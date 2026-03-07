import { v4 as uuidv4 } from "uuid";
import { payments } from "../data/paymentStore.js";
import { config } from "../utils/config.js";
import { createStripeCheckoutSession, stripe } from "../services/stripeService.js";

export function healthCheck(req, res) {
  res.json({
    status: "ok",
    service: "payment"
  });
}

export function getAllPayments(req, res) {
  const allPayments = Array.from(payments.values());
  res.json(allPayments);
}

export function getPaymentById(req, res) {
  const { paymentId } = req.params;
  const payment = payments.get(paymentId);

  if (!payment) {
    return res.status(404).json({
      error: "Payment not found"
    });
  }

  res.json(payment);
}

export async function createCheckoutSession(req, res) {
  try {
    const { orderId, userId, items, currency, successUrl, cancelUrl } = req.body;

    if (!orderId || !userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "orderId, userId, and items are required"
      });
    }

    for (const item of items) {
      if (!item.name || !item.unitAmount || !item.quantity) {
        return res.status(400).json({
          error: "Each item must have name, unitAmount, and quantity"
        });
      }
    }

    const paymentId = uuidv4();

    const finalSuccessUrl =
      successUrl ||
      `${config.frontendSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`;

    const finalCancelUrl = cancelUrl || config.frontendCancelUrl;

    const session = await createStripeCheckoutSession({
      paymentId,
      orderId,
      userId,
      currency: currency || "sgd",
      items,
      successUrl: finalSuccessUrl,
      cancelUrl: finalCancelUrl
    });

    const paymentRecord = {
      paymentId,
      orderId,
      userId,
      status: "pending",
      currency: currency || "sgd",
      items,
      stripeSessionId: session.id,
      stripePaymentIntentId: null,
      checkoutUrl: session.url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    payments.set(paymentId, paymentRecord);

    res.status(201).json({
      paymentId,
      status: "pending",
      checkoutUrl: session.url
    });
  } catch (error) {
    console.error("Error creating checkout session:", error.message);
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error.message
    });
  }
}

export function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      config.stripeWebhookSecret
    );
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;

        if (paymentId && payments.has(paymentId)) {
          const existing = payments.get(paymentId);

          payments.set(paymentId, {
            ...existing,
            status: "paid",
            stripePaymentIntentId: session.payment_intent || null,
            updatedAt: new Date().toISOString()
          });
        }

        console.log("Payment completed");
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;

        if (paymentId && payments.has(paymentId)) {
          const existing = payments.get(paymentId);

          payments.set(paymentId, {
            ...existing,
            status: "expired",
            updatedAt: new Date().toISOString()
          });
        }

        console.log("Payment expired");
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error handling webhook:", error.message);
    res.status(500).json({
      error: "Webhook handling failed"
    });
  }
}