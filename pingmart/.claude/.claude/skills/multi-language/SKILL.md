# Multi-Language Skill — Pingmart

## Overview
Pingmart supports 5 languages for the Nigerian market. Language selection is ALWAYS the first step for every new user — shown simultaneously in all 5 languages before any other content.

## Supported Languages
```typescript
enum Language {
  EN      = 'EN',      // English
  PIDGIN  = 'PIDGIN',  // Nigerian Pidgin
  IGBO    = 'IGBO',    // Igbo
  YORUBA  = 'YORUBA',  // Yoruba
  HAUSA   = 'HAUSA',   // Hausa
}
```

## File Location
`src/i18n/` — all translation strings live here
`src/i18n/index.ts` — main i18n resolver

## Language Selection Screen
This is the FIRST message every new user sees. It must be shown in ALL 5 languages at once:

```
Welcome to Pingmart! 🛍️
Chọose your language / Wetin language you want?

1️⃣ English
2️⃣ Pidgin
3️⃣ Igbo (Ọ bụ n'Igbo)
4️⃣ Yorùbá
5️⃣ Hausa (Hausa)

Reply with a number (1-5)
```

## Adding a New Translation String

1. Add the key to the `Messages` interface in `src/i18n/index.ts`
2. Add the translation for ALL 5 languages — never add for English only
3. Use the `t(key, language)` helper wherever the string is used in the bot
4. Never hardcode English strings in service files — always use `t()`

## Translation Rules

### English
- Friendly, warm, professional
- Nigerian context (₦ not $, "order" not "purchase")
- Short sentences — WhatsApp readability

### Pidgin
- Authentic Nigerian Pidgin — not broken English
- Use: "Abeg", "Na", "Wetin", "E don", "Oya", "Wahala", "Make you"
- Example: "Abeg, wetin you want order today? 😊"

### Igbo
- Standard Igbo orthography
- Keep greetings warm: "Nnọọ" (welcome), "Daalu" (thank you)

### Yoruba
- Include correct diacritical marks where possible: ọ, ẹ, ṣ
- Warm greetings: "E kaabo" (welcome), "E se" (thank you)

### Hausa
- Standard Hausa
- Greetings: "Barka da zuwa" (welcome), "Na gode" (thank you)

## Critical Rules

1. **Language selection is non-negotiable** — it must be the first interaction for every new phone number, whether they are a customer or vendor
2. **Language persists** — store on `ConversationSession.language` and never change it unless the user explicitly requests a language switch
3. **Never mix languages** — if a user chose Pidgin, all bot responses must be in Pidgin
4. **LLM understands all 5** — the Claude Haiku intent classifier already handles all Nigerian languages in input, but output must always be in the user's chosen language
5. **Vendor onboarding is also translated** — the entire vendor setup flow must respect language choice

## Adding a New Language (future)
If adding a 6th language (e.g. Edo, Ijaw):
1. Add to `Language` enum in Prisma schema + run migration
2. Add to `Language` TypeScript enum
3. Translate ALL existing `Messages` keys
4. Add the new option to the language selection screen
5. Update `REORDER_DAYS_AFTER` nudge templates for the new language
6. Test the full customer + vendor flow in that language

## Language Selection for New Phones (router.service.ts)
Every brand-new phone number sees language selection BEFORE the "shop or sell?" screen:
1. Unknown sender arrives → `showLanguageSelectionScreen()` → Redis state `LANG_INIT` for 30 min
2. User replies 1–5 → `handleLangInitReply()` → `customerRepository.findOrCreate()` + `updateLanguage()` → `showShopOrSellScreen()`
3. Unrecognised reply → show language screen again

This means language is persisted to the Customer DB record from the very first interaction, before they even choose to shop or sell.

## Mid-Conversation Language Detection (order.service.ts)
If a customer switches language mid-conversation (e.g., started in English but suddenly writes Pidgin):
1. `hasForeignLanguageTrigger(message)` — fast regex check for Pidgin/Igbo/Yoruba/Hausa trigger words (no LLM cost if clearly English)
2. If trigger words found → `detectMessageLanguage(message)` → LLM call returning `'pid'|'ig'|'yo'|'ha'|null`
3. If detected ≠ current session language: set Redis `lang:switch:${phone}` (5 min TTL), send `msgLanguageSwitchPrompt()` in the DETECTED language, return
4. On `SWITCH_LANG:<code>` button tap: `customerRepository.updateLanguage()` + delete Redis key, continue normally
5. On `KEEP_LANG` button tap: delete Redis key, return (no further action)

Detection is skipped for `AWAITING_ADDRESS`, `AWAITING_ITEM_NOTE`, and `LANGUAGE_SELECTION` states (free-text inputs where trigger words could be incidental).

## Vendor Language Instructions (Priority 1 Check)

Vendors can request a language switch at ANY point — mid-flow, mid-onboarding — using natural phrases instead of a menu. This check must run **before all other processing**, including flow-state routing.

### Detection — `detectLanguageSwitchRequest(message)` in `llm.service.ts`

Pure regex, no LLM call. Returns a `Language` code or `null`.

Recognised patterns (case-insensitive):
| Pattern | Example |
|---|---|
| `tell me in/for <lang>` | "Tell me in Pidgin", "Tell me for Yoruba" |
| `speak <lang>` | "Speak Hausa" |
| `respond in <lang>` | "Respond in Igbo" |
| `use <lang>` | "Use English" |
| `switch to <lang>` | "Switch to Pidgin" |
| `chat in <lang>` | "Chat in Hausa" |
| Bare language name (≤ 2 words) | "Pidgin", "Pidgin please" |
| Nigerian phrasing | "Abeg speak Pidgin", "Oya use Yoruba" |

### Vendor Dashboard (`vendor-management.service.ts`)

`detectLanguageSwitchRequest` is the **very first check** in `handleVendorDashboard`, before the status-command guard and before Redis state lookup. On a match:
1. `setVendorLanguage(phone, lang)` — persists to Redis (`vendor:lang:{phone}`, 30-day TTL)
2. Reply with `VENDOR_LANG_CONFIRM[lang]` — confirmation in the target language
3. Show the dashboard

### Vendor Onboarding (`vendor-onboarding.service.ts`)

Same detection at the top of `handleVendorOnboarding`, before the step switch. On a match:
1. `setOnboardingLanguage(phone, lang)` — same Redis key, 30-day TTL
2. Reply with `ONBOARDING_LANG_CONFIRM[lang]`
3. **Return without advancing the step** — the vendor's language switch is acknowledged, and we wait for their actual answer to the current onboarding question

### Vendor Language Storage

Vendor language is stored in Redis, not the DB (vendors have no `language` field yet):
- Key: `vendor:lang:{phone}`
- TTL: 30 days
- Default: `'en'` if the key is absent

### Confirmation Messages (Hardcoded per language)

| Language | Confirmation |
|---|---|
| `en` | "Sure! I'll respond in English from now on. What would you like to do?" |
| `pid` | "No problem! I go dey yarn you for Pidgin from now. Wetin you wan do?" |
| `ig` | "Ọ dị mma! A ga m asị gị n'Igbo site ugbu a. Gịnị chọrọ ị mee?" |
| `yo` | "Ko problem! Emi yoo ba ẹ sọrọ ní Yorùbá lati isisiyi. Kini o fẹ ṣe?" |
| `ha` | "To! Zan yi magana da kai da Hausa daga yanzu. Me kake so ka yi?" |

## Language Switch
If a user says "switch to English" or "change language" at any point, `isLanguageChangeKeyword()` detects it and shows the language selection list again. Update their session language after new selection.
