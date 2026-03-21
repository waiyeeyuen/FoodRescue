import express from "express";
import cors from "cors";
import { config } from "./utils/config.js";
import { paymentRoutes, handleStripeWebhook } from "./routes/paymentRoutes.js";

const app = express();

app.use(cors());

app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Payment service is running" });
});

app.use("/payments", paymentRoutes);

app.listen(config.port, () => {
  console.log(`Payment service listening on port ${config.port}`);
});
