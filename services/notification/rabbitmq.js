// rabbitmq.js
import amqp from 'amqplib';

let connection;
export const pool = [];

export async function connectRabbitMQ() {
  connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
  const channel = await connection.createChannel();
  
  for (let i = 0; i < 5; i++) {
    pool.push(await connection.createChannel());
  }
  
  const queues = ['order.expired', 'listing.expired', 'reward.triggered'];
  for (const queue of queues) {
    await channel.assertQueue(queue, { durable: true });
  }
  
  console.log('✅ RabbitMQ connected + queues ready');
  return channel;
}

export function getChannel() {
  return pool.shift() || connection.createChannel();
}

export { connection };
