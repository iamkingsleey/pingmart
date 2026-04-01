# Pingmart — Features Document

> Last updated: April 2026
> This document tracks all features built, in progress, and planned for Pingmart.
> Update this file every time a new feature is built or a significant change is made.

---

## Table of Contents

1. [Core Platform](#core-platform)
2. [Vendor Features](#vendor-features)
3. [Customer Features](#customer-features)
4. [Payment Infrastructure](#payment-infrastructure)
5. [Intelligence Layer](#intelligence-layer)
6. [Support Mode](#support-mode)
7. [Infrastructure & Security](#infrastructure--security)
8. [In Progress](#in-progress)
9. [Planned / Roadmap](#planned--roadmap)

---

## Core Platform

### Multi-Vendor Architecture
**Status:** ✅ Built

Single Pingmart WhatsApp number hosts unlimited vendor stores. Each vendor is isolated by a unique store code. Customers reach any vendor by sending their store code to the Pingmart number.

- Vendor isolation: all queries scoped to `vendorId`
- Store codes: uppercase, alphanumeric, max 8 characters (e.g. `FRESHY_NG`)
- Deep link format: `wa.me/{E164_WITHOUT_PLUS}?text={STORECODE}`

---

### Language Selection
**Status:** ✅ Built

First interaction for every new phone number — vendor or customer — before any other flow begins. Presented as a WhatsApp interactive list message.

Supported languages:
- 🇬🇧 English
- 🇳🇬 Nigerian Pidgin
- Igbo
- Yoruba
- Hausa

Language preference is saved to the user's session and persists across store switches. User is never asked again unless they request a change.

---

### Webhook Handler
**Status:** ✅ Built

- GET verification handler: validates `hub.mode`, `hub.verify_token`, `hub.challenge`
- POST handler: responds 200 immediately, then enqueues message — never processes synchronously
- Redis deduplication: `redis.set(msg:${message.id}, '1', 'EX', 86400, 'NX')` prevents duplicate processing
- Handles all three incoming message types: `text`, `interactive.list_reply`, `interactive.button_reply`

---

### Interactive Message Support
**Status:** ✅ Built

All user-facing choices use WhatsApp native interactive elements — never plain text numbered lists.

- **Reply Buttons**: used for 2–3 option choices
- **List Messages**: used for 4+ options (language selection, categories, dashboard menu)
- Incoming interactive responses parsed from `message.interactive.list_reply` and `message.interactive.button_reply`
- Fallback: if user types instead of tapping, LLM understands the intent

---

### State Machine & Session Management
**Status:** ✅ Built

- Every session has a `role` field: `vendor` or `customer`
- Role is set when flow is determined — vendor onboarding vs customer store code entry
- Session stores: `role`, `vendorId`, `storeCode`, `language`, `currentState`, `cart`
- Store switching: sending a new store code always wins — bot switches context, clears cart, preserves language
- Redis used for session storage with appropriate TTL

---

### Store Switching
**Status:** ✅ Built

When a returning customer sends a new store code:
- Store code detection runs before any session state routing
- If new code differs from current `session.vendorId` → switch context
- Old cart is cleared, language is preserved
- Customer sees the new store's welcome message

---

### Role Conflict Handling
**Status:** ✅ Built

A vendor's phone number can also be used as a customer on other stores.

- If a vendor sends their own store code → routed to vendor dashboard
- If a vendor sends a different store's code → routed as a customer to that store
- Vendor dashboard only triggers when no store code context exists

---

## Vendor Features

### Vendor Onboarding Flow
**Status:** ✅ Built

Fully conversational onboarding over WhatsApp. No app, no website, no technical knowledge needed.

Steps:
1. Language selection
2. Intent selection: "Sell on Pingmart" / "Shop from a store"
3. Business name → auto-generates store code
4. Business category (interactive list)
5. Business hours
6. Product/service catalogue setup
7. Payment method selection
8. Store confirmation and go-live

LLM handles all inputs naturally — vendor can type in any format and the bot understands.

---

### Product Catalogue Management
**Status:** ✅ Built

Vendors add products in any of the following formats:

- **Structured**: `CeraVe Foaming Cleanser | ₦21,500 | Cleanser`
- **Natural language**: "I have CeraVe cleanser, it goes for 21500, it's a cleanser"
- **Bulk**: multiple products pasted at once, one per line
- **Pidgin**: "I get one thing wey dey go for 9000"

Price parser normalises: strips ₦ symbol, commas, whitespace before parsing. Handles `k` for thousands.

LLM extracts: product name, price, category, optional description. Shows confirmation before saving.

---

### Context-Aware Vocabulary
**Status:** ✅ Built

Business category determines language used throughout the session:

| Category | Vocabulary |
|---|---|
| Food & Drink | Menu, Order, Dish |
| Fashion, Clothing | Catalogue, Collection, Piece |
| Beauty & Skincare | Catalogue, Product |
| Electronics | Products, Store, Device |
| Books, Digital | Catalogue, Library, Product |
| Furniture | Catalogue, Showroom, Piece |
| General | Catalogue, Store, Product |

Applied consistently to all messages, buttons, and prompts in the session.

---

### Product Listing Options
**Status:** ✅ Built

Three methods offered to vendors for adding products:

1. **Type products** — natural language or pipe-separated format
2. **Share Google Sheet link** — bot fetches sheet and auto-imports rows
3. **Send product photos** — vendor sends images with captions, LLM extracts details

---

### Product Images
**Status:** ✅ Built

- Vendors can attach images to products by sending WhatsApp image messages during setup
- Images stored as media URLs in the product record
- For book stores: Open Library API and Google Books API auto-fetch cover image, author, description, and ISBN by title
- Customers see product images when browsing

---

### Vendor Dashboard (Product Store)
**Status:** ✅ Built

Accessible anytime by messaging the bot from the vendor's registered number (with no store code). Presented as an interactive list message.

Options:
- 📦 Add / Remove / Update Products
- 📋 View Orders — with short-ID detail lookup
- 🔗 My Link
- ⏸️ Pause / Resume Store
- 🔔 Notification Numbers
- 🧠 Teach Bot
- ⚙️ Settings

---

### Vendor Dashboard (Support Mode)
**Status:** ✅ Built

Separate dashboard for service-based vendors with Support Mode active.

Options:
- 📅 My Bookings / All Bookings — view pending and historical bookings
- Status updates: `CONFIRM_BK`, `START_BK`, `READY_BK`, `DONE_BK`, `CANCEL_BK` + 6-char booking ID
- 🛠️ My Services — view service list
- ➕ Add Service — add a new service via natural language or pipe format
- 🧠 Add FAQ — teach the bot a new Q&A pair
- 🔗 My Link — shareable store deep-link
- ⏸️ Pause / Resume Store

---

### Business Hours Management
**Status:** ✅ Built

- Vendor sets operating days and hours during onboarding
- All times handled in Africa/Lagos timezone
- Outside hours: bot shows a soft closed notice but continues full shopping flow
- Order confirmation outside hours includes: "vendor will attend when they resume"
- Vendor notification flagged as received outside hours

---

### Multi-Staff Notifications
**Status:** ✅ Built (Growth/Pro plan)

Vendor can register multiple WhatsApp numbers to receive order notifications. All registered numbers get notified on every new order.

---

## Customer Features

### Customer Shopping Flow
**Status:** ✅ Built

Full end-to-end journey:

1. Customer taps store link or types store code
2. Language selection (shows store name in welcome)
3. Store welcome: name, description, hours, payment method
4. Browse catalogue / search product
5. Natural language ordering ("I wan get the CeraVe and the niacinamide")
6. Quantity selection
7. Special instructions (context-aware examples based on product category)
8. Cart review with interactive buttons
9. Delivery selection: Home Delivery or Pickup
10. Payment details shown
11. Order confirmation with order ID

---

### Natural Language Ordering
**Status:** ✅ Built

Customers can order in any format or language:
- "I want 2 CeraVe and 1 niacinamide"
- "I wan get the blue shirt for my size L"
- "Give me number 3 and number 5"

LLM extracts product references, quantities, and variants. Confirms what it understood before adding to cart.

---

### Context-Aware Special Instructions
**Status:** ✅ Built

Example hints for special instructions adapt to the product category:

| Category | Example shown |
|---|---|
| Clothing/Fashion | "e.g. size L, colour blue, monogram initials" |
| Food | "e.g. extra spicy, no onions, pack separately" |
| Skincare/Beauty | "e.g. gift wrap, include receipt, fragrance-free" |
| Electronics | "e.g. include charger, Nigerian plug type" |
| Books | "e.g. hardcover preferred, gift wrap" |

---

### Delivery Options
**Status:** ✅ Built

- **Home Delivery**: customer provides address
- **Pickup at Location**: vendor's pickup locations shown, customer selects nearest
- Nearest pickup recommendation uses Haversine formula on vendor-supplied coordinates
- Fallback to city/state matching if coordinates unavailable

---

### Shopping Outside Business Hours
**Status:** ✅ Built

Business hours do not block shopping. When store is closed:
- Soft notice shown at top of store welcome
- Full shopping flow continues as normal
- Order confirmation tells customer vendor will attend when they resume
- Vendor notification flagged as outside-hours order

---

### Order Status & Tracking
**Status:** ✅ Built

- Customer can ask "how do I track my order?" at any point
- Bot responds with last order reference and vendor contact context
- Explains vendor manages delivery and will reach out directly
- Offer to escalate if no response within 24 hours

---

### Context Awareness
**Status:** ✅ Built

LLM intent classification runs on every customer message before any flow routing. Handles:

- `TRACK_ORDER` → delivery tracking response
- `ORDER_STATUS` → last order details
- `CANCEL_ORDER` → cancellation flow
- `SPEAK_TO_VENDOR` → escalation
- `HELP` → help menu
- `BROWSE / VIEW_MENU` → show store catalogue

Natural language questions are never ignored in favour of showing a menu.

---

## Payment Infrastructure

### Bank Transfer Payments
**Status:** ✅ Built

- Vendor's bank details shown to customer at checkout
- Customer confirms payment manually
- Vendor notified to verify and confirm

---

### Paystack Pay with Transfer
**Status:** ✅ Built

- Unique virtual account generated per order
- Customer transfers exact amount
- Paystack webhook auto-confirms on successful transfer
- Eliminates manual vendor confirmation
- Webhook signature verified using HMAC SHA-512
- All sensitive payment data encrypted with AES-256-GCM

---

### Order Notifications
**Status:** ✅ Built

Vendor receives full order details on WhatsApp immediately on new order:
- Customer phone number (for fulfillment)
- All items and quantities
- Total amount
- Delivery address or pickup choice
- Payment method
- Outside-hours flag if applicable

---

## Intelligence Layer

### LLM Intent Classification
**Status:** ✅ Built

Claude Haiku API used for intent detection. Runs on every incoming message before any flow routing. Detects:
- Mid-flow intent changes (e.g. "I want to change my business name" mid-onboarding)
- Language instruction changes ("tell me in Pidgin")
- Natural language commands that bypass menu options
- Customer support intents

---

### Voice Note Transcription
**Status:** ✅ Built

Groq Whisper API transcribes voice notes to text. Transcribed text is then processed through the normal message flow.

---

### Reorder Engine
**Status:** ✅ Built

- Opt-in only — customers must explicitly subscribe
- Sends reorder reminders via approved Meta message templates
- Frequency controlled by `REORDER_DAYS_AFTER` env var (7=weekly, 14=bi-weekly, 30=monthly)
- 30-day rate limit per customer per vendor

---

## Support Mode

### Support Mode Onboarding
**Status:** ✅ Built

For service-based businesses (laundries, salons, mechanics, event planners, etc.). Triggered automatically when vendor selects a service category during the standard onboarding flow.

Service categories available: Laundry, Salon & Spa, Cleaning, Repairs, Tailoring, Logistics, Consulting, Events.

Steps:
1. **COLLECTING_INFO** (shared with product vendors) — business name, store code, hours, payment
2. **SUPPORT_ADDING_SERVICES** — vendor lists services via pipe format or natural language; LLM extracts name, price, unit, turnaround time; confirmation gate before saving
3. **SUPPORT_ADDING_FAQS** — vendor teaches the bot Q&A pairs; LLM extracts pairs from natural language; skippable
4. **PAYMENT_SETUP** (shared) — bank transfer or Paystack
5. **SUPPORT_CONFIRMATION** — summary shows services, FAQs, location type, payment; GO LIVE activates store

On activation: creates `ServiceItem` records, `SupportKnowledge` records, sets `vendor.mode = SUPPORT`.

Service location types: Fixed (customers come to vendor), Mobile (vendor comes to customer), Both.

---

### FAQ Knowledge Base
**Status:** ✅ Built

- Vendor teaches Q&A pairs during onboarding (`SUPPORT_ADDING_FAQS` step) or at any time via `ADD FAQ` from their dashboard
- Stored in `SupportKnowledge` table: `{ vendorId, question, answer }`
- Customer question flow:
  1. Match against `SupportKnowledge` using LLM (passes all FAQs + question to Claude, asks if any FAQ answers it)
  2. LLM fallback: answers from vendor's `businessContext` field if confident
  3. Escalation: notifies all vendor notification numbers with the unanswered question; tells customer team will respond

---

### Booking / Appointment Flow
**Status:** ✅ Built

Replaces cart/checkout for service businesses. Fully tracked state machine in `sessionData.supportState`.

Customer flow:
1. Welcome screen with 3 buttons: View Services / Book a Service / Ask a Question
2. Service selection from interactive list message
3. Preferred date/time — free text ("tomorrow at 10am", "any time Friday")
4. Pickup address collected if vendor offers mobile service
5. Booking confirmation preview → YES creates `Booking` record, notifies vendor via all registered notification numbers
6. Customer can check status any time via `MY BOOKINGS`

Vendor flow:
- `MY BOOKINGS` — shows pending bookings with short ID (`BK-XXXXXX`)
- Status update commands: `CONFIRM_BK`, `START_BK`, `READY_BK`, `DONE_BK`, `CANCEL_BK` + short ID
- Each status change auto-notifies the customer with a context-aware message

DB model: `Booking { vendorId, customerPhone, customerName, serviceRequested, scheduledDate, deliveryAddress, status: BookingStatus, notes }`

BookingStatus enum: `PENDING → CONFIRMED → IN_PROGRESS → READY → COMPLETED / CANCELLED`

---

### Human Handoff / Question Escalation
**Status:** ✅ Built

When a customer asks a question the bot cannot answer (no matching FAQ, LLM not confident):
- Customer is told the team has been notified and will respond
- All vendor notification numbers receive the customer's phone and exact question
- Vendor responds directly to the customer's WhatsApp number outside the bot
- No dead ends — customer always gets a response path

---

## Infrastructure & Security

### Secure Coding Standards
**Status:** ✅ Built

- All secrets stored in environment variables — never in codebase
- `maskPhone()` applied to all phone numbers in logs
- No passwords, API keys, account numbers, or decrypted data ever logged
- Parameterised queries via Prisma ORM — no raw SQL
- Input validation and output sanitisation on all endpoints

---

### Error Handling
**Status:** ✅ Built

- Stack traces never exposed to users
- Errors logged internally with structured context
- User-facing error messages always warm and actionable
- Predictable failure states with safe fallbacks

---

### Database
**Status:** ✅ Built

- PostgreSQL via Prisma ORM (Railway managed)
- All monetary values stored in kobo (integer) — never floats
- All queries scoped to `vendorId` for multi-tenant isolation
- Shared Prisma client singleton — never instantiate new `PrismaClient()` in services

---

### Queue & Caching
**Status:** ✅ Built

- Redis + Bull for async message queue processing
- Redis session store with TTL management
- Message deduplication: 24-hour TTL on processed message IDs
- Private Redis endpoint used (`redis.railway.internal`) to avoid egress fees

---

### Deployment
**Status:** ✅ Live

- Railway: Node.js app + PostgreSQL + Redis as managed services
- `NODE_ENV=production` in live environment
- Permanent System User token (never-expiring) for WhatsApp Cloud API
- Webhook verified and connected to Pingmart WhatsApp Business number

---

## In Progress

| Feature | Description | Status |
|---|---|---|
| Paystack Business Verification | Submit CAC docs to activate live Paystack account | 🔄 In Progress |
| Meta App Review | Submit app for review to move out of Development mode | 🔄 In Progress |
| Business Verification (Meta) | Submit CAC to Meta for 2,000+ conversation limit | 🔄 In Progress |

---

## Planned / Roadmap

| Feature | Description | Priority |
|---|---|---|
| Facebook Catalog Sync | Pull vendor's existing Meta/Instagram product catalog via Graph API | High |
| Pingmart Agent Program | Reseller program — agents earn % of vendor subscriptions they onboard | High |
| Broadcast Credits | Vendors pay per message to broadcast to past customers | High |
| Pingmart Verified Badge | Trust verification badge for vendor stores | Medium |
| Analytics Dashboard | Order volume, revenue, top products, customer retention per vendor | Medium |
| Market Association Deals | Bulk onboarding for whole market associations at negotiated rates | Medium |
| Logistics Integration | Partner with GIG, Kwik, Sendbox for in-bot delivery booking | Medium |
| Pingmart Wallet | Vendor earnings wallet with instant bank withdrawal | Medium |
| CSV / Bulk Import | Upload spreadsheet to import entire product catalogue at once | Medium |
| Multi-language Bot Responses | Full translations for Igbo, Yoruba, Hausa (currently English + Pidgin complete) | Medium |
| Data Insights Product | Anonymised market intelligence reports sold to FMCG brands | Long-term |
| Pingmart Pay | Own payment rails once transaction volume justifies it | Long-term |
| WhatsApp Catalog Sync | Sync Pingmart products to vendor's native WhatsApp Business catalog | Long-term |

---

*This document is maintained alongside the codebase. Every new feature built should be added here with its status, a brief description, and any important implementation notes.*
