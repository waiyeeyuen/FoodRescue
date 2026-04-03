import 'dotenv/config';
import amqplib from 'amqplib';
import Stripe from 'stripe';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

const QUEUE = 'refund.request';
const DLQ = 'refund.request.dlq';
const RESULT_QUEUE = 'refund.result';
const FAILURE_QUEUE = 'refund.failed';
const MAX_RETRIES = 3;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function publishToQueue(channel, queue, content, headers = {}) {
  channel.sendToQueue(queue, content, {
    persistent: true,
    contentType: 'application/json',
    headers,
  });
}

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) parsed.password = parsed.password ? '***' : '';
    return parsed.toString();
  } catch {
    return String(url).replace(/\/\/([^:/@]+):([^@]+)@/g, '//$1:***@');
  }
}

async function connectWithRetry(retries = 20, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      console.log(
        `[refund-management] Connecting to RabbitMQ ${maskUrl(RABBITMQ_URL)} (attempt ${attempt}/${retries})`
      );
      return await amqplib.connect(RABBITMQ_URL);
    } catch (error) {
      lastError = error;
      console.log('[refund-management] RabbitMQ not ready, retrying...');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function buildRefundRequest(payload) {
  const status = String(payload?.status || '').toLowerCase();
  const fullRefund = Boolean(payload?.fullRefund);
  const amountTotal = Number(payload?.amountTotal ?? 0);
  const refundAmount = Number(payload?.refundAmount ?? 0);

  const insufficientItems = Array.isArray(payload?.insufficientItems) ? payload.insufficientItems : [];
  const itemNames = insufficientItems.map((item) => item?.name).filter(Boolean);

  if (status === 'failed' || fullRefund) {
    return {
      amount: amountTotal,
      reason: itemNames.length > 0
        ? `inventory_conflict: full refund issued (${itemNames.join(', ')})`
        : 'inventory_conflict: full refund issued',
    };
  }

  return {
    amount: refundAmount || amountTotal,
    reason: itemNames.length > 0
      ? `inventory_conflict: ${itemNames.join(', ')}`
      : 'inventory_conflict',
  };
}

async function sendRefund({ paymentIntentId, amount, reason }) {
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!paymentIntentId) {
    return {
      ok: false,
      status: 400,
      text: JSON.stringify({ error: 'Missing paymentIntentId' }),
      data: null,
    };
  }

  const refundPayload = { payment_intent: paymentIntentId };
  if (amount) refundPayload.amount = amount;
  if (reason) refundPayload.metadata = { reason };

  try {
    const refund = await stripe.refunds.create(refundPayload);
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ refundId: refund.id, refundStatus: refund.status }),
      data: refund,
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 500) || 500;
    return {
      ok: false,
      status: statusCode,
      text: JSON.stringify({
        error: error?.message || 'Failed to create Stripe refund',
        code: error?.code || '',
      }),
      data: null,
    };
  }
}

function sendToDlq(channel, msg, reason) {
  publishToQueue(channel, DLQ, msg.content, {
    ...msg.properties.headers,
    'x-error': reason,
    'x-source-queue': QUEUE,
  });
}

function publishRefundResult(channel, payload, override = {}) {
  const responseQueue = payload?.replyTo || RESULT_QUEUE;
  const resultPayload = {
    orderId: payload?.orderId || '',
    paymentId: payload?.paymentId || '',
    userId: payload?.userId || '',
    status: payload?.status || '',
    fullRefund: Boolean(payload?.fullRefund),
    insufficientItems: Array.isArray(payload?.insufficientItems) ? payload.insufficientItems : [],
    refundAmount: Number(payload?.refundAmount ?? payload?.amountTotal ?? 0) || 0,
    refundId: '',
    refundStatus: 'failed',
    correlationId: payload?.correlationId || null,
    ...override,
  };

  publishToQueue(channel, responseQueue, Buffer.from(JSON.stringify(resultPayload)));
}

async function start() {
  const connection = await connectWithRetry();
  const channel = await connection.createChannel();

  await channel.assertQueue(QUEUE, { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  await channel.assertQueue(RESULT_QUEUE, { durable: true });
  await channel.assertQueue(FAILURE_QUEUE, { durable: true });
  channel.prefetch(1);

  console.log(`[refund-management] Listening on queue: ${QUEUE}`);
  console.log(`[refund-management] DLQ (invalid messages): ${DLQ}`);
  console.log(`[refund-management] Result queue: ${RESULT_QUEUE}`);
  console.log(`[refund-management] Failure queue (retry exhausted): ${FAILURE_QUEUE}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      console.error('[refund-management] Invalid JSON; sending to DLQ');
      sendToDlq(channel, msg, 'invalid_json');
      channel.ack(msg);
      return;
    }

    const paymentId = payload?.paymentId;
    const paymentIntentId = payload?.paymentIntentId;
    if (!paymentId) {
      console.error('[refund-management] Missing paymentId; sending to DLQ');
      sendToDlq(channel, msg, 'missing_payment_id');
      channel.ack(msg);
      return;
    }
    if (!paymentIntentId) {
      console.error('[refund-management] Missing paymentIntentId; sending to DLQ');
      sendToDlq(channel, msg, 'missing_payment_intent_id');
      publishRefundResult(channel, payload, {
        refundStatus: 'failed',
        error: 'Missing paymentIntentId',
      });
      channel.ack(msg);
      return;
    }

    const retryCount = msg.properties.headers?.['x-retry-count'] || 0;
    const { amount, reason } = buildRefundRequest(payload);

    console.log(`[refund-management] Attempt ${retryCount + 1} for paymentId=${paymentId}`);

    try {
      const result = await sendRefund({ paymentIntentId, amount, reason });

      if (result.ok) {
        console.log('[refund-management] Refund successful');
        publishRefundResult(channel, payload, {
          refundId: result.data?.id || '',
          refundStatus: result.data?.status || 'succeeded',
        });
        channel.ack(msg);
        return;
      }

      if (result.status >= 400 && result.status < 500) {
        console.warn('[refund-management] Business failure (ack):', result.status, result.text);
        publishRefundResult(channel, payload, {
          refundStatus: 'failed',
          error: String(result.text || '').slice(0, 1000),
        });
        channel.ack(msg);
        return;
      }

      if (retryCount < MAX_RETRIES) {
        console.warn(`[refund-management] Retry ${retryCount + 1}/${MAX_RETRIES}`);
        publishToQueue(channel, QUEUE, msg.content, {
          ...msg.properties.headers,
          'x-retry-count': retryCount + 1,
        });
      } else {
        console.error('[refund-management] Max retries reached → sending to failure queue');
        publishToQueue(channel, FAILURE_QUEUE, msg.content, {
          ...msg.properties.headers,
          'x-retry-count': retryCount,
          'x-error': `refund_failed_${result.status}`,
          'x-response': String(result.text || '').slice(0, 1000),
        });
        publishRefundResult(channel, payload, {
          refundStatus: 'failed',
          error: `refund_failed_${result.status}`,
        });
      }

      channel.ack(msg);
    } catch (error) {
      console.error('[refund-management] Network/system error:', error?.message || error);

      if (retryCount < MAX_RETRIES) {
        publishToQueue(channel, QUEUE, msg.content, {
          ...msg.properties.headers,
          'x-retry-count': retryCount + 1,
        });
      } else {
        publishToQueue(channel, FAILURE_QUEUE, msg.content, {
          ...msg.properties.headers,
          'x-retry-count': retryCount,
          'x-error': error?.message || String(error),
        });
        publishRefundResult(channel, payload, {
          refundStatus: 'failed',
          error: error?.message || String(error),
        });
      }

      channel.ack(msg);
    }
  });
}

start().catch((error) => {
  console.error('[refund-management] Fatal:', error?.stack || error);
  process.exit(1);
});
