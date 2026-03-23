import express from "express";
import {
  healthCheck,
  getAllPayments,
  getPaymentById,
  createCheckoutSession,
  refundPayment,
  logPayment,
  confirmCheckoutSession,
  handleStripeWebhook
} from "../controllers/paymentController.js";

const router = express.Router();

router.get("/health", healthCheck);
router.get("/", getAllPayments);
router.get("/:paymentId", getPaymentById);
router.post("/checkout-session", createCheckoutSession);
router.post("/confirm-session", confirmCheckoutSession);
router.post("/log", logPayment);
router.post("/:paymentId/refund", refundPayment);

export { router as paymentRoutes, handleStripeWebhook };
