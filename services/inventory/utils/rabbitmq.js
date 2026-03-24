import amqplib from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

export const EXCHANGES = {
  EVENTS: 'foodrescue.events',
};

export const QUEUES = {
  ORDER_STOCK_CHECK: 'order.stock_check',
};

let connection = null;
let channel = null;

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) parsed.password = parsed.password ? '***' : '';
    return parsed.toString();
  } catch {
    return String(url).replace(/\/\/([^:/@]+):([^@]+)@/g, '//\$1:***@');
  }
}

export async function getChannel() {
  if (channel) return channel;
  console.log('[RabbitMQ] Using URL:', maskUrl(RABBITMQ_URL));
  connection = await amqplib.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGES.EVENTS, 'topic', { durable: true });
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

// Pub-sub: publish an event to the topic exchange using a routing key like "order.created".
export async function publishEvent(routingKey, payload) {
  const ch = await getChannel();
  ch.publish(EXCHANGES.EVENTS, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: 'application/json',
    timestamp: Date.now(),
  });
  console.log(`[RabbitMQ] Published event "${routingKey}"`);
}

// Pub-sub: each subscriber should use its own queue name, bind patterns, then consume.
export async function subscribe({ queue, bindings, onMessage, prefetch = 10, durable = true }) {
  if (!queue) throw new Error('subscribe requires queue');
  if (!bindings || bindings.length === 0) throw new Error('subscribe requires bindings[]');
  if (typeof onMessage !== 'function') throw new Error('subscribe requires onMessage');

  const ch = await getChannel();
  await ch.assertQueue(queue, { durable });
  for (const pattern of bindings) {
    await ch.bindQueue(queue, EXCHANGES.EVENTS, pattern);
  }
  ch.prefetch(prefetch);

  console.log(`[RabbitMQ] Subscribed queue "${queue}" to: ${bindings.join(', ')}`);

  ch.consume(queue, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields?.routingKey || '';

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      payload = msg.content.toString();
    }

    try {
      await onMessage(routingKey, payload, msg);
      ch.ack(msg);
    } catch (err) {
      console.error('[RabbitMQ] Subscriber handler failed:', err?.message || err);
      ch.nack(msg, false, false);
    }
  });
}
