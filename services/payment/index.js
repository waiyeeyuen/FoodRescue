import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { config } from "./utils/config.js";
import { paymentRoutes, handleStripeWebhook } from "./routes/paymentRoutes.js";

const app = express();
const CORRELATION_HEADER = "x-correlation-id";

app.use(cors());

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function attachCorrelation(serviceName) {
  return (req, res, next) => {
    const correlationId = getHeaderValue(req.headers) || `${serviceName}:${randomUUID()}`;
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    console.log(`[${serviceName}] ${req.method} ${req.originalUrl} cid=${correlationId}`);
    next();
  };
}

// ✅ Webhook route MUST be before express.json() — raw body needed for signature verification
app.post(
  "/payments/webhook",
  attachCorrelation("payment"),
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());
app.use(attachCorrelation("payment"));

app.get("/", (req, res) => {
  res.json({ message: "Payment service is running" });
});

app.use("/payments", paymentRoutes);

app.listen(config.port, () => {
  console.log(`Payment service listening on port ${config.port}`);
});
