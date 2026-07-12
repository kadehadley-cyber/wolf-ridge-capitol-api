# LUMÉRA — Exosome Skincare API & Storefront

A luxury exosome skincare brand backend built on **Cloudflare Workers** + **D1**.
It serves a branded storefront landing page and a full REST API for products,
reviews, and orders.

## Stack

- **Runtime:** Cloudflare Workers (edge serverless)
- **Database:** Cloudflare D1 (SQLite)
- **Language:** TypeScript (strict)
- **Tooling:** Wrangler

## Project layout

```
src/
  index.ts              Worker entry — wires routes to handlers
  router.ts             Tiny URLPattern router + JSON/CORS helper
  handlers/
    products.ts         Product catalog CRUD
    reviews.ts          Product reviews
    orders.ts           Order placement & fulfilment
  pages/
    landing.ts          Branded storefront (server-rendered HTML)
migrations/
  0001_create_lumera_schema.sql   Schema + seeded product catalog
```

## API

Prices are stored and returned in **cents** (a `*_formatted` string is included
for convenience).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Branded storefront landing page |
| GET | `/api/products` | List products — filters: `category`, `featured=true`, `limit`, `offset` |
| GET | `/api/products/:slug` | Product details with recent reviews + rating stats |
| POST | `/api/products` | Create a product |
| PUT | `/api/products/:slug` | Update a product |
| DELETE | `/api/products/:slug` | Delete a product |
| GET | `/api/products/:slug/reviews` | List a product's reviews |
| POST | `/api/products/:slug/reviews` | Submit a review (`rating` 1–5) |
| GET | `/api/orders` | List orders — filter by `status` |
| GET | `/api/orders/:id` | Order details with line items |
| POST | `/api/orders` | Place an order (validates product existence + stock) |
| PUT | `/api/orders/:id/status` | Update order status (`pending`/`confirmed`/`shipped`/`delivered`/`cancelled`) |

All `/api/*` responses are JSON and CORS-enabled.

### Example

```bash
# List featured products
curl https://<your-worker-url>/api/products?featured=true

# Place an order
curl -X POST https://<your-worker-url>/api/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_name": "Ada Lovelace",
    "customer_email": "ada@example.com",
    "shipping_address": "1 Analytical Way",
    "city": "London", "state": "LDN", "zip": "EC1",
    "items": [{ "product_id": 1, "quantity": 2 }]
  }'
```

## Local development

```bash
npm install
npm run dev      # applies migrations to a local D1, then starts wrangler dev
```

## Deploy

Point the `DB` binding in `wrangler.json` at your own D1 database
(`wrangler d1 create lumera-db`, then update `database_id`), then:

```bash
npm run deploy   # runs migrations against remote D1 (predeploy) and deploys
```
