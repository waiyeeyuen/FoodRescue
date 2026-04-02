import 'dotenv/config';
import amqplib from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003';

const QUEUE = 'order.error';
const DLQ = 'order.error.dlq';
const DLX = 'order.error.dlx';
const FAILURE_QUEUE = 'refund.failed';

const MAX_RETRIES = 3;

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

async function sendRefund({ paymentId, amount, reason }) {
  const res = await fetch(`${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, reason }),
  });

  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

async function start() {
  const connection = await connectWithRetry();
  const channel = await connection.createChannel();

  // DLX setup (for invalid messages only)
  await channel.assertExchange(DLX, 'direct', { durable: true });

  await channel.assertQueue(DLQ, { durable: true });
  await channel.bindQueue(DLQ, DLX, 'dlq');

  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DLX,
      'x-dead-letter-routing-key': 'dlq',
    },
  });

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
      console.error('[refund-management] Invalid JSON; rejecting to DLQ');
      channel.reject(msg, false); // DLX handles
      return;
    }

    const paymentId = payload?.paymentId;
    if (!paymentId) {
      console.error('[refund-management] Missing paymentId; rejecting to DLQ');
      channel.reject(msg, false);
      return;
    }

    const retryCount = msg.properties.headers?.['x-retry-count'] || 0;

    const { amount, reason } = buildRefundRequest(payload);

    console.log(`[refund-management] Attempt ${retryCount + 1} for paymentId=${paymentId}`);

    try {
      const result = await sendRefund({ paymentId, amount, reason });

      if (result.ok) {
        console.log('[refund-management] Refund successful');
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

        channel.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            ...msg.properties.headers,
            'x-retry-count': retryCount + 1,
          },
        });

      } else {
        console.error('[refund-management] Max retries reached → sending to failure queue');

        channel.sendToQueue(FAILURE_QUEUE, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            ...msg.properties.headers,
            'x-retry-count': retryCount,
            'x-error': `refund_failed_${result.status}`,
            'x-response': String(result.text || '').slice(0, 1000),
          },
        });
      }

      channel.ack(msg);

    } catch (err) {
      console.error('[refund-management] Network/system error:', err?.message);

      if (retryCount < MAX_RETRIES) {
        channel.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            ...msg.properties.headers,
            'x-retry-count': retryCount + 1,
          },
        });
      } else {
        channel.sendToQueue(FAILURE_QUEUE, msg.content, {
          persistent: true,
          contentType: 'application/json',
          headers: {
            ...msg.properties.headers,
            'x-retry-count': retryCount,
            'x-error': err?.message || String(err),
          },
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
