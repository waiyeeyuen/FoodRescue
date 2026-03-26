import 'dotenv/config';
import amqplib from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003';

const QUEUE = 'order.error';
const DLQ = 'order.error.dlq';

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) parsed.password = parsed.password ? '***' : '';
    return parsed.toString();
  } catch {
    return String(url).replace(/\/\/([^:/@]+):([^@]+)@/g, '//\$1:***@');
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

  // partial or other conflict-like status => refund for insufficient items only
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

  await channel.assertQueue(QUEUE, { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  channel.prefetch(1);

  console.log(`[refund-management] Listening on queue: ${QUEUE}`);
  console.log(`[refund-management] DLQ enabled: ${DLQ}`);
  console.log(`[refund-management] Payment service: ${PAYMENT_SERVICE_URL}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      console.error('[refund-management] Invalid JSON; sending to DLQ');
      channel.sendToQueue(DLQ, msg.content, { persistent: true, contentType: 'application/json' });
      channel.ack(msg);
      return;
    }

    const paymentId = payload?.paymentId;
    if (!paymentId) {
      console.error('[refund-management] Missing paymentId; sending to DLQ');
      channel.sendToQueue(DLQ, msg.content, { persistent: true, contentType: 'application/json' });
      channel.ack(msg);
      return;
    }

    const { amount, reason } = buildRefundRequest(payload);
    console.log('[refund-management] Processing refund:', JSON.stringify({ paymentId, amount, reason }));

    try {
      const result = await sendRefund({ paymentId, amount, reason });
      if (result.ok) {
        console.log('[refund-management] Refund triggered successfully');
        channel.ack(msg);
        return;
      }

      // 4xx is treated as permanent (already refunded / invalid state / not found)
      if (result.status >= 400 && result.status < 500) {
        console.warn('[refund-management] Refund request rejected (ack):', result.status, result.text);
        channel.ack(msg);
        return;
      }

      console.error('[refund-management] Refund request failed; sending to DLQ:', result.status, result.text);
      channel.sendToQueue(DLQ, msg.content, {
        persistent: true,
        contentType: 'application/json',
        headers: {
          'x-error': `refund_failed_${result.status}`,
          'x-response': String(result.text || '').slice(0, 1000),
        },
      });
      channel.ack(msg);
    } catch (err) {
      console.error('[refund-management] Refund request error; sending to DLQ:', err?.message || err);
      channel.sendToQueue(DLQ, msg.content, {
        persistent: true,
        contentType: 'application/json',
        headers: { 'x-error': err?.message || String(err) },
      });
      channel.ack(msg);
    }
  });
}

start().catch((err) => {
  console.error('[refund-management] Fatal:', err?.stack || err);
  process.exit(1);
});

