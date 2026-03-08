import express from "express";
import cors from "cors";
import { config } from "./utils/config.js"; // Loads things from .env
import { paymentRoutes, handleStripeWebhook } from "./routes/paymentRoutes.js";

const app = express();

// Think of Express as the thing that listens for HTTP requests like:
// GET /payments/status
// POST /payments/create-checkout-session

app.use(cors()); // CORS Browsers block cross-domain requests by default.

// Webhook must come before express.json(). 
// Creates end point of POST /payments/webhook
// So Stripe sends payment events here. 
app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
); // Routing for Stripe Webhook because
//express.raw() is required so Stripe can verify the webhook signature.


app.use(express.json());

app.get("/", (req, res) => { //Just a health check endpoint
  res.json({
    message: "Payment service is running"
  });
});

app.use("/payments", paymentRoutes); //Register payment routes for API Calls

app.listen(config.port, () => { //Start The Server
  console.log(`Payment service listening on port ${config.port}`);
});