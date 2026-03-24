import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4001;
const PAYMENT_SERVICE_URL     = process.env.PAYMENT_SERVICE_URL     || "http://localhost:3003";
const ORDER_SERVICE_URL        = process.env.ORDER_SERVICE_URL        || "http://localhost:3004";
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3006";
const INVENTORY_SERVICE_URL    = process.env.INVENTORY_SERVICE_URL || "http://localhost:3000";

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173")
  .split(",").map((v) => v.trim()).filter(Boolean);

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Fire-and-forget — never throws, never blocks
function fireAndForget(url, body) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => console.warn(`[fire-and-forget] ${url} failed:`, err.message));
}

// Decrement OutSystems inventory for confirmed items — fire-and-forget
function decrementOutSystemsInventory(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  items.forEach((item) => {
    const itemId = item?.itemId || item?.listingId || item?.id;
    const boughtQuantity = Number(item?.quantity) || 1;
    
    if (!itemId) {
      console.warn(`[place-order] ⚠️ Skipping decrement — missing itemId for:`, item.name);
      return;
    }

    const url = `${INVENTORY_SERVICE_URL}/DecrementListingCount?itemId=${encodeURIComponent(itemId)}&boughtQuantity=${boughtQuantity}`;
    fetch(url, { method: "PUT" })
      .then((res) => {
        if (!res.ok) {
          console.warn(`[place-order] ⚠️ Inventory decrement failed (${res.status}) for itemId: ${itemId}, quantity: ${boughtQuantity}`);
        } else {
          console.log(`[place-order] ✅ Inventory inventory decremented for itemId: ${itemId}, quantity: ${boughtQuantity}`);
        }
      })
      .catch((err) => console.warn(`[place-order] ⚠️ Inventory decrement error for itemId ${itemId}:`, err.message));
  });
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

function generateOrderId() {
  return "ORD_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "composite-place-order" });
});

// Step 3 — UI calls this to begin order process
app.post("/orders/place", async (req, res) => {
  try {
    const {
      orderId: incomingOrderId,
      customerId: _customerId,
      userId,
      items: _items,
      cart,
      notes,
      currency,
      successUrl,
      cancelUrl,
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
        unitAmount: unitAmountMinor,
      };
    });

    // orderId flows into Stripe metadata → consumer → order service
    const orderId = incomingOrderId || generateOrderId();

    const paymentItems = normalizedItems.map((item) => ({
      name: item.name,
      itemId: item?.itemId || item?.listingId || item?.id || null,
      unitAmount: item.unitAmount,
      quantity: item.quantity,
    }));

    // Step 10 — call Payment Service to create Stripe session
    const paymentResponse = await fetchJson(
      `${PAYMENT_SERVICE_URL}/payments/checkout-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          userId: customerId,
          items: paymentItems,
          currency,
          successUrl,
          cancelUrl,
        }),
      }
    );

    console.log(`[place-order] ✅ Checkout session created for order ${orderId}`);

    res.status(201).json({
      success: true,
      orderId,
      payment: paymentResponse,
    });
  } catch (error) {
    console.error("[place-order] ❌ /orders/place error:", error.message);
    res.status(error.status || 500).json({ error: error.message || "Failed to place order" });
  }
});

// Step 7 — Inventory consumer calls this after stock validation
app.post("/orders/inventory-result", async (req, res) => {
  const {
    orderId,
    paymentId,
    userId,
    currency,
    status,           // "ok" | "partial" | "failed"
    confirmedItems,
    insufficientItems,
    refundAmount,
    amountTotal,
  } = req.body || {};

  console.log(`[place-order] 📦 Inventory result received for order ${orderId} — status: ${status}`);
  console.log(`[place-order] Payload:`, JSON.stringify(req.body, null, 2)); 

  if (!orderId || !paymentId || !userId || !status) {
    return res.status(400).json({ error: "orderId, paymentId, userId, and status are required" });
  }

  try {

    // ── HAPPY PATH — all items available ─────────────────────────────────────
    if (status === "ok") {
      const totalPrice = (confirmedItems || []).reduce(
        (sum, i) => sum + (Number(i.unitAmount) / 100) * Number(i.quantity), 0
      );

      // Step 7a — Create order
      console.log(`[place-order] Creating confirmed order ${orderId}`);
      const orderRes = await fetchJson(`${ORDER_SERVICE_URL}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId: userId,
          items: confirmedItems,
          totalPrice: Number(totalPrice.toFixed(2)),
          currency: currency || "sgd",
          status: "confirmed",
        }),
      });
      console.log(`[place-order] ✅ Order created:`, orderRes?.order?.orderId || orderId);

      // Inventory decrement happens in the inventory consumer as part of stock-check processing.

      // Step 9 — Log payment details to Payment Service
      try {
        await fetchJson(`${PAYMENT_SERVICE_URL}/payments/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            paymentId,
            amount: amountTotal,
            status: "completed",
          }),
        });
        console.log(`[place-order] ✅ Payment logged for order ${orderId}`);
      } catch (err) {
        console.warn(`[place-order] ⚠️ Payment log failed (non-fatal):`, err.message);
      }

      // Step 10 — Fire-and-forget notification
      fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
        userId,
        type: "ORDER_CONFIRMED",
        orderId,
      });
      console.log(`[place-order] 📨 ORDER_CONFIRMED notification fired for ${userId}`);

      return res.json({ success: true, orderId, status: "confirmed" });
    }

    // ── PARTIAL STOCK FAILURE ─────────────────────────────────────────────────
    if (status === "partial") {
      const partialTotal = (confirmedItems || []).reduce(
        (sum, i) => sum + (Number(i.unitAmount) / 100) * Number(i.quantity), 0
      );

      // Create order for confirmed items only
      console.log(`[place-order] Creating partial order ${orderId}`);
      await fetchJson(`${ORDER_SERVICE_URL}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId: userId,
          items: confirmedItems,
          totalPrice: Number(partialTotal.toFixed(2)),
          currency: currency || "sgd",
          status: "confirmed",
          notes: `Partial order — out of stock: ${(insufficientItems || []).map(i => i.name).join(", ")}`,
        }),
      });
      console.log(`[place-order] ✅ Partial order created`);

      // Refund is handled by refund-management (RabbitMQ consumer on `order.error`).

      // Fire-and-forget notification
      fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
        userId,
        type: "ORDER_PARTIAL",
        orderId,
        insufficientItems,
      });

      return res.json({ success: true, orderId, status: "partial" });
    }

    // ── FULL STOCK FAILURE ────────────────────────────────────────────────────
    if (status === "failed") {
      console.log(`[place-order] ❌ All items out of stock — full refund for order ${orderId}`);
      // Refund is handled by refund-management (RabbitMQ consumer on `order.error`).

      // Fire-and-forget notification
      fireAndForget(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
        userId,
        type: "ORDER_REFUNDED",
        orderId,
      });

      return res.json({ success: true, orderId, status: "refunded" });
    }

    // Unknown status
    return res.status(400).json({ error: `Unknown status: ${status}` });

  } catch (error) {
    console.error("[place-order] ❌ /orders/inventory-result error:", error.message);
    res.status(500).json({ error: error.message || "Orchestration failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Composite place-order service running on port ${PORT}`);
});
