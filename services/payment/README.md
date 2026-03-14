Overview

This microservice is responsible for handling payment processing within the FoodRescue system.

Its primary responsibilities include:
Initiating payment requests using Stripe Checkout
Persisting payment records and status updates
Handling Stripe webhook events to update payment status
Processing refunds when an order cannot be fulfilled (e.g., when inventory stock becomes unavailable)

The service acts as an intermediary between the FoodRescue system and the Stripe payment provider.
Requirements

Before running the service, install the following:
Node.js (v18 or above recommended)
npm
Stripe CLI
Stripe account (to obtain API keys)
npm install stripe
Install the Stripe SDK if needed: npm install stripe

Create a .env file in the payment service directory.

PORT=3003
STRIPE_SECRET_KEY=your_stripe_test_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
FRONTEND_SUCCESS_URL=http://localhost:5173/payment-success
FRONTEND_CANCEL_URL=http://localhost:5173/payment-cancel
FIREBASE_SERVICE_ACCOUNT_PATH=../firebase/serviceAccountKey.json

To Receive Stripe Secret Key, Login to your stripe account https://dashboard.stripe.com/acct_1T1oPBKglgT3Zqby/test/dashboard
To Receive Webhook_Secret Key, [path]\stripe listen --forward-to localhost:3003/payments/webhook