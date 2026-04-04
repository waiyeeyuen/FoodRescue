import { v4 as uuidv4 } from "uuid";
import { admin } from "../services/firebaseService.js";
import {
  createPayment, getAllPaymentsFromDb, getPaymentByIdFromDb, getPaymentByOrderIdFromDb,
  updatePayment, createOrUpdatePayment
} from "../services/paymentRepository.js";
import { createStripeCheckoutSession, createStripeRefund, stripe } from "../services/stripeService.js";
import { config } from "../utils/config.js";

const PLACE_ORDER_SERVICE_URL = process.env.PLACE_ORDER_SERVICE_URL || "http://localhost:4001";
const CORRELATION_HEADER = "x-correlation-id";

function calculateAmountTotal(items) {
  return items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
}

function withCorrelationHeaders(headers = {}, correlationId = "") {
  if (!correlationId) return { ...headers };
  return {
    ...headers,
    [CORRELATION_HEADER]: correlationId,
  };
}

function getSessionCorrelationId(session) {
  return String(session?.metadata?.correlationId || "").trim();
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

function hasRefundState(payment) {
  const status = String(payment?.status || "").toLowerCase();
  const refundStatus = String(payment?.refundStatus || "").toLowerCase();

  if (["refunded", "partially_refunded"].includes(status)) {
    return true;
  }

  return ["pending", "succeeded", "completed"].includes(refundStatus);
}

async function getStripeLineItemsAsPaymentItems(sessionId) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
  const items = (lineItems?.data || [])
    .map((li) => {
      const quantity = Number(li?.quantity ?? 0);
      const unitAmount = Number(
        li?.price?.unit_amount ??
          (li?.amount_subtotal && quantity ? Math.round(Number(li.amount_subtotal) / quantity) : 0)
      );
      const name = String(li?.description || '').trim();

      if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitAmount) || unitAmount < 0) {
        return null;
      }

      return {
        name,
        unitAmount,
        quantity,
      };
    })
    .filter(Boolean);

  return items;
}

async function retryGetPayment(paymentId, retries = 5, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    const record = await getPaymentByIdFromDb(paymentId);
    if (record) {
      console.log(`[Webhook] Payment record found on attempt ${i + 1}`);
      return record;
    }
    console.log(`[Webhook] Payment record not found, retrying in ${delayMs}ms... (attempt ${i + 1}/${retries})`);
    await new Promise(r => setTimeout(r, delayMs));
  }
  console.log(`[Webhook] ❌ Payment record still not found after ${retries} retries`);
  return null;
}

export function healthCheck(req, res) {
  res.json({ status: "ok", service: "payment" });
}

export async function getAllPayments(req, res) {
  try {
    res.json(await getAllPaymentsFromDb());
  } catch {
    res.status(500).json({ error: "Failed to fetch payments" });
  }
}

export async function getPaymentById(req, res) {
  try {
    const payment = await getPaymentByIdFromDb(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(payment);
  } catch {
    res.status(500).json({ error: "Failed to fetch payment" });
  }
}

export async function getPaymentByOrderId(req, res) {
  try {
    const payment = await getPaymentByOrderIdFromDb(req.params.orderId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(payment);
  } catch {
    res.status(500).json({ error: "Failed to fetch payment" });
  }
}

export async function createCheckoutSession(req, res) {
  try {
    const correlationId = req.correlationId || "";
    const { orderId, userId, items, currency, successUrl, cancelUrl, reward } = req.body;

    if (!orderId || !userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "orderId, userId, and items are required" });
    }
    for (const item of items) {
      if (!item.name || !item.unitAmount || !item.quantity) {
        return res.status(400).json({ error: "Each item must have name, unitAmount, and quantity" });
      }
    }

    const paymentId = uuidv4();
    const finalSuccessUrl = successUrl || `${config.frontendSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`;
    const finalCancelUrl = cancelUrl || config.frontendCancelUrl;

    console.log('[Checkout] Creating session for orderId:', orderId, '| userId:', userId, '| cid:', correlationId);
    console.log('[Checkout] Items:', JSON.stringify(items, null, 2));
    console.log('[Checkout] successUrl:', finalSuccessUrl);

    const session = await createStripeCheckoutSession({
      paymentId, orderId, userId,
      correlationId,
      currency: currency || "sgd",
      items,
      successUrl: finalSuccessUrl,
      cancelUrl: finalCancelUrl
    });

    console.log('[Checkout] ✅ Stripe session created:', session.id);

    const amountTotal = calculateAmountTotal(items);

    await createPayment({
      paymentId, orderId, userId,
      status: "pending",
      currency: currency || "sgd",
      amountTotal, items,
      reward: reward || null,
      stripeSessionId: session.id,
      stripePaymentIntentId: null,
      checkoutUrl: session.url,
      source: "stripe_checkout",
      correlationId,
      webhookEventType: "",
      refundStatus: "not_requested",
      refundId: "", refundAmount: 0, refundReason: "",
      refundRequestedAt: null, refundCompletedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('[Checkout] ✅ Payment record saved to Firestore cid=', correlationId);

    res.status(201).json({ paymentId, status: "pending", checkoutUrl: session.url, correlationId });
  } catch (error) {
    console.error('[Checkout] ❌ Error cid=', req.correlationId || "n/a", ':', error.message);
    res.status(500).json({ error: "Failed to create checkout session", details: error.message });
  }
}

export async function refundPayment(req, res) {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    const payment = await getPaymentByIdFromDb(paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (payment.status !== "paid" && payment.status !== "partially_refunded") {
      return res.status(400).json({ error: "Only paid or partially refunded payments can be refunded" });
    }
    if (!payment.stripePaymentIntentId) {
      return res.status(400).json({ error: "Missing Stripe payment intent ID" });
    }
    if (payment.refundStatus === "pending") {
      return res.status(400).json({ error: "Refund is already pending" });
    }

    await updatePayment(paymentId, {
      refundStatus: "pending",
      refundReason: reason || "",
      refundRequestedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const refund = await createStripeRefund({
      paymentIntentId: payment.stripePaymentIntentId,
      amount: amount || undefined,
      reason: reason || undefined
    });

    const fullRefund = !amount || amount >= payment.amountTotal;

    const updatedPayment = await updatePayment(paymentId, {
      status: fullRefund ? "refunded" : "partially_refunded",
      refundStatus: refund.status || "succeeded",
      refundId: refund.id,
      refundAmount: amount || payment.amountTotal,
      refundReason: reason || "",
      refundCompletedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ message: "Refund processed successfully", payment: updatedPayment });
  } catch (error) {
    console.error('[Refund] ❌ Error:', error.message);
    res.status(500).json({ error: "Failed to refund payment", details: error.message });
  }
}

export async function recordRefundResult(req, res) {
  try {
    const { paymentId } = req.params;
    const {
      refundId = "",
      refundStatus = "succeeded",
      refundAmount,
      refundReason = "",
    } = req.body || {};

    const payment = await getPaymentByIdFromDb(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const normalizedRefundAmount =
      Number(refundAmount ?? payment.amountTotal ?? 0) || Number(payment.amountTotal || 0) || 0;
    const originalAmount = Number(payment.amountTotal || 0) || 0;
    const fullRefund = normalizedRefundAmount >= originalAmount;

    const updatedPayment = await updatePayment(paymentId, {
      status: fullRefund ? "refunded" : "partially_refunded",
      refundStatus: refundStatus || "succeeded",
      refundId: String(refundId || ""),
      refundAmount: normalizedRefundAmount,
      refundReason: String(refundReason || ""),
      refundCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("[Refund Sync] ❌ Error:", error.message);
    return res.status(500).json({
      error: "Failed to sync refund result",
      details: error.message,
    });
  }
}

export async function logPayment(req, res) {
  try {
    const { orderId, paymentId, amount, status } = req.body;

    if (!orderId || !paymentId) {
      return res.status(400).json({ error: "orderId and paymentId are required" });
    }

    await admin.firestore().collection('payments').doc(paymentId).set({
      orderId,
      loggedStatus: status || "completed",
      loggedAmount: amount || 0,
      loggedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[Payment] ✅ Payment logged for order ${orderId} | paymentId ${paymentId}`);
    res.json({ success: true, orderId, paymentId });
  } catch (error) {
    console.error('[Payment] ❌ logPayment error:', error.message);
    res.status(500).json({ error: "Failed to log payment" });
  }
}

async function notifyPlaceOrderIfNeeded({
  paymentId,
  orderId,
  userId,
  paymentRecord,
  session,
  correlationId = "",
}) {
  if (!paymentId || !orderId) return { notified: false, reason: 'missing_data' };

  if (
    paymentRecord?.placeOrderNotifiedAt ||
    paymentRecord?.placeOrderNotified ||
    paymentRecord?.stockCheckPublishedAt ||
    paymentRecord?.stockCheckPublished
  ) {
    console.log('[Payment] Place Order already notified for paymentId:', paymentId);
    return { notified: false, reason: 'already_notified' };
  }

  let items = Array.isArray(paymentRecord?.items) ? paymentRecord.items : [];
  let amountTotal = Number(paymentRecord?.amountTotal ?? NaN);
  let currency = paymentRecord?.currency;
  let paymentIntentId = session?.payment_intent || paymentRecord?.stripePaymentIntentId || null;

  if ((!items || items.length === 0) && session?.id) {
    try {
      items = await getStripeLineItemsAsPaymentItems(session.id);
      amountTotal = Number.isFinite(amountTotal)
        ? amountTotal
        : Number(session.amount_total ?? calculateAmountTotal(items));
      currency = currency || session.currency;
      paymentIntentId = paymentIntentId || session.payment_intent || null;
      console.warn('[Payment] Payment record missing items; falling back to Stripe line_items.');
    } catch (err) {
      console.error('[Payment] ❌ Failed to fetch Stripe line_items:', err?.message || err);
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error('[Payment] ❌ Cannot notify Place Order: missing items');
    return { notified: false, reason: 'missing_items' };
  }

  if (!Number.isFinite(amountTotal)) {
    amountTotal = calculateAmountTotal(items);
  }

  const requestPayload = {
    orderId,
    paymentId,
    paymentIntentId,
    userId,
    currency: currency || 'sgd',
    amountTotal,
    items,
  };

  const resolvedCorrelationId =
    String(correlationId || "").trim() ||
    String(paymentRecord?.correlationId || "").trim() ||
    getSessionCorrelationId(session);

  console.log(
    `[Payment] Notifying Place Order cid=${resolvedCorrelationId || "n/a"}:`,
    JSON.stringify(requestPayload, null, 2)
  );
  const response = await fetch(`${PLACE_ORDER_SERVICE_URL}/orders/payment-confirmed`, {
    method: 'POST',
    headers: withCorrelationHeaders({ 'Content-Type': 'application/json' }, resolvedCorrelationId),
    body: JSON.stringify(requestPayload),
  });
  const responseBody = await readBody(response);

  if (!response.ok) {
    const error = new Error(
      (responseBody && responseBody.error) || `Place Order responded ${response.status}`
    );
    error.status = response.status;
    error.data = responseBody;
    throw error;
  }

  const paymentUpdates = {
    placeOrderNotified: true,
    placeOrderNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!paymentRecord?.items || paymentRecord.items.length === 0) paymentUpdates.items = items;
  if (paymentRecord?.amountTotal == null) paymentUpdates.amountTotal = amountTotal;
  if (!paymentRecord?.currency && currency) paymentUpdates.currency = currency;
  if (!paymentRecord?.stripePaymentIntentId && paymentIntentId) {
    paymentUpdates.stripePaymentIntentId = paymentIntentId;
  }
  if (!paymentRecord?.correlationId && resolvedCorrelationId) {
    paymentUpdates.correlationId = resolvedCorrelationId;
  }

  await createOrUpdatePayment(paymentId, paymentUpdates);

  return { notified: true };
}

export async function confirmCheckoutSession(req, res) {
  try {
    const requestCorrelationId = req.correlationId || "";
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.status(409).json({
        error: 'Payment not completed yet',
        payment_status: session.payment_status,
        status: session.status,
      });
    }

    const paymentId = session.metadata?.paymentId;
    const orderId = session.metadata?.orderId;
    const userId = session.metadata?.userId;

    if (!paymentId || !orderId) {
      return res.status(400).json({ error: 'Missing paymentId/orderId in Stripe session metadata' });
    }

    const existingPayment = await getPaymentByIdFromDb(paymentId);
    const correlationId =
      requestCorrelationId ||
      getSessionCorrelationId(session) ||
      String(existingPayment?.correlationId || "").trim();
    const preserveRefundState = hasRefundState(existingPayment);
    const paymentUpdates = {
      stripeSessionId: session.id,
      stripePaymentIntentId:
        session.payment_intent || existingPayment?.stripePaymentIntentId || null,
      correlationId,
    };

    if (!preserveRefundState) {
      paymentUpdates.webhookEventType = 'confirm-session';
      paymentUpdates.status = 'paid';
    }

    await createOrUpdatePayment(paymentId, paymentUpdates);

    if (preserveRefundState) {
      console.log(
        '[Payment] confirm-session preserved existing refund state for paymentId:',
        paymentId
      );
    }

    const paymentRecord = await retryGetPayment(paymentId);
    const result = await notifyPlaceOrderIfNeeded({
      paymentId,
      orderId,
      userId,
      paymentRecord,
      session,
      correlationId,
    });

    if (!result.notified && result.reason !== 'already_notified') {
      return res.status(500).json({ error: 'Failed to notify place-order', reason: result.reason });
    }

    return res.json({
      success: true,
      paymentId,
      orderId,
      paymentStatus: paymentRecord?.status || existingPayment?.status || 'paid',
      refundStatus: paymentRecord?.refundStatus || existingPayment?.refundStatus || '',
      ...result
    });
  } catch (error) {
    console.error('[Payment] ❌ confirmCheckoutSession error:', error);
    return res.status(500).json({ error: 'Failed to confirm checkout session', details: error?.message || String(error) });
  }
}

export async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  let event;
  const requestCorrelationId = req.correlationId || "";

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
  } catch (error) {
    console.error('[Webhook] ❌ Signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  console.log('[Webhook] Event received:', event.type, '| cid:', requestCorrelationId || "n/a");

  try {
    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;
        const orderId   = session.metadata?.orderId;
        const userId    = session.metadata?.userId;
        const correlationId =
          requestCorrelationId ||
          getSessionCorrelationId(session);

        console.log('==============================');
        console.log('[Webhook] ✅ checkout.session.completed received');
        console.log('[Webhook] Session ID:', session.id);
        console.log('[Webhook] Metadata:', { paymentId, orderId, userId, correlationId });
        console.log('==============================');

        if (paymentId) {
          const existingPayment = await getPaymentByIdFromDb(paymentId);
          const preserveRefundState = hasRefundState(existingPayment);
          const paymentUpdates = {
            stripeSessionId: session.id,
            stripePaymentIntentId:
              session.payment_intent || existingPayment?.stripePaymentIntentId || null,
            correlationId:
              correlationId || String(existingPayment?.correlationId || "").trim(),
          };

          if (!preserveRefundState) {
            paymentUpdates.webhookEventType = event.type;
            paymentUpdates.status = "paid";
          }

          await createOrUpdatePayment(paymentId, paymentUpdates);

          if (preserveRefundState) {
            console.log('[Webhook] Refund state already exists; skipping paid overwrite');
          } else {
            console.log('[Webhook] ✅ Payment updated to "paid"');
          }
        } else {
          console.log('[Webhook] ❌ No paymentId in metadata — skipping payment update');
        }

        const paymentRecord = paymentId ? await retryGetPayment(paymentId) : null;
        console.log('[Webhook] Payment record fetched:', JSON.stringify(paymentRecord, null, 2));

        if (orderId) {
          try {
            const result = await notifyPlaceOrderIfNeeded({
              paymentId,
              orderId,
              userId,
              paymentRecord,
              session,
              correlationId,
            });
            if (result.notified) {
              console.log('[Webhook] ✅ Place Order notified cid=', correlationId || "n/a");
            } else {
              console.log('[Webhook] Skipped Place Order notification:', result.reason, '| cid:', correlationId || "n/a");
              if (result.reason !== 'already_notified') {
                throw new Error(`place_order_notify_${result.reason}`);
              }
            }
          } catch (err) {
            console.error('[Webhook] ❌ Place Order notification failed cid=', correlationId || "n/a", ':', err);
            throw err;
          }
        } else {
          console.log('[Webhook] ❌ Skipped Place Order notification');
          console.log('[Webhook]    orderId:', orderId);
          console.log('[Webhook]    paymentRecord exists:', !!paymentRecord);
        }

        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;
        console.log('[Webhook] Session expired — paymentId:', paymentId);
        if (paymentId) {
          await createOrUpdatePayment(paymentId, {
            webhookEventType: event.type,
            status: "expired",
            stripeSessionId: session.id
          });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;
        console.log('[Webhook] Charge refunded — paymentIntentId:', paymentIntentId);
        if (paymentIntentId) {
          const allPayments = await getAllPaymentsFromDb();
          const matched = allPayments.find(p => p.stripePaymentIntentId === paymentIntentId);
          if (matched) {
            const refundedAmount = Number(charge.amount_refunded ?? matched.refundAmount ?? 0);
            const originalAmount = Number(charge.amount ?? matched.amountTotal ?? 0);
            const refundId = charge.refunds?.data?.[0]?.id || matched.refundId || "";

            await updatePayment(matched.paymentId, {
              webhookEventType: event.type,
              status: refundedAmount > 0 && originalAmount > 0 && refundedAmount < originalAmount
                ? "partially_refunded"
                : "refunded",
              refundStatus: "succeeded",
              refundAmount: refundedAmount || matched.amountTotal || 0,
              refundId,
              refundCompletedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Webhook] ✅ Refund recorded for paymentId:', matched.paymentId);
          } else {
            console.log('[Webhook] ❌ No matching payment found for paymentIntentId:', paymentIntentId);
          }
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[Webhook] ❌ Handler error:', error?.stack || error);
    res.status(500).json({ error: "Webhook handling failed", details: error?.message || String(error) });
  }
}
