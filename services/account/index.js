import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'
import { randomUUID } from 'crypto'
import admin, { db } from '../firebase/firebaseAdmin.js'

const app = express()
const PORT = process.env.PORT || 3001;

// ─── Swagger ──────────────────────────────────────────────────────────────────

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FoodRescue Account Microservice API",
      version: "1.0.0",
      description:
        "API documentation for the account, cart, and impact tracking service.",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Direct account service",
      },
      {
        url: "http://localhost:8000",
        description: "Kong API gateway",
      },
    ],
    tags: [
      { name: "Auth", description: "Authentication and Registration" },
      { name: "Accounts", description: "User and Restaurant Profiles" },
      { name: "Cart", description: "Cart Management" },
      { name: "Impact & Leaderboard", description: "Sustainability Metrics" },
      { name: "Internal", description: "Internal Microservice Communication" },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            details: { nullable: true },
          },
        },
        UserImpact: {
          type: "object",
          properties: {
            mealsRescued: { type: "number" },
            co2KgSaved: { type: "number" },
            waterLitersSaved: { type: "number" },
            moneySaved: { type: "number" },
            daysSaved: { type: "number" },
            completedDayKeys: { type: "array", items: { type: "string" } },
            lastSuccessfulOrderAt: { type: "string", format: "date-time", nullable: true },
            leaderboardEligible: { type: "boolean" },
          },
        },
        CartItem: {
          type: "object",
          properties: {
            listingId: { type: "string" },
            itemName: { type: "string" },
            restaurantId: { type: "string" },
            restaurantName: { type: "string" },
            imageURL: { type: "string" },
            expiryTime: { type: "string" },
            cuisineType: { type: "string" },
            price: { type: "number" },
            quantity: { type: "number" },
            pickupTime: { type: "string" },
          },
        },
        LeaderboardEntry: {
          type: "object",
          properties: {
            rank: { type: "number", nullable: true },
            userId: { type: "string" },
            username: { type: "string" },
            value: { type: "number" },
          },
        },
        AuthUser: {
          type: "object",
          properties: {
            id: { type: "string", example: "abc123userId" },
            username: { type: "string", example: "johndoe" },
            email: { type: "string", example: "john@example.com" },
          },
        },
        AuthRestaurant: {
          type: "object",
          properties: {
            id: { type: "string", example: "18CXbYrzy0o2v5BbHEUq" },
            restaurantName: { type: "string", example: "Korean Jap Bites" },
            email: { type: "string", example: "restaurant@example.com" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            token: { type: "string", description: "JWT token valid for 7 days", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
            user: { $ref: "#/components/schemas/AuthUser" },
          },
        },
        AuthRestaurantResponse: {
          type: "object",
          properties: {
            token: { type: "string", description: "JWT token valid for 7 days", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
            user: { $ref: "#/components/schemas/AuthRestaurant" },
          },
        },
        NotificationPreferences: {
          type: "object",
          properties: {
            inAppEnabled: { type: "boolean", description: "Always true", example: true },
            smsEnabled: { type: "boolean", example: false },
          },
        },
        UserProfile: {
          type: "object",
          properties: {
            id: { type: "string", example: "abc123userId" },
            username: { type: "string", example: "johndoe" },
            email: { type: "string", example: "john@example.com" },
            city: { type: "string", example: "" },
            phone: { type: "string", example: "+6591234567" },
            co2: { type: "number", example: 2.2, description: "Legacy field — mirrors impact.co2KgSaved" },
            water: { type: "number", example: 162, description: "Legacy field — mirrors impact.waterLitersSaved" },
            days: { type: "number", example: 2, description: "Legacy field — mirrors impact.daysSaved" },
            createdAt: { type: "string", format: "date-time", nullable: true },
            updatedAt: { type: "string", format: "date-time", nullable: true },
            notificationPreferences: { $ref: "#/components/schemas/NotificationPreferences" },
            impact: { $ref: "#/components/schemas/UserImpact" },
          },
        },
        RestaurantProfile: {
          type: "object",
          properties: {
            id: { type: "string", example: "18CXbYrzy0o2v5BbHEUq" },
            restaurantName: { type: "string", example: "Korean Jap Bites" },
            email: { type: "string", example: "restaurant@example.com" },
            city: { type: "string", example: "" },
            co2: { type: "number", example: 2.2 },
            water: { type: "number", example: 162 },
            days: { type: "number", example: 2 },
            createdAt: { type: "string", format: "date-time", nullable: true },
            updatedAt: { type: "string", format: "date-time", nullable: true },
            impact: {
              type: "object",
              properties: {
                mealsRescued: { type: "number" },
                co2KgSaved: { type: "number" },
                waterLitersSaved: { type: "number" },
                revenueRecovered: { type: "number" },
                ordersFulfilled: { type: "number" },
                repeatCustomers: { type: "number" },
                daysSaved: { type: "number" },
                completedDayKeys: { type: "array", items: { type: "string" } },
                lastSuccessfulOrderAt: { type: "string", format: "date-time", nullable: true },
                leaderboardEligible: { type: "boolean" },
              },
            },
          },
        },
        NotificationSettingsResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            account: { $ref: "#/components/schemas/UserProfile" },
            notificationPreferences: { $ref: "#/components/schemas/NotificationPreferences" },
            phone: { type: "string", example: "+6591234567" },
          },
        },
      },
    },
    paths: {
      "/account/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/register",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "email", "password"],
                  properties: {
                    username: { type: "string", example: "johndoe" },
                    email: { type: "string", example: "john@example.com" },
                    password: { type: "string", example: "securepassword123" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "User created successfully",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
            },
            400: { description: "Missing fields", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            409: { description: "Email already registered", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/restaurant/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new restaurant",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/restaurant/register",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["restaurantName", "email", "password"],
                  properties: {
                    restaurantName: { type: "string", example: "Korean Jap Bites" },
                    email: { type: "string", example: "restaurant@example.com" },
                    password: { type: "string", example: "securepassword123" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Restaurant created successfully",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AuthRestaurantResponse" } } },
            },
            400: { description: "Missing fields", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            409: { description: "Email already registered", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/login": {
        post: {
          tags: ["Auth"],
          summary: "User login",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", example: "john@example.com" },
                    password: { type: "string", example: "securepassword123" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Login successful",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
            },
            400: { description: "Missing fields", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            401: { description: "Invalid email or password", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/restaurant/login": {
        post: {
          tags: ["Auth"],
          summary: "Restaurant login",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/restaurant/login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", example: "restaurant@example.com" },
                    password: { type: "string", example: "securepassword123" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Login successful",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AuthRestaurantResponse" } } },
            },
            400: { description: "Missing fields", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            401: { description: "Invalid email or password", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/leaderboards/users": {
        get: {
          tags: ["Impact & Leaderboard"],
          summary: "Get impact leaderboards",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/leaderboards/users",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, minimum: 1, maximum: 25 },
              description: "Number of top entries to return (capped at 25)",
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string" },
              description: "Optional user ID to include the caller's rank in the response",
            },
          ],
          responses: {
            200: {
              description: "Leaderboard data for CO2 and Water saved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      stale: { type: "boolean", description: "True if data is served from cache due to quota limits" },
                      limit: { type: "number" },
                      leaderboards: {
                        type: "object",
                        properties: {
                          co2KgSaved: {
                            type: "object",
                            properties: {
                              top: { type: "array", items: { $ref: "#/components/schemas/LeaderboardEntry" } },
                              currentUser: { $ref: "#/components/schemas/LeaderboardEntry", nullable: true },
                            },
                          },
                          waterLitersSaved: {
                            type: "object",
                            properties: {
                              top: { type: "array", items: { $ref: "#/components/schemas/LeaderboardEntry" } },
                              currentUser: { $ref: "#/components/schemas/LeaderboardEntry", nullable: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: { description: "Server error (non-quota failures only — quota errors return 200 with stale: true and empty arrays)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/{id}": {
        get: {
          tags: ["Accounts"],
          summary: "Get user account by ID",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
          ],
          responses: {
            200: {
              description: "User profile data",
              content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } },
            },
            404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/restaurant/{id}": {
        get: {
          tags: ["Accounts"],
          summary: "Get restaurant account by ID",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/restaurant/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "18CXbYrzy0o2v5BbHEUq" } },
          ],
          responses: {
            200: {
              description: "Restaurant profile data",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RestaurantProfile" } } },
            },
            404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/{id}/notification-settings": {
        patch: {
          tags: ["Accounts"],
          summary: "Update notification preferences",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}/notification-settings",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    smsEnabled: { type: "boolean", example: true },
                    phone: { type: "string", example: "+6591234567" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Notification settings updated successfully",
              content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationSettingsResponse" } } },
            },
            400: {
              description: "Validation error (e.g., missing phone when enabling SMS, invalid phone format)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
            },
            404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/internal/contact/{id}": {
        get: {
          tags: ["Internal"],
          summary: "Resolve contact details for internal services",
          description:
            "Looks up phone and notification preferences for a user or restaurant by ID.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
            {
              name: "kind",
              in: "query",
              schema: { type: "string", enum: ["user", "restaurant", "auto"], default: "auto" },
              description: "Specifies which collection to search. Defaults to auto (tries both).",
            },
          ],
          responses: {
            200: { description: "Contact info resolved" },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/internal/impact/order-completed": {
        post: {
          tags: ["Internal"],
          summary: "Apply impact metrics after a completed order",
          description:
            "Updates mealsRescued, co2KgSaved, waterLitersSaved, and streak tracking for the customer and/or restaurant.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    customerId: { type: "string", example: "abc123userId" },
                    restaurantId: { type: "string", example: "18CXbYrzy0o2v5BbHEUq" },
                    quantity: { type: "integer", example: 2 },
                    moneySaved: { type: "number", example: 5.50 },
                    paidAmount: { type: "number", example: 4.50 },
                    completedAt: { type: "string", format: "date-time", example: "2025-04-01T14:00:00.000Z" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Impact successfully updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      updated: {
                        type: "object",
                        properties: {
                          customer: { type: "boolean" },
                          restaurant: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/{id}/cart": {
        get: {
          tags: ["Cart"],
          summary: "Get user cart",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}/cart. Expired items are automatically stripped before returning.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
          ],
          responses: {
            200: {
              description: "Returns sanitized cart array",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      cart: { type: "array", items: { $ref: "#/components/schemas/CartItem" } },
                    },
                  },
                },
              },
            },
            404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/{id}/cart/items": {
        post: {
          tags: ["Cart"],
          summary: "Add item to cart",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}/cart/items. If the listingId already exists in the cart, quantities are merged.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    item: { $ref: "#/components/schemas/CartItem" },
                    quantity: { type: "integer", default: 1, example: 2 },
                    pickupTime: { type: "string", example: "2025-04-01T18:00:00.000Z" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Item added, returns updated cart",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      cart: { type: "array", items: { $ref: "#/components/schemas/CartItem" } },
                    },
                  },
                },
              },
            },
            400: { description: "Missing listingId, invalid quantity, or expired listing", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            404: { description: "User not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/{id}/cart/items/{listingId}": {
        put: {
          tags: ["Cart"],
          summary: "Update cart item quantity or details",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}/cart/items/{listingId}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
            { name: "listingId", in: "path", required: true, schema: { type: "string", example: "listing456" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    quantity: { type: "integer", example: 3 },
                    pickupTime: { type: "string", example: "2025-04-01T18:00:00.000Z" },
                    item: { $ref: "#/components/schemas/CartItem" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Cart item updated, returns updated cart",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      cart: { type: "array", items: { $ref: "#/components/schemas/CartItem" } },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid quantity or expired listing", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            404: { description: "User or cart item not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        delete: {
          tags: ["Cart"],
          summary: "Remove item from cart",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}/cart/items/{listingId}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
            { name: "listingId", in: "path", required: true, schema: { type: "string", example: "listing456" } },
          ],
          responses: {
            200: {
              description: "Item removed, returns updated cart",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      cart: { type: "array", items: { $ref: "#/components/schemas/CartItem" } },
                    },
                  },
                },
              },
            },
            404: { description: "User not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/account/{id}/cart/clear": {
        post: {
          tags: ["Cart"],
          summary: "Clear user cart",
          description:
            "Gateway copy-paste URL: http://localhost:8000/account/{id}/cart/clear",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", example: "abc123userId" } },
          ],
          responses: {
            200: {
              description: "Cart cleared successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      cart: { type: "array", items: {}, example: [] },
                    },
                  },
                },
              },
            },
            404: { description: "User not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            500: { description: "Server error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// ─── Middleware ────────────────────────────────────────────────────────────────

const serviceName = 'account'
const CORRELATION_HEADER = 'x-correlation-id'

function getHeaderValue(headers = {}, key = CORRELATION_HEADER) {
  const value = headers?.[key] ?? headers?.[String(key).toLowerCase()]
  return String(Array.isArray(value) ? value[0] : value || '').trim()
}

function correlationMiddleware(serviceLabel) {
  return (req, res, next) => {
    const correlationId = getHeaderValue(req.headers) || `${serviceLabel}:${randomUUID()}`
    req.correlationId = correlationId
    res.setHeader(CORRELATION_HEADER, correlationId)
    console.log(`[${serviceLabel}] ${req.method} ${req.originalUrl} cid=${correlationId}`)
    next()
  }
}

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-correlation-id"]
};
app.use(cors(corsOptions))
app.use(correlationMiddleware(serviceName))
app.use(express.json())
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// ─── Constants ────────────────────────────────────────────────────────────────

const USERS = db.collection('users')
const RESTAURANTS = db.collection('restaurants')
const JWT_SECRET = process.env.JWT_SECRET || 'foodrescue-secret' // Use env variable in production
const ACCOUNT_CACHE_TTL_MS = 60 * 1000
const IMPACT_CO2_PER_MEAL = 1.1
const IMPACT_WATER_PER_MEAL = 81
const IMPACT_TIMEZONE = 'Asia/Singapore'
const accountCache = new Map()
const leaderboardCache = new Map()

// ─── Impact Defaults ──────────────────────────────────────────────────────────

function createDefaultUserImpact() {
  return {
    mealsRescued: 0,
    co2KgSaved: 0,
    waterLitersSaved: 0,
    moneySaved: 0,
    daysSaved: 0,
    completedDayKeys: [],
    lastSuccessfulOrderAt: null,
    leaderboardEligible: true
  };
}

function createDefaultRestaurantImpact() {
  return {
    mealsRescued: 0,
    co2KgSaved: 0,
    waterLitersSaved: 0,
    revenueRecovered: 0,
    ordersFulfilled: 0,
    repeatCustomers: 0,
    daysSaved: 0,
    completedDayKeys: [],
    lastSuccessfulOrderAt: null,
    leaderboardEligible: true
  };
}

// ─── Notification Helpers ─────────────────────────────────────────────────────

function createDefaultNotificationPreferences() {
  return {
    inAppEnabled: true,
    smsEnabled: false,
  }
}

function normalizeNotificationPreferences(preferences) {
  const safePreferences =
    preferences && typeof preferences === 'object' ? preferences : {}
  const defaults = createDefaultNotificationPreferences()

  return {
    inAppEnabled: true,
    smsEnabled:
      safePreferences.smsEnabled === undefined
        ? defaults.smsEnabled
        : Boolean(safePreferences.smsEnabled),
  }
}

// ─── Phone Helpers ────────────────────────────────────────────────────────────

function normalizeStoredPhone(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''

  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/[^\d]/g, '')
  return hasPlus ? `+${digits}` : digits
}

function isValidStoredPhone(value) {
  const normalized = normalizeStoredPhone(value)
  const digits = normalized.replace(/[^\d]/g, '')
  return digits.length >= 8 && digits.length <= 15
}

// ─── Impact Helpers ───────────────────────────────────────────────────────────

function normalizeImpact(impact, defaultsFactory) {
  const safeImpact = impact && typeof impact === 'object' ? impact : {};
  const defaults = defaultsFactory();

  return {
    ...defaults,
    ...safeImpact,
    daysSaved: Number(
      safeImpact.daysSaved ??
      safeImpact.currentStreakDays ??
      defaults.daysSaved ??
      0
    ) || 0,
    completedDayKeys: Array.isArray(safeImpact.completedDayKeys)
      ? [...new Set(safeImpact.completedDayKeys.map((key) => String(key).trim()).filter(Boolean))]
      : [],
    leaderboardEligible:
      safeImpact.leaderboardEligible === undefined
        ? defaults.leaderboardEligible
        : Boolean(safeImpact.leaderboardEligible)
  };
}

function buildLegacyImpactFields(safeData, impact) {
  return {
    co2: Number(safeData.co2 ?? impact.co2KgSaved ?? 0) || 0,
    water: Number(safeData.water ?? impact.waterLitersSaved ?? 0) || 0,
    days: Number(safeData.days ?? impact.daysSaved ?? 0) || 0,
  };
}

function toDateValue(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toIsoDate(value) {
  return toDateValue(value)?.toISOString() || null
}

function toPositiveImpactValue(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function getSingaporeDayKey(value) {
  const parsed = value ? new Date(value) : new Date()
  if (Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: IMPACT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IMPACT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed)
}

function buildImpactPayload({ existingImpact, quantity, completedAtValue, extraImpact = {} }) {
  const existingDayKeys = Array.isArray(existingImpact.completedDayKeys)
    ? existingImpact.completedDayKeys.map((key) => String(key))
    : []
  const completedDayKey = getSingaporeDayKey(completedAtValue?.toISOString?.() || completedAtValue)
  const nextDayKeys = existingDayKeys.includes(completedDayKey)
    ? existingDayKeys
    : [...existingDayKeys, completedDayKey]

  return {
    ...existingImpact,
    mealsRescued: toPositiveImpactValue(existingImpact.mealsRescued) + quantity,
    co2KgSaved:
      toPositiveImpactValue(existingImpact.co2KgSaved) + (quantity * IMPACT_CO2_PER_MEAL),
    waterLitersSaved:
      toPositiveImpactValue(existingImpact.waterLitersSaved) + (quantity * IMPACT_WATER_PER_MEAL),
    daysSaved: nextDayKeys.length,
    completedDayKeys: nextDayKeys,
    lastSuccessfulOrderAt: completedAtValue,
    leaderboardEligible: true,
    ...extraImpact,
  }
}

async function applyCompletedOrderImpact({ docRef, defaultsFactory, quantity, completedAtValue, extraImpact = {} }) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef)
    const data = snapshot.exists ? (snapshot.data() || {}) : {}
    const existingImpact = normalizeImpact(
      {
        ...(data.impact && typeof data.impact === 'object' ? data.impact : {}),
        co2KgSaved: data?.impact?.co2KgSaved ?? data.co2 ?? 0,
        waterLitersSaved: data?.impact?.waterLitersSaved ?? data.water ?? 0,
        daysSaved: data?.impact?.daysSaved ?? data.days ?? 0,
      },
      defaultsFactory
    )
    const resolvedExtraImpact =
      typeof extraImpact === 'function' ? extraImpact(existingImpact) : extraImpact

    const nextImpact = buildImpactPayload({
      existingImpact,
      quantity,
      completedAtValue,
      extraImpact: resolvedExtraImpact,
    })

    transaction.set(
      docRef,
      {
        co2: Number(nextImpact.co2KgSaved || 0) || 0,
        water: Number(nextImpact.waterLitersSaved || 0) || 0,
        days: Number(nextImpact.daysSaved || 0) || 0,
        impact: nextImpact,
        updatedAt: completedAtValue,
      },
      { merge: true }
    )
  })
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function isQuotaError(error) {
  const message = String(error?.message || '').toUpperCase()
  return (
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('QUOTA EXCEEDED') ||
    message.includes('QUOTA_EXCEEDED')
  )
}

function getCachedAccount(cacheKey) {
  const cached = accountCache.get(String(cacheKey || ''))
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    accountCache.delete(String(cacheKey || ''))
    return null
  }
  return cached.value
}

function setCachedAccount(cacheKey, value) {
  accountCache.set(String(cacheKey || ''), {
    value,
    expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
  })
}

function invalidateCachedAccount(cacheKey) {
  accountCache.delete(String(cacheKey || ''))
}

function getCachedLeaderboard(cacheKey) {
  const cached = leaderboardCache.get(String(cacheKey || ''))
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    leaderboardCache.delete(String(cacheKey || ''))
    return null
  }
  return cached.value
}

function setCachedLeaderboard(cacheKey, value) {
  leaderboardCache.set(String(cacheKey || ''), {
    value,
    expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
  })
}

function clearLeaderboardCache() {
  leaderboardCache.clear()
}

// ─── Account Sanitization ─────────────────────────────────────────────────────

async function ensureLegacyImpactFields(docRef, safeData, impact) {
  const updates = {};

  if (safeData.co2 === undefined) updates.co2 = Number(impact.co2KgSaved || 0) || 0;
  if (safeData.water === undefined) updates.water = Number(impact.waterLitersSaved || 0) || 0;
  if (safeData.days === undefined) updates.days = Number(impact.daysSaved || 0) || 0;

  if (Object.keys(updates).length === 0) return;

  try {
    await docRef.set(updates, { merge: true });
  } catch (error) {
    console.warn('[account] Skipping legacy impact backfill:', error?.message || error)
  }
}

function sanitizeAccountDocument(doc, defaultsFactory) {
  const data = doc.data() || {};
  const { password, ...safeData } = data;
  const notificationPreferences = normalizeNotificationPreferences(safeData.notificationPreferences)
  const impact = normalizeImpact(
    {
      ...(safeData.impact && typeof safeData.impact === 'object' ? safeData.impact : {}),
      co2KgSaved: safeData?.impact?.co2KgSaved ?? safeData.co2 ?? 0,
      waterLitersSaved: safeData?.impact?.waterLitersSaved ?? safeData.water ?? 0,
      daysSaved: safeData?.impact?.daysSaved ?? safeData.days ?? 0,
    },
    defaultsFactory
  );
  const legacyImpactFields = buildLegacyImpactFields(safeData, impact);

  return {
    id: doc.id,
    ...safeData,
    createdAt: toIsoDate(safeData.createdAt),
    updatedAt: toIsoDate(safeData.updatedAt),
    ...legacyImpactFields,
    city: typeof safeData.city === 'string' ? safeData.city : '',
    phone: normalizeStoredPhone(safeData.phone),
    notificationPreferences,
    impact: {
      ...impact,
      lastSuccessfulOrderAt: toIsoDate(impact.lastSuccessfulOrderAt),
    }
  };
}

// ─── Leaderboard Helpers ──────────────────────────────────────────────────────

function sanitizeLeaderboardValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getMetricValueFromUserDoc(doc, field, impactKey) {
  const data = doc?.data?.() || {}
  const impact = data.impact && typeof data.impact === 'object' ? data.impact : {}
  return sanitizeLeaderboardValue(data?.[field] ?? impact?.[impactKey] ?? 0)
}

async function buildTopMetricLeaderboard({ field, impactKey, limit, currentUserId = '' }) {
  const topSnapshot = await USERS.orderBy(field, 'desc').limit(limit).get()
  const top = topSnapshot.docs.map((doc, index) => {
    const data = doc.data() || {}
    return {
      rank: index + 1,
      userId: doc.id,
      username: data.username || `User ${index + 1}`,
      value: getMetricValueFromUserDoc(doc, field, impactKey),
    }
  })

  let currentUser = null

  if (currentUserId) {
    const currentDoc = await USERS.doc(currentUserId).get()
    if (currentDoc.exists) {
      const currentData = currentDoc.data() || {}
      const currentValue = getMetricValueFromUserDoc(currentDoc, field, impactKey)
      const inTop = top.find((entry) => entry.userId === currentUserId)

      if (inTop) {
        currentUser = inTop
      } else {
        try {
          const countSnapshot = await USERS.where(field, '>', currentValue).count().get()
          currentUser = {
            rank: Number(countSnapshot?.data()?.count || 0) + 1,
            userId: currentUserId,
            username: currentData.username || 'You',
            value: currentValue,
          }
        } catch {
          currentUser = {
            rank: null,
            userId: currentUserId,
            username: currentData.username || 'You',
            value: currentValue,
          }
        }
      }
    }
  }

  return { top, currentUser }
}

function buildMetricLeaderboard(entries, metric, limit, currentUserId = '') {
  const sorted = [...entries].sort((a, b) => {
    const delta =
      sanitizeLeaderboardValue(b?.impact?.[metric]) -
      sanitizeLeaderboardValue(a?.impact?.[metric]);

    if (delta !== 0) return delta;
    return String(a?.username || '').localeCompare(String(b?.username || ''));
  });

  const top = sorted.slice(0, limit).map((entry, index) => ({
    rank: index + 1,
    userId: entry.id,
    username: entry.username || `User ${index + 1}`,
    value: sanitizeLeaderboardValue(entry?.impact?.[metric]),
  }));

  const currentUserIndex = currentUserId
    ? sorted.findIndex((entry) => entry.id === String(currentUserId))
    : -1;

  const currentUser =
    currentUserIndex >= 0
      ? {
          rank: currentUserIndex + 1,
          userId: sorted[currentUserIndex].id,
          username: sorted[currentUserIndex].username || 'You',
          value: sanitizeLeaderboardValue(sorted[currentUserIndex]?.impact?.[metric]),
        }
      : null;

  return { top, currentUser };
}

// ─── Internal Contact Helper ──────────────────────────────────────────────────

function normalizeInternalContactKind(value) {
  const normalized = String(value || 'auto').trim().toLowerCase()
  if (['user', 'restaurant', 'auto'].includes(normalized)) return normalized
  return 'auto'
}

async function resolveInternalContact(id, kind = 'auto') {
  const normalizedId = String(id || '').trim()
  const normalizedKind = normalizeInternalContactKind(kind)

  if (!normalizedId) {
    return {
      found: false,
      id: '',
      kind: 'unknown',
      phone: '',
      notificationPreferences: createDefaultNotificationPreferences(),
    }
  }

  const collections =
    normalizedKind === 'user'
      ? [{ kind: 'user', ref: USERS }]
      : normalizedKind === 'restaurant'
        ? [{ kind: 'restaurant', ref: RESTAURANTS }]
        : [
            { kind: 'user', ref: USERS },
            { kind: 'restaurant', ref: RESTAURANTS },
          ]

  for (const entry of collections) {
    const doc = await entry.ref.doc(normalizedId).get()
    if (!doc.exists) continue

    const data = doc.data() || {}
    return {
      found: true,
      id: doc.id,
      kind: entry.kind,
      phone: normalizeStoredPhone(data.phone),
      notificationPreferences:
        entry.kind === 'user'
          ? normalizeNotificationPreferences(data.notificationPreferences)
          : createDefaultNotificationPreferences(),
      email: String(data.email || '').trim(),
      username: entry.kind === 'user' ? String(data.username || '').trim() : '',
      restaurantName: entry.kind === 'restaurant' ? String(data.restaurantName || '').trim() : '',
    }
  }

  return {
    found: false,
    id: normalizedId,
    kind: normalizedKind === 'auto' ? 'unknown' : normalizedKind,
    phone: '',
    notificationPreferences: createDefaultNotificationPreferences(),
  }
}

// ─── Cart Helpers ─────────────────────────────────────────────────────────────

function normalizeCartItem(input) {
  const listingId =
    input?.listingId ||
    input?.ListingId ||
    input?.id ||
    input?.Id ||
    input?.listing_id ||
    input?.listingID;

  const itemName = input?.itemName || input?.ItemName || input?.name || input?.Name;
  const restaurantId = input?.restaurantId || input?.RestaurantId;
  const restaurantName = input?.restaurantName || input?.RestaurantName;
  const imageURL = input?.imageURL || input?.ImageURL || input?.imageUrl || input?.ImageUrl || '';
  const expiryTime = input?.expiryTime || input?.ExpiryTime || '';
  const cuisineType = input?.cuisineType || input?.CuisineType || '';

  const priceRaw = input?.price ?? input?.Price ?? 0;
  const price = Number(priceRaw);

  return {
    listingId: String(listingId || ''),
    itemName: String(itemName || ''),
    restaurantId: restaurantId ? String(restaurantId) : '',
    restaurantName: restaurantName ? String(restaurantName) : '',
    imageURL: imageURL ? String(imageURL) : '',
    expiryTime: expiryTime ? String(expiryTime) : '',
    cuisineType: cuisineType ? String(cuisineType) : '',
    price: Number.isFinite(price) ? price : 0
  };
}

function isExpiredCartItem(item) {
  const expiryTime = item?.expiryTime || item?.ExpiryTime || '';
  if (!expiryTime) return false;

  const expiryDate = new Date(expiryTime);
  if (Number.isNaN(expiryDate.getTime())) return false;

  return expiryDate.getTime() <= Date.now();
}

function sanitizeCart(cart) {
  const safeCart = Array.isArray(cart) ? cart : [];
  return safeCart.filter((item) => !isExpiredCartItem(item));
}

async function updateCartIfSanitized(docRef, cart, sanitizedCart) {
  if (sanitizedCart.length === cart.length) return;

  await docRef.update({
    cart: sanitizedCart,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// ─── Routes: Auth ─────────────────────────────────────────────────────────────

// Register a new user account
app.post('/account/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const existing = await USERS.where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      username,
      email,
      password: hashedPassword,
      cart: [],
      city: '',
      phone: '',
      notificationPreferences: createDefaultNotificationPreferences(),
      co2: 0,
      water: 0,
      days: 0,
      impact: createDefaultUserImpact(),
      createdAt: new Date()
    };

    const docRef = await USERS.add(newUser);
    const token = jwt.sign({ id: docRef.id, email, username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: docRef.id, username, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register a new restaurant account
app.post('/account/restaurant/register', async (req, res) => {
  try {
    const { restaurantName, email, password } = req.body;

    if (!restaurantName || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const existing = await RESTAURANTS.where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newRestaurant = {
      restaurantName,
      email,
      password: hashedPassword,
      cart: [],
      city: '',
      co2: 0,
      water: 0,
      days: 0,
      impact: createDefaultRestaurantImpact(),
      createdAt: new Date()
    };

    const docRef = await RESTAURANTS.add(newRestaurant);
    const token = jwt.sign({ id: docRef.id, email, restaurantName }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: { id: docRef.id, restaurantName, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login to an existing user account
app.post('/account/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const snapshot = await USERS.where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const doc = snapshot.docs[0];
    const user = doc.data();

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: doc.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: doc.id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login to an existing restaurant account
app.post('/account/restaurant/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const snapshot = await RESTAURANTS.where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const doc = snapshot.docs[0];
    const restaurant = doc.data();

    const passwordMatch = await bcrypt.compare(password, restaurant.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: doc.id, email: restaurant.email, restaurantName: restaurant.restaurantName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: doc.id, restaurantName: restaurant.restaurantName, email: restaurant.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Routes: Leaderboards ─────────────────────────────────────────────────────

app.get('/account/leaderboards/users', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(25, Number(req.query.limit ?? 10) || 10));
    const currentUserId = String(req.query.userId || '').trim();
    const cacheKey = `users:${limit}:${currentUserId || 'anon'}`
    const [co2KgSaved, waterLitersSaved] = await Promise.all([
      buildTopMetricLeaderboard({ field: 'co2', impactKey: 'co2KgSaved', limit, currentUserId }),
      buildTopMetricLeaderboard({ field: 'water', impactKey: 'waterLitersSaved', limit, currentUserId }),
    ]);

    const payload = {
      success: true,
      limit,
      leaderboards: { co2KgSaved, waterLitersSaved },
    };
    setCachedLeaderboard(cacheKey, payload);

    res.json(payload);
  } catch (err) {
    const limit = Math.max(1, Math.min(25, Number(req.query.limit ?? 10) || 10));
    const currentUserId = String(req.query.userId || '').trim();
    const cacheKey = `users:${limit}:${currentUserId || 'anon'}`
    const cached = getCachedLeaderboard(cacheKey)
    if (isQuotaError(err)) {
      if (cached) return res.json({ ...cached, stale: true })
      return res.json({
        success: true,
        stale: true,
        limit,
        leaderboards: {
          co2KgSaved: { top: [], currentUser: null },
          waterLitersSaved: { top: [], currentUser: null },
        },
      })
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── Routes: Accounts ─────────────────────────────────────────────────────────

// Get a user account by ID
app.get('/account/:id', async (req, res) => {
  try {
    const doc = await USERS.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const rawData = doc.data() || {};
    const safeDoc = sanitizeAccountDocument(doc, createDefaultUserImpact);
    setCachedAccount(req.params.id, safeDoc);
    await ensureLegacyImpactFields(USERS.doc(req.params.id), rawData, safeDoc.impact);
    res.json(safeDoc);
  } catch (err) {
    if (isQuotaError(err)) {
      const cached = getCachedAccount(req.params.id)
      if (cached) return res.json(cached)
    }
    res.status(500).json({ error: err.message });
  }
});

// Get a restaurant account by ID
app.get('/account/restaurant/:id', async (req, res) => {
  try {
    const doc = await RESTAURANTS.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const rawData = doc.data() || {};
    const safeDoc = sanitizeAccountDocument(doc, createDefaultRestaurantImpact);
    setCachedAccount(`restaurant:${req.params.id}`, safeDoc);
    await ensureLegacyImpactFields(RESTAURANTS.doc(req.params.id), rawData, safeDoc.impact);
    res.json(safeDoc);
  } catch (err) {
    if (isQuotaError(err)) {
      const cached = getCachedAccount(`restaurant:${req.params.id}`)
      if (cached) return res.json(cached)
    }
    res.status(500).json({ error: err.message });
  }
});

// Update notification preferences
app.patch('/account/:id/notification-settings', async (req, res) => {
  try {
    const { id } = req.params
    const { smsEnabled, phone } = req.body || {}
    const docRef = USERS.doc(id)
    const doc = await docRef.get()

    if (!doc.exists) {
      return res.status(404).json({ error: 'Not found' })
    }

    const currentData = doc.data() || {}
    const currentPreferences = normalizeNotificationPreferences(currentData.notificationPreferences)
    const requestedSmsEnabled =
      smsEnabled === undefined ? currentPreferences.smsEnabled : Boolean(smsEnabled)
    const nextPhone =
      phone === undefined
        ? normalizeStoredPhone(currentData.phone)
        : normalizeStoredPhone(phone)

    if (requestedSmsEnabled && !nextPhone) {
      return res.status(400).json({ error: 'Phone number is required to enable SMS notifications' })
    }

    if (nextPhone && !isValidStoredPhone(nextPhone)) {
      return res.status(400).json({ error: 'Phone number must contain 8 to 15 digits' })
    }

    const nextPreferences = { inAppEnabled: true, smsEnabled: requestedSmsEnabled }

    await docRef.set(
      {
        phone: nextPhone,
        notificationPreferences: nextPreferences,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    const updatedDoc = await docRef.get()
    const sanitized = sanitizeAccountDocument(updatedDoc, createDefaultUserImpact)
    setCachedAccount(id, sanitized)

    res.json({
      success: true,
      account: sanitized,
      notificationPreferences: sanitized.notificationPreferences,
      phone: sanitized.phone,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Routes: Internal ─────────────────────────────────────────────────────────

app.get('/account/internal/contact/:id', async (req, res) => {
  try {
    const contact = await resolveInternalContact(req.params.id, req.query.kind)
    res.json(contact)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/account/internal/impact/order-completed', async (req, res) => {
  try {
    const {
      customerId = '',
      restaurantId = '',
      quantity = 1,
      moneySaved = 0,
      paidAmount = 0,
      completedAt,
    } = req.body || {}

    const normalizedCustomerId = String(customerId || '').trim()
    const normalizedRestaurantId = String(restaurantId || '').trim()
    const normalizedQuantity = Math.max(1, Math.floor(Number(quantity) || 1))
    const normalizedMoneySaved = Number(moneySaved) || 0
    const normalizedPaidAmount = Number(paidAmount) || 0
    const completedAtValue = toDateValue(completedAt) || new Date()
    const writes = []

    if (normalizedCustomerId) {
      writes.push(
        applyCompletedOrderImpact({
          docRef: USERS.doc(normalizedCustomerId),
          defaultsFactory: createDefaultUserImpact,
          quantity: normalizedQuantity,
          completedAtValue,
          extraImpact: (existingImpact) => ({
            moneySaved:
              toPositiveImpactValue(existingImpact.moneySaved) +
              toPositiveImpactValue(normalizedMoneySaved),
          }),
        })
      )
    }

    if (normalizedRestaurantId) {
      writes.push(
        applyCompletedOrderImpact({
          docRef: RESTAURANTS.doc(normalizedRestaurantId),
          defaultsFactory: createDefaultRestaurantImpact,
          quantity: normalizedQuantity,
          completedAtValue,
          extraImpact: (existingImpact) => ({
            revenueRecovered:
              toPositiveImpactValue(existingImpact.revenueRecovered) +
              toPositiveImpactValue(normalizedPaidAmount),
            ordersFulfilled:
              toPositiveImpactValue(existingImpact.ordersFulfilled) + normalizedQuantity,
          }),
        })
      )
    }

    await Promise.all(writes)

    if (normalizedCustomerId) invalidateCachedAccount(normalizedCustomerId)
    if (normalizedRestaurantId) invalidateCachedAccount(`restaurant:${normalizedRestaurantId}`)
    clearLeaderboardCache()

    res.json({
      success: true,
      updated: {
        customer: Boolean(normalizedCustomerId),
        restaurant: Boolean(normalizedRestaurantId),
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Routes: Cart ─────────────────────────────────────────────────────────────

// Get cart for a user
app.get('/account/:id/cart', async (req, res) => {
  try {
    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const data = doc.data() || {};
    const cart = Array.isArray(data.cart) ? data.cart : [];
    const sanitizedCart = sanitizeCart(cart);

    await updateCartIfSanitized(docRef, cart, sanitizedCart);
    res.json({ cart: sanitizedCart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add item to cart (merge by listingId)
app.post('/account/:id/cart/items', async (req, res) => {
  try {
    const { item, quantity, pickupTime } = req.body || {};
    const normalized = normalizeCartItem(item || req.body);

    if (!normalized.listingId) {
      return res.status(400).json({ error: 'listingId is required' });
    }
    if (isExpiredCartItem(normalized)) {
      return res.status(400).json({ error: 'This listing has expired' });
    }

    const qty = Number(quantity ?? req.body?.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    const data = doc.data() || {};
    const cart = sanitizeCart(Array.isArray(data.cart) ? data.cart.slice() : []);
    const idx = cart.findIndex((c) => String(c?.listingId || '') === String(normalized.listingId));
    const pickup = pickupTime ?? req.body?.pickup_time ?? '';

    if (idx >= 0) {
      const existing = cart[idx] || {};
      const existingQty = Number(existing.quantity ?? 0);
      cart[idx] = {
        ...existing,
        ...normalized,
        quantity: (Number.isFinite(existingQty) ? existingQty : 0) + qty,
        pickupTime: pickup ? String(pickup) : (existing.pickupTime || ''),
        updatedAt: new Date().toISOString()
      };
    } else {
      cart.push({
        ...normalized,
        quantity: qty,
        pickupTime: pickup ? String(pickup) : '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await docRef.update({ cart, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).json({ cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove item from cart by listingId
app.delete('/account/:id/cart/items/:listingId', async (req, res) => {
  try {
    const { id, listingId } = req.params;
    const docRef = USERS.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    const data = doc.data() || {};
    const cart = sanitizeCart(Array.isArray(data.cart) ? data.cart : []);
    const filtered = cart.filter((c) => String(c?.listingId || '') !== String(listingId));

    await docRef.update({ cart: filtered, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ cart: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update an existing cart item by listingId
app.put('/account/:id/cart/items/:listingId', async (req, res) => {
  try {
    const { id, listingId } = req.params;
    const { quantity, pickupTime, item } = req.body || {};

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const docRef = USERS.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    if (item && isExpiredCartItem(normalizeCartItem(item))) {
      return res.status(400).json({ error: 'This listing has expired' });
    }

    const data = doc.data() || {};
    const cart = sanitizeCart(Array.isArray(data.cart) ? data.cart.slice() : []);
    const idx = cart.findIndex((c) => String(c?.listingId || '') === String(listingId));

    if (idx < 0) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    const existing = cart[idx] || {};
    const normalized = item ? normalizeCartItem(item) : {};

    cart[idx] = {
      ...existing,
      ...normalized,
      listingId: String(existing?.listingId || listingId),
      quantity: qty,
      pickupTime:
        pickupTime !== undefined && pickupTime !== null
          ? String(pickupTime)
          : String(existing?.pickupTime || ''),
      updatedAt: new Date().toISOString()
    };

    await docRef.update({ cart, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear cart
app.post('/account/:id/cart/clear', async (req, res) => {
  try {
    const docRef = USERS.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    await docRef.update({ cart: [], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ cart: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Account service running on port ${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
});
