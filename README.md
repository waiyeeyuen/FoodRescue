# FoodRescue

FoodRescue is a microservices-based web platform that helps reduce food waste by connecting customers with time-sensitive surplus meals from restaurants at discounted prices.

The system supports both customer and restaurant workflows:

- Customers can register, browse rescue listings, receive personalized recommendations, place orders, make payments, earn discount rewards, and receive notifications.
- Restaurants can register, create listings, manage live/expired/deleted listings, view affected orders, and trigger refunds when a listing is deleted.

This project is built around atomic microservices, composite orchestration services, an API gateway, asynchronous messaging, and external integrations such as Firebase, Stripe, Twilio, AWS S3, Gemini, and OutSystems.

## Problem Statement

Restaurants frequently have unsold food near the end of the day, while customers are often looking for affordable meals nearby. Without a coordinated system, this food is wasted and restaurants lose potential revenue.

FoodRescue solves this by:

- letting restaurants publish discounted rescue meals before they expire
- surfacing relevant listings to customers
- supporting secure checkout and payment
- notifying users about order outcomes and refunds
- rewarding repeat rescue behavior with discount eligibility
- allowing restaurants to remove listings safely while automatically refunding affected customers

## What The Project Does

At a high level, FoodRescue combines:

- a React frontend for customers and restaurants
- atomic microservices for account, inventory, order, payment, reward, and notification responsibilities
- composite microservices that orchestrate end-to-end business scenarios
- Kong as the API gateway
- RabbitMQ for asynchronous event/queue-based workflows

Key user-facing capabilities:

- user and restaurant registration/login
- personalized food recommendations using order history, current availability, reward status, and Gemini reranking
- cart and order placement flow with Stripe checkout
- reward eligibility and discount tracking
- in-app and SMS notifications through Twilio
- restaurant listing creation and listing deletion with composite-managed refunds
- deleted listing archive for restaurant-side tracking

## Scenario Overview

### Scenario 1: Get Food Recommendation

The recommendation composite service:

- reads a customer's order history from `order`
- reads currently available listings from `inventory`
- checks discount eligibility from `reward`
- optionally reranks recommendations using Gemini
- returns personalized recommendations to the frontend

Main route:

- `GET /recommendations/:userId`

### Scenario 2: Order Placement And Payment Processing

The place-order composite service:

- checks reward status
- creates a Stripe checkout/payment flow
- coordinates with inventory and order services
- updates reward usage after a successful discounted order
- triggers user notifications

Supporting services include RabbitMQ, the inventory consumer, payment webhook handling, and the notification service.

Main routes:

- `GET /orders/reward-status/:userId`
- `POST /orders/place`
- `POST /payments/webhook`

### Scenario 3: Restaurant Listing Creation, Deletion, And Refund

The upload-listing and delete-listing composites support restaurant operations.

Current delete-listing behavior:

- restaurant creates a listing through the listing flow
- restaurant previews listing deletion
- the delete-listing composite checks affected orders from `order`
- all affected orders are refunded through `payment`
- each affected customer receives one website notification and one Twilio SMS with combined refund totals
- if a refunded order had used a discount voucher, the customer regains one voucher
- the listing is deleted from `inventory` and archived for the restaurant's `Deleted` tab

Main routes:

- `POST /listings`
- `GET /delete-listing/:listingId/preview`
- `DELETE /delete-listing/:listingId`

## Architecture

### Frontend

- `frontend/`
- React 19 + Vite
- customer UI and restaurant UI

### Atomic Microservices

- `services/account` - authentication, profiles, cart, impact, leaderboard
- `services/inventory` - listing CRUD, active/deleted listing retrieval, image upload, OutSystems inventory integration
- `services/order` - order persistence and history queries
- `services/payment` - Stripe checkout, payment records, refunds, webhook handling
- `services/reward` - reward eligibility, voucher usage, voucher restoration after refunds
- `services/notification` - in-app notification records and Twilio SMS delivery
- `services/refund-management` - background refund retry consumer for queue-driven failures

### Composite Microservices

- `composite/recommendation` - Scenario 1 orchestration
- `composite/place-order` - Scenario 2 orchestration
- `composite/upload-listing` - restaurant listing creation flow
- `composite/delete-listing` - restaurant delete-listing, refund, notification, and voucher-restore flow
- `composite/checkout` - checkout helper/orchestration
- `composite/remove-expired` - expired listing cleanup flow

### Platform Components

- `api/kong.docker.yml` - declarative Kong gateway config used in Docker
- `rabbitmq` - queue broker and management UI
- Firebase - account, notification, deleted listing archive, reward restoration, and other persisted app data
- AWS S3 - listing image storage
- Stripe - payment and refund processing
- Twilio - SMS notifications
- Gemini - recommendation reranking
- OutSystems endpoints - inventory and reward system integration

## Repository Structure

```text
api/                    Kong gateway configuration
composite/              Composite orchestration services
frontend/               React frontend
services/               Atomic microservices
docker-compose.yml      Main local runtime
DOCKER.md               Short Docker notes
README.md               This file
```

## Prerequisites

Before running the project, install or prepare:

- Docker Desktop or Docker Engine with Docker Compose v2
- Stripe CLI for local webhook forwarding
- valid Firebase service account JSON
- valid provider credentials for the services you plan to demo:
  - Stripe
  - Twilio
  - AWS S3
  - Gemini
  - OutSystems-backed APIs used by inventory and reward flows

## Required Local Files

Do not place actual secret values in this README. Submit the configuration files separately together with the project.

### Firebase Service Account

Place the Firebase Admin JSON file here:

- `services/firebase/serviceAccountKey.json`

Important:

- this file is mounted into multiple containers by `docker-compose.yml`
- if you are on macOS with iCloud Drive enabled, make sure the file is fully downloaded locally and not an offloaded placeholder

### `.env` File Locations

Create or populate the following files:

- `services/inventory/.env`
- `services/payment/.env`
- `services/notification/.env`
- `composite/place-order/.env`
- `composite/recommendation/.env`

For the default Docker setup, no additional frontend `.env` file is required because the frontend service receives its `VITE_*` values from `docker-compose.yml`.

### What These Config Files Are Used For

- `services/inventory/.env`
  - AWS S3 credentials and inventory-related runtime settings
- `services/payment/.env`
  - Stripe keys, webhook secret, frontend success/cancel URLs, payment service configuration
- `services/notification/.env`
  - Twilio credentials and optional default SMS fallback number
- `composite/place-order/.env`
  - composite service runtime settings for order placement
- `composite/recommendation/.env`
  - Gemini API key, cache options, and recommendation runtime settings

## Docker Configuration

The project is designed to run from the root `docker-compose.yml`.

Important runtime details:

- Kong uses `./api/kong.docker.yml` as a declarative config volume
- RabbitMQ is health-checked before dependent services start
- the Firebase key is mounted read-only into Firebase-dependent containers
- service-specific `.env` files are injected using Compose `env_file`
- the frontend is configured to call Kong on `http://localhost:8000`

## How To Run

From the project root:

```sh
docker compose up --build
```

To stop the project:

```sh
docker compose down
```

Recommended startup flow:

1. Place the Firebase key in `services/firebase/serviceAccountKey.json`.
2. Populate all required `.env` files at the paths listed above.
3. Start the full stack with `docker compose up --build`.
4. Open the frontend at `http://localhost:5173`.
5. Use Kong at `http://localhost:8000` for API access.

## Stripe Webhook Setup

For local Stripe webhook testing, run this on the host machine:

```sh
stripe listen --forward-to http://localhost:3003/payments/webhook
```

Then ensure the webhook secret generated by Stripe CLI is placed inside:

- `services/payment/.env`

## Access URLs

- Frontend: `http://localhost:5173`
- Kong Gateway: `http://localhost:8000`
- Kong Admin API: `http://localhost:8001`
- RabbitMQ Management UI: `http://localhost:15672`

RabbitMQ default credentials:

- username: `guest`
- password: `guest`

## Exposed Ports

| Component | Host Port | Purpose |
| --- | ---: | --- |
| frontend | 5173 | React UI |
| kong | 8000 | public API gateway |
| kong admin | 8001 | Kong admin interface |
| rabbitmq | 5672 | AMQP broker |
| rabbitmq ui | 15672 | RabbitMQ management UI |
| account | 3001 | account/auth/profile/cart service |
| inventory | 3000 | inventory/listing service |
| payment | 3003 | payment/refund service |
| order | 3004 | order service |
| reward | 3005 | reward service |
| notification | 3006 | notification service |
| recommendation | 4000 | recommendation composite |
| place-order | 4001 | place-order composite |
| upload-listing | 4002 | upload-listing composite |
| remove-expired | 4003 | expired listing cleanup composite |
| checkout | 4004 | checkout composite |
| delete-listing | 4005 | delete-listing composite |

Note:

- the frontend should normally talk to Kong on port `8000`
- direct service ports are mainly useful for debugging and development

## Kong Route Prefixes

The following route prefixes are exposed through Kong:

| Route Prefix | Target |
| --- | --- |
| `/account` | account service |
| `/inventory` | inventory service |
| `/orders` | order service and place-order routes |
| `/payments` | payment service |
| `/reward` | reward service |
| `/notifications` | notification service |
| `/recommendations` | recommendation composite |
| `/listings` | upload-listing composite |
| `/delete-listing` | delete-listing composite |
| `/cleanup` | remove-expired composite |
| `/checkout` | checkout composite |

## Test Accounts

Fill in the credentials below before submission/demo.

```text
User accounts:

Test Customer 1:
Name:
Email:
Password:
Phone:
User ID:

Test Customer 2:
Name:
Email:
Password:
Phone:
User ID:

Test Restaurant 1:
Restaurant Name:
Email:
Password:
Phone:
Restaurant ID:

Test Restaurant 2:
Restaurant Name:
Email:
Password:
Phone:
Restaurant ID:
```

## Demo Notes

Useful pages in the frontend:

- `/login` - login/register page for users and restaurants
- `/` - customer home page with recommendations
- `/cart` - customer cart
- `/orders` - customer order history
- `/leaderboard` - customer impact leaderboard
- `/profile` - customer profile
- `/restaurant/listings` - restaurant listing management
- `/restaurant/orders` - restaurant order view
- `/restaurant/profile` - restaurant profile
- `/restaurant/settings` - restaurant settings

Restaurant listing management supports:

- `Active`, `Expired`, and `Deleted` listing tabs
- preview-before-delete flow
- combined refund + combined notification behavior during listing deletion

## Recommendation Cache Note

The recommendation composite caches Gemini reranking results for about 5 minutes.

To bypass cache during development:

```sh
curl "http://localhost:4000/recommendations/<userId>?noCache=true"
```

Or disable cache through:

- `composite/recommendation/.env`

## Submission Notes

When submitting the project:

- include all code, Dockerfiles, configuration files, and data files required to run the system
- include this `README.md`
- submit the required `.env` files and Firebase key separately as instructed by your team/instructor
- do not include generated artifacts such as Docker images

## Troubleshooting

- If services fail at startup with Firebase file read errors, verify that `services/firebase/serviceAccountKey.json` exists and is locally available.
- If payments do not update after checkout, verify Stripe CLI is forwarding webhooks to `http://localhost:3003/payments/webhook`.
- If SMS notifications do not send, verify Twilio credentials in `services/notification/.env` and that the target phone numbers are valid.
- If recommendations fall back to simpler ranking, verify the Gemini key in `composite/recommendation/.env`.
- If listing images fail to upload, verify the AWS S3 credentials in `services/inventory/.env`.
- If inventory or reward flows fail, verify access to the external OutSystems endpoints used by those services.

## Notes On Current Behavior

- User-facing orchestration is handled by composite services.
- The delete-listing flow refunds all affected orders, combines notifications per affected customer, and restores one discount voucher when a refunded order had used one.
- Deleted listings are archived so restaurants can review them later from the `Deleted` tab.
