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

## Clean Flow Exit Pattern (Vendor Mid-Flow Escape)

When a vendor sends a message that clearly signals they want to switch to a different task while inside an active flow, the state machine must exit cleanly before routing to the new flow.

### The Pattern

```typescript
// 1. Pre-check (cheap regex — no LLM cost for normal replies)
if (mightBeVendorFlowEscape(message)) {

  // 2. LLM confirms escape intent and returns a dashboard token or 'CONTINUE'
  const escapeIntent = await classifyVendorFlowEscape(message, state.step);
  const escapedCmd = buildIntentCommandMap(vendor)[escapeIntent];

  if (escapedCmd) {
    // 3. Clear orphaned state FIRST — never route while state is dirty
    await clearVendorState(phone);

    // 4. Soft acknowledgement before the new flow starts
    await send(phone, `No worries! Let's do that instead. 👍`);

    // 5. Route to the new command as if the vendor had typed it fresh
    return handleTopLevelCommand(phone, message, escapedCmd, vendor);
  }
}
```

### Rules

- **Always `clearVendorState` before routing** — leaving Redis state behind causes the next message to be misrouted into the old flow.
- **Send the acknowledgement** (`"No worries!"`) before starting the new flow — the vendor needs feedback that the switch was understood.
- The escape check runs **after** the CANCEL/BACK/DASHBOARD universal escape and **after** the language switch check (Bug 2), but **before** the `switch (state.step)` handler.
- `classifyVendorFlowEscape` always returns `'CONTINUE'` on LLM errors — fail safe, never break the current flow silently.
- `buildIntentCommandMap(vendor)` is the single source of truth for token→command mapping. It handles the `PAUSE_STORE` / `RESUME_STORE` contextual flip based on `vendor.isPaused`. Do not duplicate this map.

### Where This Is Applied

`handleStateReply` in `vendor-management.service.ts` — covers all post-onboarding vendor flows.

### Extending to Onboarding

For LLM-driven onboarding steps (COLLECTING_INFO), the underlying LLM already handles "go back" / "I want to change X" naturally via conversation history. For deterministic steps (ADDING_PRODUCTS, PAYMENT_SETUP), add the same pattern in `handleVendorOnboarding` when those steps are extended.

## Adding a New State

1. Add the state name to the state enum/type in `src/types/`
2. Add a handler function in `router.service.ts`
3. Add the state to the routing switch/if-chain
4. Define what transitions INTO this state (who sets it)
5. Define what transitions OUT of this state (what user actions move forward)
6. Add the state to the `whatsapp-testing` SKILL.md test checklist
7. Never remove an old state without a migration — existing sessions may be in that state

## Router-Level Redis States (router.service.ts)
The router uses `router:state:${phone}` in Redis to track pre-session states for unknown senders:

| State | Meaning |
|---|---|
| `LANG_INIT` | Brand-new phone is choosing their language (before "shop or sell?") |
| `SHOP_OR_SELL` | Phone has chosen language and is choosing shop vs. sell |

These states are checked at the TOP of `routeIncomingMessage` before any DB lookups. Unrecognised replies re-show the relevant screen.

## Language Switch Redis State (order.service.ts)
Mid-conversation language detection uses a separate key `lang:switch:${phone}` with 5-min TTL. When this key exists, the bot has already sent a switch prompt and is waiting for the customer's `SWITCH_LANG:<code>` or `KEEP_LANG` button response.

`SWITCH_LANG` / `KEEP_LANG` are handled at the TOP of `processIncomingMessage`, before the working-hours gate, so they always work regardless of session state.

## Session Expiry
Sessions older than 24 hours in a non-terminal state should reset to `IDLE`. This handles cases where users abandon mid-flow. Do NOT delete the session — just reset the state and clear cartItems.
