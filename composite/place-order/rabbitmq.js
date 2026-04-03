import amqplib from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

export const QUEUES = {
  ORDER_STOCK_CHECK: "order.stock_check",
};

let connection = null;
let channel = null;

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.password = parsed.password ? "***" : "";
    }
    return parsed.toString();
  } catch {
    return String(url).replace(/\/\/([^:/@]+):([^@]+)@/g, "//$1:***@");
  }
}

async function connectWithRetry(retries = 10, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      console.log(`[place-order/rabbitmq] Connecting to ${maskUrl(RABBITMQ_URL)} (attempt ${attempt}/${retries})`);
      const conn = await amqplib.connect(RABBITMQ_URL);
      conn.on("close", () => {
        connection = null;
        channel = null;
      });
      conn.on("error", (err) => {
        console.warn("[place-order/rabbitmq] Connection error:", err?.message || err);
      });
      return conn;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
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
  const activeChannel = await getChannel();
  activeChannel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
  });
  console.log(`[place-order/rabbitmq] Published to ${queue}:`, payload);
}
