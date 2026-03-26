import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3005;
const BASE_URL =
  "https://personal-zxyqgjgl.outsystemscloud.com/FoodRescueRewardsSystem/rest/RewardAPI";
const STAMP_TARGET = 5;
const DISCOUNT_PERCENT = 20;

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5173"],
  })
);
app.use(express.json());

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

async function fetchRewardEligibility(userId) {
  const response = await fetch(`${BASE_URL}/eligibility?UserId=${encodeURIComponent(userId)}`);
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
    const { response, data } = await fetchRewardEligibility(userId);
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
  const { userId, voucherId } = req.body;
  try {
    const response = await fetch(`${BASE_URL}/UpdateStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
