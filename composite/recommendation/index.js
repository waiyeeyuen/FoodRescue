import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4000;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || "http://localhost:3004";
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";
const REWARD_SERVICE_URL = process.env.REWARD_SERVICE_URL || "http://localhost:3005";

const corsOrigins = (process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:5173"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins
  })
);
app.use(express.json());

function getField(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function normalizeString(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await readBody(response);
  if (!response.ok) {
    const err = new Error(
      (data && data.error) || `Request failed (${response.status})`
    );
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
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
  const itemName = normalizeString(
    getField(listing, "itemName", "ItemName", "name", "Name")
  );
  const cuisineType = normalizeString(
    getField(listing, "cuisineType", "CuisineType", "category", "Category")
  );

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

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "composite-recommendation"
  });
});

// Scenario 3: "Get Food Recommendation"
// 1) UI calls: GET /recommendations/:userId
// 2) Composite fetches Order history (user_id, status?)
// 4) Composite fetches available Inventory listings
// 6) Composite checks Reward eligibility (derived stamps_count)
// 8) Composite returns recommendations + eligibility info
app.get("/recommendations/:userId", async (req, res) => {
  const { userId } = req.params;

  const includeActive = parseBool(req.query.includeActive, true);
  const maxListings = Math.max(
    1,
    Math.min(200, Number(req.query.maxListings ?? 20) || 20)
  );
  const maxSignals = Math.max(
    1,
    Math.min(20, Number(req.query.maxSignals ?? 5) || 5)
  );

  const requestedListingIds = normalizeCsv(
    req.query.listingIds ?? req.query.listing_ids ?? req.query.listing_id
  );

  let orderHistoryResponse = null;
  let inventoryListings = null;
  let rewardEligibility = null;

  // 2) Get Order History
  try {
    orderHistoryResponse = await fetchJson(
      `${ORDER_SERVICE_URL}/orders/customer/${encodeURIComponent(userId)}/history?limit=20`
    );
  } catch (error) {
    orderHistoryResponse = {
      success: false,
      error: error.message,
      status: error.status || 500
    };
  }

  const orderHistory = Array.isArray(orderHistoryResponse?.orderHistory)
    ? orderHistoryResponse.orderHistory
    : [];

  const stampsCount = orderHistory.length;

  // 6) Check Rewards Eligibility (Reward service takes userId; we also include stampsCount as metadata)
  try {
    const rewardPayload = await fetchJson(
      `${REWARD_SERVICE_URL}/reward/eligibility/${encodeURIComponent(userId)}`
    );
    rewardEligibility = {
      success: true,
      stampsCount,
      data: rewardPayload
    };
  } catch (error) {
    rewardEligibility = {
      success: false,
      stampsCount,
      error: error.message,
      status: error.status || 500
    };
  }

  // 4) Get Available Items
  if (includeActive) {
    try {
      inventoryListings = await fetchJson(`${INVENTORY_SERVICE_URL}/inventory/active`);
    } catch (error) {
      inventoryListings = {
        success: false,
        error: error.message,
        status: error.status || 500
      };
    }
  }

  const { topNames, topCategories } = pickTopSignals(orderHistory, maxSignals);

  // If the UI supplies listing_id(s), filter the available items to those first.
  const filteredListings = Array.isArray(inventoryListings)
    ? inventoryListings.filter((listing) => {
        if (requestedListingIds.length === 0) return true;
        const id =
          getField(listing, "Id", "id", "listingId", "ListingId") ?? "";
        return requestedListingIds.includes(String(id));
      })
    : [];

  const scored = filteredListings
    .map((listing) => {
      const { score, reasons } = scoreListing(listing, topNames, topCategories);
      return { listing, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const recommended = scored
    .filter((row) => row.score > 0)
    .slice(0, maxListings)
    .map((row) => row.listing);

  // Fallback: if no signals match, just return a small slice of available items.
  const fallbackListings =
    recommended.length > 0
      ? []
      : filteredListings.slice(0, Math.min(maxListings, filteredListings.length));

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
    signals: {
      topItemNames: topNames,
      topCategories
    },
    recommendedListings: recommended,
    fallbackListings
  });
});

app.listen(PORT, () => {
  console.log(`Composite recommendation service running on port ${PORT}`);
});
