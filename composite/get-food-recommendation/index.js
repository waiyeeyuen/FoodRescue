import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { randomUUID } from "crypto";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4000;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || "http://localhost:3004";
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";
const REWARD_SERVICE_URL = process.env.REWARD_SERVICE_URL || "http://localhost:3005";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const CORRELATION_HEADER = "x-correlation-id";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FoodRescue Get Food Recommendation Composite API",
      version: "1.0.0",
      description:
        "Aggregates order history, inventory, reward eligibility, and Gemini ranking to return food recommendations.",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Direct composite-get-food-recommendation service",
      },
      {
        url: "http://localhost:8000",
        description: "Kong API gateway",
      },
    ],
    tags: [
      { name: "Recommendations", description: "Recommendation endpoints" },
      { name: "Health", description: "Service health check" },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            details: { nullable: true },
          },
        },
        RecommendationResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            userId: { type: "string" },
            stampsCount: { type: "number" },
            rewardEligibility: { type: "object" },
            signals: { type: "object" },
            gemini: { type: "object" },
            recommendedListings: {
              type: "array",
              items: { type: "object" },
            },
            fallbackListings: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          responses: {
            200: {
              description: "Service health status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      service: {
                        type: "string",
                        example: "composite-get-food-recommendation",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/recommendations/{userId}": {
        get: {
          tags: ["Recommendations"],
          summary: "Get food recommendations for a user",
          description:
            "Gateway copy-paste URL: http://localhost:8000/recommendations/{userId}",
          parameters: [
            {
              in: "path",
              name: "userId",
              required: true,
              schema: { type: "string", example: "user_123" },
            },
            {
              in: "query",
              name: "includeActive",
              required: false,
              schema: { type: "boolean", default: true },
            },
            {
              in: "query",
              name: "maxListings",
              required: false,
              schema: { type: "integer", default: 4, minimum: 1, maximum: 200 },
            },
            {
              in: "query",
              name: "maxSignals",
              required: false,
              schema: { type: "integer", default: 5, minimum: 1, maximum: 20 },
            },
            {
              in: "query",
              name: "listingIds",
              required: false,
              schema: {
                type: "string",
                example: "listing1,listing2",
                description: "Comma-separated listing IDs to filter ranking candidates.",
              },
            },
            {
              in: "query",
              name: "noCache",
              required: false,
              schema: {
                type: "boolean",
                default: false,
                description: "Bypass Gemini cache for this request.",
              },
            },
          ],
          responses: {
            200: {
              description: "Recommendations generated successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RecommendationResponse" },
                },
              },
            },
            500: {
              description: "Unexpected server error",
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

console.log("Gemini key loaded:", GEMINI_API_KEY?.slice(0, 8) + "...");

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function createCorrelationId(scope = "get-food-recommendation") {
  return `${scope}:${randomUUID()}`;
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
    const correlationId = getHeaderValue(req.headers) || createCorrelationId(serviceName);
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    console.log(`[${serviceName}] ${req.method} ${req.originalUrl} cid=${correlationId}`);
    next();
  };
}

app.use(correlationMiddleware("get-food-recommendation"));

app.get("/get-food-recommendation-api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});
app.use(
  "/get-food-recommendation-api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec)
);

const geminiCache = new Map();
const GEMINI_CACHE_TTL_MS = 5 * 60 * 1000;

function getField(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function normalizeString(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeCsv(value) {
  if (!value) return [];
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

function stableSignalsKey(topNames, topCategories) {
  const names = (topNames || [])
    .map((n) => `${n?.name || ""}:${Number(n?.count || 0)}`)
    .join("|");
  const categories = (topCategories || [])
    .map((c) => `${c?.category || ""}:${Number(c?.count || 0)}`)
    .join("|");
  return `${names}__${categories}`;
}

function shouldBypassCache(req) {
  const q = req?.query || {};
  return (
    parseBool(q.noCache ?? q.nocache ?? q.refresh ?? q.reload, false) ||
    parseBool(process.env.DISABLE_GEMINI_CACHE, false)
  );
}

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

function parseRewardEligibility(payload, stampsCount) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const completedOrdersTowardsReward = (Number(stampsCount) || 0) % 5;
  const eligibleRaw = getField(data, "eligible", "Eligible", "isEligible", "IsEligible", "active", "Active");
  const eligible =
    eligibleRaw === undefined
      ? false
      : Boolean(
          typeof eligibleRaw === "string"
            ? ["true", "1", "yes", "active"].includes(eligibleRaw.trim().toLowerCase())
            : eligibleRaw
        );

  const ordersLeftRaw = getField(data, "ordersLeft", "OrdersLeft", "remainingOrders", "RemainingOrders");
  const parsedOrdersLeft = Number(ordersLeftRaw);
  const ordersLeft = Number.isFinite(parsedOrdersLeft)
    ? Math.max(0, Math.floor(parsedOrdersLeft))
    : (eligible ? 0 : 4 - completedOrdersTowardsReward);

  const discountPercentRaw = getField(
    data,
    "discountPercent",
    "DiscountPercent",
    "discount_percentage",
    "DiscountPercentage"
  );
  const discountPercent = Number(discountPercentRaw ?? (eligible ? 20 : 0));

  return {
    success: true,
    stampsCount,
    eligible,
    active: eligible,
    ordersLeft,
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    stampTarget: Number(getField(data, "stampTarget", "StampTarget") ?? 5) || 5,
    voucherId: String(getField(data, "voucherId", "VoucherId") || ""),
    source: getField(data, "source", "Source") || "unknown",
    data,
  };
}

function parseBool(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

function pickTopSignals(orderHistory, maxSignals) {
  const itemNameFrequency = new Map();
  const categoryFrequency = new Map();

  for (const order of orderHistory || []) {
    for (const item of order?.items || []) {
      const name = normalizeString(getField(item, "name", "itemName", "ItemName"));
      if (name) itemNameFrequency.set(name, (itemNameFrequency.get(name) || 0) + 1);

      const category = normalizeString(getField(item, "category", "Category", "cuisineType", "CuisineType"));
      if (category) categoryFrequency.set(category, (categoryFrequency.get(category) || 0) + 1);
    }
  }

  const topNames = Array.from(itemNameFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSignals)
    .map(([name, count]) => ({ name, count }));

  const topCategories = Array.from(categoryFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSignals)
    .map(([category, count]) => ({ category, count }));

  return { topNames, topCategories };
}

function scoreListing(listing, topNames, topCategories) {
  const itemName = normalizeString(getField(listing, "itemName", "ItemName", "name", "Name"));
  const cuisineType = normalizeString(getField(listing, "cuisineType", "CuisineType", "category", "Category"));

  let score = 0;
  const reasons = [];

  for (const signal of topNames) {
    if (!signal?.name) continue;
    if (itemName.includes(signal.name)) {
      score += 10;
      reasons.push({ type: "ITEM_MATCH", value: signal.name });
    }
  }

  for (const signal of topCategories) {
    if (!signal?.category) continue;
    if (cuisineType.includes(signal.category)) {
      score += 4;
      reasons.push({ type: "CATEGORY_MATCH", value: signal.category });
    }
  }

  return { score, reasons };
}

async function callGemini(topNames, topCategories, listings, correlationId = "") {
  if (!GEMINI_API_KEY) {
    return { used: false, reasoning: "No Gemini API key provided.", orderedIds: null };
  }

  if (listings.length === 0) {
    return { used: false, reasoning: "No listings to rank.", orderedIds: null };
  }

  const listingSummaries = listings.map((l) => ({
    id: String(getField(l, "Id", "id", "listingId", "ListingId") ?? ""),
    itemName: getField(l, "itemName", "ItemName", "name", "Name") ?? "",
    cuisineType: getField(l, "cuisineType", "CuisineType", "category", "Category") ?? "",
    price: getField(l, "price", "Price") ?? ""
  }));

  const prompt = `
You are a food recommendation engine. Based on the user's preferences below, rank the listings by relevance and return a JSON array of listing IDs in order from most to least recommended. Only return a raw JSON array of ID strings, nothing else.

User's top ordered items: ${topNames.map((n) => n.name).join(", ") || "none"}
User's top categories: ${topCategories.map((c) => c.category).join(", ") || "none"}

Available listings:
${JSON.stringify(listingSummaries, null, 2)}

Return ONLY a JSON array of IDs like: ["id1", "id2", "id3"]
`;

  try {
    const response = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: withCorrelationHeaders({ "Content-Type": "application/json" }, correlationId),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const data = await readBody(response);
    console.log(`Gemini raw response cid=${correlationId || "n/a"}:`, JSON.stringify(data, null, 2));

    if (data?.error) {
      throw new Error(`Gemini API error ${data.error.code}: ${data.error.status}`);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!rawText) throw new Error("Gemini returned empty text");

    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const orderedIds = JSON.parse(cleaned);

    if (!Array.isArray(orderedIds)) throw new Error("Gemini did not return an array");

    console.log(`Gemini hit! ordered IDs cid=${correlationId || "n/a"}:`, orderedIds);
    return {
      used: true,
      reasoning: `Gemini ranked up to ${orderedIds.length} listings based on your order history signals.`,
      orderedIds
    };
  } catch (err) {
    console.error(`Gemini error cid=${correlationId || "n/a"}:`, err.message);
    return { used: false, reasoning: `Gemini error: ${err.message}`, orderedIds: null };
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "composite-get-food-recommendation" });
});

app.get("/recommendations/:userId", async (req, res) => {
  const { userId } = req.params;
  const correlationId = req.correlationId;

  const includeActive = parseBool(req.query.includeActive, true);
  const maxListings = Math.max(1, Math.min(200, Number(req.query.maxListings ?? 4) || 4));
  const maxSignals = Math.max(1, Math.min(20, Number(req.query.maxSignals ?? 5) || 5));

  const requestedListingIds = normalizeCsv(
    req.query.listingIds ?? req.query.listing_ids ?? req.query.listing_id
  );

  let orderHistoryResponse = null;
  let inventoryListings = null;
  let rewardEligibility = null;

  // Step 1 — Order service
  let orderHistory = [];
  let totalConfirmedOrders = 0;
  try {
    orderHistoryResponse = await fetchJson(
      `${ORDER_SERVICE_URL}/orders/customer/${encodeURIComponent(userId)}/history?limit=20`,
      {},
      correlationId
    );
    orderHistory = Array.isArray(orderHistoryResponse?.orderHistory)
      ? orderHistoryResponse.orderHistory
      : [];
    totalConfirmedOrders = Number(orderHistoryResponse?.totalOrders ?? orderHistory.length) || orderHistory.length;
    console.log(`Order hit! order history cid=${correlationId}:`, orderHistory);
  } catch (error) {
    orderHistoryResponse = { success: false, error: error.message, status: error.status || 500 };
    orderHistory = [];
    totalConfirmedOrders = 0;
    console.log(`Order hit! order history cid=${correlationId}:`, []);
  }

  const stampsCount = totalConfirmedOrders;

  // Step 2 — Inventory service
  let listings = [];
  try {
    inventoryListings = await fetchJson(`${INVENTORY_SERVICE_URL}/inventory/active`, {}, correlationId);
    listings = Array.isArray(inventoryListings) ? inventoryListings : [];
    console.log(`Inventory hit! listings cid=${correlationId}:`, listings);
  } catch (error) {
    inventoryListings = { success: false, error: error.message, status: error.status || 500 };
    listings = [];
    console.log(`Inventory hit! listings cid=${correlationId}:`, []);
  }

  // Step 3 — Reward service
  try {
    const rewardPayload = await fetchJson(
      `${REWARD_SERVICE_URL}/reward/eligibility/${encodeURIComponent(userId)}?stampsCount=${encodeURIComponent(stampsCount)}`,
      {},
      correlationId
    );
    rewardEligibility = parseRewardEligibility(rewardPayload, stampsCount);
    console.log(`Rewards hit! reward eligibility cid=${correlationId}:`, rewardEligibility.eligible);
  } catch (error) {
    rewardEligibility = { success: false, stampsCount, error: error.message, status: error.status || 500 };
    console.log(`Rewards hit! reward eligibility cid=${correlationId}:`, false);
  }

  // Step 4 — Gemini reranking (with cache)
  const { topNames, topCategories } = pickTopSignals(orderHistory, maxSignals);
  console.log(`Signals cid=${correlationId}:`, { topNames, topCategories });

  const filteredListings = Array.isArray(inventoryListings)
    ? inventoryListings.filter((listing) => {
        if (requestedListingIds.length === 0) return true;
        const id = getField(listing, "Id", "id", "listingId", "ListingId") ?? "";
        return requestedListingIds.includes(String(id));
      })
    : [];

  
  const bypassCache = shouldBypassCache(req);
  const signalsKey = stableSignalsKey(topNames, topCategories);
  const cacheKey = `${userId}::${stampsCount}::${signalsKey}::${requestedListingIds.join(",") || "*"}`;
  const cached = bypassCache ? null : geminiCache.get(cacheKey);
  let gemini;

  if (cached && cached.expiresAt > Date.now()) {
    console.log(`Gemini cache hit for user cid=${correlationId}:`, userId);
    gemini = cached.result;
  } else {
    gemini = await callGemini(topNames, topCategories, filteredListings, correlationId);
    if (!bypassCache) {
      geminiCache.set(cacheKey, { result: gemini, expiresAt: Date.now() + GEMINI_CACHE_TTL_MS });
    }
  }

  let recommended = [];

  if (gemini.used && gemini.orderedIds && gemini.orderedIds.length > 0) {
    const listingMap = new Map(
      filteredListings.map((l) => [
        String(getField(l, "Id", "id", "listingId", "ListingId") ?? ""),
        l
      ])
    );
    recommended = gemini.orderedIds
      .map((id, idx) => {
        const listing = listingMap.get(String(id));
        if (!listing) return null;
        if (idx < 3) {
          const { reasons } = scoreListing(listing, topNames, topCategories);
          const matchedValues = [...new Set(reasons.map((r) => r.value))];
          const aiReason = matchedValues.length > 0
            ? `Matches your taste: ${matchedValues.join(", ")}`
            : `You've ordered "${getField(listing, "itemName", "ItemName", "name", "Name") ?? "this"}" before`;
          return { ...listing, aiRecommended: true, aiReason };
        }
        return listing;
      })
      .filter(Boolean)
      .slice(0, maxListings);
  } else {
    recommended = filteredListings
      .map((listing) => {
        const { score, reasons } = scoreListing(listing, topNames, topCategories);
        return { listing, score, reasons };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxListings)
      .map((row, idx) => {
        if (idx < 3 && row.reasons.length > 0) {
          const reasonText = `Matches your taste: ${[...new Set(row.reasons.map((r) => r.value))].join(", ")}`;
          return { ...row.listing, aiRecommended: true, aiReason: reasonText };
        }
        return row.listing;
      });
  }

  const fallbackListings = [];

  res.json({
    success: true,
    userId,
    sources: {
      orderService: ORDER_SERVICE_URL,
      inventoryService: includeActive ? INVENTORY_SERVICE_URL : null,
      rewardService: REWARD_SERVICE_URL
    },
    stampsCount,
    rewardEligibility,
    signals: { topItemNames: topNames, topCategories },
    gemini: { used: gemini.used, reasoning: gemini.reasoning },
    recommendedListings: recommended,
    fallbackListings
  });
});

app.listen(PORT, () => {
  console.log(`Composite get-food-recommendation service running on port ${PORT}`);
});
