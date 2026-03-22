import amqplib from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

export const QUEUES = {
  ORDER_STOCK_CHECK: 'order.stock_check',
};

let connection = null;
let channel = null;

export async function getChannel() {
  if (channel) return channel;
  connection = await amqplib.connect(RABBITMQ_URL);
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
