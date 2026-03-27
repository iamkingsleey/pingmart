# PINGMART — WhatsApp Order Bot

A production-grade WhatsApp order management system for Nigerian vendors selling physical goods, digital products, or both. Customers browse catalogs, build carts, and pay — entirely inside WhatsApp. Vendors manage products, track orders, and receive payment notifications through a REST API.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start with Docker Compose](#quick-start-with-docker-compose)
- [Manual Setup (without Docker)](#manual-setup-without-docker)
- [Environment Variables Reference](#environment-variables-reference)
- [npm Scripts Reference](#npm-scripts-reference)
- [API Endpoints Reference](#api-endpoints-reference)
- [WhatsApp Setup Guide](#whatsapp-setup-guide)
- [Paystack Setup Guide](#paystack-setup-guide)
- [Testing](#testing)

---

## Architecture Overview

```
WhatsApp Cloud API ──► POST /webhooks/whatsapp
                                │
                         Signature check (HMAC-SHA256)
                                │
                      incomingMessage.queue (Bull/Redis)
                                │
                       Conversation state machine
                        (IDLE → BROWSING → ORDERING
                         → AWAITING_ADDRESS → AWAITING_PAYMENT
                         → COMPLETED)
                                │
                    ┌───────────┴───────────┐
               Physical flow           Digital flow
               (address capture,       (instant delivery
                Paystack link)          on payment)
                                │
Paystack ──────► POST /webhooks/paystack
                        │
               payment.queue (Bull/Redis)
                        │
          ┌─────────────┴─────────────┐
     Physical order               Digital order
     (vendor notified)            (digitalDelivery.queue)
                                       │
                              Cloudinary file / URL
                              sent via WhatsApp
```

**Stack**

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+, TypeScript 5 |
| Web framework | Express 4 |
| Database | PostgreSQL 15+ via Prisma ORM |
| Queue / cache | Redis 7 + Bull |
| File storage | Cloudinary |
| Payments | Paystack |
| Messaging | WhatsApp Cloud API (Meta) |
| Validation | Zod |
| Logging | Winston |

**Key design decisions**

- All monetary values are stored in **kobo** (integer). Display in ₦ at the presentation layer.
- Phone numbers are in international format: `+2348012345678`.
- API keys are stored as **bcrypt hashes**. The raw key is shown once at registration and never again.
- Bank account numbers are encrypted at rest using **AES-256-GCM** with a 96-bit random nonce per value.
- Webhook payloads are verified via HMAC before any processing (SHA-256 for WhatsApp, SHA-512 for Paystack).
- Paystack webhook processing is idempotent — the `paymentProcessed` flag prevents double-charging.
- Bull queues decouple webhook receipt from all downstream work, so webhooks always return `200` quickly.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | 18.x | LTS recommended |
| npm | 9.x | Bundled with Node 18 |
| PostgreSQL | 15 | Any host: local, Docker, Supabase, Neon, etc. |
| Redis | 7 | Used by Bull for job queues |
| Docker + Docker Compose | 24+ | Only required for the Docker quick-start path |

External accounts required:

- **Meta Developer account** — for WhatsApp Cloud API access
- **Paystack account** — for payment processing (test keys work during development)
- **Cloudinary account** — for digital product file hosting

---

## Quick Start with Docker Compose

The `docker-compose.yml` starts **PostgreSQL 16** and **Redis 7** with persistent volumes. The application itself runs on your host machine (not inside Docker).

### 1. Clone and install

```bash
git clone <repo-url> pingmart
cd pingmart
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in every value. See [Environment Variables Reference](#environment-variables-reference) for details.

Generate the required 32-byte encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output as the value of `ENCRYPTION_KEY`.

### 3. Start infrastructure

```bash
docker compose up -d
```

Wait for both health checks to pass:

```bash
docker compose ps   # Both services should show "healthy"
```

### 4. Run database migrations

```bash
npm run migrate:dev
```

### 5. (Optional) Seed demo data

```bash
npm run seed
```

### 6. Start the development server

```bash
npm run dev
```

The server starts on `http://localhost:3000` (or the `PORT` you configured).

### 7. Expose your local server for webhooks

Meta and Paystack webhooks require a public HTTPS URL. Use ngrok or a similar tunnel:

```bash
npx ngrok http 3000
```

Copy the `https://` URL — you will need it in the WhatsApp and Paystack setup steps below.

---

## Manual Setup (without Docker)

Use this path if you already have PostgreSQL and Redis running locally or on a remote host.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Point DATABASE_URL and REDIS_URL at your instances

```
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<dbname>
REDIS_URL=redis://<host>:6379
```

### 4. Run migrations and start

```bash
npm run migrate:dev   # Creates tables and generates Prisma client
npm run dev           # Starts ts-node-dev with hot reload
```

### Production build

```bash
npm run build         # Compiles TypeScript to dist/
npm run migrate       # Runs pending migrations (deploy mode, no prompts)
npm start             # Runs compiled dist/server.js
```

---

## Environment Variables Reference

All variables are validated at startup with Zod. The process exits immediately with a clear error message if anything is missing or malformed.

### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | HTTP port the server listens on |

### Database

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Full PostgreSQL connection URL, e.g. `postgresql://user:pass@localhost:5432/pingmart` |

### Redis

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | Yes | Redis connection URL, e.g. `redis://localhost:6379` |

### WhatsApp Cloud API

All four variables come from the Meta Developer Console → Your App → WhatsApp → API Setup.

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | The numeric Phone Number ID (not the phone number itself) |
| `WHATSAPP_ACCESS_TOKEN` | Yes | Permanent or temporary system user access token |
| `WHATSAPP_APP_SECRET` | Yes | App Secret used to verify `X-Hub-Signature-256` on incoming webhooks |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Yes | Any string you choose; must match what you enter in the Meta console |

### Paystack

| Variable | Required | Description |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Yes | Must start with `sk_`. Use `sk_test_...` for development. |
| `PAYSTACK_WEBHOOK_SECRET` | Yes | Used to verify `x-paystack-signature`. Typically the same as your secret key. |

### Cloudinary

| Variable | Required | Description |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Yes | Your cloud name from the Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Yes | API key |
| `CLOUDINARY_API_SECRET` | Yes | API secret |

### Encryption

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | Yes | 64-character hex string (32 bytes). Used for AES-256-GCM encryption of bank account numbers at rest. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

> **Important:** Never commit `.env` to source control. The `.env.example` file is the reference template.

---

## npm Scripts Reference

| Script | Command | Description |
|---|---|---|
| `dev` | `ts-node-dev --respawn --transpile-only src/server.ts` | Development server with hot reload |
| `build` | `tsc --project tsconfig.json` | Compile TypeScript to `dist/` |
| `start` | `node dist/server.js` | Run the compiled production build |
| `test` | `jest --runInBand --forceExit` | Run all tests once |
| `test:watch` | `jest --watch --runInBand` | Run tests in watch mode |
| `test:coverage` | `jest --coverage --runInBand --forceExit` | Run tests and generate coverage report |
| `migrate` | `prisma migrate deploy` | Apply pending migrations (production — no prompts) |
| `migrate:dev` | `prisma migrate dev` | Apply migrations and generate client (development) |
| `migrate:reset` | `prisma migrate reset --force` | Drop and recreate the database (destructive) |
| `generate` | `prisma generate` | Re-generate the Prisma client after schema changes |
| `seed` | `ts-node prisma/seed.ts` | Seed the database with demo data |
| `studio` | `prisma studio` | Open Prisma Studio (visual DB browser) at `http://localhost:5555` |
| `lint` | `eslint src --ext .ts` | Run ESLint on all TypeScript source files |
| `typecheck` | `tsc --noEmit` | Type-check without emitting files |

---

## API Endpoints Reference

Base path: `http://localhost:3000`

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ status: "ok", timestamp }` |

### Vendor Registration and Profile

Authentication uses the `x-api-key` header with the raw API key returned at registration.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/vendors` | None | Register a new vendor. Returns vendor object + raw API key (shown once). |
| `GET` | `/api/vendors/:id` | API key | Get vendor profile. `bankAccountNumber` is returned decrypted. |
| `PATCH` | `/api/vendors/:id` | API key | Update vendor profile fields. `bankAccountNumber` is encrypted before saving. |

**POST /api/vendors — request body**

```json
{
  "businessName": "Mama's Kitchen",
  "whatsappNumber": "+2348012345678",
  "phoneNumber": "+2348012345678",
  "vendorType": "PHYSICAL_GOODS"
}
```

`vendorType` options: `PHYSICAL_GOODS`, `DIGITAL_PRODUCTS`, `HYBRID`

**PATCH /api/vendors/:id — request body (all fields optional)**

```json
{
  "businessName": "Mama's Kitchen Updated",
  "phoneNumber": "+2348087654321",
  "isActive": true,
  "bankAccountNumber": "0123456789"
}
```

### Product Management

All product routes require the API key of the owning vendor.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/vendors/:vendorId/products` | API key | List all products for a vendor |
| `POST` | `/api/vendors/:vendorId/products` | API key | Add a new product (supports `multipart/form-data` for digital file upload) |
| `PATCH` | `/api/vendors/:vendorId/products/:productId` | API key | Update a product |
| `DELETE` | `/api/vendors/:vendorId/products/:productId` | API key | Delete a product |
| `POST` | `/api/vendors/:vendorId/products/cover` | API key | Upload a cover image for a product |

**POST /api/vendors/:vendorId/products — JSON body (physical product)**

```json
{
  "name": "Jollof Rice (Party Pack)",
  "description": "Feeds 10–12 people",
  "price": 1500000,
  "category": "Food",
  "productType": "PHYSICAL",
  "stockCount": 50
}
```

**POST /api/vendors/:vendorId/products — multipart body (digital product with file)**

Send as `multipart/form-data`. Include the file under the field name `file`. Other fields as form fields:

```
name=Python Masterclass
price=2500000
productType=DIGITAL
deliveryType=FILE
deliveryMessage=Welcome! Here is your course download link.
```

**POST /api/vendors/:vendorId/products — JSON body (digital product with link)**

```json
{
  "name": "Canva Business Templates",
  "price": 500000,
  "productType": "DIGITAL",
  "deliveryType": "LINK",
  "deliveryContent": "https://drive.google.com/...",
  "deliveryMessage": "Your templates are ready. Enjoy!"
}
```

> All prices are in **kobo**. ₦15,000 = `1500000`.

### Order Management

| Method | Path | Auth | Query params | Description |
|---|---|---|---|---|
| `GET` | `/api/vendors/:vendorId/orders` | API key | `status`, `orderType`, `dateFrom`, `dateTo`, `page`, `limit` | Paginated order list |
| `GET` | `/api/vendors/:vendorId/orders/:orderId` | API key | — | Single order with full detail |

`status` values: `PENDING_PAYMENT`, `PAYMENT_CONFIRMED`, `CONFIRMED`, `PREPARING`, `READY`, `DELIVERED`, `DIGITAL_SENT`, `CANCELLED`

### Webhooks

| Method | Path | Description |
|---|---|---|
| `GET` | `/webhooks/whatsapp` | Meta hub.challenge verification (no signature required) |
| `POST` | `/webhooks/whatsapp` | Incoming WhatsApp messages (requires valid `X-Hub-Signature-256`) |
| `POST` | `/webhooks/paystack` | Paystack payment events (requires valid `x-paystack-signature`) |

Webhook endpoints are rate-limited to 200 requests per minute per IP.

### Response format

All API responses follow a consistent envelope:

**Success**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Vendor not found"
  }
}
```

---

## WhatsApp Setup Guide

### 1. Create a Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com) and create a new app.
2. Select **Business** as the app type.
3. Add the **WhatsApp** product to your app.

### 2. Get your credentials

In **WhatsApp → API Setup**:

- Copy **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- Copy the **temporary access token** (or generate a permanent system user token) → `WHATSAPP_ACCESS_TOKEN`

In **App Settings → Basic**:

- Copy **App Secret** → `WHATSAPP_APP_SECRET`

### 3. Configure the webhook

1. In **WhatsApp → Configuration**, click **Edit** next to Webhooks.
2. Set **Callback URL** to `https://<your-public-url>/webhooks/whatsapp`
3. Set **Verify Token** to the same string you put in `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. Click **Verify and Save** — your server must be running and publicly accessible at this point.
5. Subscribe to the **messages** field.

### 4. Send a test message

Use the WhatsApp API Setup page to send a test message to your test number. You should see it processed in your server logs.

### Conversation flow

Customers interact with the bot by messaging your WhatsApp Business number:

1. Any message starts a session and shows the catalog.
2. Customers tap numbered buttons to select products and quantities.
3. Physical orders: the bot asks for a delivery address, then sends a Paystack payment link.
4. Digital orders: the bot sends the payment link directly. On payment, the file/link is delivered automatically.
5. The session expires after 30 minutes of inactivity.

---

## Paystack Setup Guide

### 1. Get your API keys

1. Log into your [Paystack dashboard](https://dashboard.paystack.com).
2. Go to **Settings → API Keys & Webhooks**.
3. Copy your **Secret Key** (use `sk_test_...` for development) → `PAYSTACK_SECRET_KEY`

### 2. Configure the webhook

1. On the same Settings page, set **Webhook URL** to `https://<your-public-url>/webhooks/paystack`
2. Save. Paystack will send `charge.success` events to this URL when payments complete.

> **PAYSTACK_WEBHOOK_SECRET:** Paystack signs webhooks using your secret key as the HMAC-SHA512 secret. Set `PAYSTACK_WEBHOOK_SECRET` to the same value as `PAYSTACK_SECRET_KEY` unless you have configured a separate webhook secret.

### 3. Test payments

Use Paystack's [test card numbers](https://paystack.com/docs/payments/test-payments/) to simulate successful and failed payments in development. Paystack will fire the webhook to your ngrok URL.

---

## Testing

### Run all tests

```bash
npm test
```

### Watch mode (re-runs on file change)

```bash
npm run test:watch
```

### Coverage report

```bash
npm run test:coverage
```

Coverage output is written to `coverage/` and a summary is printed to the terminal.

### Test structure

```
src/tests/
  setup.ts                          — Jest global setup (env mocks, DB teardown)
  unit/
    stateMachine.test.ts            — Conversation state machine transitions
    webhookSignature.test.ts        — HMAC signature verification (WhatsApp + Paystack)
    formatters.test.ts              — Price and phone number formatting utilities
  integration/
    orderFlow.test.ts               — Full order lifecycle (browse → cart → payment)
    duplicateWebhook.test.ts        — Idempotent webhook processing
```

Tests use an isolated test database. Set `DATABASE_URL` in your `.env` (or a `.env.test`) to a separate test database to avoid affecting development data.

### Typecheck without running tests

```bash
npm run typecheck
```

---

## Security Notes

- **API keys** are bcrypt-hashed (10 rounds) before storage. The raw key is never logged.
- **Bank account numbers** are AES-256-GCM encrypted at rest. The encrypted format is `iv_hex:authTag_hex:ciphertext_hex`. The GCM authentication tag prevents silent tampering.
- **Webhook signatures** are verified using `crypto.timingSafeEqual` to prevent timing attacks.
- **Helmet** is applied to set secure HTTP headers on all responses.
- **Rate limiting** is applied globally (60 req/min) and more aggressively on webhook endpoints (200 req/min).
- Rotate `ENCRYPTION_KEY` carefully — existing encrypted values cannot be decrypted with a different key without a migration step.
