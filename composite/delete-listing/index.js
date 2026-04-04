import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { randomUUID } from "crypto";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4005;
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || "http://localhost:3004";
const REFUND_MANAGEMENT_SERVICE_URL =
  process.env.REFUND_MANAGEMENT_SERVICE_URL || "http://localhost:3007";
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3006";
const REWARD_SERVICE_URL =
  process.env.REWARD_SERVICE_URL || "http://localhost:3005";
const CORRELATION_HEADER = "x-correlation-id";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FoodRescue Delete Listing Composite API",
      version: "1.0.0",
      description:
        "Orchestrates listing deletion, refunds, reward restoration, and customer notifications.",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Direct composite-delete-listing service",
      },
      {
        url: "http://localhost:8000",
        description: "Kong API gateway",
      },
    ],
    tags: [
      { name: "Delete Listing", description: "Delete listing orchestration endpoint" },
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
        DeletePreviewResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            listing: {
              type: "object",
              properties: {
                listingId: { type: "string" },
                restaurantId: { type: "string" },
                restaurantName: { type: "string" },
                itemName: { type: "string" },
                quantity: { type: "number" },
                price: { type: "number" },
                expiryTime: { type: "string" },
                cuisineType: { type: "string" },
              },
            },
            summary: {
              type: "object",
              properties: {
                affectedOrders: { type: "number" },
                affectedCustomers: { type: "number" },
                totalListingUnits: { type: "number" },
                requiresRefunds: { type: "boolean" },
                totalRefundAmountMinor: { type: "number" },
                totalRefundAmount: { type: "number" },
              },
            },
            affectedOrders: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
      },
    },
    paths: {
      "/delete-listing/{listingId}": {
        post: {
          tags: ["Delete Listing"],
          summary: "Delete listing",
          description:
            "Gateway copy-paste URL: http://localhost:8000/delete-listing/{listingId}",
          parameters: [
            {
              in: "path",
              name: "listingId",
              required: true,
              schema: { type: "string", example: "125" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["restaurantId"],
                  properties: {
                    restaurantId: { type: "string", example: "18CXbYrzy0o2v5BbHEUq" },
                    restaurantName: { type: "string", example: "Korean Jap Bites" },
                    reason: { type: "string", example: "manual test delete" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Listing deleted and orchestration completed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      listingDeleted: { type: "boolean" },
                      listing: { type: "object" },
                      summary: { type: "object" },
                    },
                  },
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
              description: "Listing not found",
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

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function createCorrelationId(scope = "delete-listing") {
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

app.use(correlationMiddleware("delete-listing"));

app.get("/delete-listing-api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});
app.use("/delete-listing-api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

async function fetchJson(url, options = {}, correlationId = "") {
  const response = await fetch(url, {
    ...options,
    headers: withCorrelationHeaders(options?.headers || {}, correlationId),
  });
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

async function getListingForRestaurant({ listingId, restaurantId, correlationId = "" }) {
  const listings = await fetchJson(
    `${INVENTORY_SERVICE_URL}/inventory/restaurant/${encodeURIComponent(restaurantId)}`,
    {},
    correlationId
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
  correlationId = "",
}) {
  const params = new URLSearchParams();
  if (restaurantId) params.set("restaurantId", restaurantId);
  if (restaurantName) params.set("restaurantName", restaurantName);
  if (includeCompleted) params.set("includeCompleted", "true");

  const query = params.toString();
  return fetchJson(
    `${ORDER_SERVICE_URL}/orders/listings/${encodeURIComponent(listingId)}/affected${
      query ? `?${query}` : ""
    }`,
    {},
    correlationId
  );
}

async function processRefund({
  orderId,
  amountMinor,
  reason,
  correlationId = "",
}) {
  return fetchJson(`${REFUND_MANAGEMENT_SERVICE_URL}/refund-management/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      amountMinor,
      reason,
    }),
  }, correlationId);
}

async function markOrderItemRefunded({
  orderId,
  itemId,
  restaurantId,
  restaurantName,
  reason,
  refundAmount,
  paymentId,
  correlationId = "",
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
    },
    correlationId
  );
}

async function deleteInventoryListing({
  listingId,
  listing,
  summary,
  restaurantId,
  restaurantName,
  reason,
  correlationId = "",
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
    },
    correlationId
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
  correlationId = "",
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
  }, correlationId);
}

async function sendChannelNotification({
  userId,
  listing,
  refundAmount,
  currency,
  channel,
  quantity,
  orderCount,
  correlationId = "",
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
  }, correlationId);

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
  correlationId = "",
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
        correlationId,
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
  correlationId = "",
}) {
  const listing = await getListingForRestaurant({ listingId, restaurantId, correlationId });
  const affectedOrders = await getAffectedOrders({
    listingId,
    restaurantId,
    restaurantName,
    includeCompleted: true,
    correlationId,
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
    const correlationId = req.correlationId;
    const { listing, affectedOrders } = await loadDeleteContext({
      listingId,
      restaurantId,
      restaurantName,
      correlationId,
    });

    const refundReason = buildRefundReason({ listing, customReason: reason });

    for (const order of affectedOrders?.orders || []) {
      const totalRefundAmountMinor = Number(order?.totalRefundAmountMinor || 0);
      const totalRefundAmount = Number(order?.totalRefundAmount || 0);

      if (totalRefundAmountMinor <= 0) {
        continue;
      }

      const refundResponse = await processRefund({
        orderId: order.orderId,
        amountMinor: totalRefundAmountMinor,
        reason: refundReason,
        correlationId,
      });

      const paymentId = String(refundResponse?.paymentId || "").trim();
      if (!paymentId) {
        const error = new Error(`Missing paymentId in refund response for order ${order.orderId}`);
        error.status = 502;
        throw error;
      }

      for (const item of order?.items || []) {
        await markOrderItemRefunded({
          orderId: order.orderId,
          itemId: item.itemId,
          restaurantId,
          restaurantName,
          reason: refundReason,
          refundAmount: Number(item.refundAmount || 0),
          paymentId,
          correlationId,
        });
      }

      results.refundsProcessed.push({
        orderId: order.orderId,
        paymentId,
        customerId: order.customerId,
        currency: order.currency || "sgd",
        refundAmountMinor: totalRefundAmountMinor,
        refundAmount: totalRefundAmount,
        listingQuantity: sumListingQuantity(order?.items),
        rewardUsed: hasUsedReward({ reward: refundResponse?.reward || null }),
        rewardVoucherId: String(refundResponse?.reward?.voucherId || ""),
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
          correlationId,
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
        correlationId,
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
      correlationId,
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
    const correlationId = req.correlationId;
    const { listingId } = req.params;
    const { restaurantId = "", restaurantName = "" } = req.query;

    if (!restaurantId) {
      return res.status(400).json({ error: "restaurantId is required" });
    }

    const payload = await loadDeleteContext({
      listingId,
      restaurantId,
      restaurantName,
      correlationId,
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
