Overview

This microservice handles payment processing for the FoodRescue system.
Its main responsibility is to initiate payment requests through Stripe and return the payment result (success or failure).

The service does not maintain its own database. Payment processing is handled externally through Stripe, while order records are managed by other services.

Requirements

Before running the service, install the following:
Node.js (v18 or above recommended)
npm
Stripe CLI
Stripe account (for API keys)
npm install stripe


Create a .env file in the payment service directory.

PORT=3003
STRIPE_SECRET_KEY=your_stripe_test_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
FRONTEND_SUCCESS_URL=http://localhost:5173/payment-success
FRONTEND_CANCEL_URL=http://localhost:5173/payment-cancel


To Receive Webhook_Secret Key, [path]\stripe listen --forward-to localhost:3003/payments/webhook