import Stripe from "stripe";
import { config } from "../utils/config.js";

export const stripe = new Stripe(config.stripeSecretKey);

export async function createStripeCheckoutSession({
  paymentId,
  orderId,
  userId,
  currency,
  items,
  successUrl,
  cancelUrl
}) {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: orderId,
    metadata: {
      paymentId,
      orderId,
      userId
    },
    line_items: items.map((item) => ({
      price_data: {
        currency: currency || "sgd",
        product_data: {
          name: item.name
        },
        unit_amount: item.unitAmount
      },
      quantity: item.quantity
    })),
    success_url: successUrl,
    cancel_url: cancelUrl
  });

  return session;
}

export async function createStripeRefund({ paymentIntentId, amount, reason }) {
  const refundPayload = {
    payment_intent: paymentIntentId
  };

  if (amount) {
    refundPayload.amount = amount;
  }

  if (reason) {
    refundPayload.metadata = {
      reason
    };
  }

  const refund = await stripe.refunds.create(refundPayload);
  return refund;
}