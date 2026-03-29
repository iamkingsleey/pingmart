# PINGMART BUILD SPECIFICATION
### WhatsApp-Powered Multi-Vendor Commerce Platform for Nigerian Businesses

**Version:** 2.0
**Status:** Active Development
**Last Updated:** March 2026

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Tweet Feedback — Real Pain Points This Solves](#2-tweet-feedback--real-pain-points-this-solves)
3. [Bot Personality & Agentic Philosophy](#3-bot-personality--agentic-philosophy)
4. [Architecture Overview](#4-architecture-overview)
5. [Database Strategy](#5-database-strategy)
6. [Phase 1 — Multi-Tenant Database Schema](#6-phase-1--multi-tenant-database-schema)
7. [Phase 2 — Single Number Webhook Routing](#7-phase-2--single-number-webhook-routing)
8. [Phase 3 — Vendor Onboarding Flow (LLM-Powered)](#8-phase-3--vendor-onboarding-flow-llm-powered)
9. [Phase 4 — Customer Shopping Flow](#9-phase-4--customer-shopping-flow)
10. [Phase 5 — Vendor Management Commands](#10-phase-5--vendor-management-commands)
11. [Phase 6 — Multi-Number Notifications & Subscription Tiers](#11-phase-6--multi-number-notifications--subscription-tiers)
12. [Phase 7 — Bot Intelligence (Vendor Context Training)](#12-phase-7--bot-intelligence-vendor-context-training)
13. [Phase 8 — Human Escalation & Handover](#13-phase-8--human-escalation--handover)
14. [Phase 9 — Data Migration](#14-phase-9--data-migration)
15. [Future Module — Pingmart Support](#15-future-module--pingmart-support)
16. [Environment Variables](#16-environment-variables)
17. [Testing Checklist](#17-testing-checklist)

---

## 1. Product Vision

Pingmart is a WhatsApp-native commerce platform that lets Nigerian vendors run their entire business through WhatsApp — no website, no app, no technical knowledge required.

**One Pingmart number powers everything:**
- Vendors set up and manage their store by chatting with the bot
- Customers shop from any vendor using a unique store link
- Orders, payments, and notifications all happen inside WhatsApp

**Business Model:** SaaS subscription — vendors pay monthly to keep their store live on the platform.

---

## 2. Tweet Feedback — Real Pain Points This Solves

> **Reference label:** *Tweet Feedback*
> This section documents validated real-world pain points from Nigerian Twitter/X about WhatsApp-based commerce. Every feature in this spec should trace back to at least one of these problems. When the team debates a feature, ask: "Does this solve a Tweet Feedback pain point?"

---

### For Vendors (The People Running WhatsApp Stores)

**Pain Point 1 — Chat Overload & Lost Orders**
Repetitive questions ("How much?", "You get size 8?", "When you dey deliver?") bury real orders in chat history. Payments are scattered, inventory is guesswork, and orders literally disappear in the chat.

*Pingmart fix:* Bot handles ALL repetitive questions automatically. Every order is captured, timestamped, and stored. Nothing gets lost.

---

**Pain Point 2 — Scaling Nightmare**
At just 30–40 orders a day, solo founders drown. Many Lagos businesses now hire dedicated "WhatsApp Order Manager" staff — a full-time job just answering chats, chasing payments, and coordinating riders.

*Pingmart fix:* Bot scales infinitely. 300 orders a day costs the same as 3. Multi-number notifications mean the whole team stays in the loop without stepping on each other.

---

**Pain Point 3 — Off-Hours Burnout**
Messages come in 24/7. Missing one means lost sales or angry customers. Vendors feel like "therapist + escrow + logistics person" all in one.

*Pingmart fix:* Working hours awareness — bot handles off-hours messages gracefully, queues them, and notifies vendor at opening time. Vendor sleeps. Bot works.

---

### For Customers (The People Buying)

**Pain Point 4 — Slow or No Replies (The #1 Complaint)**
Customer orders via WhatsApp, gets ghosted, waits hours, gets wrong item, no follow-up. Called "shege" by Nigerian Twitter.

*Pingmart fix:* Instant automated responses 24/7. Order confirmation sent immediately. No ghosting. No waiting.

---

**Pain Point 5 — No Tracking, No Trust**
No order confirmation, no status updates, no easy way to check "where is my order?" Customers call multiple times or switch vendors entirely.

*Pingmart fix:* Real-time status updates at every stage (CONFIRMED → PREPARING → OUT FOR DELIVERY → DELIVERED). Customer can type ORDER STATUS anytime and get instant update.

---

**Pain Point 6 — Chaotic, Unprofessional Experience**
Even when businesses use WhatsApp Catalogs, the actual order process feels messy and untrustworthy.

*Pingmart fix:* Structured, beautiful ordering flow that feels like a premium experience — without leaving WhatsApp.

---

### About Chatbots Specifically

**Pain Point 7 — Rigid Bots That Loop Forever**
When businesses try chatbots, customers complain: "I just want to speak to a human!" Bots with rigid menus, no escalation path, and zero personality get dragged publicly.

*Pingmart fix:* This is the most critical one. See Section 3 — Bot Personality & Agentic Philosophy. The Pingmart bot must NEVER feel like a rigid menu system. It must feel like chatting with a brilliant, warm, knowledgeable person.

---

### Opportunities These Pain Points Create for Pingmart

| Pain Point | Pingmart Feature |
|---|---|
| Lost orders | Auto-capture every order in database |
| Scattered payments | Paystack link + bank transfer with proof |
| Repetitive questions | LLM-powered FAQ via vendor context training |
| No order tracking | ORDER STATUS command + vendor status updates |
| Team coordination chaos | Multi-number notifications + double-confirm guard |
| Off-hours burnout | Working hours awareness + queued messages |
| Rigid bot experience | Agentic LLM with personality (see Section 3) |
| Scaling beyond one person | Bot handles unlimited simultaneous conversations |

---

## 3. Bot Personality & Agentic Philosophy

> **This section is as important as any technical specification.**
> The biggest risk for Pingmart is building a bot that feels like a rigid form. Based on Tweet Feedback, this is the fastest way to lose users. The bot must feel exciting, warm, and intelligent.

---

### The Golden Rule

**The customer should never feel like they are talking to a bot.**

They should feel like they are chatting with a brilliant, warm, knowledgeable friend who happens to work at the store — someone who understands them, anticipates their needs, speaks their language, and makes ordering feel effortless and even enjoyable.

---

### Personality Traits

The bot has a consistent personality across all vendor stores, but adapts its tone to match the vendor's business type:

- **Food vendors** — warm, mouth-watering, uses food emojis naturally
- **Fashion vendors** — stylish, enthusiastic, complimentary
- **Beauty vendors** — friendly, encouraging, confidence-boosting
- **Digital products** — smart, aspirational, motivating
- **General** — warm, helpful, professional

**Universal traits across all stores:**
- Speaks naturally, not like a system
- Understands Nigerian Pidgin English natively
- Uses emojis with purpose, not excessively
- Never says "Invalid input" — always guides warmly
- Celebrates the customer ("Great choice!", "You have good taste!")
- Never makes the customer feel stupid for typing something wrong
- Short, punchy responses — no walls of text

---

### What the Bot Should NEVER Say

```
❌ "Invalid input. Please select a valid option."
❌ "Your session has timed out. Please start over."
❌ "Error processing your request."
❌ "Please enter a number between 1 and 5."
❌ "I don't understand that. Please try again."
❌ "Your input was not recognised."
```

### What the Bot Should Say Instead

```
✅ "Hmm, I didn't quite catch that — did you mean [closest match]? 😊"
✅ "No worries! Type MENU to start fresh or tell me what you're looking for."
✅ "I'm not sure I understood — could you say that differently? I want to get your order right! 🙏"
✅ "Oops, something went sideways on my end. Let's try that again! Type MENU to continue."
```

---

### Agentic Behaviour Rules

The bot must behave like an intelligent agent, not a state machine. This means:

1. **Intent over keywords** — understand what the customer MEANS, not what they literally typed
2. **Context awareness** — remember what was said earlier in the conversation
3. **Proactive helpfulness** — anticipate needs (e.g. suggest a drink with a meal)
4. **Graceful recovery** — when something goes wrong, fix it naturally without exposing errors
5. **Global commands always work** — MENU, CANCEL, HELP, ORDER STATUS work from any point in the conversation, no exceptions
6. **Never trap the customer** — there is always a way out of any state
7. **Human escalation** — when a conversation is beyond the bot's ability, hand off to a human gracefully (see Phase 8)

---

### Response Length Guidelines

| Situation | Response Length |
|---|---|
| Greeting / welcome | 4–6 lines max |
| Menu display | As needed, but structured clearly |
| Confirmations | 2–3 lines |
| Error / confusion | 1–2 lines, warm and clear |
| FAQ answers | 2–4 lines |
| Order summary | Structured, no fluff |

---

### LLM Prompt Philosophy

Every LLM call for customer-facing responses must include these instructions:

```
You are a warm, intelligent Nigerian WhatsApp commerce assistant.
You speak naturally, understand Pidgin English, and make customers
feel valued and excited to order.

Never sound like a bot. Never say "invalid input."
Always find a way to help, even if the request is unclear.
Keep responses short and punchy — this is WhatsApp, not email.
Use emojis naturally, not excessively.
Celebrate good choices. Be the kind of assistant people enjoy chatting with.
```

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────┐
│           ONE PINGMART WHATSAPP NUMBER       │
└──────────────────┬──────────────────────────┘
                   │
          Message comes in
                   │
    ┌──────────────▼──────────────┐
    │      SMART ROUTER           │
    │                             │
    │  Is sender a vendor? ───────┼──► VENDOR DASHBOARD
    │                             │
    │  Is message a store code? ──┼──► CUSTOMER SHOPPING FLOW
    │                             │
    │  Is sender unknown? ────────┼──► "SHOP OR SELL?" SCREEN
    └─────────────────────────────┘
```

**Key Design Decisions:**
- One WhatsApp number handles all traffic (vendors + customers)
- Vendors are identified by their registered phone number
- Customers are routed to stores via unique store codes
- Store links are WhatsApp deep links: `wa.me/PINGNUMBER?text=STORECODE`
- All vendor setup and management happens entirely inside WhatsApp
- LLM powers natural language understanding for both vendors and customers
- **Language selection is ALWAYS the first interaction for any new user — no exceptions**

---

### Language Selection — Universal First Step

Every brand new user who messages Pingmart — whether they are a vendor setting up a store, a customer shopping, or an unknown user — must be shown the language selection screen FIRST before any other content is displayed.

**Language selection message (shown in all 5 languages simultaneously):**

```
👋 Welcome to Pingmart!

Please choose your language:
Abeg choose your language:
Họrọ asụsụ gị:
Jọwọ yan èdè rẹ:
Zaɓi harshenka:

1️⃣ English
2️⃣ Pidgin
3️⃣ Igbo
4️⃣ Yoruba
5️⃣ Hausa

Reply with a number (1-5)
```

**Rules:**
- Shown to ALL new users — vendor or customer — before ANYTHING else
- Language preference saved immediately to database on selection
- Returning users skip this entirely — their saved language is used automatically
- If user sends an invalid reply, resend the language selection in all 5 languages
- After language is selected, continue to the appropriate flow (vendor onboarding, store shopping, or shop/sell screen)
- Vendor's chosen language is used throughout their entire onboarding and management experience
- Customer's chosen language is used throughout their entire shopping experience at ALL stores
- Users can change language anytime by typing **LANGUAGE** or **CHANGE LANGUAGE**

**Confirmation messages per language after selection:**

```typescript
const LANGUAGE_CONFIRMED = {
  en:  "✅ Great! We'll chat in English. 🇳🇬",
  pid: "✅ Oya! We go yarn for Pidgin. 🇳🇬",
  ig:  "✅ Ọ dị mma! Anyị ga-asụ Igbo. 🇳🇬",
  yo:  "✅ Dáadáa! A ó sọ Yorùbá. 🇳🇬",
  ha:  "✅ Kyau! Za mu yi magana da Hausa. 🇳🇬",
};
```

**Language must be applied to:**
- All bot responses (customer-facing and vendor-facing)
- Menu displays
- Order confirmations
- Payment instructions
- Vendor notifications (vendor's own language preference)
- Error and help messages
- Onboarding questions and confirmations
- Management command responses

---

## 5. Database Strategy

### Current Build — PostgreSQL (Keep for Commerce + Order Management)

The current Pingmart build uses **PostgreSQL with Prisma ORM** and this should be maintained for the Commerce and Order Management pillars. The reasons are critical for a payments-handling platform:

- **ACID transactions** — if a payment fails halfway through, the database rolls back cleanly. No partial orders, no lost money
- **Relational integrity** — vendor → products → orders → customers are tightly linked and need referential integrity
- **Complex queries** — vendor analytics, order history, customer reporting all require relational joins that PostgreSQL handles efficiently
- **Data consistency** — two customers cannot simultaneously buy the last item in stock without one being rejected cleanly

**Do not migrate Commerce or Order Management to Firebase.** The financial risk is too high.

---

### Future — Firebase for Pingmart Support Module

When the Support module is built (see Section 15), **Firebase (Firestore) is the recommended database** for that specific module. The reasons:

- **Real-time updates** — support tickets and agent chats need live synchronisation out of the box
- **Flexible schema** — support tickets have unpredictable structures (attachments, tags, custom fields)
- **Agent dashboard** — Firebase's real-time listeners make building a live support dashboard much simpler
- **No infrastructure management** — support teams need reliability without DevOps overhead
- **Free tier is generous** — suitable for early support module traction before monetisation

The Support module will run as a **separate service** alongside the main Pingmart backend, with its own Firebase project. The two services communicate via shared customer phone number as the common identifier.

---

### Summary

| Pillar | Database | Why |
|---|---|---|
| Commerce | PostgreSQL (current) | Relational integrity, ACID transactions |
| Order Management | PostgreSQL (current) | Payment safety, complex queries |
| Support (future) | Firebase | Real-time, flexible, no infrastructure |

---

## 6. Phase 1 — Multi-Tenant Database Schema

Refactor the entire Prisma schema to support multiple vendors. Every record must be isolated per vendor. Run each migration before proceeding to the next phase.

```prisma
// ─────────────────────────────────────────
// VENDOR
// ─────────────────────────────────────────
model Vendor {
  id                    String    @id @default(cuid())
  businessName          String
  storeCode             String    @unique   // e.g. "MAMATEE" — permanent, used in deep links
  ownerPhone            String    @unique   // WhatsApp number used during setup
  ownerName             String?
  businessType          String    @default("general") // food | fashion | beauty | digital | general
  description           String?   // shown to customers on store welcome
  welcomeMessage        String?   // custom greeting for customers
  isActive              Boolean   @default(false)  // false until setup complete
  isPaused              Boolean   @default(false)  // vendor can pause/resume
  isVerified            Boolean   @default(false)  // Pingmart admin verification

  // Payment
  paystackSecretKey     String?   // encrypted at rest
  bankName              String?
  bankAccountNumber     String?   // AES-256-GCM encrypted
  bankAccountName       String?
  acceptedPayments      String    @default("both") // paystack | bank | both

  // Working hours
  workingHoursStart     String    @default("08:00")
  workingHoursEnd       String    @default("21:00")
  workingDays           String    @default("1,2,3,4,5,6")
  timezone              String    @default("Africa/Lagos")
  acceptOffHoursOrders  Boolean   @default(false)

  // Bot intelligence — vendor-provided context
  businessContext       String?   // plain text vendor feeds to educate the bot
  faqs                  String?   // JSON array of {question, answer} pairs
  specialInstructions   String?   // e.g. "We don't do deliveries after 9pm"

  // Subscription
  plan                  String    @default("free")  // free | starter | growth | pro
  subscriptionEndsAt    DateTime?

  // Timestamps
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  // Relations
  products              Product[]
  orders                Order[]
  customers             VendorCustomer[]
  sessions              ConversationSession[]
  notificationNumbers   VendorNotificationNumber[]
  setupSession          VendorSetupSession?
}

// ─────────────────────────────────────────
// PRODUCT
// ─────────────────────────────────────────
model Product {
  id           String    @id @default(cuid())
  vendorId     String
  vendor       Vendor    @relation(fields: [vendorId], references: [id])
  name         String
  description  String?
  price        Decimal
  category     String?
  isAvailable  Boolean   @default(true)
  isDigital    Boolean   @default(false)
  fileUrl      String?
  imageUrl     String?
  sortOrder    Int       @default(0)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  orderItems   OrderItem[]
}

// ─────────────────────────────────────────
// CUSTOMER
// ─────────────────────────────────────────
model Customer {
  id        String   @id @default(cuid())
  phone     String   @unique  // global across all vendors
  name      String?
  language  String   @default("en")
  createdAt DateTime @default(now())

  vendorRelations VendorCustomer[]
  sessions        ConversationSession[]
  orders          Order[]
}

// Tracks per-vendor customer relationship
model VendorCustomer {
  id            String    @id @default(cuid())
  vendorId      String
  customerId    String
  vendor        Vendor    @relation(fields: [vendorId], references: [id])
  customer      Customer  @relation(fields: [customerId], references: [id])
  totalOrders   Int       @default(0)
  lastOrderAt   DateTime?
  reorderOptOut Boolean   @default(false)
  notes         String?   // vendor can add notes about this customer

  @@unique([vendorId, customerId])
}

// ─────────────────────────────────────────
// ORDER
// ─────────────────────────────────────────
model Order {
  id              String      @id @default(cuid())
  vendorId        String
  customerId      String
  vendor          Vendor      @relation(fields: [vendorId], references: [id])
  customer        Customer    @relation(fields: [customerId], references: [id])
  status          OrderStatus @default(PENDING)
  totalAmount     Decimal
  deliveryAddress String?
  paymentMethod   String?
  paymentStatus   String      @default("pending")
  generalNotes    String?
  deliveredAt     DateTime?
  reorderSentAt   DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  items           OrderItem[]
}

model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  productId String
  order     Order   @relation(fields: [orderId], references: [id])
  product   Product @relation(fields: [productId], references: [id])
  quantity  Int
  price     Decimal
  notes     String?
}

enum OrderStatus {
  PENDING
  CONFIRMED
  PREPARING
  OUT_FOR_DELIVERY
  DELIVERED
  CANCELLED
}

// ─────────────────────────────────────────
// CONVERSATION SESSION
// ─────────────────────────────────────────
model ConversationSession {
  id                String   @id @default(cuid())
  customerId        String?
  vendorId          String?  // null when in store selection or unknown state
  customer          Customer? @relation(fields: [customerId], references: [id])
  vendor            Vendor?   @relation(fields: [vendorId], references: [id])
  state             String   @default("UNKNOWN")
  cartItems         Json     @default("[]")
  selectedProductId String?
  pendingProductId  String?
  lastMessageId     String?  // prevents duplicate processing
  language          String   @default("en")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

// ─────────────────────────────────────────
// VENDOR SETUP SESSION (onboarding progress)
// ─────────────────────────────────────────
model VendorSetupSession {
  id           String   @id @default(cuid())
  vendorId     String   @unique
  vendor       Vendor   @relation(fields: [vendorId], references: [id])
  step         String   @default("WELCOME")
  collectedData Json    @default("{}")  // stores answers as onboarding progresses
  completedAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// ─────────────────────────────────────────
// VENDOR NOTIFICATION NUMBERS
// ─────────────────────────────────────────
model VendorNotificationNumber {
  id        String   @id @default(cuid())
  vendorId  String
  vendor    Vendor   @relation(fields: [vendorId], references: [id])
  phone     String
  label     String?  // e.g. "Garki Branch", "Main Manager"
  isActive  Boolean  @default(true)
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())

  @@unique([vendorId, phone])
}
```

**Migration command:**
```bash
npx prisma migrate dev --name multi_tenant_schema
```

---

## 4. Phase 2 — Single Number Webhook Routing

All messages arrive at one Pingmart number. The router determines who is messaging and what to show them.

### Routing Logic (strict priority order)

```typescript
/**
 * Smart Router — src/services/router.service.ts
 *
 * Priority:
 * 1. Duplicate message check — ignore if already processed
 * 2. Sender is a registered vendor → vendor dashboard
 * 3. Message is a valid store code → customer shopping flow for that vendor
 * 4. Sender has an active customer session → continue that session
 * 5. Unknown sender, no store code → "shop or sell?" screen
 */
async function routeIncomingMessage(
  senderPhone: string,
  message: string,
  metaMessageId: string
): Promise<void> {

  // 1. Deduplicate
  const isDuplicate = await checkDuplicate(senderPhone, metaMessageId);
  if (isDuplicate) return;

  // 2. Check if sender is a vendor
  const vendor = await prisma.vendor.findUnique({ where: { ownerPhone: senderPhone } });
  if (vendor) {
    await handleVendorMessage(senderPhone, message, vendor);
    return;
  }

  // 3. Check if vendor also added this number as notification number
  const notificationRecord = await prisma.vendorNotificationNumber.findFirst({
    where: { phone: senderPhone, isActive: true },
    include: { vendor: true },
  });
  if (notificationRecord && !notificationRecord.isPrimary) {
    await handleVendorStaffMessage(senderPhone, message, notificationRecord.vendor);
    return;
  }

  // 4. Check if message is a valid store code
  const storeCode = message.trim().toUpperCase();
  const vendorByCode = await prisma.vendor.findUnique({
    where: { storeCode, isActive: true, isPaused: false },
  });
  if (vendorByCode) {
    await startCustomerSession(senderPhone, message, vendorByCode);
    return;
  }

  // 5. Check for active customer session
  const activeSession = await getActiveCustomerSession(senderPhone);
  if (activeSession?.vendorId) {
    await handleCustomerMessage(senderPhone, message, activeSession);
    return;
  }

  // 6. Unknown — show shop or sell screen
  await showShopOrSellScreen(senderPhone);
}
```

### Shop or Sell Screen

Only shown to completely unknown numbers with no store code:

```
👋 Welcome to *Pingmart*!

What brings you here today?

1️⃣ I want to shop from a store
2️⃣ I want to sell on Pingmart

Reply with *1* or *2*
```

If user replies **1** and has no store code:
```
To shop, you need a store link from a vendor.

Ask the vendor to share their Pingmart link with you —
it looks like this: wa.me/234XXXXXXX?text=STORECODE

Once you tap their link, you'll land directly in their store. 🛍️
```

If user replies **2** → begin vendor onboarding.

---

## 5. Phase 3 — Vendor Onboarding Flow (LLM-Powered)

### Overview

This is NOT a rigid form. The onboarding is powered by an LLM agent that holds a natural conversation with the vendor, extracts the information it needs, and guides them warmly through setup.

The LLM agent:
- Understands natural language responses (vendor doesn't need to follow exact formats)
- Handles corrections mid-flow ("Actually, change the name to...")
- Responds with warmth and personality
- Extracts structured data from conversational answers
- Detects when it has enough information to move to the next step
- Handles edge cases gracefully

### Onboarding States

```
LANGUAGE_SELECTION →  ← ALWAYS first, no exceptions
WELCOME →
COLLECTING_INFO →     ← LLM agent runs here (conversational, not rigid)
ADDING_PRODUCTS →     ← LLM agent runs here too
PAYMENT_SETUP →
CONFIRMATION →
COMPLETE
```

### Create: src/services/vendor-onboarding.service.ts

#### LANGUAGE_SELECTION State

This is the absolute first step for every new vendor. Triggered before anything else when an unknown number first messages Pingmart and selects "2" (I want to sell).

Show the universal language selection screen (defined in Architecture Overview section above). After vendor selects their language, immediately confirm in their chosen language and proceed to WELCOME.

#### WELCOME State

Triggered after language is selected. All messages from this point forward are in the vendor's chosen language:

```
🎉 Welcome to *Pingmart for Vendors*!

I'm going to help you set up your WhatsApp store in just a few minutes.
No technical knowledge needed — just answer my questions and you'll be live before you know it.

Ready? Tell me a bit about your business — what do you sell and what's your business called? 😊
```

#### COLLECTING_INFO State (LLM Agent)

This is the core of the onboarding. Instead of asking one rigid question at a time, the LLM agent engages in a natural conversation to collect all required vendor information.

**LLM System Prompt for Onboarding Agent:**

```typescript
const ONBOARDING_SYSTEM_PROMPT = `You are a friendly and warm Pingmart onboarding assistant helping a Nigerian vendor set up their WhatsApp store.

Your personality:
- Warm, encouraging, and conversational
- Use occasional Nigerian expressions naturally (e.g. "oya", "well done", "e go be") but don't overdo it
- Celebrate milestones ("Amazing! Your store is almost ready 🎉")
- Be patient with corrections and changes

Your job:
Collect the following information through natural conversation. You don't have to ask for each one separately — extract what you can from each response and only ask for what's still missing.

Required information to collect:
1. businessName — the name of their store
2. storeCode — a short unique code (4-10 alphanumeric chars, no spaces) for their store link
3. businessType — one of: food, fashion, beauty, digital, general
4. description — 1-2 sentence description of their business (for customer welcome screen)
5. workingHours — when they're open (start time, end time, which days)
6. paymentMethod — paystack, bank, or both

Already collected: {alreadyCollected}
Still needed: {stillNeeded}

After each vendor message, respond naturally AND return a JSON block at the very end of your response (hidden from display) with any new data you extracted:

<extracted>
{
  "businessName": "...",
  "storeCode": "...",
  "businessType": "...",
  "description": "...",
  "workingHoursStart": "09:00",
  "workingHoursEnd": "21:00",
  "workingDays": "1,2,3,4,5,6",
  "paymentMethod": "bank"
}
</extracted>

Only include fields you are confident about. Leave out fields you're not sure about.

If the vendor suggests a store code that might be taken, suggest alternatives.
If a response is ambiguous, ask a friendly follow-up question.
Once ALL required fields are collected, end your response with <ready_for_products/> to signal the next phase.

Important rules:
- Never make up information the vendor didn't provide
- Always confirm critical details like store code and payment method
- If vendor wants to change something already collected, update it and confirm
- Keep responses concise — vendors are on mobile`;
```

**Example Natural Onboarding Conversation:**

```
Vendor: I sell shawarma and drinks. My shop is called Mallam Suya & More

Bot: Love it! 🌯 Mallam Suya & More — great name for a food business.

Let me suggest a store code for your link. How about MALLAM or MALLAM01?
This is the short code your customers will use to find your store.

Which do you prefer, or do you have something else in mind?

---

Vendor: Use MALLAMSUYA

Bot: Perfect! MALLAMSUYA it is. ✅

Your customers will shop at:
wa.me/2348XXXXXXX?text=MALLAMSUYA

Now, when are you usually open? And do you take bank transfers,
Paystack, or both for payments?

---

Vendor: Open every day 10am to 10pm. I prefer bank transfer for now

Bot: Oya! Got everything I need. Let me confirm before we move on:

🏪 *Mallam Suya & More*
🔑 Store Code: *MALLAMSUYA*
🍽️ Type: Food & Drinks
🕐 Open: 10am – 10pm daily
💳 Payment: Bank Transfer

All good? Reply *YES* to continue or tell me what to change.
```

**Parsing extracted data:**
After each LLM response, parse the `<extracted>` block and save to `VendorSetupSession.collectedData`. When `<ready_for_products/>` appears, transition to ADDING_PRODUCTS state.

#### ADDING_PRODUCTS State (LLM Agent)

```
Bot: Now let's add your menu! 🛍️

Send your products one by one like this:
*Product name | Price | Category*

You can also add a short description if you want.

Example:
Chicken Shawarma | 2500 | Shawarma | Crispy grilled chicken wrap

Go ahead — send your first product!
(Type *DONE* when you've added everything)
```

The LLM handles flexible product formats:
- "Chicken Shawarma 2500" → extracts name and price
- "Beef wrap, 2000 naira, wrap category" → extracts all three
- "I have chicken shawarma for 2500, beef shawarma for 2000, and pepsi for 500" → extracts 3 products from one message

**LLM System Prompt for Product Extraction:**

```typescript
const PRODUCT_EXTRACTION_PROMPT = `You are helping a vendor add products to their Pingmart store.

Extract product information from the vendor's message and return structured JSON.
Handle flexible formats — vendors may send products in many ways.

Return ONLY this JSON format:
{
  "products": [
    {
      "name": "Chicken Shawarma",
      "price": 2500,
      "category": "Shawarma",
      "description": "Crispy grilled chicken wrap"
    }
  ],
  "isDone": false
}

Set isDone: true if vendor says DONE, FINISH, THAT'S ALL, or similar.
If price has "k" (e.g. "2.5k"), convert to number (2500).
If no category given, use the vendor's business type as default.
If no description given, leave as null.
Never invent information not provided by the vendor.`;
```

After each product is confirmed:
```
Bot: ✅ Added *Chicken Shawarma* — ₦2,500 to your menu!

Send another product or type *DONE* when you're finished.
(You have 3 products so far)
```

#### PAYMENT_SETUP State

**If bank transfer selected:**
```
Bot: Almost done! What are your bank details?

Send them like this:
*Bank Name | Account Number | Account Name*

Example:
GTBank | 0123456789 | Mallam Ahmed Suya
```

Validate format, encrypt account number, confirm:
```
Bot: Got it! Let me confirm:
🏦 GTBank
💳 0123456789
👤 Mallam Ahmed Suya

Is this correct? Reply *YES* or send the correct details.
```

**If Paystack selected:**
```
Bot: Please send your Paystack Secret Key.

You'll find it in Paystack Dashboard → Settings → API Keys.
It starts with *sk_live_* or *sk_test_*
```

#### CONFIRMATION State

```
Bot: 🎉 Your store is ready! Here's the summary:

━━━━━━━━━━━━━━━━━━━━
🏪 *Mallam Suya & More*
🔑 Store Code: MALLAMSUYA
🍽️ Type: Food & Drinks
📦 Products: 5 items
💳 Payment: Bank Transfer (GTBank)
🕐 Hours: 10am – 10pm daily
━━━━━━━━━━━━━━━━━━━━

Reply *GO LIVE* to activate your store
or tell me anything you'd like to change.
```

#### COMPLETE State

```
Bot: 🚀 *Mallam Suya & More* is now LIVE on Pingmart!

━━━━━━━━━━━━━━━━━━━━
🔗 *Your Store Link:*
wa.me/2348XXXXXXX?text=MALLAMSUYA

Share this link on:
📱 WhatsApp Status
📸 Instagram Bio
🖨️ Business flyers
💬 Customer groups
━━━━━━━━━━━━━━━━━━━━

When a customer taps that link, they land directly in your store —
no downloads, no sign-ups needed.

*Manage your store anytime by messaging me:*
📦 ADD PRODUCT — add new items
🗑️ REMOVE PRODUCT — remove items
💰 UPDATE PRICE — change a price
📋 MY ORDERS — view orders
⏸️ PAUSE STORE — temporarily close
🔗 MY LINK — get your store link again
🧠 TEACH BOT — add info to help me understand your business better
⚙️ SETTINGS — update store settings
```

Set `vendor.isActive = true` and `vendorSetupSession.completedAt = now()`.
Create primary `VendorNotificationNumber` record from `vendor.ownerPhone`.

---

## 6. Phase 4 — Customer Shopping Flow

### Entry Point — Via Store Link

When a customer taps `wa.me/2348XXXXXXX?text=MALLAMSUYA`, WhatsApp opens with "MALLAMSUYA" pre-filled. They hit send and the bot immediately routes to that vendor's store.

**No "shop or sell?" screen. No intermediary steps. Straight to the store.**

### New Customer Welcome

```
👋 Welcome to *Mallam Suya & More*! 🌯

Lagos' finest shawarma made fresh daily. We deliver within 30 minutes!

🕐 Open: 10am – 10pm daily

━━━━━━━━━━━━━━━━
*TODAY'S MENU*
━━━━━━━━━━━━━━━━

🌯 *Shawarma*
1. Chicken Shawarma — ₦2,500
   Crispy grilled chicken with fresh veggies

2. Beef Shawarma — ₦2,000
   Juicy beef with coleslaw and sauce

🥤 *Drinks*
3. Pepsi (Large) — ₦500
4. Water — ₦200

Reply with a *number* to order or just tell me what you want 😊
Type *0* to see this menu again anytime
```

### Returning Customer Welcome

If VendorCustomer record exists for this customer + vendor combination:

```
👋 Welcome back, Ada! Great to see you again at *Mallam Suya & More* 🌯

Your last order: 2x Chicken Shawarma (₦5,000)

Want the same again? Reply *YES* to reorder instantly
or *MENU* to browse everything 😊
```

### Language Selection — Customers

**Language selection is the FIRST thing a new customer sees — before the store welcome, before the menu, before anything.**

When a brand new customer taps a vendor's store link and sends their first message (the store code), the bot must:
1. Show the universal language selection screen immediately
2. Wait for their selection
3. Confirm in their chosen language
4. THEN show the vendor's store welcome and menu in that language

Returning customers (language already saved) skip this entirely and go straight to the store welcome.

```
Please choose your language:
Abeg choose your language:
Họrọ asụsụ gị:
Jọwọ yan èdè rẹ:
Zaɓi harshenka:

1️⃣ English
2️⃣ Pidgin
3️⃣ Igbo
4️⃣ Yoruba
5️⃣ Hausa

Reply with a number (1-5)
```

After selection, all store communications — menu, order confirmations, payment instructions, status updates — are delivered in the customer's chosen language.

The customer's language preference applies across ALL vendors on Pingmart. If they shop at a different vendor's store, the bot already knows their language.

### Customer Ordering Flow

The full customer flow powered by LLM + state machine:

```
1. LANGUAGE_SELECTION ← ALWAYS first for new customers, no exceptions
        ↓
2. BROWSING — customer sees menu, browses freely
        ↓
3. CART_BUILDING — adding items (supports multi-item, split quantities, natural language)
        ↓
4. AWAITING_ADDRESS — "What's your delivery address?"
        ↓
5. AWAITING_PAYMENT_METHOD — "How would you like to pay?"
        ↓
6. AWAITING_PAYMENT — customer pays and sends proof (bank) or completes Paystack link
        ↓
7. ORDER_CONFIRMED — vendor notified, customer gets confirmation
        ↓
8. ORDER_TRACKING — vendor sends PREPARING → DELIVERED updates
```

### Global Customer Commands (work from any state)

| Command | Action |
|---|---|
| MENU or 0 | Show menu, reset to BROWSING |
| CART | Show current cart summary |
| CANCEL | Cancel and start over |
| HELP | Show available commands |
| LANGUAGE | Change language preference |
| ORDER STATUS | Check latest order status |

### Order Notes

After quantity is set for each item:
```
Bot: ✅ 2x Chicken Shawarma added.

Any special instructions for this item?
(e.g. extra spicy, no sauce, pack separately)

Reply with your note or *SKIP*
```

### Cart Summary Before Checkout

```
🛒 *Your Cart — Mallam Suya & More*

• 2x Chicken Shawarma — ₦5,000 [extra spicy]
• 1x Pepsi (Large) — ₦500

──────────────────
Total: ₦5,500

Reply *DONE* to checkout
Add more by number or type what you want
*CLEAR* to start over
```

### Paused Store Handling

If vendor has paused their store:
```
😔 *Mallam Suya & More* is not taking orders right now.

We'll be back soon! Check back later or
message us directly for enquiries.
```

### Off-Hours Handling

If customer messages outside working hours:
```
Hi! 👋 We're currently closed.

🕐 We open at *10:00 AM* (Lagos time)

Your message has been noted — feel free to
browse our menu when we open. Type *MENU* anytime 😊
```

---

## 7. Phase 5 — Vendor Management Commands

Vendors manage their store by messaging the Pingmart number from their registered phone. The bot recognises them as a vendor and shows their dashboard.

### Vendor Dashboard (shown when vendor messages)

```
👋 Welcome back, *Mallam Suya & More*!

What would you like to do?

📦 ADD PRODUCT
🗑️ REMOVE PRODUCT
💰 UPDATE PRICE
📋 MY ORDERS
🔗 MY LINK
⏸️ PAUSE STORE / ▶️ RESUME STORE
🔔 NOTIFICATIONS — manage alert numbers
🧠 TEACH BOT — add business context
⚙️ SETTINGS
```

### Command: ADD PRODUCT

```
Vendor: ADD PRODUCT

Bot: Send your product details:
*Name | Price | Category | Description (optional)*

Example:
Pepper Soup | 2000 | Soups | Spicy catfish pepper soup

---

Vendor: Turkey Shawarma | 3500 | Shawarma

Bot: ✅ Added *Turkey Shawarma* — ₦3,500 to your menu!
Your store now has 6 products.
```

### Command: REMOVE PRODUCT

```
Vendor: REMOVE PRODUCT

Bot: Which product would you like to remove?

1. Chicken Shawarma — ₦2,500
2. Beef Shawarma — ₦2,000
3. Pepsi (Large) — ₦500
...

Reply with the product number.

---

Vendor: 3

Bot: Remove *Pepsi (Large) — ₦500*?
Reply *YES* to confirm or *NO* to cancel.
```

### Command: UPDATE PRICE

```
Vendor: UPDATE PRICE

Bot: Which product price would you like to update?
[shows product list]

---

Vendor: 1

Bot: *Chicken Shawarma* is currently ₦2,500.
What's the new price?

---

Vendor: 2800

Bot: ✅ *Chicken Shawarma* price updated from ₦2,500 to ₦2,800.
```

### Command: MY ORDERS

```
Bot: 📋 *Recent Orders — Mallam Suya & More*

#1047 — Amaka — ₦5,500 — ⏳ PENDING
#1046 — Emeka — ₦3,000 — ✅ CONFIRMED
#1045 — Fatima — ₦2,500 — 🍳 PREPARING
#1044 — Chidi  — ₦6,000 — 🚚 DELIVERED

Reply with an order number for full details.
Type *PENDING* to see only pending orders.
```

### Command: MY LINK

```
Bot: 🔗 *Your Pingmart Store Link:*

wa.me/2348XXXXXXX?text=MALLAMSUYA

Share this everywhere — customers tap it and
land directly in your store on WhatsApp! 🛍️
```

### Command: PAUSE STORE / RESUME STORE

```
Vendor: PAUSE STORE

Bot: ⏸️ *Mallam Suya & More* is now PAUSED.

Customers will see a "not taking orders" message.
Type *RESUME STORE* to go live again.
```

### Command: SETTINGS

```
Bot: ⚙️ *Store Settings — Mallam Suya & More*

What would you like to update?

1. Business name
2. Description / welcome message
3. Working hours
4. Payment method
5. Bank details
6. Change store code

Reply with a number.
```

---

## 8. Phase 6 — Multi-Number Notifications & Subscription Tiers

### Plan Limits

```typescript
export const PLAN_LIMITS = {
  free:    { notificationNumbers: 1,  products: 5   },
  starter: { notificationNumbers: 3,  products: 20  },
  growth:  { notificationNumbers: 10, products: 999 },
  pro:     { notificationNumbers: 999, products: 999 },
};

export const PLAN_PRICES = {
  free:    0,
  starter: 3000,   // ₦3,000/month
  growth:  8000,   // ₦8,000/month
  pro:     15000,  // ₦15,000/month
};
```

### Command: NOTIFICATIONS

```
Bot: 🔔 *Notification Numbers — Mallam Suya & More*

Numbers that receive order alerts:
1. +2348012345678 — Main (primary) ✅
2. +2348098765432 — Garki Branch ✅

Plan: Starter (2/3 numbers used)

Commands:
*ADD NUMBER | +234XXXXXXXXX | Label* — add a number
*REMOVE NUMBER | +234XXXXXXXXX* — remove a number

---

Vendor: ADD NUMBER | +2348055566677 | Maitama Branch

Bot: ✅ +2348055566677 (Maitama Branch) will now
receive all order alerts.

Notification numbers (3/3 on Starter plan):
• +2348012345678 — Main
• +2348098765432 — Garki Branch
• +2348055566677 — Maitama Branch

You've reached your Starter plan limit.
Upgrade to Growth to add up to 10 numbers.
Type UPGRADE for options.
```

### Order Notification to All Numbers

When an order is placed, send simultaneously to ALL active notification numbers:

```typescript
async function notifyVendorOfOrder(vendorId: string, order: Order): Promise<void> {
  const numbers = await prisma.vendorNotificationNumber.findMany({
    where: { vendorId, isActive: true },
  });

  await Promise.all(
    numbers.map(n => sendWhatsAppMessage(n.phone, buildOrderMessage(order)))
  );
}
```

### Prevent Double Confirmation

When ANY number replies CONFIRM, immediately lock the order and notify others:

```typescript
// Check if already handled
if (order.status !== 'PENDING') {
  await sendWhatsAppMessage(
    respondingPhone,
    `✅ Order #${order.id} was already confirmed by another manager.`
  );
  return;
}

// Confirm and notify others
await updateOrderStatus(order.id, 'CONFIRMED');
const others = allNumbers.filter(n => n.phone !== respondingPhone);
await Promise.all(
  others.map(n =>
    sendWhatsAppMessage(n.phone, `ℹ️ Order #${order.id} confirmed by another manager.`)
  )
);
```

---

## 9. Phase 7 — Bot Intelligence (Vendor Context Training)

Vendors can teach the bot about their business so it answers customer questions accurately. This is a major differentiator — the bot becomes smarter the more context a vendor provides.

### Command: TEACH BOT

```
Vendor: TEACH BOT

Bot: 🧠 *Teach Me About Your Business*

The more you tell me, the better I can answer
your customers' questions automatically.

You can share:
• Common customer questions and answers
• Things customers should know (e.g. no delivery after 9pm)
• Special services you offer
• Ingredients or allergen information
• Anything else about your business

Just type it naturally — I'll learn from it!
Start sharing, or type *VIEW* to see what I already know.
```

**Examples of vendor-provided context:**

```
Vendor: We use halal meat only. No pork in any of our products.
We don't deliver to the mainland, only island locations.
Minimum order for delivery is 3000 naira.
We can do bulk orders for events, contact us directly for that.

Bot: ✅ Got it! I've learned the following about your business:

• All meat is halal certified — no pork
• Delivery: Lagos Island only
• Minimum delivery order: ₦3,000
• Bulk/event orders available on request

I'll use this to answer customer questions accurately.
Keep adding more anytime — just type it out!
```

**How the bot uses this context:**

When a customer asks a question, the LLM includes the vendor's `businessContext` and `faqs` in the system prompt:

```typescript
const systemPrompt = `You are a customer service assistant for ${vendor.businessName}.

About this business:
${vendor.businessContext}

Special instructions:
${vendor.specialInstructions}

FAQs:
${vendor.faqs}

Products available:
${products.map(p => `${p.name} — ₦${p.price}`).join('\n')}

Answer the customer's question accurately using this information.
If you don't know something, say so honestly and suggest they
contact the vendor directly.`;
```

**Customer experience with vendor context:**

```
Customer: Do you use halal meat?

Bot: Yes! All our meat at Mallam Suya & More is
100% halal certified 🥩✅ No pork in any of our products.

Would you like to see our menu? 😊

---

Customer: Do you deliver to Festac?

Bot: Sorry, we currently only deliver within
Lagos Island. Festac is on the mainland so
we won't be able to reach you there.

Is there anything else I can help with? 😊
```

---

## 12. Phase 8 — Human Escalation & Handover

> **Tweet Feedback origin:** "I just want to speak to a human!" is the most common complaint about WhatsApp bots. Pingmart must always have a graceful exit to a real person.

### When to Escalate

The bot should automatically detect and escalate in these situations:

```typescript
const ESCALATION_TRIGGERS = [
  // Explicit requests
  'speak to human', 'talk to someone', 'real person', 'customer service',
  'manager', 'owner', 'complaint', 'this is wrong', 'i want to complain',

  // Frustration signals (detected by LLM sentiment)
  'this is rubbish', 'useless bot', 'nonsense', 'stupid',
  'i am angry', 'very annoyed', 'this is frustrating',

  // Confusion loops (bot failed 3 times to understand)
  // — auto-detected when LLM returns UNKNOWN intent 3x in a row

  // Complex requests bot cannot handle
  'bulk order', 'event catering', 'partnership', 'wholesale',
];
```

### Escalation Flow

**Step 1 — Bot detects escalation trigger:**
```
Bot: I completely understand — let me connect you with
the team at *Mallam Suya & More* right away. 🙏

I'm notifying them now. Someone will reply you shortly.

In the meantime, is there anything quick I can
help with while you wait? 😊
```

**Step 2 — Vendor receives escalation alert on ALL notification numbers:**
```
🚨 *CUSTOMER NEEDS ATTENTION*

Customer: Ada (+2348...)
Reason: Requested human assistance
Last message: "I want to speak to someone about my order"

Order in progress: #1047 — ₦5,500

Please reply to this customer directly on WhatsApp.
Their number: +2348XXXXXXXXX

Reply HANDLED when you've spoken to them.
```

**Step 3 — After vendor replies HANDLED:**
```
Bot sends to customer:
"The team has been notified and will reach out to you directly.
Thanks for your patience, Ada! 😊"
```

### Confusion Loop Detection

Track consecutive UNKNOWN intents per session. After 3 consecutive failures:

```typescript
if (session.consecutiveUnknownCount >= 3) {
  await triggerHumanEscalation(session, customer, vendor);
  session.consecutiveUnknownCount = 0;
}
```

Bot message on confusion loop:
```
Hmm, I'm having a bit of trouble understanding — my apologies! 😅
Let me get a real person to help you out.

Notifying the *{vendorName}* team now...
```

### ORDER STATUS Self-Service

Customers should never need to contact a human just to check their order status. This directly addresses Tweet Feedback Pain Point 5.

At any point, customer types **ORDER STATUS**:

```
Bot: 📦 *Your Latest Order — Mallam Suya & More*

Order #1047
• 2x Chicken Shawarma
• 1x Pepsi (Large)
Total: ₦5,500

Status: 🍳 *PREPARING*
Your order is being prepared right now!

We'll message you when it's on the way. 🛵
```

---

## 13. Phase 9 — Data Migration

Migrate existing single-vendor data to multi-tenant structure.

```typescript
async function migrateExistingData(): Promise<void> {
  // 1. Create Vendor record from existing .env config
  const vendor = await prisma.vendor.create({
    data: {
      businessName: process.env.VENDOR_NAME ?? 'Mama Tee\'s Kitchen',
      storeCode: 'MAMATEE',
      ownerPhone: process.env.VENDOR_WHATSAPP_NUMBER ?? '',
      businessType: 'food',
      isActive: true,
      plan: 'growth',
    },
  });

  // 2. Assign all existing products to this vendor
  await prisma.product.updateMany({
    where: { vendorId: null },
    data: { vendorId: vendor.id },
  });

  // 3. Assign all existing orders and customers to this vendor
  await prisma.order.updateMany({
    where: { vendorId: null },
    data: { vendorId: vendor.id },
  });

  // 4. Create primary notification number
  await prisma.vendorNotificationNumber.create({
    data: {
      vendorId: vendor.id,
      phone: vendor.ownerPhone,
      label: 'Main',
      isPrimary: true,
    },
  });

  console.log('✅ Migration complete — Mama Tee\'s Kitchen is now on multi-tenant schema');
}
```

Run: `npm run migrate:data` (add this as a script in package.json)

---

## 15. Future Module — Pingmart Support

> **Status:** Planned — build after Commerce + Order Management pillars are stable
> **Database:** Firebase (Firestore) — see Section 5

---

### What It Is

Pingmart Support is a standalone WhatsApp customer service platform for businesses that don't need to sell through Pingmart but need intelligent, automated WhatsApp support.

**Target customers:**
- Banks and fintechs handling account/transaction complaints
- Logistics companies managing delivery issues
- Schools handling parent and student enquiries
- Hospitals managing appointment and billing questions
- Any business whose WhatsApp support is currently manual chaos

**The core pitch:** Give every business a brilliant, always-on WhatsApp support agent — powered by AI, backed by a human team when needed.

---

### Three Core Features

**1. Knowledge Base (Train Your Bot)**
Business uploads their FAQs, policies, product docs, and procedures. The bot learns from this and answers customer questions accurately and instantly — 24/7.

```
Business trains bot with:
- FAQ documents
- Return/refund policies
- Product manuals
- Service procedures
- Common complaint resolutions

Bot handles:
- "How do I reset my PIN?"
- "Where is my delivery?"
- "What is your refund policy?"
- "My account is locked"
→ All answered instantly without a human
```

**2. Smart Ticket Management**
When a customer raises an issue, the bot creates a ticket, tracks it, and keeps the customer updated — without any human needed unless the issue escalates.

```
Customer: My transfer has been pending for 3 hours

Bot: I've created a support ticket for you 🎫

Ticket: #SUP-2047
Issue: Pending transfer
Status: Under review

We'll update you within 2 hours. You can check
your status anytime by typing: STATUS #SUP-2047
```

Ticket states:
```
OPEN → IN_PROGRESS → RESOLVED → CLOSED
```

**3. Human Agent Handover**
When the bot cannot resolve an issue, it escalates to a human agent seamlessly. The agent sees the full conversation history and picks up without the customer repeating themselves.

Agent features:
- Multiple agents can handle tickets simultaneously
- Agent claims a ticket to prevent overlap
- Customer is notified when a human takes over
- CSAT rating collected after resolution
- SLA tracking (response time targets)

---

### How a Business Onboards to Support

Same WhatsApp-first philosophy as Commerce:

```
Business messages Pingmart → selects "Support Plan" →
Bot guides through:
  1. Language selection
  2. Business name and type
  3. Upload knowledge base (FAQs, policies)
  4. Add agent numbers (who handles escalations)
  5. Set SLA targets (e.g. respond within 2 hours)
  6. Gets their unique support number/link
  7. Live
```

---

### Pricing

```
Support Starter    ₦5,000/month
├── 1 WhatsApp number
├── Unlimited bot-handled queries
├── Up to 3 human agents
├── Basic ticket tracking
└── Standard response analytics

Support Pro        ₦15,000/month
├── 1 WhatsApp number
├── Unlimited bot-handled queries
├── Unlimited human agents
├── Full ticket management + SLA tracking
├── Advanced analytics and reports
├── Priority support from Pingmart team
└── Custom bot training (Pingmart helps set up)
```

---

### Technical Architecture (Firebase)

```
Firebase Firestore Collections:
├── supportBusinesses/{businessId}
│   ├── name, phone, plan, knowledgeBase
│   └── agents: [{ phone, name, isActive }]
├── tickets/{ticketId}
│   ├── businessId, customerPhone, issue
│   ├── status, assignedAgent, createdAt
│   └── messages: [{ from, text, timestamp }]
└── customerSessions/{phone}
    ├── businessId, language, currentTicketId
    └── history: [ticketIds]
```

Real-time Firestore listeners power:
- Agent dashboard (live ticket updates)
- Customer ticket status (instant updates when agent responds)
- SLA countdown timers

---

### Integration with Commerce + Order Management

The Support module shares one common identifier with the rest of Pingmart — the customer's phone number. This means:

- A customer who shops at a vendor AND raises a support ticket is recognised as the same person
- Future: vendors on Commerce + Order Management plans can upgrade to add Support features for their own customers
- The `businessContext` and `TEACH BOT` features already built in Phase 7 are the direct foundation of the Support knowledge base

---

### Build This After

- Pingmart Commerce is live with at least 10 active vendors
- Order Management is stable with real transactions flowing
- Human escalation (Phase 8) is fully tested — that feature is the seed of the Support module

---

## 16. Environment Variables

Update `.env` with all required variables:

```env
# ─────────────────────────────────────
# WHATSAPP (Meta)
# ─────────────────────────────────────
WHATSAPP_ACCESS_TOKEN=           # permanent token from Meta
WHATSAPP_PHONE_NUMBER_ID=        # the one Pingmart number
WHATSAPP_BUSINESS_ACCOUNT_ID=
WEBHOOK_VERIFY_TOKEN=
PINGMART_PHONE_NUMBER=234XXXXXXXXXX  # actual phone number (for deep links)

# ─────────────────────────────────────
# PLATFORM
# ─────────────────────────────────────
PINGMART_ADMIN_PHONE=234XXXXXXXXXX   # your personal number — super admin access
PLATFORM_NAME=Pingmart

# ─────────────────────────────────────
# AI
# ─────────────────────────────────────
ANTHROPIC_API_KEY=               # Claude API — NLU + onboarding agent
ANTHROPIC_MODEL=claude-haiku-4-5
GROQ_API_KEY=                    # Groq Whisper — voice note transcription

# ─────────────────────────────────────
# DATABASE & CACHE
# ─────────────────────────────────────
DATABASE_URL=
REDIS_URL=

# ─────────────────────────────────────
# STORAGE
# ─────────────────────────────────────
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# ─────────────────────────────────────
# ENCRYPTION
# ─────────────────────────────────────
ENCRYPTION_KEY=                  # 32-byte key for AES-256-GCM

# ─────────────────────────────────────
# SERVER
# ─────────────────────────────────────
PORT=3000
NODE_ENV=development

# ─────────────────────────────────────
# RE-ORDER ENGINE
# ─────────────────────────────────────
REORDER_DAYS_AFTER=7
```

---

## 17. Testing Checklist

Work through these tests in order after each phase is complete.

### Phase 1 — Database
- [ ] Migration runs without errors
- [ ] All models created correctly in database
- [ ] Existing data preserved

### Phase 2 — Routing & Language Selection
- [ ] Every brand new number — vendor or customer — sees language selection FIRST
- [ ] Language selection shown in all 5 languages simultaneously
- [ ] Invalid language reply (e.g. "6") resends the selection screen
- [ ] Language confirmed in chosen language after selection
- [ ] Language preference saved to database immediately
- [ ] Returning user skips language selection — saved language used
- [ ] LANGUAGE command changes preference from any state
- [ ] Language applies to ALL bot messages — menus, confirmations, errors
- [ ] Unknown number gets "shop or sell?" screen (after language selection)
- [ ] Registered vendor number gets vendor dashboard (in their saved language)
- [ ] Valid store code routes to correct vendor store (in customer's saved language)
- [ ] Active customer session continues correctly
- [ ] Duplicate message guard works (same message ID ignored)

### Phase 3 — Vendor Onboarding
- [ ] New number replies "2" → onboarding begins
- [ ] Natural language responses are understood (not rigid format)
- [ ] "My shop is called Jide Burgers and I sell burgers and fries" → extracts name + type
- [ ] Store code uniqueness is validated
- [ ] "Actually change the name to Jide's Burgers" → correction handled
- [ ] Products can be added one by one
- [ ] Multiple products in one message extracted correctly
- [ ] Bank details encrypted and stored securely
- [ ] CONFIRMATION screen shows correct summary
- [ ] GO LIVE sets vendor.isActive = true
- [ ] Completion message includes correct store link
- [ ] Primary notification number created automatically

### Phase 4 — Customer Flow
- [ ] Tapping store link (wa.me...?text=STORECODE) routes to correct vendor
- [ ] New customer sees language selection
- [ ] Returning customer sees personalised greeting with last order
- [ ] Natural language ordering works ("I want jollof rice")
- [ ] Multi-item ordering works ("3, 4, 5" adds all three)
- [ ] Split quantity works ("2 jollof and 1 chicken")
- [ ] Order notes captured correctly
- [ ] Cart summary accurate before checkout
- [ ] Vendor notification sent on order completion
- [ ] Paused store shows correct message
- [ ] Off-hours message shows correct opening time

### Phase 5 — Vendor Management
- [ ] ADD PRODUCT adds to correct vendor's menu
- [ ] REMOVE PRODUCT removes correctly
- [ ] UPDATE PRICE updates correctly
- [ ] MY ORDERS shows only this vendor's orders
- [ ] PAUSE STORE hides store from customers
- [ ] RESUME STORE restores access
- [ ] MY LINK returns correct deep link
- [ ] SETTINGS allows all fields to be updated

### Phase 6 — Multi-Number Notifications
- [ ] ADD NUMBER adds within plan limits
- [ ] All active numbers receive order notification simultaneously
- [ ] First CONFIRM locks order, others get "already confirmed" message
- [ ] Exceeding plan limit shows upgrade prompt
- [ ] REMOVE NUMBER deactivates correctly (cannot remove primary)

### Phase 7 — Bot Intelligence
- [ ] TEACH BOT saves context to vendor.businessContext
- [ ] Customer asking a contextual question gets accurate answer
- [ ] Vendor context used in LLM system prompt for that vendor's customers
- [ ] VIEW command shows current bot knowledge

### Phase 8 — Migration
- [ ] Existing vendor data migrated correctly
- [ ] MAMATEE store code works for existing vendor
- [ ] All existing products accessible via MAMATEE link
- [ ] Existing orders preserved and linked to vendor

---

### Tweet Feedback Validation Tests

These tests validate that Pingmart directly solves the real pain points from Nigerian Twitter:

- [ ] **Lost orders** — Place 5 orders simultaneously from 5 different numbers. Confirm all 5 are captured in the database with no losses
- [ ] **Repetitive questions** — Ask "how much is the chicken?" 3 times from 3 different numbers. Bot answers all 3 instantly without vendor involvement
- [ ] **Off-hours message** — Message the bot at a time outside working hours. Confirm vendor is NOT disturbed and customer gets graceful response
- [ ] **Order tracking** — Place an order, type ORDER STATUS at each stage. Confirm accurate real-time status every time
- [ ] **Rigid bot test** — Type something completely unexpected ("abeg help me find my car keys"). Bot should respond warmly and helpfully, NOT say "invalid input"
- [ ] **Human escalation** — Type "I want to speak to a real person". Confirm vendor gets alert and customer gets acknowledgement
- [ ] **Frustration detection** — Type "this bot is useless". Confirm escalation triggers, vendor is notified
- [ ] **Confusion loop** — Send 3 completely unintelligible messages in a row. Confirm auto-escalation triggers after 3rd attempt
- [ ] **Multi-team notification** — Add 3 notification numbers. Place order. Confirm all 3 receive alert simultaneously
- [ ] **No ghosting test** — Place an order and abandon it at delivery address step. Come back 2 hours later and continue. Confirm session is preserved
- [ ] **Pidgin fluency** — Conduct entire order flow in Pidgin English. Confirm bot understands and responds naturally throughout
- [ ] **Voice note order** — Send a voice note saying "I want 2 chicken shawarma abeg". Confirm bot transcribes and processes correctly

---

*This document is the single source of truth for the Pingmart 2.0 build.*
*Claude Code must read Sections 2 and 3 carefully before writing any customer-facing message or LLM prompt.*
*Every feature must solve a Tweet Feedback pain point. Every bot response must pass the "does this feel human?" test.*
*Follow phases in order. Test fully before moving to the next phase.*
