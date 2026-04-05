import "dotenv/config";
import express from "express";
import amqplib from "amqplib";
import Stripe from "stripe";
import { randomUUID } from "crypto";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

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
const CORRELATION_HEADER = "x-correlation-id";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FoodRescue Refund Management API",
      version: "1.0.0",
      description:
        "Handles direct refund processing and background refund orchestration with RabbitMQ and Stripe.",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Direct refund-management service",
      },
      {
        url: "http://localhost:8000",
        description: "Kong API gateway",
      },
    ],
    tags: [
      { name: "Refund Management", description: "Refund management endpoints" },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string", example: "Failed to refund payment" },
            details: {
              nullable: true,
              example: "Missing paymentIntentId",
            },
          },
        },
        RefundResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            orderId: { type: "string", example: "order_123" },
            paymentId: { type: "string", example: "pay_123" },
            refundId: { type: "string", example: "re_123" },
            refundStatus: { type: "string", example: "succeeded" },
            refundAmountMinor: { type: "number", example: 500 },
            refundAmount: { type: "number", example: 5.0 },
            reward: {
              nullable: true,
              example: null,
            },
            paymentSyncWarning: { type: "string", example: "" },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Refund Management"],
          summary: "Health check",
          responses: {
            200: {
              description: "Refund management service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      service: {
                        type: "string",
                        example: "refund-management",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/refund-management/refund": {
        post: {
          tags: ["Refund Management"],
          summary: "Process refund",
          description:
            "Processes a refund by resolving the payment record, refunding through Stripe, and syncing the refund result back to the payment service.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    orderId: { type: "string", example: "order_123" },
                    paymentId: { type: "string", example: "pay_123" },
                    amountMinor: { type: "number", example: 500 },
                    amount: { type: "number", example: 500 },
                    reason: {
                      type: "string",
                      example: "listing_deleted_refund",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Refund processed successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RefundResponse" },
                },
              },
            },
            400: {
              description: "Invalid request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            404: {
              description: "Payment record not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to process refund",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use(express.json());

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function withCorrelationHeaders(headers = {}, correlationId = "") {
  if (!correlationId) return { ...headers };
  return {
    ...headers,
    [CORRELATION_HEADER]: correlationId,
  };
}

function correlationMiddleware(serviceName) {
  return (req, res, next) => {
    const correlationId = getHeaderValue(req.headers) || `${serviceName}:${randomUUID()}`;
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    console.log(`[${serviceName}] ${req.method} ${req.originalUrl} cid=${correlationId}`);
    next();
  };
}

function getPayloadCorrelationId(payload = {}, fallbackHeaders = {}) {
  return (
    getHeaderValue(fallbackHeaders, CORRELATION_HEADER) ||
    String(payload?.correlationId || "").trim() ||
    ""
  );
}

app.use(correlationMiddleware("refund-management"));

app.get("/refund-management-api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});

app.use(
  "/refund-management-api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec)
);

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

async function fetchJson(url, options = {}, correlationId = "") {
  const response = await fetch(url, {
    ...options,
    headers: withCorrelationHeaders(options?.headers || {}, correlationId),
  });
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

async function getPaymentByOrderId(orderId, correlationId = "") {
  return fetchJson(`${PAYMENT_SERVICE_URL}/payments/order/${encodeURIComponent(orderId)}`, {}, correlationId);
}

async function getPaymentById(paymentId, correlationId = "") {
  return fetchJson(`${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}`, {}, correlationId);
}

async function syncRefundRecord({
  paymentId,
  refundId,
  refundStatus,
  refundAmount,
  refundReason,
  correlationId = "",
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
  }, correlationId);
}

async function syncFailedRefundRecord({
  paymentId,
  refundAmount,
  refundReason,
  correlationId = "",
}) {
  if (!paymentId) return "";

  try {
    await syncRefundRecord({
      paymentId,
      refundId: "",
      refundStatus: "failed",
      refundAmount: Number(refundAmount ?? 0) || 0,
      refundReason: String(refundReason || "refund_failed"),
      correlationId,
    });
    return "";
  } catch (error) {
    const warning = error?.message || String(error);
    console.warn("[refund-management] Failed refund sync warning:", warning);
    return warning;
  }
}

async function resolveRefundContext(payload = {}, correlationId = "") {
  let payment = null;

  if (payload?.orderId) {
    try {
      payment = await getPaymentByOrderId(payload.orderId, correlationId);
    } catch (error) {
      if (!payload?.paymentId) {
        throw error;
      }
    }
  }

  if (!payment && payload?.paymentId) {
    payment = await getPaymentById(payload.paymentId, correlationId);
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
  correlationId = "",
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
        correlationId,
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
  const correlationId = getPayloadCorrelationId(payload);
  const resultPayload = {
    orderId: payload?.orderId || "",
    paymentId: payload?.paymentId || "",
    userId: payload?.userId || "",
    currency: payload?.currency || "sgd",
    status: payload?.status || "",
    fullRefund: Boolean(payload?.fullRefund),
    confirmedItems: Array.isArray(payload?.confirmedItems) ? payload.confirmedItems : [],
    insufficientItems: Array.isArray(payload?.insufficientItems) ? payload.insufficientItems : [],
    refundAmount: Number(payload?.refundAmount ?? payload?.amountTotal ?? 0) || 0,
    refundId: "",
    refundStatus: "failed",
    correlationId: correlationId || null,
    ...override,
  };

  publishToQueue(
    channel,
    responseQueue,
    Buffer.from(JSON.stringify(resultPayload)),
    correlationId ? { [CORRELATION_HEADER]: correlationId } : {}
  );
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "refund-management" });
});

app.post("/refund-management/refund", async (req, res) => {
  try {
    const { orderId = "", paymentId = "", amountMinor, amount, reason = "" } = req.body || {};
    const correlationId = req.correlationId || "";

    if (!orderId && !paymentId) {
      return res.status(400).json({ error: "orderId or paymentId is required" });
    }

    const context = await resolveRefundContext({ orderId, paymentId }, correlationId);
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
      correlationId,
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
    const correlationId = getPayloadCorrelationId(payload, msg.properties.headers);
    const queuePayload = { ...payload, correlationId };
    const { amount, reason } = buildRefundRequest(queuePayload);

    let context;
    try {
      context = await resolveRefundContext(queuePayload, correlationId);
    } catch (error) {
      console.error(`[refund-management] Failed to resolve payment context cid=${correlationId || "n/a"}:`, error.message);
      sendToDlq(channel, msg, "payment_lookup_failed");
      publishRefundResult(channel, queuePayload, {
        refundStatus: "failed",
        error: error.message || "payment_lookup_failed",
      });
      channel.ack(msg);
      return;
    }

    const paymentId = context.paymentId;
    const paymentIntentId = context.paymentIntentId;

    if (!paymentId) {
      console.error(`[refund-management] Missing paymentId; sending to DLQ cid=${correlationId || "n/a"}`);
      sendToDlq(channel, msg, "missing_payment_id");
      channel.ack(msg);
      return;
    }

    if (!paymentIntentId) {
      console.error(`[refund-management] Missing paymentIntentId; sending to DLQ cid=${correlationId || "n/a"}`);
      sendToDlq(channel, msg, "missing_payment_intent_id");
      const paymentSyncWarning = await syncFailedRefundRecord({
        paymentId,
        refundAmount: amount,
        refundReason: "Missing paymentIntentId",
        correlationId,
      });
      publishRefundResult(channel, queuePayload, {
        paymentId,
        refundStatus: "failed",
        error: "Missing paymentIntentId",
        paymentSyncWarning,
      });
      channel.ack(msg);
      return;
    }

    console.log(`[refund-management] Attempt ${retryCount + 1} for paymentId=${paymentId} cid=${correlationId || "n/a"}`);

    try {
      const result = await executeRefund({
        paymentId,
        paymentIntentId,
        amount,
        reason,
        correlationId,
      });

      if (result.ok) {
        console.log(`[refund-management] Refund successful cid=${correlationId || "n/a"}`);
        publishRefundResult(channel, queuePayload, {
          paymentId,
          refundId: result.refundId,
          refundStatus: result.refundStatus,
          paymentSyncWarning: result.paymentSyncWarning || "",
        });
        channel.ack(msg);
        return;
      }

      if (result.status >= 400 && result.status < 500) {
        console.warn(`[refund-management] Business failure cid=${correlationId || "n/a"} (ack):`, result.status, result.errorText);
        const paymentSyncWarning = await syncFailedRefundRecord({
          paymentId,
          refundAmount: amount,
          refundReason: reason || result.errorText,
          correlationId,
        });
        publishRefundResult(channel, queuePayload, {
          paymentId,
          refundStatus: "failed",
          error: String(result.errorText || "").slice(0, 1000),
          paymentSyncWarning,
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
        const paymentSyncWarning = await syncFailedRefundRecord({
          paymentId,
          refundAmount: amount,
          refundReason: reason || `refund_failed_${result.status}`,
          correlationId,
        });
        publishRefundResult(channel, queuePayload, {
          paymentId,
          refundStatus: "failed",
          error: `refund_failed_${result.status}`,
          paymentSyncWarning,
        });
      }

      channel.ack(msg);
    } catch (error) {
      console.error(`[refund-management] Network/system error cid=${correlationId || "n/a"}:`, error?.message || error);

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
        const paymentSyncWarning = await syncFailedRefundRecord({
          paymentId,
          refundAmount: amount,
          refundReason: error?.message || String(error),
          correlationId,
        });
        publishRefundResult(channel, queuePayload, {
          paymentId,
          refundStatus: "failed",
          error: error?.message || String(error),
          paymentSyncWarning,
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
