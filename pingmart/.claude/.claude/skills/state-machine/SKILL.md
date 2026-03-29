# State Machine Skill — Pingmart

## Overview
Pingmart uses a conversation state machine to track where each user is in their journey. State is stored in the `ConversationSession` table (PostgreSQL) so it survives server restarts. Each phone number has exactly one active session per vendor context.

## File Location
`src/services/router.service.ts` — main routing logic
`src/repositories/session.repository.ts` — session read/write

## Session Model Fields
```prisma
ConversationSession {
  id          String
  phone       String        // customer or vendor phone in E.164 format
  vendorId    String        // which vendor store this session belongs to
  state       String        // current state name (see states below)
  cartItems   Json          // [{productId, quantity, unitPrice, note}]
  language    Language      // EN | PIDGIN | IGBO | YORUBA | HAUSA
  lastMessageAt DateTime
}
```

## Customer States

| State | Description | Next states |
|---|---|---|
| `LANGUAGE_SELECT` | First ever message — show language options | `IDLE` |
| `IDLE` | Browsing, no active order | `BROWSING`, `ORDERING` |
| `BROWSING` | Viewing menu | `ORDERING`, `IDLE` |
| `ORDERING` | Item selected, awaiting quantity | `CART_REVIEW`, `ORDERING` |
| `CART_REVIEW` | Cart shown, awaiting confirm/edit | `AWAITING_PAYMENT`, `ORDERING` |
| `AWAITING_PAYMENT` | Payment method chosen | `AWAITING_TRANSFER_CONFIRMATION`, `COMPLETE` |
| `AWAITING_TRANSFER_CONFIRMATION` | Bank transfer — waiting for vendor to confirm | `COMPLETE` |
| `COMPLETE` | Order placed | → resets to `IDLE` |

## Vendor States (Onboarding)

| State | Description |
|---|---|
| `COLLECTING_INFO` | LLM extracts: business name, store code, type, hours, payment method |
| `ADDING_PRODUCTS` | Vendor sends products one-by-one or in bulk |
| `PAYMENT_SETUP` | Collect Paystack key or bank details |
| `CONFIRMATION` | Show summary, wait for "GO LIVE" |
| `COMPLETE` | vendor.isActive = true |

## Critical Rules

### 1. Global Intents Override State
Certain intents must always work regardless of current state:
- `MENU` → always show menu, reset to BROWSING
- `CANCEL` → always cancel cart, reset to IDLE
- `CART` → always show cart contents
- `HELP` → always show help message

Check global intents BEFORE routing to the state-specific handler.

```typescript
// CORRECT order
if (isGlobalIntent(intent)) {
  return handleGlobalIntent(intent, session);
}
return handleStateIntent(intent, session);
```

### 2. Never Double-Process a Message
Use Redis deduplication with the WhatsApp message ID:
```typescript
const alreadyProcessed = await redis.set(
  `msg:${message.id}`,
  '1',
  'EX', 86400,   // 24 hour TTL
  'NX'           // only set if not exists
);
if (!alreadyProcessed) return; // skip duplicate
```

### 3. Always Set wasHandled Flag
When an intent handler sends a response, it must return immediately. Never let multiple handlers respond to the same message.

### 4. State Transitions Must Be Atomic
Always update state AND any related data in a single Prisma transaction:
```typescript
await prisma.$transaction([
  prisma.conversationSession.update({ where: { id }, data: { state: 'CART_REVIEW', cartItems } }),
  // other related updates
]);
```

### 5. Language Persists Across Sessions
Once a user selects a language, store it on the session. All subsequent messages to that user must use their chosen language. Never default back to English mid-conversation.

## Adding a New State

1. Add the state name to the state enum/type in `src/types/`
2. Add a handler function in `router.service.ts`
3. Add the state to the routing switch/if-chain
4. Define what transitions INTO this state (who sets it)
5. Define what transitions OUT of this state (what user actions move forward)
6. Add the state to the `whatsapp-testing` SKILL.md test checklist
7. Never remove an old state without a migration — existing sessions may be in that state

## Session Expiry
Sessions older than 24 hours in a non-terminal state should reset to `IDLE`. This handles cases where users abandon mid-flow. Do NOT delete the session — just reset the state and clear cartItems.
