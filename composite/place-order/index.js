import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import amqplib from "amqplib";
import { randomUUID } from "crypto";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

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
const CORRELATION_HEADER = "x-correlation-id";

let rabbitConnection = null;
let rabbitChannel = null;

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173")
  .split(",").map((v) => v.trim()).filter(Boolean);

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Place Order Service API",
      version: "1.0.0",
      description: "Composite service for placing orders, handling payment, inventory and rewards"
    },
    paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: {
          200: {
            description: "Service is running",
            content: {
              "application/json": {
                example: {
                  status: "ok",
                  service: "composite-place-order"
                }
              }
            }
          }
        }
      }
    },

    "/orders/reward-status/{userId}": {
      get: {
        summary: "Get reward status",
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "Reward status retrieved",
            content: {
              "application/json": {
                example: {
                  success: true,
                  reward: {
                    eligible: false,
                    discountPercent: 0
                  }
                }
              }
            }
          },
          500: {
            description: "Server error"
          }
        }
      }
    },

    "/orders/place": {
      post: {
        summary: "Place Order",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: {
                customerId: "cust_001",
                items: [
                  {
                    itemId: "RES123_ITEM1",
                    quantity: 2,
                    price: 5.99
                  }
                ]
              }
            }
          }
        },
        responses: {
          201: {
            description: "Order placed successfully"
          },
          400: {
            description: "Missing required fields"
          },
          500: {
            description: "Server error"
          }
        }
      }
    },

    "/orders/payment-confirmed": {
      post: {
        summary: "Confirm payment and trigger inventory check",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: {
                orderId: "ORD_123",
                paymentId: "PAY_123",
                userId: "cust_001",
                items: []
              }
            }
          }
        },
        responses: {
          200: {
            description: "Inventory check queued"
          },
          400: {
            description: "Missing required fields"
          },
          500: {
            description: "Server error"
          }
        }
      }
    }
  },
    servers: [
      {
        url: `http://localhost:${PORT}`
      }
    ]
  },
  apis: ["./index.js"],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(cors({ origin: corsOrigins }));
app.use(express.json());

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function createCorrelationId(scope = "place-order") {
  return `${scope}:${randomUUID()}`;
}

function resolveCorrelationId(value, scope = "place-order") {
  return String(value || "").trim() || createCorrelationId(scope);
}

function withCorrelationHeaders(headers = {}, correlationId = "") {
  if (!correlationId) return { ...headers };
  return {
    ...headers,
    [CORRELATION_HEADER]: correlationId,
  };
}

function getMessageCorrelationId(msg, payload, scope = "place-order") {
  return (
    getHeaderValue(msg?.properties?.headers, CORRELATION_HEADER) ||
    String(payload?.correlationId || "").trim() ||
    createCorrelationId(scope)
  );
}

function correlationMiddleware(serviceName) {
  return (req, res, next) => {
    const correlationId = resolveCorrelationId(getHeaderValue(req.headers), serviceName);
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    console.log(`[${serviceName}] ${req.method} ${req.originalUrl} cid=${correlationId}`);
    next();
  };
}

app.use(correlationMiddleware("place-order"));

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

async function fetchJson(url, options = {}, correlationId = "") {
  const response = await fetch(url, {
    ...options,
    headers: withCorrelationHeaders(options?.headers || {}, correlationId),
  });
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

async function publishToQueue(queue, payload, correlationId = "") {
  const channel = await getRabbitChannel();
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
    headers: withCorrelationHeaders({}, correlationId || payload?.correlationId || ""),
  });
  console.log(
    `[place-order] Published to ${queue} cid=${correlationId || payload?.correlationId || "n/a"}:`,
    JSON.stringify(payload, null, 2)
  );
}

// Fire-and-forget — never throws, never blocks
function fireAndForget(url, body, correlationId = "") {
  fetch(url, {
    method: "POST",
    headers: withCorrelationHeaders({ "Content-Type": "application/json" }, correlationId),
    body: JSON.stringify(body),
  }).catch((err) =>
    console.warn(`[fire-and-forget] ${url} failed cid=${correlationId || "n/a"}:`, err.message)
  );
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

async function markRewardUsedIfNeeded(paymentId, orderId, correlationId = "") {
  if (!paymentId) return;

  try {
    const payment = await fetchJson(
      `${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}`,
      {},
      correlationId
    );
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
    }, correlationId);

    console.log(`[place-order] Reward usage recorded for order ${orderId} cid=${correlationId || "n/a"}`);
  } catch (error) {
    console.warn(
      `[place-order] Reward update failed for order ${orderId} cid=${correlationId || "n/a"}:`,
      error.message
    );
  }
}

async function getConfirmedOrderCount(userId, correlationId = "") {
  if (!userId) return 0;

  const historyResponse = await fetchJson(
    `${ORDER_SERVICE_URL}/orders/customer/${encodeURIComponent(userId)}/history?limit=100`,
    {},
    correlationId
  );

  if (Number.isFinite(Number(historyResponse?.totalOrders))) {
    return parseInteger(historyResponse.totalOrders, 0);
  }

  const history = Array.isArray(historyResponse?.orderHistory)
    ? historyResponse.orderHistory
    : [];
  return history.length;
}

async function getRewardStatus(userId, correlationId = "") {
  const stampsCount = await getConfirmedOrderCount(userId, correlationId);

  try {
    const rewardPayload = await fetchJson(
      `${REWARD_SERVICE_URL}/reward/eligibility/${encodeURIComponent(userId)}?stampsCount=${encodeURIComponent(stampsCount)}`,
      {},
      correlationId
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
    const reward = await getRewardStatus(req.params.userId, req.correlationId);
    res.json({ success: true, reward });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch reward status" });
  }
});

// Step 3 — UI calls this to begin order process
app.post("/orders/place", async (req, res) => {
  try {
    const correlationId = req.correlationId;
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

    const reward = await getRewardStatus(customerId, correlationId);
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
      },
      correlationId
    );

    console.log(`[place-order] ✅ Checkout session created for order ${orderId} cid=${correlationId}`);

    res.status(201).json({
      success: true,
      orderId,
      reward,
      payment: paymentResponse,
      correlationId,
    });
  } catch (error) {
    console.error(`[place-order] ❌ /orders/place error cid=${req.correlationId || "n/a"}:`, error.message);
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
  correlationId,
}) {
  const resolvedCorrelationId = resolveCorrelationId(correlationId, `inventory:${String(orderId || "").trim()}`);
  await publishToQueue(QUEUES.INVENTORY_CHECK, {
    orderId,
    paymentId,
    paymentIntentId: paymentIntentId || null,
    userId,
    currency: currency || "sgd",
    amountTotal,
    items,
    correlationId: resolvedCorrelationId,
    replyTo: QUEUES.INVENTORY_RESULT,
  }, resolvedCorrelationId);
  return resolvedCorrelationId;
}

async function requestRefund({
  orderId,
  paymentId,
  paymentIntentId,
  userId,
  currency,
  status,
  fullRefund,
  confirmedItems,
  insufficientItems,
  refundAmount,
  amountTotal,
  correlationId,
}) {
  const resolvedCorrelationId = resolveCorrelationId(correlationId, `refund:${String(orderId || "").trim()}`);
  await publishToQueue(QUEUES.REFUND_REQUEST, {
    orderId,
    paymentId,
    paymentIntentId: paymentIntentId || null,
    userId,
    currency: currency || "sgd",
    status,
    fullRefund: Boolean(fullRefund),
    confirmedItems: Array.isArray(confirmedItems) ? confirmedItems : [],
    insufficientItems: Array.isArray(insufficientItems) ? insufficientItems : [],
    refundAmount,
    amountTotal,
    correlationId: resolvedCorrelationId,
    replyTo: QUEUES.REFUND_RESULT,
  }, resolvedCorrelationId);
  return resolvedCorrelationId;
}

const REFUND_SUCCESS_STATUSES = new Set(["succeeded", "success", "completed"]);
const REFUND_PENDING_STATUSES = new Set(["pending", "processing", "requires_action"]);

function getRefundLifecycle(refundStatus) {
  const normalizedRefundStatus = String(refundStatus || "").trim().toLowerCase();

  if (REFUND_SUCCESS_STATUSES.has(normalizedRefundStatus)) {
    return "succeeded";
  }

  if (REFUND_PENDING_STATUSES.has(normalizedRefundStatus)) {
    return "pending";
  }

  return "failed";
}

function getOrderTotalPrice(items = []) {
  return Number(
    items
      .reduce((sum, item) => {
        const quantity = Number(item?.quantity ?? 1);
        const unitAmountMinor = Number(item?.unitAmount ?? item?.originalUnitAmount ?? 0);
        return sum + (unitAmountMinor / 100) * (Number.isFinite(quantity) ? quantity : 0);
      }, 0)
      .toFixed(2)
  );
}

function buildRefundOutcomeItems({
  status,
  fullRefund,
  confirmedItems,
  insufficientItems,
  refundLifecycle,
  refundStatus,
  refundId,
  error,
}) {
  const resolvedConfirmedItems = Array.isArray(confirmedItems) ? confirmedItems : [];
  const resolvedInsufficientItems = Array.isArray(insufficientItems) ? insufficientItems : [];
  const refundOutcomeStatus =
    refundLifecycle === "succeeded"
      ? "refunded"
      : refundLifecycle === "pending"
        ? "refund_pending"
        : "refund_failed";
  const keepConfirmedItems = status === "partial" && !fullRefund;

  const decorateItem = (item, fulfillmentStatus) => {
    const quantity = Number(item?.quantity ?? 1);
    const itemRefundAmountMinor =
      Number(item?.itemRefundAmount ?? 0) ||
      Number(item?.unitAmount ?? item?.originalUnitAmount ?? 0) * (Number.isFinite(quantity) ? quantity : 0);

    return {
      ...item,
      fulfillmentStatus,
      refundStatus: String(refundStatus || ""),
      refundId: String(refundId || ""),
      refundError: String(error || ""),
      refundAmount: Number((itemRefundAmountMinor / 100).toFixed(2)),
    };
  };

  const keptItems = resolvedConfirmedItems.map((item) =>
    decorateItem(item, keepConfirmedItems ? "new" : refundOutcomeStatus)
  );
  const refundedItems = resolvedInsufficientItems.map((item) =>
    decorateItem(item, refundOutcomeStatus)
  );

  return [...keptItems, ...refundedItems];
}

async function persistRefundOutcomeOrder({
  orderId,
  userId,
  currency,
  status,
  fullRefund,
  confirmedItems,
  insufficientItems,
  refundAmount,
  refundId,
  refundStatus,
  error,
  correlationId,
}) {
  const refundLifecycle = getRefundLifecycle(refundStatus);
  const refundSuccessful = refundLifecycle === "succeeded";
  const refundPending = refundLifecycle === "pending";
  const items = buildRefundOutcomeItems({
    status,
    fullRefund,
    confirmedItems,
    insufficientItems,
    refundLifecycle,
    refundStatus,
    refundId,
    error,
  });

  if (!orderId || !userId) {
    throw new Error("orderId and userId are required to persist refund outcome");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`No order items available to persist refund outcome for ${orderId}`);
  }

  const orderStatus =
    status === "partial" && !fullRefund
      ? (refundSuccessful ? "partially_refunded" : refundPending ? "refund_pending" : "refund_failed")
      : (refundSuccessful ? "refunded" : refundPending ? "refund_pending" : "refund_failed");

  let notes = `Automatic refund failed for out-of-stock order. Reason: ${String(error || refundStatus || "unknown").trim() || "unknown"}.`;
  if (refundSuccessful) {
    notes = `Automatic refund completed for out-of-stock order. Refund amount: ${Number(refundAmount || 0) / 100}.`;
  } else if (refundPending) {
    notes = `Automatic refund is pending for out-of-stock order. Refund amount: ${Number(refundAmount || 0) / 100}. Current status: ${String(refundStatus || "pending").trim() || "pending"}.`;
  }

  return fetchJson(
    `${ORDER_SERVICE_URL}/orders`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        customerId: userId,
        items,
        totalPrice: getOrderTotalPrice(items),
        currency: currency || "sgd",
        status: orderStatus,
        notes,
      }),
    },
    correlationId
  );
}

async function processInventoryResultMessage(payload) {
  const {
    orderId,
    paymentId,
    paymentIntentId,
    userId,
    currency,
    status,
    confirmedItems,
    insufficientItems,
    refundAmount,
    amountTotal,
    correlationId,
  } = payload || {};

  console.log(
    `[place-order] 📦 Inventory result received for order ${orderId} — status: ${status} cid=${correlationId || "n/a"}`
  );
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
    }, correlationId);
    console.log(`[place-order] ✅ Order created cid=${correlationId || "n/a"}:`, orderRes?.order?.orderId || orderId);

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
      }, correlationId);
      console.log(`[place-order] ✅ Payment logged for order ${orderId} cid=${correlationId || "n/a"}`);
    } catch (error) {
      console.warn(
        `[place-order] ⚠️ Payment log failed (non-fatal) cid=${correlationId || "n/a"}:`,
        error.message
      );
    }

    await markRewardUsedIfNeeded(paymentId, orderId, correlationId);

    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_CONFIRMED",
      orderId,
    }, correlationId);
    console.log(`[place-order] 📨 ORDER_CONFIRMED notification fired for ${userId} cid=${correlationId || "n/a"}`);
    return;
  }

  if (status === "partial") {
    console.log(
      `[place-order] ⚠️ Partial stock result for order ${orderId} — refunding entire order instead of creating a partial order`
    );
    await requestRefund({
      orderId,
      paymentId,
      paymentIntentId,
      userId,
      currency,
      status,
      fullRefund: true,
      confirmedItems,
      insufficientItems,
      refundAmount: amountTotal,
      amountTotal,
      correlationId,
    });
    return;
  }

  if (status === "failed") {
    console.log(`[place-order] ❌ All items out of stock — requesting full refund for order ${orderId}`);
    await requestRefund({
      orderId,
      paymentId,
      paymentIntentId,
      userId,
      currency,
      status,
      fullRefund: true,
      confirmedItems,
      insufficientItems,
      refundAmount,
      amountTotal,
      correlationId,
    });
    return;
  }

  throw new Error(`Unknown inventory status: ${status}`);
}

async function processRefundResultMessage(payload) {
  const {
    orderId,
    paymentId,
    userId,
    currency,
    status,
    fullRefund,
    confirmedItems,
    refundAmount,
    refundId,
    refundStatus,
    insufficientItems,
    correlationId,
    error,
  } = payload || {};

  console.log(
    `[place-order] 💸 Refund result received for order ${orderId} — status: ${refundStatus} cid=${correlationId || "n/a"}`
  );
  console.log(`[place-order] Payload:`, JSON.stringify(payload, null, 2));

  if (!orderId || !userId || !status) {
    throw new Error("orderId, userId, and status are required");
  }

  const refundLifecycle = getRefundLifecycle(refundStatus);
  await persistRefundOutcomeOrder({
    orderId,
    userId,
    currency,
    status,
    fullRefund,
    confirmedItems,
    insufficientItems,
    refundAmount,
    refundId,
    refundStatus,
    error,
    correlationId,
  });

  if (refundLifecycle === "failed") {
    console.warn(`[place-order] Refund not successful for order ${orderId}: ${refundStatus || "unknown"}`);
    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_REFUND_FAILED",
      orderId,
      refundAmount,
      refundId,
      refundStatus,
      message:
        "Your order could not be fulfilled, and the automatic refund did not complete. Please contact support if the refund does not appear shortly.",
    }, correlationId);
    console.log(`[place-order] 📨 ORDER_REFUND_FAILED notification fired for ${userId} cid=${correlationId || "n/a"}`);
    return;
  }

  if (refundLifecycle === "pending") {
    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_REFUND_PENDING",
      orderId,
      refundAmount,
      refundId,
      refundStatus,
      message:
        "Your order could not be fulfilled. The refund has been initiated and is still being processed by the payment provider.",
    }, correlationId);
    console.log(`[place-order] 📨 ORDER_REFUND_PENDING notification fired for ${userId} cid=${correlationId || "n/a"}`);
    return;
  }

  if (status === "partial" && !fullRefund) {
    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_PARTIAL",
      orderId,
      insufficientItems,
      refundAmount,
      refundId,
      refundStatus,
      paymentId,
    }, correlationId);
    console.log(`[place-order] 📨 ORDER_PARTIAL notification fired for ${userId} cid=${correlationId || "n/a"}`);
    return;
  }

  if (status === "failed" || fullRefund) {
    fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
      userId,
      type: "ORDER_REFUNDED",
      orderId,
      refundAmount,
      refundId,
      refundStatus,
      paymentId,
    }, correlationId);
    console.log(`[place-order] 📨 ORDER_REFUNDED notification fired for ${userId} cid=${correlationId || "n/a"}`);
    return;
  }

  console.warn(`[place-order] Ignoring refund result with unsupported status: ${status}`);
}

app.post("/orders/payment-confirmed", async (req, res) => {
  try {
    const requestCorrelationId = req.correlationId;
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

    const queuedCorrelationId = await requestInventoryCheck({
      orderId,
      paymentId,
      paymentIntentId,
      userId,
      currency,
      amountTotal,
      items,
      correlationId: requestCorrelationId,
    });

    return res.json({
      success: true,
      orderId,
      paymentId,
      queued: true,
      correlationId: queuedCorrelationId,
    });
  } catch (error) {
    console.error(
      `[place-order] ❌ /orders/payment-confirmed error cid=${req.correlationId || "n/a"}:`,
      error.message
    );
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
      payload.correlationId = getMessageCorrelationId(msg, payload, "inventory");
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
      payload.correlationId = getMessageCorrelationId(msg, payload, "refund");
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
