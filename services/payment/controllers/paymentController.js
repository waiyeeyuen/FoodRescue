//PaymentController.js is responsible for handling requests that come in from routes.

// Route receives request
// → controller function runs
// → controller validates input
// → controller calls service / data store
// → controller sends response

import { v4 as uuidv4 } from "uuid"; // generates a unique ID.
import { payments } from "../data/paymentStore.js"; // in-memory payment store (If using)
import { config } from "../utils/config.js"; // Environment .env files access
import { createStripeCheckoutSession, stripe } from "../services/stripeService.js"; 
// A helper/service function that talks to Stripe and creates the checkout session

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
  // Check req.body for all required parameters. 
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

    // Make random payment id
    const paymentId = uuidv4();

    const finalSuccessUrl =
      successUrl ||
      `${config.frontendSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`;
      // If request provides a successUrl, use it. Otherwise use default from config.

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

    res.status(201).json({ //return of json request
      paymentId,
      status: "pending", // This is important because later webhook will come back and update that record
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
  const signature = req.headers["stripe-signature"]; //Stripe sends a special header containing a signed value.

  let event;

  try { // verify webhook signature . Checks raw request body, received signature, your webhook secret if all match trust stripe event
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
        const session = event.data.object; // event.data.object contains the actual Stripe session.
        const paymentId = session.metadata?.paymentId;
        //Stripe session was probably created with metadata including your internal payment ID.
        //That is how Stripe event gets mapped back to your local payment record.

        if (paymentId && payments.has(paymentId)) {
          const existing = payments.get(paymentId); 
          //If the payment exists in store, retrieve old record, overwrite it with updated fields

          payments.set(paymentId, {
            ...existing,
            status: "paid", // Change status
            stripePaymentIntentId: session.payment_intent || null,
            updatedAt: new Date().toISOString() //Updated 
          });
        }

        console.log("Payment completed");
        break;
      }

      case "checkout.session.expired": { //Similarly this is if checkout session expired
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

    res.json({ received: true }); // Tells stripe webhook has been received, Important because Stripe expects a success response.
  } catch (error) {
    console.error("Error handling webhook:", error.message);
    res.status(500).json({
      error: "Webhook handling failed"
    });
  }
}