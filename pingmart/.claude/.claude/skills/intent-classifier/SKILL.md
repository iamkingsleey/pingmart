# Intent Classifier Skill — Pingmart

## Overview
The intent classifier is the brain of the Pingmart bot. It uses Claude Haiku to interpret natural language WhatsApp messages from both customers and vendors, and converts them into structured intents the state machine can act on.

## File Location
`src/services/llm.service.ts`

## Core Rule: LLM First, Validation Second
**NEVER run format validation before checking intent.** Any unexpected input (mid-flow or otherwise) must first pass through the LLM intent classifier before being rejected. This prevents the bot from rudely rejecting plain English responses.

```
User message → LLM intent check → if intent matches expected → validate format
                                 → if intent is off-script → handle gracefully
```

## Customer Intents (CustomerIntent type)

| Intent | Trigger examples | Notes |
|---|---|---|
| `MENU` | "show me menu", "wetin you get", "what do you sell" | Broadest catch — many phrasings |
| `ORDER` | "I want jollof", "give me 2 chicken" | Includes quantity + note extraction |
| `MULTI_ORDER` | "2 jollof and 1 chicken" | Array of {productHint, quantity} |
| `CANCEL` | "cancel", "forget it", "abeg cancel" | Must cancel current cart |
| `CONFIRM` | "yes", "confirm", "e correct" | Confirms cart before payment |
| `CART` | "what's in my cart", "show my order" | Reads current session cart |
| `PRICE_ENQUIRY` | "how much is X", "do you have X", "any X" | Availability questions = PRICE_ENQUIRY |
| `DELIVERY_ENQUIRY` | "do you deliver", "how much for delivery" | — |
| `GREETING` | "hi", "hello", "good morning" | Do not route to state machine |
| `MODIFY_CART` | "remove X", "change to 3", "add one more" | action: remove/update_quantity/increment |
| `REPEAT_ORDER` | "same as last time", "my usual" | Triggers reorder flow |
| `SHOW_CHEAPEST` | "cheapest thing", "wetin dey affordable" | — |
| `SHOW_POPULAR` | "best seller", "what people order most" | — |
| `UNKNOWN` | anything else | Falls back to keyword matching |

## Vendor Onboarding Intents
Used during vendor onboarding when a specific format is expected but vendor sends plain English.

| Intent | Trigger examples |
|---|---|
| `PROVIDING_VALUE` | Vendor is directly answering the question asked |
| `SKIP_STEP` | "skip", "ignore paystack", "I don't have this", "move on" |
| `CHANGE_PREFERENCE` | "I only want bank transfer", "no card payments" |
| `GO_BACK` | "wait", "let me change my business name", "go back" |
| `ASKING_HELP` | "what is this?", "where do I find this?", "I don't understand" |

## Adding a New Intent

1. Add the new intent type to `CustomerIntent` union in `llm.service.ts`
2. Add a JSON example to the system prompt in `interpretMessage()`
3. Add a rule to the Rules section of the prompt explaining when to use it
4. Add a handler in `router.service.ts` or the relevant state handler
5. Add the intent to the fallback keyword list in case LLM is unavailable

## Prompt Engineering Rules

- Always pass `availableProducts` to the LLM — it needs this for fuzzy matching
- Always pass `conversationContext` (current state + last message) for context-awareness
- The LLM returns ONLY valid JSON — no markdown, no explanation
- Strip code fences from response before `JSON.parse()` — Claude sometimes wraps in ```json
- Always have a graceful fallback: if LLM fails → return `{ intent: 'UNKNOWN', rawMessage }`
- Keep `max_tokens: 150` for intent classification — responses are always short JSON

## Nigerian Language Rules
The LLM must understand these Pidgin/Nigerian patterns:
- "abeg" = please
- "wetin" = what
- "I wan" / "I want" = I want
- "make I" = let me
- "e dey" = it is available
- "no be so" = that's not right
- Quantities as words: "two", "three" → convert to integers

## Fuzzy Product Matching
When a customer says "jollof" and the product is "Jollof Rice (Large)", the LLM should:
1. Match to closest available product name
2. Return the hint as "jollof rice" not "jollof"
3. The state machine then does a final fuzzy DB lookup using the hint

## Fallback Chain
```
LLM intent → UNKNOWN → keyword matching → still unknown → ask customer to clarify
```
Never leave the customer with a blank or error response.
