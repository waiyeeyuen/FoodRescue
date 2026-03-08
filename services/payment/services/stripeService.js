//doing the actual communication with Stripe’s API.

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
  //Stripe SDK allows us to call StripeAPI's like
  //stripe.checkout.sessions.create()
  //stripe.paymentIntents.create()
  //stripe.refunds.create()
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: orderId,
    metadata: {
      paymentId,
      orderId,
      userId
      //Metadata is extra information you attach to the Stripe object.
      //Stripe stores it and returns it in webhook events.
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