import { v4 as uuidv4 } from "uuid";
import { admin } from "../services/firebaseService.js";
import {
  createPayment, getAllPaymentsFromDb, getPaymentByIdFromDb,
  updatePayment, createOrUpdatePayment
} from "../services/paymentRepository.js";
import { createStripeCheckoutSession, createStripeRefund, stripe } from "../services/stripeService.js";
import { config } from "../utils/config.js";
import { publishToQueue, QUEUES } from "../utils/rabbitmq.js";

function calculateAmountTotal(items) {
  return items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
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

export async function createCheckoutSession(req, res) {
  try {
    const { orderId, userId, items, currency, successUrl, cancelUrl } = req.body;

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

    console.log('[Checkout] Creating session for orderId:', orderId, '| userId:', userId);
    console.log('[Checkout] Items:', JSON.stringify(items, null, 2));
    console.log('[Checkout] successUrl:', finalSuccessUrl);

    const session = await createStripeCheckoutSession({
      paymentId, orderId, userId,
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
      stripeSessionId: session.id,
      stripePaymentIntentId: null,
      checkoutUrl: session.url,
      source: "stripe_checkout",
      webhookEventType: "",
      refundStatus: "not_requested",
      refundId: "", refundAmount: 0, refundReason: "",
      refundRequestedAt: null, refundCompletedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('[Checkout] ✅ Payment record saved to Firestore');

    res.status(201).json({ paymentId, status: "pending", checkoutUrl: session.url });
  } catch (error) {
    console.error('[Checkout] ❌ Error:', error.message);
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

async function publishStockCheckIfNeeded({ paymentId, orderId, userId, paymentRecord }) {
  if (!paymentId || !orderId || !paymentRecord) return { published: false, reason: 'missing_data' };

  if (paymentRecord.stockCheckPublishedAt || paymentRecord.stockCheckPublished) {
    console.log('[Payment] Stock check already published for paymentId:', paymentId);
    return { published: false, reason: 'already_published' };
  }

  const queuePayload = {
    orderId,
    paymentId,
    userId,
    currency: paymentRecord.currency || 'sgd',
    amountTotal: paymentRecord.amountTotal,
    items: paymentRecord.items,
  };

  console.log('[Payment] Publishing stock check to queue:', JSON.stringify(queuePayload, null, 2));
  await publishToQueue(QUEUES.ORDER_STOCK_CHECK, queuePayload);

  await createOrUpdatePayment(paymentId, {
    stockCheckPublished: true,
    stockCheckPublishedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { published: true };
}

export async function confirmCheckoutSession(req, res) {
  try {
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

    await createOrUpdatePayment(paymentId, {
      webhookEventType: 'confirm-session',
      status: 'paid',
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
    });

    const paymentRecord = await retryGetPayment(paymentId);
    const result = await publishStockCheckIfNeeded({ paymentId, orderId, userId, paymentRecord });

    return res.json({ success: true, paymentId, orderId, ...result });
  } catch (error) {
    console.error('[Payment] ❌ confirmCheckoutSession error:', error);
    return res.status(500).json({ error: 'Failed to confirm checkout session', details: error?.message || String(error) });
  }
}

export async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
  } catch (error) {
    console.error('[Webhook] ❌ Signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  console.log('[Webhook] Event received:', event.type);

  try {
    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;
        const orderId   = session.metadata?.orderId;
        const userId    = session.metadata?.userId;

        console.log('==============================');
        console.log('[Webhook] ✅ checkout.session.completed received');
        console.log('[Webhook] Session ID:', session.id);
        console.log('[Webhook] Metadata:', { paymentId, orderId, userId });
        console.log('==============================');

        if (paymentId) {
          await createOrUpdatePayment(paymentId, {
            webhookEventType: event.type,
            status: "paid",
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent || null
          });
          console.log('[Webhook] ✅ Payment updated to "paid"');
        } else {
          console.log('[Webhook] ❌ No paymentId in metadata — skipping payment update');
        }

        const paymentRecord = paymentId ? await retryGetPayment(paymentId) : null;
        console.log('[Webhook] Payment record fetched:', JSON.stringify(paymentRecord, null, 2));

        if (orderId && paymentRecord) {
          try {
            const result = await publishStockCheckIfNeeded({ paymentId, orderId, userId, paymentRecord });
            if (result.published) {
              console.log('[Webhook] ✅ Published stock check to RabbitMQ');
            } else {
              console.log('[Webhook] ℹ️ Skipped stock check publish:', result.reason);
            }
          } catch (err) {
            console.error('[Webhook] ❌ RabbitMQ publish failed:', err);
            throw err;
          }
        } else {
          console.log('[Webhook] ❌ Skipped RabbitMQ publish');
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
            await updatePayment(matched.paymentId, {
              webhookEventType: event.type,
              status: "refunded",
              refundStatus: "succeeded",
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
    console.error('[Webhook] ❌ Handler error:', error);
    res.status(500).json({ error: "Webhook handling failed", details: error?.message || String(error) });
  }
}
