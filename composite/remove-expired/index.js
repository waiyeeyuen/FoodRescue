import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import amqp from "amqplib";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4003;
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";
const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || "http://localhost:3003";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";

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

function parseExpiryMs(listing) {
  const raw = getField(listing, "expiryTime", "ExpiryTime");
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw < 10_000_000_000 ? raw * 1000 : raw;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) return asNum < 10_000_000_000 ? asNum * 1000 : asNum;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.getTime();
  return null;
}

function parseBool(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
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

let rabbitConn = null;
let rabbitChannel = null;

async function getRabbitChannel() {
  if (rabbitChannel) return rabbitChannel;
  rabbitConn = await amqp.connect(RABBITMQ_URL);
  rabbitChannel = await rabbitConn.createChannel();
  await rabbitChannel.assertQueue("listing.expired", { durable: true });
  await rabbitChannel.assertQueue("order.expired", { durable: true });
  await rabbitChannel.assertQueue("reward.triggered", { durable: true });
  return rabbitChannel;
}

async function publish(queue, payload) {
  const channel = await getRabbitChannel();
  const ok = channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true
  });
  return ok;
}

process.on("SIGINT", async () => {
  try {
    if (rabbitChannel) await rabbitChannel.close();
    if (rabbitConn) await rabbitConn.close();
  } catch {
    // ignore
  }
  process.exit(0);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "composite-remove-expired"
  });
});

async function collectExpiredListings() {
  const listings = await fetchJson(`${INVENTORY_SERVICE_URL}/inventory/active`);
  if (!Array.isArray(listings)) return [];
  const now = Date.now();
  return listings
    .map((listing) => {
      const expiryMs = parseExpiryMs(listing);
      return { listing, expiryMs };
    })
    .filter((row) => row.expiryMs && row.expiryMs < now);
}

async function collectExpiredPayments() {
  const payments = await fetchJson(`${PAYMENT_SERVICE_URL}/payments`);
  if (!Array.isArray(payments)) return [];
  return payments.filter((p) => String(p?.status || "").toLowerCase() === "expired");
}

app.get("/cleanup/preview", async (req, res) => {
  try {
    const includePayments = parseBool(req.query.includePayments, false);
    const expiredListings = await collectExpiredListings();
    const expiredPayments = includePayments ? await collectExpiredPayments() : [];

    res.json({
      success: true,
      counts: {
        expiredListings: expiredListings.length,
        expiredPayments: expiredPayments.length
      },
      expiredListings: expiredListings.slice(0, 50).map((row) => ({
        id: getField(row.listing, "Id", "id", "listingId", "ListingId") ?? null,
        restaurantId:
          getField(row.listing, "restaurantId", "RestaurantId") ?? null,
        itemName: getField(row.listing, "itemName", "ItemName") ?? null,
        expiryTime: getField(row.listing, "expiryTime", "ExpiryTime") ?? null,
        expiryMs: row.expiryMs
      })),
      expiredPayments: expiredPayments.slice(0, 50).map((p) => ({
        paymentId: p?.paymentId,
        orderId: p?.orderId,
        userId: p?.userId,
        status: p?.status,
        updatedAt: p?.updatedAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to preview cleanup" });
  }
});

app.post("/cleanup/run", async (req, res) => {
  const dryRun = parseBool(req.query.dryRun, parseBool(req.body?.dryRun, true));
  const includePayments = parseBool(
    req.query.includePayments,
    parseBool(req.body?.includePayments, false)
  );

  const results = {
    success: true,
    dryRun,
    published: {
      "listing.expired": 0,
      "order.expired": 0
    },
    skipped: {
      "listing.expired": 0,
      "order.expired": 0
    },
    errors: []
  };

  try {
    const expiredListings = await collectExpiredListings();
    for (const row of expiredListings) {
      const listing = row.listing;
      const restaurantId = getField(listing, "restaurantId", "RestaurantId");
      const payload = {
        type: "listing.expired",
        user_id: restaurantId || "unknown",
        listing_id: getField(listing, "Id", "id", "listingId", "ListingId") ?? "",
        itemName: getField(listing, "itemName", "ItemName") ?? "",
        expiryTime: getField(listing, "expiryTime", "ExpiryTime") ?? "",
        detectedAt: new Date().toISOString()
      };

      if (dryRun) {
        results.skipped["listing.expired"] += 1;
        continue;
      }

      try {
        await publish("listing.expired", payload);
        results.published["listing.expired"] += 1;
      } catch (error) {
        results.errors.push({
          queue: "listing.expired",
          error: error.message
        });
      }
    }

    if (includePayments) {
      const expiredPayments = await collectExpiredPayments();
      for (const payment of expiredPayments) {
        const payload = {
          type: "order.expired",
          user_id: payment.userId || "unknown",
          order_id: payment.orderId || "",
          payment_id: payment.paymentId || "",
          detectedAt: new Date().toISOString()
        };

        if (dryRun) {
          results.skipped["order.expired"] += 1;
          continue;
        }

        try {
          await publish("order.expired", payload);
          results.published["order.expired"] += 1;
        } catch (error) {
          results.errors.push({
            queue: "order.expired",
            error: error.message
          });
        }
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Cleanup run failed",
      results
    });
  }
});

app.listen(PORT, () => {
  console.log(`Composite remove-expired service running on port ${PORT}`);
});

