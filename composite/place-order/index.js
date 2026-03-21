import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4001;
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || "http://localhost:3003";

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

async function readBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!raw) return null;
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  try { return JSON.parse(raw); } catch { return raw; }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await readBody(response);
  if (!response.ok) {
    const err = new Error((data && data.error) || `Request failed (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toMinorUnits(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!Number.isInteger(num)) return Math.round(num * 100);
  if (num <= 100) return num * 100;
  return num;
}

function getItemName(item) {
  return item?.name || item?.itemName || item?.ItemName || item?.title || item?.itemId || "Item";
}

// ✅ Generate orderId here so it ties payment metadata → consumer → order service
function generateOrderId() {
  return 'ORD_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "composite-place-order" });
});

app.post("/orders/place", async (req, res) => {
  try {
    const {
      customerId: _customerId,
      userId,
      items: _items,
      cart,
      notes,
      currency,
      successUrl,
      cancelUrl
    } = req.body || {};

    const customerId = _customerId || userId;
    const items = _items || cart;

    if (!customerId) {
      return res.status(400).json({ error: "customerId (or userId) is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items (or cart) array is required" });
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
        unitAmount: unitAmountMinor  // ✅ key must be unitAmount for payment service
      };
    });

    // ✅ Generate orderId HERE — passed to payment metadata so consumer can use same ID
    const orderId = generateOrderId();

    const paymentItems = normalizedItems.map((item) => ({
      name: item.name,
      unitAmount: item.unitAmount,
      quantity: item.quantity
    }));

    // ✅ Only call payment service — order is created by inventory consumer after stock check
    const paymentResponse = await fetchJson(
      `${PAYMENT_SERVICE_URL}/payments/checkout-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,       // ← passed into Stripe metadata
          userId: customerId,
          items: paymentItems,
          currency,
          successUrl,
          cancelUrl
        })
      }
    );

    res.status(201).json({
      success: true,
      orderId,                        // ← frontend can store this to poll order status later
      payment: paymentResponse
    });

  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Failed to place order" });
  }
});

app.listen(PORT, () => {
  console.log(`Composite place-order service running on port ${PORT}`);
});
