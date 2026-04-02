import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4005;
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || "http://localhost:3004";
const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || "http://localhost:3003";
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3006";
const REWARD_SERVICE_URL =
  process.env.REWARD_SERVICE_URL || "http://localhost:3005";

const corsOrigins = (process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins,
  })
);
app.use(express.json());

function getField(item, ...keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function getListingId(listing) {
  return String(getField(listing, "Id", "id", "listingId", "ListingId") || "").trim();
}

function toMinorUnits(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (!Number.isInteger(numeric)) return Math.round(numeric * 100);
  if (numeric <= 100) return numeric * 100;
  return numeric;
}

function toMajorUnits(value) {
  return Number((toMinorUnits(value) / 100).toFixed(2));
}

function formatMoney(value, currency = "sgd") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0.00";

  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: String(currency || "SGD").toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await readBody(response);

  if (!response.ok) {
    const error = new Error(
      (data && data.error) || `Request failed (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function buildListingSummary(listing) {
  const itemName = String(
    getField(listing, "itemName", "ItemName", "name", "Name") || "Untitled"
  );
  const quantity = Number(getField(listing, "quantity", "Quantity") || 0);
  const price = Number(getField(listing, "price", "Price") || 0);

  return {
    listingId: getListingId(listing),
    restaurantId: String(getField(listing, "restaurantId", "RestaurantId") || ""),
    restaurantName: String(
      getField(listing, "restaurantName", "RestaurantName") || ""
    ),
    itemName,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    price: Number.isFinite(price) ? price : 0,
    expiryTime: String(getField(listing, "expiryTime", "ExpiryTime") || ""),
    cuisineType: String(getField(listing, "cuisineType", "CuisineType") || ""),
  };
}

async function getListingForRestaurant({ listingId, restaurantId }) {
  const listings = await fetchJson(
    `${INVENTORY_SERVICE_URL}/inventory/restaurant/${encodeURIComponent(restaurantId)}`
  );

  const matched = Array.isArray(listings)
    ? listings.find((listing) => getListingId(listing) === String(listingId))
    : null;

  if (!matched) {
    const error = new Error("Listing not found for this restaurant");
    error.status = 404;
    throw error;
  }

  return matched;
}

async function getAffectedOrders({
  listingId,
  restaurantId,
  restaurantName = "",
  includeCompleted = true,
}) {
  const params = new URLSearchParams();
  if (restaurantId) params.set("restaurantId", restaurantId);
  if (restaurantName) params.set("restaurantName", restaurantName);
  if (includeCompleted) params.set("includeCompleted", "true");

  const query = params.toString();
  return fetchJson(
    `${ORDER_SERVICE_URL}/orders/listings/${encodeURIComponent(listingId)}/affected${
      query ? `?${query}` : ""
    }`
  );
}

async function getPaymentForOrder(orderId) {
  return fetchJson(
    `${PAYMENT_SERVICE_URL}/payments/order/${encodeURIComponent(orderId)}`
  );
}

async function refundPayment({ paymentId, amountMinor, reason }) {
  return fetchJson(
    `${PAYMENT_SERVICE_URL}/payments/${encodeURIComponent(paymentId)}/refund`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountMinor,
        reason,
      }),
    }
  );
}

async function markOrderItemRefunded({
  orderId,
  itemId,
  restaurantId,
  restaurantName,
  reason,
  refundAmount,
  paymentId,
}) {
  return fetchJson(
    `${ORDER_SERVICE_URL}/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(
      itemId
    )}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "refunded",
        restaurantId,
        restaurantName,
        reason,
        refundAmount,
        paymentId,
      }),
    }
  );
}

async function deleteInventoryListing({
  listingId,
  listing,
  summary,
  restaurantId,
  restaurantName,
  reason,
}) {
  return fetchJson(
    `${INVENTORY_SERVICE_URL}/inventory/listings/${encodeURIComponent(listingId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listing,
        summary,
        restaurantId,
        restaurantName,
        reason,
      }),
    }
  );
}

function buildRefundReason({ listing, customReason = "" }) {
  const itemName = String(
    getField(listing, "itemName", "ItemName", "name", "Name") || "listing"
  ).trim();
  const reason = customReason
    ? `restaurant_removed_listing:${itemName}:${customReason}`
    : `restaurant_removed_listing:${itemName}`;
  return reason.slice(0, 200);
}

function getPositiveInteger(value, fallback = 0) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function sumListingQuantity(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const quantity = getPositiveInteger(item?.quantity, 1);
    return sum + Math.max(1, quantity);
  }, 0);
}

function summarizeAffectedOrders(affectedOrders) {
  const orders = Array.isArray(affectedOrders?.orders) ? affectedOrders.orders : [];
  const customerIds = new Set();
  const totalListingUnits = orders.reduce((sum, order) => {
    const customerId = String(order?.customerId || "").trim();
    if (customerId) customerIds.add(customerId);

    return (
      sum +
      (Array.isArray(order?.items) ? order.items : []).reduce((itemSum, item) => {
        return itemSum + Math.max(1, getPositiveInteger(item?.quantity, 1));
      }, 0)
    );
  }, 0);

  return {
    affectedOrders: orders.length,
    affectedCustomers: customerIds.size,
    totalListingUnits,
    requiresRefunds: orders.length > 0,
    totalRefundAmountMinor: Number(affectedOrders?.totalRefundAmountMinor || 0),
    totalRefundAmount: Number(affectedOrders?.totalRefundAmount || 0),
  };
}

function buildRefundNotificationMessage({
  listing,
  refundAmount,
  currency,
  quantity,
  orderCount,
}) {
  const restaurantName =
    String(getField(listing, "restaurantName", "RestaurantName") || "").trim() ||
    "this restaurant";
  const listingName =
    String(getField(listing, "itemName", "ItemName", "name", "Name") || "").trim() ||
    "this listing";
  const safeQuantity = Math.max(1, getPositiveInteger(quantity, 1));
  const safeOrderCount = Math.max(1, getPositiveInteger(orderCount, 1));

  return (
    `Restaurant ${restaurantName} has deleted listing ${listingName}. ` +
    `You have been refunded ${formatMoney(refundAmount, currency)} for ${safeQuantity} ${listingName} ` +
    `across ${safeOrderCount} order${safeOrderCount === 1 ? "" : "s"}.`
  );
}

function hasUsedReward(payment) {
  const reward = payment?.reward;
  if (!reward || typeof reward !== "object") return false;
  const eligible = Boolean(reward?.eligible);
  const discountPercent = Number(reward?.discountPercent || 0);
  const voucherId = String(reward?.voucherId || "").trim();
  const source = String(reward?.source || "").trim();
  return eligible || discountPercent > 0 || Boolean(voucherId) || Boolean(source);
}

async function restoreRewardVoucher({
  userId,
  voucherId,
  listingId,
  orderIds,
  paymentIds,
}) {
  const restoreKey = `delete_listing:${String(listingId || "").trim()}:${String(userId || "").trim()}`;

  return fetchJson(`${REWARD_SERVICE_URL}/reward/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      voucherId,
      restoreKey,
      listingId,
      sourceOrderIds: Array.isArray(orderIds) ? orderIds : [],
      sourcePaymentIds: Array.isArray(paymentIds) ? paymentIds : [],
      reason: "listing_deleted_refund",
    }),
  });
}

async function sendChannelNotification({
  userId,
  listing,
  refundAmount,
  currency,
  channel,
  quantity,
  orderCount,
}) {
  const restaurantName =
    String(getField(listing, "restaurantName", "RestaurantName") || "").trim() ||
    "restaurant";
  const listingName =
    String(getField(listing, "itemName", "ItemName", "name", "Name") || "").trim() ||
    "listing";
  const message = buildRefundNotificationMessage({
    listing,
    refundAmount,
    currency,
    quantity,
    orderCount,
  });
  const response = await fetchJson(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      listingId: getListingId(listing),
      type: "LISTING_DELETED_REFUND",
      channel,
      title: `Refund issued for ${listingName}`,
      message,
      smsBody: channel === "SMS" ? message : undefined,
      metadata: {
        restaurantName,
        listingName,
        orderCount,
        quantity,
      },
    }),
  });

  const status = String(response?.status || "").toUpperCase();
  const acceptedStatuses = channel === "SMS" ? ["SENT", "SKIPPED"] : ["STORED"];

  if (!acceptedStatuses.includes(status)) {
    const error = new Error(
      `Notification channel ${channel} returned status ${status || "UNKNOWN"}`
    );
    error.response = response;
    throw error;
  }

  return response;
}

async function sendDualRefundNotifications({
  userId,
  listing,
  refundAmount,
  currency,
  quantity,
  orderCount,
}) {
  const outcomes = [];

  for (const channel of ["IN_APP", "SMS"]) {
    try {
      await sendChannelNotification({
        userId,
        listing,
        refundAmount,
        currency,
        channel,
        quantity,
        orderCount,
      });
      outcomes.push({ channel, success: true });
    } catch (error) {
      outcomes.push({
        channel,
        success: false,
        error: error?.message || String(error),
      });
    }
  }

  return outcomes;
}

function buildPreviewResponse({ listing, affectedOrders }) {
  const summary = summarizeAffectedOrders(affectedOrders);

  return {
    success: true,
    listing: buildListingSummary(listing),
    summary,
    affectedOrders: Array.isArray(affectedOrders?.orders) ? affectedOrders.orders : [],
  };
}

async function loadDeleteContext({
  listingId,
  restaurantId,
  restaurantName = "",
}) {
  const listing = await getListingForRestaurant({ listingId, restaurantId });
  const affectedOrders = await getAffectedOrders({
    listingId,
    restaurantId,
    restaurantName,
    includeCompleted: true,
  });

  return { listing, affectedOrders };
}

async function handleDeleteListing(req, res) {
  const { listingId } = req.params;
  const {
    restaurantId = "",
    restaurantName = "",
    reason = "",
  } = req.body || {};

  if (!restaurantId) {
    return res.status(400).json({ error: "restaurantId is required" });
  }

  const results = {
    success: false,
    listingId: String(listingId || ""),
    listingDeleted: false,
    refundsProcessed: [],
    notificationsProcessed: [],
    notificationsFailed: [],
    rewardsRestored: [],
    rewardsRestoreFailed: [],
  };

  try {
    const { listing, affectedOrders } = await loadDeleteContext({
      listingId,
      restaurantId,
      restaurantName,
    });

    const plannedRefunds = [];

    for (const order of affectedOrders?.orders || []) {
      const payment = await getPaymentForOrder(order.orderId);

      if (!payment?.paymentId) {
        const error = new Error(`Missing payment record for order ${order.orderId}`);
        error.status = 502;
        throw error;
      }

      plannedRefunds.push({
        order,
        paymentId: payment.paymentId,
        payment,
      });
    }

    const refundReason = buildRefundReason({ listing, customReason: reason });

    for (const plan of plannedRefunds) {
      const totalRefundAmountMinor = Number(plan.order?.totalRefundAmountMinor || 0);
      const totalRefundAmount = Number(plan.order?.totalRefundAmount || 0);

      if (totalRefundAmountMinor <= 0) {
        continue;
      }

      await refundPayment({
        paymentId: plan.paymentId,
        amountMinor: totalRefundAmountMinor,
        reason: refundReason,
      });

      for (const item of plan.order?.items || []) {
        await markOrderItemRefunded({
          orderId: plan.order.orderId,
          itemId: item.itemId,
          restaurantId,
          restaurantName,
          reason: refundReason,
          refundAmount: Number(item.refundAmount || 0),
          paymentId: plan.paymentId,
        });
      }

      results.refundsProcessed.push({
        orderId: plan.order.orderId,
        paymentId: plan.paymentId,
        customerId: plan.order.customerId,
        currency: plan.order.currency || "sgd",
        refundAmountMinor: totalRefundAmountMinor,
        refundAmount: totalRefundAmount,
        listingQuantity: sumListingQuantity(plan.order?.items),
        rewardUsed: hasUsedReward(plan.payment),
        rewardVoucherId: String(plan.payment?.reward?.voucherId || ""),
      });
    }

    const notificationsByUser = new Map();
    for (const refundRow of results.refundsProcessed) {
      const userId = String(refundRow.customerId || "");
      if (!userId) continue;

      if (!notificationsByUser.has(userId)) {
        notificationsByUser.set(userId, {
          userId,
          currency: refundRow.currency || "sgd",
          refundAmount: 0,
          listingQuantity: 0,
          orderIds: [],
          paymentIds: [],
          rewardUsed: false,
          rewardVoucherId: "",
        });
      }

      const entry = notificationsByUser.get(userId);
      entry.refundAmount = Number(
        (entry.refundAmount + Number(refundRow.refundAmount || 0)).toFixed(2)
      );
      entry.listingQuantity += Math.max(0, getPositiveInteger(refundRow.listingQuantity, 0));
      entry.orderIds.push(refundRow.orderId);
      entry.paymentIds.push(refundRow.paymentId);
      entry.rewardUsed = entry.rewardUsed || Boolean(refundRow.rewardUsed);
      if (!entry.rewardVoucherId && refundRow.rewardVoucherId) {
        entry.rewardVoucherId = String(refundRow.rewardVoucherId || "");
      }
    }

    for (const rewardEntry of notificationsByUser.values()) {
      if (!rewardEntry.rewardUsed) continue;

      try {
        const response = await restoreRewardVoucher({
          userId: rewardEntry.userId,
          voucherId: rewardEntry.rewardVoucherId,
          listingId,
          orderIds: rewardEntry.orderIds,
          paymentIds: rewardEntry.paymentIds,
        });

        results.rewardsRestored.push({
          userId: rewardEntry.userId,
          restoreKey: response?.restoreKey || "",
          voucherId: response?.voucherId || rewardEntry.rewardVoucherId || "",
          orderIds: rewardEntry.orderIds,
        });
      } catch (error) {
        results.rewardsRestoreFailed.push({
          userId: rewardEntry.userId,
          voucherId: rewardEntry.rewardVoucherId || "",
          orderIds: rewardEntry.orderIds,
          error: error?.message || String(error),
        });
      }
    }

    for (const notificationEntry of notificationsByUser.values()) {
      const outcomes = await sendDualRefundNotifications({
        userId: notificationEntry.userId,
        listing,
        refundAmount: notificationEntry.refundAmount,
        currency: notificationEntry.currency,
        quantity: notificationEntry.listingQuantity,
        orderCount: notificationEntry.orderIds.length,
      });

      outcomes.forEach((outcome) => {
        const payload = {
          userId: notificationEntry.userId,
          channel: outcome.channel,
          refundAmount: notificationEntry.refundAmount,
          listingQuantity: notificationEntry.listingQuantity,
          orderCount: notificationEntry.orderIds.length,
          orderIds: notificationEntry.orderIds,
        };

        if (outcome.success) {
          results.notificationsProcessed.push(payload);
        } else {
          results.notificationsFailed.push({
            ...payload,
            error: outcome.error,
          });
        }
      });
    }

    const deleteSummary = {
      refundedOrders: results.refundsProcessed.length,
      affectedCustomers: notificationsByUser.size,
      totalListingUnits: Array.from(notificationsByUser.values()).reduce(
        (sum, entry) => sum + Number(entry.listingQuantity || 0),
        0
      ),
      totalRefundAmount: Number(
        results.refundsProcessed
          .reduce((sum, row) => sum + Number(row.refundAmount || 0), 0)
          .toFixed(2)
      ),
      notificationsSent: results.notificationsProcessed.length,
      notificationsFailed: results.notificationsFailed.length,
      rewardsRestored: results.rewardsRestored.length,
      rewardsRestoreFailed: results.rewardsRestoreFailed.length,
    };

    await deleteInventoryListing({
      listingId,
      listing,
      summary: deleteSummary,
      restaurantId,
      restaurantName,
      reason: refundReason,
    });
    results.success = true;
    results.listingDeleted = true;

    return res.json({
      ...results,
      listing: buildListingSummary(listing),
      summary: {
        ...deleteSummary,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ...results,
      error: error.message || "Failed to delete listing",
      details: error.data || null,
    });
  }
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "composite-delete-listing",
  });
});

async function handleDeletePreview(req, res) {
  try {
    const { listingId } = req.params;
    const { restaurantId = "", restaurantName = "" } = req.query;

    if (!restaurantId) {
      return res.status(400).json({ error: "restaurantId is required" });
    }

    const payload = await loadDeleteContext({
      listingId,
      restaurantId,
      restaurantName,
    });

    return res.json(buildPreviewResponse(payload));
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to build delete preview",
      details: error.data || null,
    });
  }
}

app.get("/delete-listing/:listingId/preview", handleDeletePreview);
app.get("/listings/delete/:listingId/preview", handleDeletePreview);

app.delete("/delete-listing/:listingId", handleDeleteListing);
app.post("/delete-listing/:listingId", handleDeleteListing);
app.delete("/listings/delete/:listingId", handleDeleteListing);
app.post("/listings/delete/:listingId", handleDeleteListing);

app.listen(PORT, () => {
  console.log(`Composite delete-listing service running on port ${PORT}`);
});
