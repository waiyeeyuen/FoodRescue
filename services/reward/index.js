import express from "express";
import cors from "cors";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { randomUUID } from "crypto";
import { db } from "../firebase/firebaseAdmin.js";

const app = express();
const PORT = process.env.PORT || 3005;
const BASE_URL = String(process.env.OUTSYSTEMS_REWARD_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const STAMP_TARGET = 5;
const DISCOUNT_PERCENT = 20;
const RESTORED_REWARDS = db.collection("reward_restorations");
const CORRELATION_HEADER = "x-correlation-id";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FoodRescue Reward Service API",
      version: "1.0.0",
      description: "Manages reward eligibility checks, reward updates, and reward voucher restoration.",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Direct reward service",
      },
      {
        url: "http://localhost:8000",
        description: "Kong API gateway",
      },
    ],
    tags: [{ name: "Reward", description: "Reward service endpoints" }],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        RewardEligibilityResponse: {
          type: "object",
          properties: {
            userId: { type: "string" },
            eligible: { type: "boolean" },
            active: { type: "boolean" },
            stampsCount: { type: "number" },
            stampTarget: { type: "number" },
            ordersLeft: { type: "number" },
            discountPercent: { type: "number" },
            voucherId: { type: "string" },
            source: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/reward/eligibility/{userId}": {
        get: {
          tags: ["Reward"],
          summary: "Get reward eligibility for a user",
          description:
            "Gateway copy-paste URL: http://localhost:8000/reward/eligibility/{userId}",
          parameters: [
            {
              in: "path",
              name: "userId",
              required: true,
              schema: { type: "string", example: "user_123" },
            },
            {
              in: "query",
              name: "stampsCount",
              required: false,
              schema: { type: "integer", default: 0, minimum: 0 },
            },
          ],
          responses: {
            200: {
              description: "Eligibility evaluated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RewardEligibilityResponse" },
                },
              },
            },
          },
        },
      },
      "/reward/update": {
        post: {
          tags: ["Reward"],
          summary: "Update reward voucher status",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["userId"],
                  properties: {
                    userId: { type: "string", example: "user_123" },
                    voucherId: { type: "string", example: "voucher_abc" },
                    source: { type: "string", example: "restored-voucher" },
                    restoreKey: { type: "string", example: "restored_user_123_1710000000000" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Reward update completed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      source: { type: "string" },
                      voucherId: { type: "string" },
                      restoreKey: { type: "string" },
                    },
                  },
                },
              },
            },
            404: {
              description: "Restored voucher not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Server error",
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

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5173"],
    allowedHeaders: ["Content-Type", "Authorization", "x-correlation-id"],
  })
);
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

app.use(correlationMiddleware("reward"));

app.get("/reward-api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});
app.use("/reward-api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

function getField(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function parseInteger(value, defaultValue = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(0, Math.floor(parsed));
}

function getRewardBaseUrl() {
  if (!BASE_URL) {
    throw new Error("OUTSYSTEMS_REWARD_BASE_URL is not configured");
  }

  return BASE_URL;
}

function parseEligibilityPayload(payload) {
  const eligibleRaw = getField(
    payload,
    "eligible",
    "Eligible",
    "isEligible",
    "IsEligible",
    "active",
    "Active"
  );

  const discountPercentRaw = getField(
    payload,
    "discountPercent",
    "DiscountPercent",
    "discount_percentage",
    "DiscountPercentage"
  );

  const voucherId = String(
    getField(payload, "voucherId", "VoucherId", "voucher_id", "Voucher_ID") || ""
  );

  const ordersLeftRaw = getField(
    payload,
    "ordersLeft",
    "OrdersLeft",
    "remainingOrders",
    "RemainingOrders"
  );

  const eligible =
    eligibleRaw === undefined
      ? null
      : Boolean(
          typeof eligibleRaw === "string"
            ? ["true", "1", "yes", "active"].includes(eligibleRaw.trim().toLowerCase())
            : eligibleRaw
        );

  const discountPercent = Number(discountPercentRaw ?? 0);
  const ordersLeft =
    ordersLeftRaw === undefined || ordersLeftRaw === null
      ? null
      : parseInteger(ordersLeftRaw, 0);

  return {
    eligible,
    voucherId,
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    ordersLeft,
  };
}

function buildFallbackEligibility(userId, stampsCount) {
  const normalizedStamps = parseInteger(stampsCount, 0);
  const completedOrdersTowardsReward = normalizedStamps % STAMP_TARGET;
  const eligible = completedOrdersTowardsReward === STAMP_TARGET - 1;
  const ordersLeft = eligible
    ? 0
    : (STAMP_TARGET - 1) - completedOrdersTowardsReward;

  return {
    userId,
    eligible,
    active: eligible,
    stampsCount: normalizedStamps,
    stampTarget: STAMP_TARGET,
    ordersLeft,
    discountPercent: eligible ? DISCOUNT_PERCENT : 0,
    voucherId: "",
    source: "local-fallback",
  };
}

function toSerializableDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

async function getActiveRestoredReward(userId) {
  const snapshot = await RESTORED_REWARDS.where("userId", "==", userId).get();

  const matches = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: toSerializableDate(doc.data()?.createdAt) || doc.data()?.createdAt || null,
      usedAt: toSerializableDate(doc.data()?.usedAt) || doc.data()?.usedAt || null,
      restoredAt: toSerializableDate(doc.data()?.restoredAt) || doc.data()?.restoredAt || null,
    }))
    .filter((entry) => String(entry.status || "active") === "active")
    .sort((a, b) => new Date(a.createdAt || a.restoredAt || 0).getTime() - new Date(b.createdAt || b.restoredAt || 0).getTime());

  return matches[0] || null;
}

async function fetchRewardEligibility(userId, correlationId = "") {
  const response = await fetch(`${getRewardBaseUrl()}/eligibility?UserId=${encodeURIComponent(userId)}`, {
    headers: withCorrelationHeaders({}, correlationId),
  });
  const rawText = await response.text();

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }
  }

  return { response, data };
}

app.get("/reward/eligibility/:userId", async (req, res) => {
  const { userId } = req.params;
  const stampsCount = parseInteger(req.query.stampsCount, 0);
  const fallback = buildFallbackEligibility(userId, stampsCount);

  try {
    const restoredReward = await getActiveRestoredReward(userId);
    if (restoredReward) {
      return res.status(200).json({
        ...fallback,
        eligible: true,
        active: true,
        ordersLeft: 0,
        discountPercent: Number(restoredReward.discountPercent || DISCOUNT_PERCENT),
        voucherId: String(restoredReward.voucherId || ""),
        restoreKey: restoredReward.id,
        source: "restored-voucher",
        raw: {
          restoredReward,
        },
      });
    }

    const { response, data } = await fetchRewardEligibility(userId, req.correlationId);
    const parsed = parseEligibilityPayload(data);

    if (response.ok && parsed.eligible !== null) {
      const localEligible = fallback.eligible;
      const externalEligible = parsed.eligible;
      const eligible = localEligible || externalEligible;

      return res.status(200).json({
        ...fallback,
        eligible,
        active: eligible,
        ordersLeft: eligible
          ? 0
          : parsed.ordersLeft ?? fallback.ordersLeft,
        discountPercent:
          parsed.discountPercent || (eligible ? DISCOUNT_PERCENT : 0),
        voucherId: parsed.voucherId,
        source: "outsystems",
        raw: data,
      });
    }

    return res.status(200).json({
      ...fallback,
      raw: data ?? {},
      source: "local-fallback",
      warning: "OutSystems eligibility response was empty or incomplete",
    });
  } catch (error) {
    return res.status(200).json({
      ...fallback,
      source: "local-fallback",
      warning: error.message || "Failed to fetch OutSystems eligibility",
    });
  }
});

app.post("/reward/update", async (req, res) => {
  const { userId, voucherId, source, restoreKey } = req.body;
  try {
    const normalizedSource = String(source || "").trim().toLowerCase();
    const restoredVoucherSource =
      normalizedSource === "restored-voucher" ||
      normalizedSource === "refund-restored-voucher" ||
      String(voucherId || "").startsWith("restored_") ||
      Boolean(restoreKey);

    if (restoredVoucherSource) {
      let targetDocId = String(restoreKey || "").trim();

      if (!targetDocId && userId) {
        const restoredReward = await getActiveRestoredReward(userId);
        targetDocId = String(restoredReward?.id || "");
      }

      if (!targetDocId) {
        return res.status(404).json({ error: "Restored voucher not found" });
      }

      await RESTORED_REWARDS.doc(targetDocId).set(
        {
          status: "used",
          usedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return res.status(200).json({
        success: true,
        source: "restored-voucher",
        voucherId,
        restoreKey: targetDocId,
      });
    }

    const response = await fetch(`${getRewardBaseUrl()}/UpdateStatus`, {
      method: "POST",
      headers: withCorrelationHeaders({ "Content-Type": "application/json" }, req.correlationId),
      body: JSON.stringify({ UserId: userId, VoucherId: voucherId || "" }),
    });
    const rawText = await response.text();
    const data = rawText ? JSON.parse(rawText) : {};
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to update reward status" });
  }
});

app.listen(PORT, () => {
  console.log(`Reward service running on port ${PORT}`);
});
