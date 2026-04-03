import express from "express";
import {
  healthCheck,
  getAllPayments,
  getPaymentById,
  getPaymentByOrderId,
  createCheckoutSession,
  refundPayment,
  recordRefundResult,
  logPayment,
  confirmCheckoutSession,
  handleStripeWebhook
} from "../controllers/paymentController.js";

const router = express.Router();

router.get("/health", healthCheck);
router.get("/", getAllPayments);
router.get("/order/:orderId", getPaymentByOrderId);
router.get("/:paymentId", getPaymentById);
router.post("/checkout-session", createCheckoutSession);
router.post("/confirm-session", confirmCheckoutSession);
router.post("/log", logPayment);
router.post("/:paymentId/refund", refundPayment);
router.post("/:paymentId/refund-record", recordRefundResult);

export { router as paymentRoutes, handleStripeWebhook };
