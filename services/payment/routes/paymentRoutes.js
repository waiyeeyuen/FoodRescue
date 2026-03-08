import express from "express";
// Instead of putting all routes in index.js, we create a separate router module for payment related endpoints.

import {
  healthCheck,
  getAllPayments,
  getPaymentById,
  createCheckoutSession,
  handleStripeWebhook
} from "../controllers/paymentController.js";
//Importing logic functions from Controller

const router = express.Router(); 

router.get("/health", healthCheck); // GET /payments/health
router.get("/", getAllPayments); // GET /payments
router.get("/:paymentId", getPaymentById); // GET /payments/{paymentId}
router.post("/checkout-session", createCheckoutSession); // POST /payments/checkout-session

export { router as paymentRoutes, handleStripeWebhook };
// Stripe webhooks are special routes that require raw body parsing, so they are not placed inside the router.
// This one can be found in index.js