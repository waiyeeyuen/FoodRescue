# Composite / Orchestrator Microservices

## Get Food Recommendation (Scenario 3)

Service: `composite/recommendation` (default port `4000`)

- `GET /health`
- `GET /recommendations/:userId`
  - Calls:
    - Order: `GET /orders/customer/:userId/history?limit=20`
    - Inventory: `GET /inventory/active` (optional, `includeActive=1`)
    - Reward: `GET /reward/eligibility/:userId`
  - Query params:
    - `includeActive=1|0` (default `1`)
    - `maxListings=20` (default `20`)
    - `maxSignals=5` (default `5`)
    - `listingIds=<csv>` (optional; filters inventory results before scoring)

