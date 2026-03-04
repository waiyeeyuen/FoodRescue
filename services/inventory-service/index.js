import express from "express";
import amqp from "amqplib";
import crypto from "crypto";
import inventoryRouter from './routes/inventory.js'

const SERVICE = process.env.SERVICE_NAME || "service";
const PORT = Number(process.env.PORT || 3000);
const RABBITMQ_URL = process.env.RABBITMQ_URL;

const app = express();
app.use(express.json());

// Simple request id / trace id
app.use((req, _res, next) => {
  req.traceId = req.header("x-request-id") || crypto.randomUUID();
  next();
});

function errorResponse(res, traceId, code, message, status = 400) {
  return res.status(status).json({ error: { code, message, traceId } });
}

let channel = null;
const EXCHANGE = "food.events";

async function initRabbit() {
  if (!RABBITMQ_URL) return;
  const conn = await amqp.connect(RABBITMQ_URL);
  channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  console.log(`[${SERVICE}] RabbitMQ connected`);
}

async function publishEvent(routingKey, payload) {
  if (!channel) return;
  const body = Buffer.from(JSON.stringify(payload));
  channel.publish(EXCHANGE, routingKey, body, {
    contentType: "application/json",
    persistent: true,
    messageId: crypto.randomUUID(),
    headers: { traceId: payload.traceId }
  });
}

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true, service: SERVICE, traceId: req.traceId });
});

// Example endpoint
app.post("/", async (req, res) => {
  if (!req.body) return errorResponse(res, req.traceId, "BAD_REQUEST", "Missing body");
  const result = { id: crypto.randomUUID(), ...req.body, traceId: req.traceId };

  // Example: publish something
  await publishEvent(`${SERVICE}.created`, result);

  res.status(201).json(result);
});


app.use("/inventory", inventoryRouter)

initRabbit()
  .catch((e) => console.error(`[${SERVICE}] Rabbit init failed (running without MQ):`, e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`[${SERVICE}] listening on :${PORT}`));
  });
