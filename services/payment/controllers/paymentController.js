import { v4 as uuidv4 } from "uuid";
import { admin } from "../services/firebaseService.js";
import {
  createPayment,
  getAllPaymentsFromDb,
  getPaymentByIdFromDb,
  updatePayment,
  createOrUpdatePayment
} from "../services/paymentRepository.js";
import {
  createStripeCheckoutSession,
  createStripeRefund,
  stripe
} from "../services/stripeService.js";
import { config } from "../utils/config.js";

function calculateAmountTotal(items) {
  return items.reduce((sum, item) => {
    return sum + item.unitAmount * item.quantity;
  }, 0);
}

export function healthCheck(req, res) {
  res.json({
    status: "ok",
    service: "payment"
  });
}

export async function getAllPayments(req, res) {
  try {
    const allPayments = await getAllPaymentsFromDb();
    res.json(allPayments);
  } catch (error) {
    console.error("Error getting all payments:", error.message);
    res.status(500).json({
      error: "Failed to fetch payments"
    });
  }
}

export async function getPaymentById(req, res) {
  try {
    const { paymentId } = req.params;
    const payment = await getPaymentByIdFromDb(paymentId);

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found"
      });
    }

    res.json(payment);
  } catch (error) {
    console.error("Error getting payment by ID:", error.message);
    res.status(500).json({
      error: "Failed to fetch payment"
    });
  }
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
      successUrl || `${config.frontendSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`;

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

    const amountTotal = calculateAmountTotal(items);

    const paymentRecord = {
      paymentId,
      orderId,
      userId,
      status: "pending",
      currency: currency || "sgd",
      amountTotal,
      items,
      stripeSessionId: session.id,
      stripePaymentIntentId: null,
      checkoutUrl: session.url,
      source: "stripe_checkout",
      webhookEventType: "",
      refundStatus: "not_requested",
      refundId: "",
      refundAmount: 0,
      refundReason: "",
      refundRequestedAt: null,
      refundCompletedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await createPayment(paymentRecord);

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

export async function refundPayment(req, res) {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    const payment = await getPaymentByIdFromDb(paymentId);

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found"
      });
    }

    if (payment.status !== "paid" && payment.status !== "partially_refunded") {
      return res.status(400).json({
        error: "Only paid or partially refunded payments can be refunded"
      });
    }

    if (!payment.stripePaymentIntentId) {
      return res.status(400).json({
        error: "Missing Stripe payment intent ID"
      });
    }

    if (payment.refundStatus === "pending") {
      return res.status(400).json({
        error: "Refund is already pending"
      });
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

    res.json({
      message: "Refund processed successfully",
      payment: updatedPayment
    });
  } catch (error) {
    console.error("Error refunding payment:", error.message);
    res.status(500).json({
      error: "Failed to refund payment",
      details: error.message
    });
  }
}

export async function handleStripeWebhook(req, res) {
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

        if (paymentId) {
          await createOrUpdatePayment(paymentId, {
            webhookEventType: event.type,
            status: "paid",
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent || null
          });
        }

        console.log("Payment completed");
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;

        if (paymentId) {
          await createOrUpdatePayment(paymentId, {
            webhookEventType: event.type,
            status: "expired",
            stripeSessionId: session.id
          });
        }

        console.log("Payment expired");
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;

        if (paymentIntentId) {
          // Simple approach: query by paymentIntentId is not ideal for scale,
          // but okay for MVP if you later add index/query support.
          const allPayments = await getAllPaymentsFromDb();
          const matched = allPayments.find(
            (payment) => payment.stripePaymentIntentId === paymentIntentId
          );

          if (matched) {
            await updatePayment(matched.paymentId, {
              webhookEventType: event.type,
              status: "refunded",
              refundStatus: "succeeded",
              refundCompletedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }

        console.log("Charge refunded");
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