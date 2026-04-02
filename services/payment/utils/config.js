import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load `.env` from the payment service root regardless of where `node` was launched from.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const hasStripeSecretKey = Boolean(process.env.STRIPE_SECRET_KEY);
const hasStripeWebhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
console.log("[payment/config] CWD:", process.cwd());
console.log("[payment/config] STRIPE_SECRET_KEY set:", hasStripeSecretKey);
console.log("[payment/config] STRIPE_WEBHOOK_SECRET set:", hasStripeWebhookSecret);

export const config = {
  port: process.env.PORT || 3003,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  frontendSuccessUrl: process.env.FRONTEND_SUCCESS_URL,
  frontendCancelUrl: process.env.FRONTEND_CANCEL_URL,
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH
};
