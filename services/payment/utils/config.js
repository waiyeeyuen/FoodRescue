import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 3003,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  frontendSuccessUrl: process.env.FRONTEND_SUCCESS_URL,
  frontendCancelUrl: process.env.FRONTEND_CANCEL_URL
};