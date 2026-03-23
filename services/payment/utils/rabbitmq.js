import amqplib from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

export const QUEUES = {
  ORDER_STOCK_CHECK: 'order.stock_check',
};

let connection = null;
let channel = null;

async function connectWithRetry(retries = 5, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      console.log(`[RabbitMQ] Connecting to ${RABBITMQ_URL} (attempt ${i + 1}/${retries})`);
      const conn = await amqplib.connect(RABBITMQ_URL);
      conn.on('error', (err) => {
        console.error('[RabbitMQ] Connection error:', err?.message || err);
      });
      conn.on('close', () => {
        console.warn('[RabbitMQ] Connection closed');
        connection = null;
        channel = null;
      });
      return conn;
    } catch (err) {
      lastError = err;
      console.error('[RabbitMQ] Connect failed:', err?.message || err);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

export async function getChannel() {
  if (channel) return channel;
  connection = await connectWithRetry();
  channel = await connection.createChannel();
  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, { durable: true });
  }
  return channel;
}

export async function publishToQueue(queue, payload) {
  const ch = await getChannel();
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: 'application/json',
  });
  console.log(`[RabbitMQ] Published to ${queue}:`, payload);
}
