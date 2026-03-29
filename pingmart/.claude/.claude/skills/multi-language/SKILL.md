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

## Language Switch
If a user says "switch to English" or "change language" at any point, detect this intent and show the language selection screen again. Update their session language after new selection.
