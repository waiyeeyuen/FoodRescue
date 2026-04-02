import express from "express";
import cors from "cors";
import { db } from "../firebase/firebaseAdmin.js";

const app = express();
const PORT = process.env.PORT || 3005;
const BASE_URL = String(process.env.OUTSYSTEMS_REWARD_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const STAMP_TARGET = 5;
const DISCOUNT_PERCENT = 20;
const RESTORED_REWARDS = db.collection("reward_restorations");

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

async function fetchRewardEligibility(userId) {
  const response = await fetch(`${getRewardBaseUrl()}/eligibility?UserId=${encodeURIComponent(userId)}`);
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

app.post("/reward/restore", async (req, res) => {
  const {
    userId,
    voucherId = "",
    restoreKey = "",
    sourceOrderIds = [],
    sourcePaymentIds = [],
    reason = "refund_restored_voucher",
    listingId = "",
    discountPercent = DISCOUNT_PERCENT,
  } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const docId =
      String(restoreKey || "").trim() ||
      `restored_${String(userId).trim()}_${Date.now()}`;
    const restoredVoucherId =
      String(voucherId || "").trim() || `restored_${String(userId).trim()}`;

    const payload = {
      userId: String(userId).trim(),
      voucherId: restoredVoucherId,
      discountPercent: Number(discountPercent || DISCOUNT_PERCENT) || DISCOUNT_PERCENT,
      status: "active",
      restoreReason: String(reason || "refund_restored_voucher"),
      listingId: String(listingId || ""),
      sourceOrderIds: Array.isArray(sourceOrderIds) ? sourceOrderIds : [],
      sourcePaymentIds: Array.isArray(sourcePaymentIds) ? sourcePaymentIds : [],
      restoredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    await RESTORED_REWARDS.doc(docId).set(payload, { merge: true });

    return res.status(201).json({
      success: true,
      restoreKey: docId,
      voucherId: restoredVoucherId,
      source: "restored-voucher",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to restore reward voucher" });
  }
});

app.listen(PORT, () => {
  console.log(`Reward service running on port ${PORT}`);
});
