# Docker setup

This repo is a multi-service Node.js app (atomic services under `services/` and composite services under `composite/`).

## Prereqs

- Docker Desktop (or Docker Engine) with Compose v2
- Stripe CLI (optional, for webhook forwarding)

## Required local files

- `services/firebase/serviceAccountKey.json` (Firebase Admin service account)
- Service `.env` files (already present in this repo, but **do not commit secrets**):
  - `services/payment/.env`
  - `services/notification/.env`
  - `services/inventory/.env`
  - `composite/place-order/.env`
  - `composite/recommendation/.env`

## Run everything

From the repo root:

```sh
docker compose up --build
```

Endpoints:

- Frontend: `http://localhost:5173`
- Kong (API gateway): `http://localhost:8000`
- RabbitMQ UI: `http://localhost:15672` (guest/guest)

## Stripe webhooks (local)

Keep Stripe CLI on your host (not in Docker) and forward to the payment container:

```sh
stripe listen --forward-to http://localhost:3003/payments/webhook
```

Make sure `STRIPE_WEBHOOK_SECRET` in `services/payment/.env` matches the `whsec_...` shown by `stripe listen`.

