import "dotenv/config";
import express from "express";
import amqplib from "amqplib";
import Stripe from "stripe";

const app = express();

const PORT = Number(process.env.PORT || 3007);
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || "http://localhost:3003";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

const QUEUE = "refund.request";
const DLQ = "refund.request.dlq";
const RESULT_QUEUE = "refund.result";
const FAILURE_QUEUE = "refund.failed";
const MAX_RETRIES = 3;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

app.use(express.json());

function publishToQueue(channel, queue, content, headers = {}) {
  channel.sendToQueue(queue, content, {
    persistent: true,
    contentType: "application/json",
    headers,
  });
}

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) parsed.password = parsed.password ? "***" : "";
    return parsed.toString();
  } catch {
    return String(url).replace(/\/\/([^:/@]+):([^@]+)@/g, "//$1:***@");
  }
}

async function readBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!raw) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await readBody(response);

  if (!response.ok) {
    const error = new Error(
      typeof body === "string" ? body : body?.error || `Request failed with ${response.status}`
    );
    error.status = response.status;
    error.data = body;
    throw error;
  }

  return body;
}

async function getPaymentByOrderId(orderId) {
  return fetchJson(`${PAYMENT_SERVICE_URL}/payments/order/${encodeURIComponent(orderId)}`);
}

async function getPaymentById(paymentId) {
  return fetchJson(`${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}`);
}

async function syncRefundRecord({
  paymentId,
  refundId,
  refundStatus,
  refundAmount,
  refundReason,
}) {
  return fetchJson(`${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}/refund-record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refundId,
      refundStatus,
      refundAmount,
      refundReason,
    }),
  });
}

async function resolveRefundContext(payload = {}) {
  let payment = null;

  if (payload?.orderId) {
    try {
      payment = await getPaymentByOrderId(payload.orderId);
    } catch (error) {
      if (!payload?.paymentId) {
        throw error;
      }
    }
  }

  if (!payment && payload?.paymentId) {
    payment = await getPaymentById(payload.paymentId);
  }

  return {
    payment,
    paymentId: String(payload?.paymentId || payment?.paymentId || "").trim(),
    paymentIntentId: String(
      payload?.paymentIntentId || payment?.stripePaymentIntentId || ""
    ).trim(),
  };
}

async function connectWithRetry(retries = 20, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      console.log(
        `[refund-management] Connecting to RabbitMQ ${maskUrl(RABBITMQ_URL)} (attempt ${attempt}/${retries})`
      );
      return await amqplib.connect(RABBITMQ_URL);
    } catch (error) {
      lastError = error;
      console.log("[refund-management] RabbitMQ not ready, retrying...");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function buildRefundRequest(payload) {
  const status = String(payload?.status || "").toLowerCase();
  const fullRefund = Boolean(payload?.fullRefund);
  const amountTotal = Number(payload?.amountTotal ?? 0);
  const refundAmount = Number(payload?.refundAmount ?? 0);

  const insufficientItems = Array.isArray(payload?.insufficientItems) ? payload.insufficientItems : [];
  const itemNames = insufficientItems.map((item) => item?.name).filter(Boolean);

  if (status === "failed" || fullRefund) {
    return {
      amount: amountTotal,
      reason: itemNames.length > 0
        ? `inventory_conflict: full refund issued (${itemNames.join(", ")})`
        : "inventory_conflict: full refund issued",
    };
  }

  return {
    amount: refundAmount || amountTotal,
    reason: itemNames.length > 0 ? `inventory_conflict: ${itemNames.join(", ")}` : "inventory_conflict",
  };
}

async function sendRefund({ paymentIntentId, amount, reason }) {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!paymentIntentId) {
    return {
      ok: false,
      status: 400,
      text: JSON.stringify({ error: "Missing paymentIntentId" }),
      data: null,
    };
  }

  const refundPayload = { payment_intent: paymentIntentId };
  if (amount) refundPayload.amount = amount;
  if (reason) refundPayload.metadata = { reason };

  try {
    const refund = await stripe.refunds.create(refundPayload);
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ refundId: refund.id, refundStatus: refund.status }),
      data: refund,
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 500) || 500;
    return {
      ok: false,
      status: statusCode,
      text: JSON.stringify({
        error: error?.message || "Failed to create Stripe refund",
        code: error?.code || "",
      }),
      data: null,
    };
  }
}

async function executeRefund({
  paymentId,
  paymentIntentId,
  amount,
  reason,
}) {
  const result = await sendRefund({ paymentIntentId, amount, reason });

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      errorText: String(result.text || ""),
      refundId: "",
      refundStatus: "failed",
      paymentSyncWarning: "",
    };
  }

  let paymentSyncWarning = "";
  try {
    if (paymentId) {
      await syncRefundRecord({
        paymentId,
        refundId: result.data?.id || "",
        refundStatus: result.data?.status || "succeeded",
        refundAmount: Number(amount || 0) || 0,
        refundReason: reason || "",
      });
    }
  } catch (error) {
    paymentSyncWarning = error?.message || String(error);
    console.warn("[refund-management] Payment sync warning:", paymentSyncWarning);
  }

  return {
    ok: true,
    status: result.status,
    errorText: "",
    refundId: result.data?.id || "",
    refundStatus: result.data?.status || "succeeded",
    paymentSyncWarning,
  };
}

function sendToDlq(channel, msg, reason) {
  publishToQueue(channel, DLQ, msg.content, {
    ...msg.properties.headers,
    "x-error": reason,
    "x-source-queue": QUEUE,
  });
}

function publishRefundResult(channel, payload, override = {}) {
  const responseQueue = payload?.replyTo || RESULT_QUEUE;
  const resultPayload = {
    orderId: payload?.orderId || "",
    paymentId: payload?.paymentId || "",
    userId: payload?.userId || "",
    status: payload?.status || "",
    fullRefund: Boolean(payload?.fullRefund),
    insufficientItems: Array.isArray(payload?.insufficientItems) ? payload.insufficientItems : [],
    refundAmount: Number(payload?.refundAmount ?? payload?.amountTotal ?? 0) || 0,
    refundId: "",
    refundStatus: "failed",
    correlationId: payload?.correlationId || null,
    ...override,
  };

  publishToQueue(channel, responseQueue, Buffer.from(JSON.stringify(resultPayload)));
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "refund-management" });
});

app.post("/refund-management/refund", async (req, res) => {
  try {
    const { orderId = "", paymentId = "", amountMinor, amount, reason = "" } = req.body || {};

    if (!orderId && !paymentId) {
      return res.status(400).json({ error: "orderId or paymentId is required" });
    }

    const context = await resolveRefundContext({ orderId, paymentId });
    const resolvedPayment = context.payment;
    const resolvedPaymentId = context.paymentId;
    const paymentIntentId = context.paymentIntentId;

    if (!resolvedPaymentId) {
      return res.status(404).json({ error: "Payment record not found" });
    }

    if (!paymentIntentId) {
      return res.status(400).json({ error: "Missing Stripe payment intent ID" });
    }

    const normalizedAmountMinor =
      Number(amountMinor ?? amount ?? resolvedPayment?.amountTotal ?? 0) ||
      Number(resolvedPayment?.amountTotal || 0) ||
      0;
    const refundReason = String(reason || "manual_refund");

    const refundResult = await executeRefund({
      paymentId: resolvedPaymentId,
      paymentIntentId,
      amount: normalizedAmountMinor,
      reason: refundReason,
    });

    if (!refundResult.ok) {
      return res.status(refundResult.status || 500).json({
        error: "Failed to refund payment",
        details: refundResult.errorText,
      });
    }

    return res.json({
      success: true,
      orderId: String(orderId || resolvedPayment?.orderId || ""),
      paymentId: resolvedPaymentId,
      refundId: refundResult.refundId,
      refundStatus: refundResult.refundStatus,
      refundAmountMinor: normalizedAmountMinor,
      refundAmount: Number((normalizedAmountMinor / 100).toFixed(2)),
      reward: resolvedPayment?.reward || null,
      paymentSyncWarning: refundResult.paymentSyncWarning || "",
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to process refund",
      details: error.data || null,
    });
  }
});

async function startConsumer() {
  const connection = await connectWithRetry();
  const channel = await connection.createChannel();

  await channel.assertQueue(QUEUE, { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  await channel.assertQueue(RESULT_QUEUE, { durable: true });
  await channel.assertQueue(FAILURE_QUEUE, { durable: true });
  channel.prefetch(1);

  console.log(`[refund-management] Listening on queue: ${QUEUE}`);
  console.log(`[refund-management] DLQ (invalid messages): ${DLQ}`);
  console.log(`[refund-management] Result queue: ${RESULT_QUEUE}`);
  console.log(`[refund-management] Failure queue (retry exhausted): ${FAILURE_QUEUE}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      console.error("[refund-management] Invalid JSON; sending to DLQ");
      sendToDlq(channel, msg, "invalid_json");
      channel.ack(msg);
      return;
    }

    const retryCount = msg.properties.headers?.["x-retry-count"] || 0;
    const { amount, reason } = buildRefundRequest(payload);

    let context;
    try {
      context = await resolveRefundContext(payload);
    } catch (error) {
      console.error("[refund-management] Failed to resolve payment context:", error.message);
      sendToDlq(channel, msg, "payment_lookup_failed");
      publishRefundResult(channel, payload, {
        refundStatus: "failed",
        error: error.message || "payment_lookup_failed",
      });
      channel.ack(msg);
      return;
    }

    const paymentId = context.paymentId;
    const paymentIntentId = context.paymentIntentId;

    if (!paymentId) {
      console.error("[refund-management] Missing paymentId; sending to DLQ");
      sendToDlq(channel, msg, "missing_payment_id");
      channel.ack(msg);
      return;
    }

    if (!paymentIntentId) {
      console.error("[refund-management] Missing paymentIntentId; sending to DLQ");
      sendToDlq(channel, msg, "missing_payment_intent_id");
      publishRefundResult(channel, payload, {
        paymentId,
        refundStatus: "failed",
        error: "Missing paymentIntentId",
      });
      channel.ack(msg);
      return;
    }

    console.log(`[refund-management] Attempt ${retryCount + 1} for paymentId=${paymentId}`);

    try {
      const result = await executeRefund({
        paymentId,
        paymentIntentId,
        amount,
        reason,
      });

      if (result.ok) {
        console.log("[refund-management] Refund successful");
        publishRefundResult(channel, payload, {
          paymentId,
          refundId: result.refundId,
          refundStatus: result.refundStatus,
          paymentSyncWarning: result.paymentSyncWarning || "",
        });
        channel.ack(msg);
        return;
      }

      if (result.status >= 400 && result.status < 500) {
        console.warn("[refund-management] Business failure (ack):", result.status, result.errorText);
        publishRefundResult(channel, payload, {
          paymentId,
          refundStatus: "failed",
          error: String(result.errorText || "").slice(0, 1000),
        });
        channel.ack(msg);
        return;
      }

      if (retryCount < MAX_RETRIES) {
        console.warn(`[refund-management] Retry ${retryCount + 1}/${MAX_RETRIES}`);
        publishToQueue(channel, QUEUE, msg.content, {
          ...msg.properties.headers,
          "x-retry-count": retryCount + 1,
        });
      } else {
        console.error("[refund-management] Max retries reached -> sending to failure queue");
        publishToQueue(channel, FAILURE_QUEUE, msg.content, {
          ...msg.properties.headers,
          "x-retry-count": retryCount,
          "x-error": `refund_failed_${result.status}`,
          "x-response": String(result.errorText || "").slice(0, 1000),
        });
        publishRefundResult(channel, payload, {
          paymentId,
          refundStatus: "failed",
          error: `refund_failed_${result.status}`,
        });
      }

      channel.ack(msg);
    } catch (error) {
      console.error("[refund-management] Network/system error:", error?.message || error);

      if (retryCount < MAX_RETRIES) {
        publishToQueue(channel, QUEUE, msg.content, {
          ...msg.properties.headers,
          "x-retry-count": retryCount + 1,
        });
      } else {
        publishToQueue(channel, FAILURE_QUEUE, msg.content, {
          ...msg.properties.headers,
          "x-retry-count": retryCount,
          "x-error": error?.message || String(error),
        });
        publishRefundResult(channel, payload, {
          paymentId,
          refundStatus: "failed",
          error: error?.message || String(error),
        });
      }

      channel.ack(msg);
    }
  });
}

app.listen(PORT, () => {
  console.log(`[refund-management] HTTP service running on port ${PORT}`);
});

startConsumer().catch((error) => {
  console.error("[refund-management] Fatal:", error?.stack || error);
  process.exit(1);
});
