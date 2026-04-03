import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import amqplib from "amqplib";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4001;
const PAYMENT_SERVICE_URL     = process.env.PAYMENT_SERVICE_URL     || "http://localhost:3003";
const ORDER_SERVICE_URL        = process.env.ORDER_SERVICE_URL        || "http://localhost:3004";
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3006";
const REWARD_SERVICE_URL       = process.env.REWARD_SERVICE_URL       || "http://localhost:3005";
const RABBITMQ_URL             = process.env.RABBITMQ_URL             || "amqp://guest:guest@localhost:5672";
const REWARD_STAMP_TARGET = 5;
const REWARD_DISCOUNT_PERCENT = 20;

const QUEUES = {
  INVENTORY_CHECK: "inventory.check",
  INVENTORY_RESULT: "inventory.result",
  REFUND_REQUEST: "refund.request",
  REFUND_RESULT: "refund.result",
};

let rabbitConnection = null;
let rabbitChannel = null;

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173")
  .split(",").map((v) => v.trim()).filter(Boolean);

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!raw) return null;
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  try { return JSON.parse(raw); } catch { return raw; }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await readBody(response);
  if (!response.ok) {
    const err = new Error((data && data.error) || `Request failed (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function connectRabbitWithRetry() {
  while (true) {
    try {
      const connection = await amqplib.connect(RABBITMQ_URL);
      connection.on("error", (error) => {
        console.error("[place-order] RabbitMQ connection error:", error?.message || error);
      });
      connection.on("close", () => {
        console.warn("[place-order] RabbitMQ connection closed");
        rabbitConnection = null;
        rabbitChannel = null;
        startRabbitConsumers().catch((error) => {
          console.error("[place-order] RabbitMQ reconnect failed:", error?.message || error);
        });
      });
      return connection;
    } catch (error) {
      console.log("[place-order] RabbitMQ not ready, retrying in 3s...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function getRabbitChannel() {
  if (rabbitChannel) return rabbitChannel;

  rabbitConnection = rabbitConnection || (await connectRabbitWithRetry());
  rabbitChannel = await rabbitConnection.createChannel();

  await rabbitChannel.assertQueue(QUEUES.INVENTORY_CHECK, { durable: true });
  await rabbitChannel.assertQueue(QUEUES.INVENTORY_RESULT, { durable: true });
  await rabbitChannel.assertQueue(QUEUES.REFUND_REQUEST, { durable: true });
  await rabbitChannel.assertQueue(QUEUES.REFUND_RESULT, { durable: true });

  return rabbitChannel;
}

function buildCorrelationId(prefix, orderId) {
  return `${prefix}:${String(orderId || "").trim()}:${Date.now()}`;
}

async function publishToQueue(queue, payload) {
  const channel = await getRabbitChannel();
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
  });
  console.log(`[place-order] Published to ${queue}:`, JSON.stringify(payload, null, 2));
}

// Fire-and-forget — never throws, never blocks
function fireAndForget(url, body) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => console.warn(`[fire-and-forget] ${url} failed:`, err.message));
}

function toMinorUnits(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!Number.isInteger(num)) return Math.round(num * 100);
  if (num <= 100) return num * 100;
  return num;
}

function getItemName(item) {
  return item?.name || item?.itemName || item?.ItemName || item?.title || item?.itemId || "Item";
}

function generateOrderId() {
  return "ORD_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

function parseInteger(value, defaultValue = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(0, Math.floor(parsed));
}

function normalizeRewardStatus(payload, stampsCount) {
  const completedOrdersTowardsReward = (Number(stampsCount) || 0) % REWARD_STAMP_TARGET;
  const eligibleRaw =
    payload?.eligible ??
    payload?.Eligible ??
    payload?.isEligible ??
    payload?.IsEligible ??
    payload?.active ??
    payload?.Active;

  const eligible =
    eligibleRaw === undefined
      ? false
      : Boolean(
          typeof eligibleRaw === "string"
            ? ["true", "1", "yes", "active"].includes(eligibleRaw.trim().toLowerCase())
            : eligibleRaw
        );

  const ordersLeftRaw =
    payload?.ordersLeft ??
    payload?.OrdersLeft ??
    payload?.remainingOrders ??
    payload?.RemainingOrders;
  const parsedOrdersLeft = Number(ordersLeftRaw);
  const ordersLeft = Number.isFinite(parsedOrdersLeft)
    ? Math.max(0, Math.floor(parsedOrdersLeft))
    : (eligible ? 0 : (REWARD_STAMP_TARGET - 1) - completedOrdersTowardsReward);

  const discountPercentRaw =
    payload?.discountPercent ??
    payload?.DiscountPercent ??
    payload?.discount_percentage ??
    payload?.DiscountPercentage;
  const discountPercent = Number(discountPercentRaw ?? (eligible ? REWARD_DISCOUNT_PERCENT : 0));

  return {
    stampsCount,
    eligible,
    active: eligible,
    ordersLeft,
    stampTarget: Number(payload?.stampTarget ?? payload?.StampTarget ?? REWARD_STAMP_TARGET) || REWARD_STAMP_TARGET,
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    voucherId: String(payload?.voucherId ?? payload?.VoucherId ?? ""),
    restoreKey: String(payload?.restoreKey ?? payload?.RestoreKey ?? ""),
    source: payload?.source || payload?.Source || "unknown",
    raw: payload,
  };
}

async function markRewardUsedIfNeeded(paymentId, orderId) {
  if (!paymentId) return;

  try {
    const payment = await fetchJson(`${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}`);
    const reward = payment?.reward;

    if (!reward?.eligible) return;

    await fetchJson(`${REWARD_SERVICE_URL}/reward/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: payment?.userId,
        voucherId: reward?.voucherId || "",
        restoreKey: reward?.restoreKey || "",
        source: reward?.source || "",
      }),
    });

    console.log(`[place-order] Reward usage recorded for order ${orderId}`);
  } catch (error) {
    console.warn(`[place-order] Reward update failed for order ${orderId}:`, error.message);
  }
}

async function getConfirmedOrderCount(userId) {
  if (!userId) return 0;

  const historyResponse = await fetchJson(
    `${ORDER_SERVICE_URL}/orders/customer/${encodeURIComponent(userId)}/history?limit=100`
  );

  if (Number.isFinite(Number(historyResponse?.totalOrders))) {
    return parseInteger(historyResponse.totalOrders, 0);
  }

  const history = Array.isArray(historyResponse?.orderHistory)
    ? historyResponse.orderHistory
    : [];
  return history.length;
}

async function getRewardStatus(userId) {
  const stampsCount = await getConfirmedOrderCount(userId);

  try {
    const rewardPayload = await fetchJson(
      `${REWARD_SERVICE_URL}/reward/eligibility/${encodeURIComponent(userId)}?stampsCount=${encodeURIComponent(stampsCount)}`
    );
    return normalizeRewardStatus(rewardPayload, stampsCount);
  } catch (error) {
    return normalizeRewardStatus({ source: "local-fallback" }, stampsCount);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "composite-place-order" });
});

app.get("/orders/reward-status/:userId", async (req, res) => {
  try {
    const reward = await getRewardStatus(req.params.userId);
    res.json({ success: true, reward });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch reward status" });
  }
});

// Step 3 — UI calls this to begin order process
app.post("/orders/place", async (req, res) => {
  try {
    const {
      orderId: incomingOrderId,
      customerId: _customerId,
      userId,
      items: _items,
      cart,
      notes,
      currency,
      successUrl,
      cancelUrl,
    } = req.body || {};

    const customerId = _customerId || userId;
    const items = _items || cart;

    if (!customerId) {
      return res.status(400).json({ error: "customerId (or userId) is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items (or cart) array is required" });
    }

    const normalizedItems = items.map((item) => {
      const quantity = Number(item?.quantity ?? 1);
      const unitAmountMinor =
        toMinorUnits(item?.unitAmount) ??
        toMinorUnits(item?.price) ??
        toMinorUnits(item?.Price);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Each item must have a positive quantity");
      }
      if (unitAmountMinor == null || unitAmountMinor < 0) {
        throw new Error("Each item must have a valid unitAmount/price");
      }

      return {
        ...item,
        name: getItemName(item),
        quantity,
        unitAmount: unitAmountMinor,
      };
    });

    // orderId flows into Stripe metadata → consumer → order service
    const orderId = incomingOrderId || generateOrderId();

    const reward = await getRewardStatus(customerId);
    const multiplier = reward.eligible && Number(reward.discountPercent) > 0
      ? (100 - Number(reward.discountPercent)) / 100
      : 1;

    const paymentItems = normalizedItems.map((item) => ({
      name: item.name,
      itemId: item?.itemId || item?.listingId || item?.id || null,
      originalUnitAmount: item.unitAmount,
      unitAmount: Math.max(0, Math.round(item.unitAmount * multiplier)),
      quantity: item.quantity,
      pickupTime: item?.pickupTime || "",
      restaurantName: item?.restaurantName || "",
      restaurantId: item?.restaurantId || "",
    }));

    // Step 10 — call Payment Service to create Stripe session
    const paymentResponse = await fetchJson(
      `${PAYMENT_SERVICE_URL}/payments/checkout-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          userId: customerId,
          items: paymentItems,
          currency,
          successUrl,
          cancelUrl,
          reward,
        }),
      }
    );

    console.log(`[place-order] ✅ Checkout session created for order ${orderId}`);

    res.status(201).json({
      success: true,
      orderId,
      reward,
      payment: paymentResponse,
    });
  } catch (error) {
    console.error("[place-order] ❌ /orders/place error:", error.message);
    res.status(error.status || 500).json({ error: error.message || "Failed to place order" });
  }
});

async function requestInventoryCheck({
  orderId,
  paymentId,
  paymentIntentId,
  userId,
  currency,
  amountTotal,
  items,
}) {
  const correlationId = buildCorrelationId("inventory", orderId);
  await publishToQueue(QUEUES.INVENTORY_CHECK, {
    orderId,
    paymentId,
    paymentIntentId: paymentIntentId || null,
    userId,
    currency: currency || "sgd",
    amountTotal,
    items,
    correlationId,
    replyTo: QUEUES.INVENTORY_RESULT,
  });
  return correlationId;
}

async function requestRefund({
  orderId,
  paymentId,
  userId,
  currency,
  status,
  confirmedItems,
  insufficientItems,
  refundAmount,
  amountTotal,
}) {
  const correlationId = buildCorrelationId("refund", orderId);
  await publishToQueue(QUEUES.REFUND_REQUEST, {
    orderId,
    paymentId,
    userId,
    currency: currency || "sgd",
    status,
    confirmedItems: Array.isArray(confirmedItems) ? confirmedItems : [],
    insufficientItems: Array.isArray(insufficientItems) ? insufficientItems : [],
    refundAmount,
    amountTotal,
    correlationId,
    replyTo: QUEUES.REFUND_RESULT,
  });
  return correlationId;
}

async function processInventoryResultMessage(payload) {
  const {
    orderId,
    paymentId,
    userId,
    currency,
    status,
    confirmedItems,
    insufficientItems,
    refundAmount,
    amountTotal,
  } = payload || {};

  console.log(`[place-order] 📦 Inventory result received for order ${orderId} — status: ${status}`);
  console.log(`[place-order] Payload:`, JSON.stringify(payload, null, 2));

  if (!orderId || !paymentId || !userId || !status) {
    throw new Error("orderId, paymentId, userId, and status are required");
  }

  if (status === "ok") {
    const totalPrice = (confirmedItems || []).reduce(
      (sum, item) => sum + (Number(item.unitAmount) / 100) * Number(item.quantity),
      0
    );

    console.log(`[place-order] Creating confirmed order ${orderId}`);
    const orderRes = await fetchJson(`${ORDER_SERVICE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        customerId: userId,
        items: confirmedItems,
        totalPrice: Number(totalPrice.toFixed(2)),
        currency: currency || "sgd",
        status: "confirmed",
      }),
    });
    console.log(`[place-order] ✅ Order created:`, orderRes?.order?.orderId || orderId);

    try {
      await fetchJson(`${PAYMENT_SERVICE_URL}/payments/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          paymentId,
          amount: amountTotal,
          status: "completed",
        }),
      });
      console.log(`[place-order] ✅ Payment logged for order ${orderId}`);
    } catch (error) {
      console.warn(`[place-order] ⚠️ Payment log failed (non-fatal):`, error.message);
    }

    await markRewardUsedIfNeeded(paymentId, orderId);

    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_CONFIRMED",
      orderId,
    });
    console.log(`[place-order] 📨 ORDER_CONFIRMED notification fired for ${userId}`);
    return;
  }

  if (status === "partial") {
    const partialTotal = (confirmedItems || []).reduce(
      (sum, item) => sum + (Number(item.unitAmount) / 100) * Number(item.quantity),
      0
    );

    console.log(`[place-order] Creating partial order ${orderId}`);
    await fetchJson(`${ORDER_SERVICE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        customerId: userId,
        items: confirmedItems,
        totalPrice: Number(partialTotal.toFixed(2)),
        currency: currency || "sgd",
        status: "confirmed",
        notes: `Partial order — out of stock: ${(insufficientItems || [])
          .map((item) => item.name)
          .join(", ")}`,
      }),
    });
    console.log(`[place-order] ✅ Partial order created`);

    await markRewardUsedIfNeeded(paymentId, orderId);
    await requestRefund({
      orderId,
      paymentId,
      userId,
      currency,
      status,
      confirmedItems,
      insufficientItems,
      refundAmount,
      amountTotal,
    });
    return;
  }

  if (status === "failed") {
    console.log(`[place-order] ❌ All items out of stock — requesting full refund for order ${orderId}`);
    await requestRefund({
      orderId,
      paymentId,
      userId,
      currency,
      status,
      confirmedItems,
      insufficientItems,
      refundAmount,
      amountTotal,
    });
    return;
  }

  throw new Error(`Unknown inventory status: ${status}`);
}

async function processRefundResultMessage(payload) {
  const {
    orderId,
    userId,
    status,
    refundAmount,
    refundId,
    refundStatus,
    insufficientItems,
  } = payload || {};

  console.log(`[place-order] 💸 Refund result received for order ${orderId} — status: ${refundStatus}`);
  console.log(`[place-order] Payload:`, JSON.stringify(payload, null, 2));

  if (!orderId || !userId || !status) {
    throw new Error("orderId, userId, and status are required");
  }

  const normalizedRefundStatus = String(refundStatus || "").toLowerCase();
  if (!["succeeded", "success", "completed"].includes(normalizedRefundStatus)) {
    console.warn(`[place-order] Refund not successful for order ${orderId}: ${refundStatus || "unknown"}`);
    return;
  }

  if (status === "partial") {
    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_PARTIAL",
      orderId,
      insufficientItems,
      refundAmount,
      refundId,
      refundStatus,
    });
    console.log(`[place-order] 📨 ORDER_PARTIAL notification fired for ${userId}`);
    return;
  }

  if (status === "failed") {
    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_REFUNDED",
      orderId,
      refundAmount,
      refundId,
      refundStatus,
    });
    console.log(`[place-order] 📨 ORDER_REFUNDED notification fired for ${userId}`);
    return;
  }

  console.warn(`[place-order] Ignoring refund result with unsupported status: ${status}`);
}

app.post("/orders/payment-confirmed", async (req, res) => {
  try {
    const {
      orderId,
      paymentId,
      paymentIntentId,
      userId,
      currency,
      amountTotal,
      items,
    } = req.body || {};

    if (!orderId || !paymentId || !userId) {
      return res.status(400).json({ error: "orderId, paymentId, and userId are required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    const correlationId = await requestInventoryCheck({
      orderId,
      paymentId,
      paymentIntentId,
      userId,
      currency,
      amountTotal,
      items,
    });

    return res.json({
      success: true,
      orderId,
      paymentId,
      queued: true,
      correlationId,
    });
  } catch (error) {
    console.error("[place-order] ❌ /orders/payment-confirmed error:", error.message);
    return res.status(error.status || 500).json({
      error: error.message || "Failed to queue inventory check",
    });
  }
});

async function startRabbitConsumers() {
  const channel = await getRabbitChannel();
  channel.prefetch(5);

  await channel.consume(QUEUES.INVENTORY_RESULT, async (msg) => {
    if (!msg) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      await processInventoryResultMessage(payload);
      channel.ack(msg);
    } catch (error) {
      console.error("[place-order] ❌ inventory.result processing failed:", error?.message || error);
      channel.nack(msg, false, true);
    }
  });

  await channel.consume(QUEUES.REFUND_RESULT, async (msg) => {
    if (!msg) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      await processRefundResultMessage(payload);
      channel.ack(msg);
    } catch (error) {
      console.error("[place-order] ❌ refund.result processing failed:", error?.message || error);
      channel.nack(msg, false, true);
    }
  });

  console.log(
    `[place-order] RabbitMQ consumers ready on ${QUEUES.INVENTORY_RESULT} and ${QUEUES.REFUND_RESULT}`
  );
}

startRabbitConsumers().catch((error) => {
  console.error("[place-order] RabbitMQ startup failed:", error?.message || error);
});

app.listen(PORT, () => {
  console.log(`Composite place-order service running on port ${PORT}`);
});
