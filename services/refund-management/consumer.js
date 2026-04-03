import 'dotenv/config';
import amqplib from 'amqplib';
import Stripe from 'stripe';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const PLACE_ORDER_SERVICE_URL = process.env.PLACE_ORDER_SERVICE_URL || 'http://localhost:4001';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

const QUEUE = 'order.error';
const DLQ = 'order.error.dlq';
const FAILURE_QUEUE = 'refund.failed';

const MAX_RETRIES = 3;
const stripe = new Stripe(STRIPE_SECRET_KEY);

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
      console.log(`[refund-management] Connecting to RabbitMQ ${maskUrl(RABBITMQ_URL)} (attempt ${attempt}/${retries})`);
      return await amqplib.connect(RABBITMQ_URL);
    } catch (err) {
      lastError = err;
      console.log('[refund-management] RabbitMQ not ready, retrying...');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

function buildRefundRequest(payload) {
  const status = String(payload?.status || '').toLowerCase();
  const amountTotal = Number(payload?.amountTotal ?? 0);
  const refundAmount = Number(payload?.refundAmount ?? 0);

  const insufficientItems = Array.isArray(payload?.insufficientItems) ? payload.insufficientItems : [];
  const itemNames = insufficientItems.map((i) => i?.name).filter(Boolean);

  if (status === 'failed') {
    return {
      amount: amountTotal,
      reason: itemNames.length > 0
        ? `inventory_conflict: all items out of stock (${itemNames.join(', ')})`
        : 'inventory_conflict: all items out of stock',
    };
  }

  return {
    amount: refundAmount || amountTotal,
    reason: itemNames.length > 0
      ? `inventory_conflict: ${itemNames.join(', ')}`
      : 'inventory_conflict',
  };
}

async function sendRefund({ paymentId, paymentIntentId, amount, reason }) {
  if (!paymentIntentId) {
    return {
      ok: false,
      status: 400,
      text: 'Missing Stripe payment intent ID',
    };
  }

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      ...(amount ? { amount } : {}),
      ...(reason ? { metadata: { reason } } : {}),
    },
    {
      idempotencyKey: `refund:${paymentId}:${amount || 0}:${reason || ''}`,
    }
  );

  return {
    ok: ['succeeded', 'pending'].includes(String(refund?.status || '').toLowerCase()),
    status: 200,
    refund,
  };
}

async function notifyPlaceOrderRefund(payload) {
  const res = await fetch(`${PLACE_ORDER_SERVICE_URL}/orders/refund-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Place Order refund callback failed (${res.status}): ${text}`);
  }

  return text;
}

function sendToDlq(channel, msg, reason) {
  publishToQueue(channel, DLQ, msg.content, {
    ...msg.properties.headers,
    'x-error': reason,
    'x-source-queue': QUEUE,
  });
}

async function start() {
  const connection = await connectWithRetry();
  const channel = await connection.createChannel();

  await channel.assertQueue(DLQ, { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });

  // Failure queue (NEW)
  await channel.assertQueue(FAILURE_QUEUE, { durable: true });

  channel.prefetch(1);

  console.log(`[refund-management] Listening on queue: ${QUEUE}`);
  console.log(`[refund-management] DLQ (invalid messages): ${DLQ}`);
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
      channel.ack(msg);
      return;
    }

    const retryCount = msg.properties.headers?.['x-retry-count'] || 0;

    const { amount, reason } = buildRefundRequest(payload);

    console.log(`[refund-management] Attempt ${retryCount + 1} for paymentId=${paymentId}`);

    try {
      const result = await sendRefund({ paymentId, paymentIntentId, amount, reason });

      if (result.ok) {
        console.log('[refund-management] Refund successful');

        await notifyPlaceOrderRefund({
          orderId: payload.orderId,
          paymentId,
          userId: payload.userId,
          status: payload.status,
          confirmedItems: payload.confirmedItems || [],
          insufficientItems: payload.insufficientItems || [],
          refundAmount: amount,
          refundId: result.refund?.id || '',
          refundStatus: result.refund?.status || 'succeeded',
        });

        channel.ack(msg);
        return;
      }

      // Business failure (4xx) → do not retry
      if (result.status >= 400 && result.status < 500) {
        console.warn('[refund-management] Business failure (ack):', result.status, result.text);
        channel.ack(msg);
        return;
      }

      // System failure (5xx) → retry logic
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
      }

      channel.ack(msg);

    } catch (err) {
      console.error('[refund-management] Network/system error:', err?.message);

      if (retryCount < MAX_RETRIES) {
        publishToQueue(channel, QUEUE, msg.content, {
          ...msg.properties.headers,
          'x-retry-count': retryCount + 1,
        });
      } else {
        publishToQueue(channel, FAILURE_QUEUE, msg.content, {
          ...msg.properties.headers,
          'x-retry-count': retryCount,
          'x-error': err?.message || String(err),
        });
      }

      channel.ack(msg);
    }
  });
}

start().catch((err) => {
  console.error('[refund-management] Fatal:', err?.stack || err);
  process.exit(1);
});
