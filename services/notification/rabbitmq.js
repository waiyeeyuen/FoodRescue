// rabbitmq.js
import amqp from 'amqplib';

let connection;
export const pool = [];
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const QUEUES = ['order.expired', 'listing.expired', 'reward.triggered'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(retries = 20, delayMs = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      console.log(`[notifications/rabbitmq] Connecting to ${RABBITMQ_URL} (attempt ${attempt}/${retries})`);
      return await amqp.connect(RABBITMQ_URL);
    } catch (error) {
      lastError = error;
      console.warn('[notifications/rabbitmq] RabbitMQ not ready, retrying...');
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function resetConnectionState() {
  connection = undefined;
  pool.length = 0;
}

export async function connectRabbitMQ() {
  if (!connection) {
    connection = await connectWithRetry();
    connection.on('close', resetConnectionState);
    connection.on('error', (error) => {
      console.error('[notifications/rabbitmq] Connection error:', error?.message || error);
    });
  }

  const channel = await connection.createChannel();

  if (pool.length === 0) {
    for (let i = 0; i < 5; i += 1) {
      pool.push(await connection.createChannel());
    }
  }

  for (const queue of QUEUES) {
    await channel.assertQueue(queue, { durable: true });
  }

  console.log('✅ RabbitMQ connected + queues ready');
  return channel;
}

export function getChannel() {
  return pool.shift() || connection.createChannel();
}

export { connection };
