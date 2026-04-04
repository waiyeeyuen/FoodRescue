import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { config } from "./utils/config.js";
import { paymentRoutes, handleStripeWebhook } from "./routes/paymentRoutes.js";


const app = express();
const CORRELATION_HEADER = "x-correlation-id";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FoodRescue Payment Service API",
      version: "1.0.0",
      description:
        "Handles payment retrieval, Stripe checkout session creation, payment confirmation, refund processing, refund recording, and payment logging.",
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: "Direct payment service",
      },
      {
        url: "http://localhost:8000",
        description: "Kong API gateway",
      },
    ],
    tags: [
      { name: "Payment", description: "Payment service endpoints" },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string", example: "Failed to fetch payment" },
            details: {
              type: "string",
              nullable: true,
              example: "Internal server error",
            },
          },
        },
        Payment: {
          type: "object",
          properties: {
            paymentId: { type: "string", example: "pay_123" },
            orderId: { type: "string", example: "order_123" },
            userId: { type: "string", example: "user_456" },
            status: { type: "string", example: "paid" },
            currency: { type: "string", example: "sgd" },
            amountTotal: { type: "number", example: 1000 },
            stripeSessionId: {
              type: "string",
              nullable: true,
              example: "cs_test_123",
            },
            stripePaymentIntentId: {
              type: "string",
              nullable: true,
              example: "pi_123",
            },
            checkoutUrl: {
              type: "string",
              nullable: true,
              example: "https://checkout.stripe.com/...",
            },
            refundStatus: { type: "string", example: "not_requested" },
            refundId: { type: "string", example: "" },
            refundAmount: { type: "number", example: 0 },
            refundReason: { type: "string", example: "" },
            correlationId: { type: "string", example: "payment:123e4567" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", example: "Chicken Rice" },
                  unitAmount: { type: "number", example: 500 },
                  quantity: { type: "number", example: 2 },
                },
              },
            },
          },
        },
      },
    },
    paths: {
      "/": {
        get: {
          tags: ["Payment"],
          summary: "Root health/info endpoint",
          responses: {
            200: {
              description: "Payment service is running",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: {
                        type: "string",
                        example: "Payment service is running",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/payments/webhook": {
        post: {
          tags: ["Payment"],
          summary: "Handle Stripe webhook",
          description:
            "Receives Stripe webhook events such as checkout.session.completed, checkout.session.expired, and charge.refunded.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            200: {
              description: "Webhook processed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      received: { type: "boolean", example: true },
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid webhook signature",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Webhook handling failed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/health": {
        get: {
          tags: ["Payment"],
          summary: "Health check",
          responses: {
            200: {
              description: "Payment service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      service: { type: "string", example: "payment" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      "/payments": {
        get: {
          tags: ["Payment"],
          summary: "Get all payments",
          responses: {
            200: {
              description: "List of all payments",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Payment" },
                  },
                },
              },
            },
            500: {
              description: "Failed to fetch payments",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/order/{orderId}": {
        get: {
          tags: ["Payment"],
          summary: "Get payment by order ID",
          parameters: [
            {
              in: "path",
              name: "orderId",
              required: true,
              schema: { type: "string", example: "order_123" },
            },
          ],
          responses: {
            200: {
              description: "Payment found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Payment" },
                },
              },
            },
            404: {
              description: "Payment not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to fetch payment",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/{paymentId}": {
        get: {
          tags: ["Payment"],
          summary: "Get payment by payment ID",
          parameters: [
            {
              in: "path",
              name: "paymentId",
              required: true,
              schema: { type: "string", example: "pay_123" },
            },
          ],
          responses: {
            200: {
              description: "Payment found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Payment" },
                },
              },
            },
            404: {
              description: "Payment not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to fetch payment",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/checkout-session": {
        post: {
          tags: ["Payment"],
          summary: "Create checkout session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["orderId", "userId", "items"],
                  properties: {
                    orderId: { type: "string", example: "order_123" },
                    userId: { type: "string", example: "user_456" },
                    currency: { type: "string", example: "sgd" },
                    successUrl: {
                      type: "string",
                      example: "http://localhost:5173/payment-success",
                    },
                    cancelUrl: {
                      type: "string",
                      example: "http://localhost:5173/payment-cancel",
                    },
                    reward: {
                      type: "object",
                      nullable: true,
                      additionalProperties: true,
                    },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["name", "unitAmount", "quantity"],
                        properties: {
                          name: { type: "string", example: "Chicken Rice" },
                          unitAmount: { type: "number", example: 500 },
                          quantity: { type: "number", example: 2 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Checkout session created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      paymentId: { type: "string", example: "uuid-123" },
                      status: { type: "string", example: "pending" },
                      checkoutUrl: {
                        type: "string",
                        example: "https://checkout.stripe.com/...",
                      },
                      correlationId: {
                        type: "string",
                        example: "payment:123e4567",
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to create checkout session",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/confirm-session": {
        post: {
          tags: ["Payment"],
          summary: "Confirm checkout session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sessionId"],
                  properties: {
                    sessionId: { type: "string", example: "cs_test_123" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Session confirmed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      paymentId: { type: "string", example: "pay_123" },
                      orderId: { type: "string", example: "order_123" },
                      paymentStatus: { type: "string", example: "paid" },
                      refundStatus: {
                        type: "string",
                        example: "not_requested",
                      },
                      notified: { type: "boolean", example: true },
                    },
                  },
                },
              },
            },
            400: {
              description: "Missing or invalid request data",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            409: {
              description: "Payment not completed yet",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to confirm checkout session",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/log": {
        post: {
          tags: ["Payment"],
          summary: "Log payment",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["orderId", "paymentId"],
                  properties: {
                    orderId: { type: "string", example: "order_123" },
                    paymentId: { type: "string", example: "pay_123" },
                    amount: { type: "number", example: 1000 },
                    status: { type: "string", example: "completed" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Payment logged successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      orderId: { type: "string", example: "order_123" },
                      paymentId: { type: "string", example: "pay_123" },
                    },
                  },
                },
              },
            },
            400: {
              description: "orderId and paymentId are required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to log payment",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/{paymentId}/refund": {
        post: {
          tags: ["Payment"],
          summary: "Refund payment",
          parameters: [
            {
              in: "path",
              name: "paymentId",
              required: true,
              schema: { type: "string", example: "pay_123" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    amount: { type: "number", example: 500 },
                    reason: { type: "string", example: "Order cancelled" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Refund processed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: {
                        type: "string",
                        example: "Refund processed successfully",
                      },
                      payment: { $ref: "#/components/schemas/Payment" },
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid refund request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            404: {
              description: "Payment not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to refund payment",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },

      "/payments/{paymentId}/refund-record": {
        post: {
          tags: ["Payment"],
          summary: "Record refund result",
          parameters: [
            {
              in: "path",
              name: "paymentId",
              required: true,
              schema: { type: "string", example: "pay_123" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    refundId: { type: "string", example: "re_123" },
                    refundStatus: { type: "string", example: "succeeded" },
                    refundAmount: { type: "number", example: 500 },
                    refundReason: { type: "string", example: "Listing deleted" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Refund result synced successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      payment: { $ref: "#/components/schemas/Payment" },
                    },
                  },
                },
              },
            },
            404: {
              description: "Payment not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            500: {
              description: "Failed to sync refund result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

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

app.get("/payment-api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});

app.use("/payment-api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/", (req, res) => {
  res.json({ message: "Payment service is running" });
});

app.use("/payments", paymentRoutes);

app.listen(config.port, () => {
  console.log(`Payment service listening on port ${config.port}`);
});
