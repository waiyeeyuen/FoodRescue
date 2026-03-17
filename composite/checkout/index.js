import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4004;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || "http://localhost:3004";
const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || "http://localhost:3003";
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

function toMinorUnits(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!Number.isInteger(num)) return Math.round(num * 100);
  if (num <= 100) return num * 100;
  return num;
}

function parseBool(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

function getItemName(item) {
  return (
    item?.name ||
    item?.itemName ||
    item?.ItemName ||
    item?.title ||
    item?.itemId ||
    "Item"
  );
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

function parseReward(rewardPayload) {
  const eligibleRaw = getField(rewardPayload, "eligible", "Eligible", "isEligible");
  const eligible = eligibleRaw === undefined ? false : Boolean(eligibleRaw);

  const voucherId =
    getField(rewardPayload, "voucherId", "VoucherId") ||
    getField(rewardPayload, "voucher", "Voucher")?.id ||
    "";

  const discountPercentRaw =
    getField(rewardPayload, "discountPercent", "DiscountPercent") ??
    getField(rewardPayload, "discount_percentage", "DiscountPercentage");
  const discountPercent = Number(discountPercentRaw ?? 0);

  return {
    eligible,
    voucherId: String(voucherId || ""),
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    raw: rewardPayload
  };
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "composite-checkout"
  });
});

app.post("/checkout", async (req, res) => {
  try {
    const {
      userId,
      customerId,
      items,
      notes,
      currency,
      successUrl,
      cancelUrl,
      applyVoucher
    } = req.body || {};

    const resolvedUserId = userId || customerId;
    if (!resolvedUserId) {
      return res.status(400).json({ error: "userId (or customerId) is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
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
        unitAmountMinor
      };
    });

    let reward = null;
    if (parseBool(applyVoucher, false)) {
      try {
        const rewardPayload = await fetchJson(
          `${REWARD_SERVICE_URL}/reward/eligibility/${encodeURIComponent(resolvedUserId)}`
        );
        reward = parseReward(rewardPayload);
      } catch (error) {
        reward = {
          eligible: false,
          voucherId: "",
          discountPercent: 0,
          error: error.message,
          status: error.status || 500
        };
      }
    }

    const discountPercent = reward?.eligible ? Number(reward.discountPercent || 0) : 0;
    const multiplier = discountPercent > 0 ? (100 - discountPercent) / 100 : 1;

    const discountedItems = normalizedItems.map((item) => {
      const discountedUnitAmountMinor = Math.max(
        0,
        Math.round(item.unitAmountMinor * multiplier)
      );
      return {
        ...item,
        discountedUnitAmountMinor
      };
    });

    const totalPriceMajor =
      discountedItems.reduce(
        (sum, item) =>
          sum + (item.discountedUnitAmountMinor / 100) * item.quantity,
        0
      ) || 0;

    const orderResponse = await fetchJson(`${ORDER_SERVICE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: resolvedUserId,
        items: discountedItems.map((item) => ({
          itemId: item.itemId || item.listingId || item.id || item.name,
          name: item.name,
          quantity: item.quantity,
          category: item.category || item.cuisineType || "",
          unitAmountMinor: item.discountedUnitAmountMinor,
          originalUnitAmountMinor: item.unitAmountMinor
        })),
        totalPrice: Number(totalPriceMajor.toFixed(2)),
        notes: notes || ""
      })
    });

    const orderId =
      orderResponse?.order?.orderId ||
      orderResponse?.orderId ||
      orderResponse?.order?.id;

    if (!orderId) {
      return res.status(502).json({
        error: "Order service did not return an orderId",
        orderResponse
      });
    }

    const paymentItems = discountedItems.map((item) => ({
      name: item.name,
      unitAmount: item.discountedUnitAmountMinor,
      quantity: item.quantity
    }));

    const paymentResponse = await fetchJson(
      `${PAYMENT_SERVICE_URL}/payments/checkout-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          userId: resolvedUserId,
          items: paymentItems,
          currency,
          successUrl,
          cancelUrl
        })
      }
    );

    res.status(201).json({
      success: true,
      reward,
      order: orderResponse?.order || orderResponse,
      payment: paymentResponse
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Checkout failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Composite checkout service running on port ${PORT}`);
});

