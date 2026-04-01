/**
 * LLM Service — Natural Language Understanding for Pingmart
 *
 * Uses Claude Haiku to interpret customer messages and extract structured intent.
 * This allows customers to type naturally instead of using exact keywords.
 *
 * Example inputs and what they map to:
 * "I want 2 jollof rice" → { intent: 'ORDER', productHint: 'jollof rice', quantity: 2 }
 * "What's on the menu?" → { intent: 'MENU' }
 * "Cancel my order" → { intent: 'CANCEL' }
 * "How much is the chicken?" → { intent: 'PRICE_ENQUIRY', productHint: 'chicken' }
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  findLanguagePattern,
  saveLanguagePattern,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
} from './learning.service';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type CustomerIntent =
  | { intent: 'MENU' }
  | { intent: 'ORDER'; productHint: string; quantity?: number; note?: string }
  | { intent: 'CANCEL' }
  | { intent: 'CONFIRM' }
  | { intent: 'CART' }
  | { intent: 'PRICE_ENQUIRY'; productHint: string }
  | { intent: 'DELIVERY_ENQUIRY' }
  | { intent: 'TRACK_ORDER' }
  | { intent: 'SPEAK_TO_VENDOR' }
  | { intent: 'HELP' }
  | { intent: 'GREETING' }
  | { intent: 'MULTI_ORDER'; items: Array<{ productHint: string; quantity?: number }> }
  | { intent: 'MODIFY_CART'; action: 'remove' | 'update_quantity' | 'increment'; productHint: string; quantity?: number }
  | { intent: 'REPEAT_ORDER' }
  | { intent: 'SHOW_CHEAPEST' }
  | { intent: 'SHOW_POPULAR' }
  | { intent: 'UNKNOWN'; rawMessage: string };

/**
 * Enriched result from `interpretMessageWithConfidence`.
 * Every consumer receives the confidence score so it can be logged
 * and routing decisions can adapt (clarify on low confidence).
 */
export interface ClassifiedIntent {
  intent:     CustomerIntent;
  confidence: number;           // 0.0–1.0 from LLM or pattern library
  source:     'pattern' | 'llm' | 'fallback';
  language?:  string;           // detected language (if non-English)
}

/**
 * Full intent classification with confidence scoring and pattern-library lookup.
 * Prefer this over `interpretMessage` in new code.
 *
 * Decision flow:
 *   1. Check LanguagePattern library (fast, no API call)
 *   2. If pattern confidence ≥ CONFIDENCE_HIGH → return directly
 *   3. Otherwise call LLM (includes confidence in JSON response)
 *   4. If LLM confidence ≥ CONFIDENCE_HIGH → save pattern for future
 *   5. Always return { intent, confidence, source }
 */
export async function interpretMessageWithConfidence(
  customerMessage: string,
  availableProducts: string[],
  conversationContext: string,
  language?: string,
): Promise<ClassifiedIntent> {
  // ── Step 1: Check stored language patterns ──────────────────────────────────
  if (language && language !== 'en') {
    const patternMatch = await findLanguagePattern(language, customerMessage);
    if (patternMatch && patternMatch.confidence >= CONFIDENCE_HIGH) {
      logger.debug('Intent resolved from language pattern', {
        language,
        intent: patternMatch.intent,
        confidence: patternMatch.confidence,
      });
      // Reconstruct a minimal CustomerIntent from the stored intent name
      const intent = patternToIntent(patternMatch.intent, customerMessage);
      return { intent, confidence: patternMatch.confidence, source: 'pattern', language };
    }
  }

  // ── Step 2: LLM classification ──────────────────────────────────────────────
  const llmResult = await interpretMessage(customerMessage, availableProducts, conversationContext);

  // Confidence is embedded in the LLM response if we use the updated prompt;
  // fall back to a heuristic if the LLM didn't include it.
  const confidence = extractConfidence(llmResult);

  // ── Step 3: Save high-confidence patterns for future lookups ────────────────
  if (language && language !== 'en' && confidence >= CONFIDENCE_HIGH) {
    saveLanguagePattern(language, llmResult.intent, customerMessage);
  }

  return { intent: llmResult, confidence, source: 'llm', language };
}

/** Convert a stored intent name back to a minimal CustomerIntent object. */
function patternToIntent(intentName: string, rawMessage: string): CustomerIntent {
  switch (intentName) {
    case 'MENU':             return { intent: 'MENU' };
    case 'CANCEL':           return { intent: 'CANCEL' };
    case 'CONFIRM':          return { intent: 'CONFIRM' };
    case 'CART':             return { intent: 'CART' };
    case 'DELIVERY_ENQUIRY': return { intent: 'DELIVERY_ENQUIRY' };
    case 'TRACK_ORDER':      return { intent: 'TRACK_ORDER' };
    case 'SPEAK_TO_VENDOR':  return { intent: 'SPEAK_TO_VENDOR' };
    case 'HELP':             return { intent: 'HELP' };
    case 'GREETING':         return { intent: 'GREETING' };
    case 'REPEAT_ORDER':     return { intent: 'REPEAT_ORDER' };
    case 'SHOW_CHEAPEST':    return { intent: 'SHOW_CHEAPEST' };
    case 'SHOW_POPULAR':     return { intent: 'SHOW_POPULAR' };
    default:                 return { intent: 'UNKNOWN', rawMessage };
  }
}

/** Extract confidence from an LLM-returned intent (may include `_confidence` field). */
function extractConfidence(intent: CustomerIntent & { _confidence?: number }): number {
  if (typeof intent._confidence === 'number') {
    return Math.max(0, Math.min(1, intent._confidence));
  }
  // Heuristic: UNKNOWN = low confidence, everything else = medium-high
  if (intent.intent === 'UNKNOWN') return 0.40;
  return CONFIDENCE_MEDIUM + 0.10; // 0.70 default for non-UNKNOWN
}

export async function interpretMessage(
  customerMessage: string,
  availableProducts: string[],
  conversationContext: string,
): Promise<CustomerIntent> {
  try {
    const systemPrompt = `You are an intent classifier for a Nigerian WhatsApp shopping bot called Pingmart.
Your job is to read a customer's message and return a JSON object representing their intent.
Available products in this store: ${availableProducts.join(', ')}
Current conversation context: ${conversationContext}
Return ONLY a valid JSON object — no explanation, no markdown, no extra text.
Include a "_confidence" field (0.0–1.0) indicating how certain you are.
Possible intents and their JSON format:
- View menu: {"intent": "MENU"}
- Order a product: {"intent": "ORDER", "productHint": "product name here", "quantity": 1}
- Order with special instructions: {"intent": "ORDER", "productHint": "jollof rice", "quantity": 1, "note": "extra spicy"}
- Multiple items in one message: {"intent": "MULTI_ORDER", "items": [{"productHint": "Chapman", "quantity": 3}, {"productHint": "Sprite", "quantity": 2}]}
- Cancel order: {"intent": "CANCEL"}
- Confirm order: {"intent": "CONFIRM"}
- View cart: {"intent": "CART"}
- Ask about price OR availability: {"intent": "PRICE_ENQUIRY", "productHint": "product name here"}
- Ask about delivery or shipping: {"intent": "DELIVERY_ENQUIRY"}
- Track an order / ask order status: {"intent": "TRACK_ORDER"}
- Speak to a human / contact the vendor: {"intent": "SPEAK_TO_VENDOR"}
- Ask for help / available commands: {"intent": "HELP"}
- Greeting (hi, hello, hey): {"intent": "GREETING"}
- Remove item from cart: {"intent": "MODIFY_CART", "action": "remove", "productHint": "product name"}
- Change quantity in cart: {"intent": "MODIFY_CART", "action": "update_quantity", "productHint": "product name", "quantity": 3}
- Add more of item in cart: {"intent": "MODIFY_CART", "action": "increment", "productHint": "product name", "quantity": 1}
- Repeat last order: {"intent": "REPEAT_ORDER"}
- Show cheapest item: {"intent": "SHOW_CHEAPEST"}
- Show most popular item: {"intent": "SHOW_POPULAR"}
- Anything else: {"intent": "UNKNOWN", "rawMessage": "original message here"}
Rules:
- Nigerian Pidgin English is common — understand it (e.g. "abeg", "wetin", "I wan", "make I")
- Quantities can be written as words: "two", "three" → convert to numbers
- If a product name is approximate (e.g. "jollof" for "Jollof Rice"), match it to the closest available product
- Availability questions like "Do you have X?", "Is X available?", "Do you sell X?", "Any X today?" → PRICE_ENQUIRY
- MULTI_ORDER: when customer mentions multiple distinct products in one message with or without quantities
  "3 Chapman and 2 Sprite" → {"intent": "MULTI_ORDER", "items": [{"productHint": "Chapman", "quantity": 3}, {"productHint": "Sprite", "quantity": 2}]}
  "I want 2 jollof and 1 chicken" → {"intent": "MULTI_ORDER", "items": [{"productHint": "jollof rice", "quantity": 2}, {"productHint": "chicken", "quantity": 1}]}
  "Give me jollof and dodo, 2 each" → {"intent": "MULTI_ORDER", "items": [{"productHint": "jollof", "quantity": 2}, {"productHint": "dodo", "quantity": 2}]}
- ORDER with notes: detect inline special instructions and include in "note" field
  "jollof rice, extra spicy" → {"intent": "ORDER", "productHint": "jollof rice", "quantity": 1, "note": "extra spicy"}
  "2 egusi soup no pepper" → {"intent": "ORDER", "productHint": "egusi soup", "quantity": 2, "note": "no pepper"}
  "grilled chicken without coleslaw" → {"intent": "ORDER", "productHint": "grilled chicken", "note": "no coleslaw"}
- MODIFY_CART: when customer wants to change their existing cart
  "Remove Chapman from my cart" → {"intent": "MODIFY_CART", "action": "remove", "productHint": "Chapman"}
  "Change jollof to 3" → {"intent": "MODIFY_CART", "action": "update_quantity", "productHint": "jollof rice", "quantity": 3}
  "Add one more chicken" → {"intent": "MODIFY_CART", "action": "increment", "productHint": "chicken", "quantity": 1}
- REPEAT_ORDER: "same as last time", "my usual", "last order", "order again", "the usual"
- SHOW_CHEAPEST: "cheapest", "most affordable", "cheapest thing", "wetin dey affordable"
- SHOW_POPULAR: "most popular", "what people order most", "best seller", "what's your best"
- TRACK_ORDER: any question about order tracking, delivery status, or order progress
  "Where is my order?" → {"intent": "TRACK_ORDER"}
  "Has my order been shipped?" → {"intent": "TRACK_ORDER"}
  "When will my order arrive?" → {"intent": "TRACK_ORDER"}
  "What's my order status?" → {"intent": "TRACK_ORDER"}
  "I want to track my delivery" → {"intent": "TRACK_ORDER"}
  "How do I track my delivery?" → {"intent": "TRACK_ORDER"}
  "Order status" → {"intent": "TRACK_ORDER"}
  "Check my order" → {"intent": "TRACK_ORDER"}
- SPEAK_TO_VENDOR: any request to speak to a human, contact vendor, or get human help
  "I want to speak to someone" → {"intent": "SPEAK_TO_VENDOR"}
  "Can I talk to a person?" → {"intent": "SPEAK_TO_VENDOR"}
  "Connect me to the vendor" → {"intent": "SPEAK_TO_VENDOR"}
  "I need to speak to a human" → {"intent": "SPEAK_TO_VENDOR"}
  "Contact customer service" → {"intent": "SPEAK_TO_VENDOR"}
  "Speak to vendor" → {"intent": "SPEAK_TO_VENDOR"}
- HELP: any request for help, assistance, or available commands
  "Help me" → {"intent": "HELP"}
  "I need help" → {"intent": "HELP"}
  "What can you do?" → {"intent": "HELP"}
  "How does this work?" → {"intent": "HELP"}
  "What are the commands?" → {"intent": "HELP"}
  "I'm confused" → {"intent": "HELP"}
- MENU intent — any request to browse, see, or show available items:
  "Let me see your menu" → {"intent": "MENU"}
  "Show me the menu" → {"intent": "MENU"}
  "Show me what you have" → {"intent": "MENU"}
  "What do you sell?" → {"intent": "MENU"}
  "What's available?" → {"intent": "MENU"}
  "I want to see the menu" → {"intent": "MENU"}
  "Wetin you get?" → {"intent": "MENU"}
  "Show me food" → {"intent": "MENU"}
  "What can I order?" → {"intent": "MENU"}
  "See menu" → {"intent": "MENU"}
  "Menu" → {"intent": "MENU"}
- Always return valid JSON
- Always include "_confidence" field: 1.0 = certain, 0.5 = unsure, 0.0 = guessing
  Example: {"intent": "MENU", "_confidence": 0.97}`;

    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 160,
      messages: [
        {
          role: 'user',
          content: customerMessage,
        },
      ],
      system: systemPrompt,
    });

    const rawContent = response.content[0];
    if (rawContent.type !== 'text') {
      throw new Error('Unexpected response type from LLM');
    }

    // Claude may wrap JSON in markdown code fences — strip them before parsing
    const rawText = rawContent.text.trim();
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText;

    logger.debug('LLM raw response', { raw: jsonText.substring(0, 200) });

    const parsed = JSON.parse(jsonText) as CustomerIntent;
    logger.info('LLM intent parsed', {
      message: customerMessage.substring(0, 50),
      intent: parsed.intent,
    });

    return parsed;
  } catch (error) {
    // Serialize Error objects properly — they have non-enumerable properties
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('LLM intent parsing failed', { error: errMsg });
    // Graceful fallback — treat as unknown so existing keyword matching can handle it
    return { intent: 'UNKNOWN', rawMessage: customerMessage };
  }
}

// ─── Vendor Dashboard Intent Classifier ──────────────────────────────────────

/**
 * Maps a vendor's free-form message to a known dashboard command.
 * Returns one of the exact command strings (e.g. 'ADD PRODUCT'),
 * 'GREETING' for hi/hello, or 'UNKNOWN' when genuinely ambiguous.
 *
 * Only called from handleTopLevelCommand when no exact keyword matched.
 */
export async function classifyVendorDashboardIntent(message: string): Promise<string> {
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 20,
      system:
        `You are an intent classifier for a WhatsApp store management bot in Nigeria.\n` +
        `A vendor (store owner) sent this message. Map it to EXACTLY ONE of these command tokens:\n` +
        `ADD_PRODUCT      — add a new product / item\n` +
        `REMOVE_PRODUCT   — remove / delete a product\n` +
        `UPDATE_PRICE     — change / update price of a product\n` +
        `MY_ORDERS        — view orders, see recent orders\n` +
        `MY_LINK          — get store link, share store link\n` +
        `PAUSE_STORE      — pause / stop taking orders\n` +
        `RESUME_STORE     — resume / reopen store\n` +
        `NOTIFICATIONS    — manage notification numbers, alerts\n` +
        `SETTINGS         — change business name, description, hours, bank, payment\n` +
        `TEACH_BOT        — add business context, FAQs, teach the bot\n` +
        `GREETING         — hi, hello, hey, good morning, good afternoon\n` +
        `UNKNOWN          — anything else that doesn't fit\n` +
        `Reply with ONLY the token — no explanation, no punctuation, nothing else.`,
      messages: [{ role: 'user', content: message }],
    });
    const raw = response.content[0];
    if (raw.type !== 'text') return 'UNKNOWN';
    const token = raw.text.trim().toUpperCase().split(/\s/)[0] ?? 'UNKNOWN';
    const VALID = new Set([
      'ADD_PRODUCT', 'REMOVE_PRODUCT', 'UPDATE_PRICE', 'MY_ORDERS', 'MY_LINK',
      'PAUSE_STORE', 'RESUME_STORE', 'NOTIFICATIONS', 'SETTINGS', 'TEACH_BOT',
      'GREETING', 'UNKNOWN',
    ]);
    return VALID.has(token) ? token : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

// ─── Mid-Conversation Language Detector ──────────────────────────────────────

export type DetectedLanguage = 'pid' | 'ig' | 'yo' | 'ha' | null;

/**
 * Fast trigger-word check — avoids an LLM call for clearly-English messages.
 * Returns true if the message contains markers of a Nigerian language.
 */
function hasForeignLanguageTrigger(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /\b(abeg|wetin|wahala|oya\b|sabi\b|dey\b|comot|abi\b|jare|una\b|dem\b|naija|chop\b|e don|na wa|no wahala|oga\b)\b/.test(m) || // Pidgin
    /\b(nnoo|daalu|kedu|biko|nwanne|chineke|gwa m|ozoemena|bia\b|ahụ|ọ bụ)\b/.test(m) || // Igbo
    /\b(kaabọ|ese\b|jọwọ|ẹkáàbọ̀|e kaabo|e se|ẹ jẹ|mo fẹ|kini)\b/.test(m) || // Yoruba
    /\b(sannu|yauwa|nagode|ranka|kai\b|ya dai|don allah|kai tsaye|bari)\b/.test(m)    // Hausa
  );
}

/**
 * Detects the primary language of a message when it appears to be non-English.
 * Only calls the LLM when `hasForeignLanguageTrigger` is true first.
 * Returns null when the message is English (or detection is uncertain).
 */
export async function detectMessageLanguage(message: string): Promise<DetectedLanguage> {
  if (!hasForeignLanguageTrigger(message)) return null;

  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 10,
      system:
        `Detect the primary language of this WhatsApp message.\n` +
        `Reply with EXACTLY ONE token:\n` +
        `pid  → Nigerian Pidgin English\n` +
        `ig   → Igbo\n` +
        `yo   → Yoruba\n` +
        `ha   → Hausa\n` +
        `en   → English (or unclear)\n` +
        `Only the token — nothing else.`,
      messages: [{ role: 'user', content: message }],
    });
    const raw = response.content[0];
    if (raw.type !== 'text') return null;
    const lang = raw.text.trim().toLowerCase();
    if (lang === 'pid' || lang === 'ig' || lang === 'yo' || lang === 'ha') return lang;
    return null;
  } catch {
    return null;
  }
}

/** Subset of vendor fields used for context-aware LLM responses */
export interface VendorContext {
  businessContext?: string | null;
  specialInstructions?: string | null;
  faqs?: string | null;
}

/** Builds the optional vendor context block injected into LLM system prompts */
function buildVendorContextBlock(ctx: VendorContext): string {
  const lines: string[] = [];
  if (ctx.businessContext) lines.push(`About this business:\n${ctx.businessContext}`);
  if (ctx.specialInstructions) lines.push(`Special instructions:\n${ctx.specialInstructions}`);
  if (ctx.faqs) lines.push(`FAQs:\n${ctx.faqs}`);
  return lines.length ? '\n\n' + lines.join('\n\n') : '';
}

/**
 * Generates a context-aware "we don't have that" response.
 *
 * Instead of a generic warehouse-sounding reply, Claude reads the actual
 * menu and the customer's question, then responds warmly and specifically —
 * e.g. noting it's a food shop when someone asks for perfumes.
 *
 * Falls back to a safe static string if the API call fails.
 */
export async function generateNotFoundResponse(
  customerMessage: string,
  productNames: string[],
  vendorName: string,
  vendorCtx: VendorContext = {},
): Promise<string> {
  const FALLBACK = "Sorry, we don't have that! Type *MENU* to see what we offer. 😊";
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 120,
      system:
        `You are a friendly Nigerian WhatsApp vendor assistant for ${vendorName}.\n` +
        `The store sells: ${productNames.join(', ')}.` +
        buildVendorContextBlock(vendorCtx) + '\n' +
        `A customer asked about something that is NOT on the menu.\n` +
        `Reply naturally and warmly in 1–2 short sentences explaining you don't sell that.\n` +
        `If it's clearly a different category (e.g. perfumes when you sell food), acknowledge it warmly.\n` +
        `End by inviting them to see the menu.\n` +
        `Never say "carry that item". Sound human and friendly, not like a system.`,
      messages: [{ role: 'user', content: customerMessage }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text.trim() : FALLBACK;
  } catch (err) {
    logger.error('generateNotFoundResponse failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK;
  }
}

/**
 * Answers a general customer question using the vendor's business context.
 *
 * Used when intent is UNKNOWN and the vendor has provided businessContext —
 * the bot answers questions about delivery areas, allergens, policies, etc.
 * instead of falling back to the state machine.
 *
 * Falls back to a soft "I'm not sure, ask the vendor directly" message.
 */
export async function generateContextAwareAnswer(
  customerMessage: string,
  vendorName: string,
  productNames: string[],
  vendorCtx: VendorContext,
): Promise<string> {
  const FALLBACK =
    `I'm not sure about that — for the best answer, please contact *${vendorName}* directly. 😊\n\n` +
    `Type *MENU* to browse or order.`;
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 200,
      system:
        `You are a customer service assistant for ${vendorName} on WhatsApp.\n` +
        `Products available: ${productNames.join(', ')}.` +
        buildVendorContextBlock(vendorCtx) + '\n' +
        `Answer the customer's question accurately using the business context above.\n` +
        `Be friendly and concise (2–3 sentences max). Use Nigerian-friendly language.\n` +
        `If the answer is in the context, give it confidently.\n` +
        `If you genuinely don't know, say so honestly and suggest contacting the vendor directly.\n` +
        `End with a soft prompt to order or browse if relevant.`,
      messages: [{ role: 'user', content: customerMessage }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text.trim() : FALLBACK;
  } catch (err) {
    logger.error('generateContextAwareAnswer failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK;
  }
}

// ─── Vendor Language Switch Detector ─────────────────────────────────────────

/**
 * Detects whether a vendor's message is a language-switch instruction.
 *
 * Pure regex — no LLM call — so it can be placed as the VERY FIRST check on
 * every incoming vendor message without adding latency.
 *
 * Recognises patterns like:
 *   "Tell me in Pidgin"  "Speak Yoruba"  "Respond in Hausa"
 *   "Use Igbo"           "Switch to English"  "Pidgin please"
 *
 * Returns the target Language code, or null if no instruction detected.
 */
export function detectLanguageSwitchRequest(message: string): import('../i18n').Language | null {
  const m = message.toLowerCase().trim();

  // Must contain a known language name
  const hasEnglish = /\benglish\b/.test(m);
  const hasPidgin  = /\bpidgin\b/.test(m);
  const hasIgbo    = /\bigbo\b/.test(m);
  const hasYoruba  = /\b(yoruba|yor[uù]b[aá])\b/.test(m);
  const hasHausa   = /\bhausa\b/.test(m);

  if (!hasEnglish && !hasPidgin && !hasIgbo && !hasYoruba && !hasHausa) return null;

  // Accept if there is an instruction verb / preposition alongside the language
  const hasInstruction = /\b(tell|speak|reply|respond|write|talk|chat|answer|yarn|use|switch|change|in|for|please|oya|abeg)\b/.test(m);

  // Also accept bare language name (1–2 words: "Pidgin" or "Pidgin please")
  const wordCount = m.replace(/[^a-z\s]/g, '').trim().split(/\s+/).length;
  const isBareLanguage = wordCount <= 2;

  if (!hasInstruction && !isBareLanguage) return null;

  if (hasEnglish) return 'en';
  if (hasPidgin)  return 'pid';
  if (hasIgbo)    return 'ig';
  if (hasYoruba)  return 'yo';
  if (hasHausa)   return 'ha';
  return null;
}

// ─── Vendor Mid-Flow Escape Detector ─────────────────────────────────────────

/**
 * Human-readable descriptions of each vendor command step, injected into the
 * escape-detection prompt so the LLM understands what question was just asked.
 */
const VENDOR_FLOW_STEP_DESCRIPTIONS: Record<string, string> = {
  ADD_PRODUCT:            'entering a new product name and price (e.g. "Jollof Rice | 1500")',
  REMOVE_PRODUCT_LIST:    'selecting a product to remove — choosing from a numbered list',
  REMOVE_PRODUCT_CONFIRM: 'confirming whether to delete a product — expected YES or NO',
  UPDATE_PRICE_LIST:      'selecting a product to update — choosing from a numbered list',
  UPDATE_PRICE_ENTER:     'typing the new price for a product (a number)',
  MY_ORDERS:              'browsing recent orders; can type an order ID for details',
  NOTIFICATIONS:          'managing order-alert numbers (ADD NUMBER or REMOVE NUMBER)',
  SETTINGS_MENU:          'choosing which setting to update — expected a number 1–6',
  SETTINGS_NAME:          'typing a new business name',
  SETTINGS_DESCRIPTION:   'typing a new business description',
  SETTINGS_HOURS:         'typing new working hours in HH:MM-HH:MM format',
  SETTINGS_PAYMENT:       'choosing a payment method — expected 1, 2, or 3',
  SETTINGS_BANK:          'typing bank details in "Bank | Account Number | Account Name" format',
  SETTINGS_CODE:          'typing a new store code (4–20 alphanumeric characters)',
  TEACH_BOT:              'teaching the bot about the business (free text; DONE to finish, VIEW to see)',
};

/**
 * Fast pre-check — skips the LLM if the message shows no escape signals.
 * This keeps the cost of every in-flow message to zero LLM calls when the
 * vendor is simply answering the current question.
 */
export function mightBeVendorFlowEscape(message: string): boolean {
  return /\b(instead|actually|wait|sorry|abeg|oya|hold on|different|update price|add product|remove product|my orders|my link|settings|notifications|teach bot|pause|resume|want to|i want|let me|can i|switch)\b/i.test(message);
}

/**
 * Asks the LLM whether the vendor's message is answering the current step's
 * question, or is clearly trying to do something entirely different.
 *
 * Returns:
 *  - 'CONTINUE'     — message is a valid in-flow response; keep processing normally
 *  - One of the dashboard intent tokens (ADD_PRODUCT, UPDATE_PRICE, …)
 *    — vendor wants to switch; clear state and route to that command
 *
 * Only call this after `mightBeVendorFlowEscape` returns true to avoid
 * unnecessary LLM calls on ordinary replies.
 *
 * Fails safe: returns 'CONTINUE' on any error so the current flow is never
 * silently broken.
 */
export async function classifyVendorFlowEscape(
  message: string,
  currentStep: string,
): Promise<string> {
  try {
    const stepDesc = VENDOR_FLOW_STEP_DESCRIPTIONS[currentStep] ?? `in the "${currentStep}" step`;
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 20,
      system:
        `A WhatsApp store vendor is currently ${stepDesc}.\n` +
        `They sent this message. Decide: are they answering the current question, OR clearly switching to a different task?\n` +
        `If answering the current question → reply: CONTINUE\n` +
        `If switching tasks, reply with ONE token:\n` +
        `ADD_PRODUCT  REMOVE_PRODUCT  UPDATE_PRICE  MY_ORDERS  MY_LINK\n` +
        `PAUSE_STORE  RESUME_STORE  NOTIFICATIONS  SETTINGS  TEACH_BOT\n` +
        `Reply with ONLY the token — nothing else.`,
      messages: [{ role: 'user', content: message }],
    });
    const raw = response.content[0];
    if (raw.type !== 'text') return 'CONTINUE';
    const token = raw.text.trim().toUpperCase().split(/\s/)[0] ?? 'CONTINUE';
    const VALID = new Set([
      'CONTINUE',
      'ADD_PRODUCT', 'REMOVE_PRODUCT', 'UPDATE_PRICE', 'MY_ORDERS', 'MY_LINK',
      'PAUSE_STORE', 'RESUME_STORE', 'NOTIFICATIONS', 'SETTINGS', 'TEACH_BOT',
    ]);
    return VALID.has(token) ? token : 'CONTINUE';
  } catch {
    return 'CONTINUE'; // fail safe — never break the current flow on LLM errors
  }
}

// ─── Item Note Hint Generator ─────────────────────────────────────────────────

/**
 * Deterministic category → hint map covering the most common product categories
 * on Pingmart. Keys are lowercase substrings matched against the product's
 * category field and name. Order matters — more specific entries first.
 */
const NOTE_HINT_MAP: Array<{ keywords: string[]; hint: string }> = [
  // Beverages & Drinks — must come BEFORE the general food entry so 'juice'/'drink' matches here first
  { keywords: ['juice', 'smoothie', 'smoothies', 'milkshake', 'shake', 'zobo', 'kunu', 'chapman', 'cocktail', 'mocktail', 'lemonade', 'tea', 'coffee', 'yoghurt', 'yogurt', 'drink', 'beverage', 'bottle', 'mineral water', 'spring water'], hint: 'no ice, less sugar, room temperature' },
  // Solid Food & Meals
  { keywords: ['food', 'meal', 'rice', 'soup', 'stew', 'chicken', 'beef', 'fish', 'snack', 'cake', 'bread', 'pastry', 'pizza', 'burger', 'shawarma', 'suya', 'puff', 'moi moi', 'chops', 'noodle', 'pasta', 'sandwich', 'wrap', 'salad', 'bbq', 'grill'], hint: 'extra spicy, no onions, pack separately' },
  // Clothing & Apparel
  { keywords: ['shirt', 'blouse', 'dress', 'gown', 'jacket', 'hoodie', 'sweater', 'trousers', 'jeans', 'skirt', 'suit', 'cloth', 'wear', 'fashion', 'apparel', 'native', 'agbada', 'kaftan'], hint: 'size L, colour blue, monogram initials' },
  // Shoes & Footwear
  { keywords: ['shoe', 'sneaker', 'sandal', 'slipper', 'boot', 'heel', 'loafer', 'footwear'], hint: 'size 42, wide fit, black colourway' },
  // Bags & Accessories
  { keywords: ['bag', 'handbag', 'backpack', 'purse', 'wallet', 'belt', 'hat', 'cap', 'scarf', 'accessory', 'accessories', 'jewel', 'necklace', 'bracelet', 'ring', 'earring', 'wristwatch', 'watch'], hint: 'gift wrap, include card, engraving text' },
  // Skincare & Beauty
  { keywords: ['skincare', 'cream', 'lotion', 'serum', 'moisturiser', 'moisturizer', 'soap', 'perfume', 'cologne', 'fragrance', 'makeup', 'lipstick', 'foundation', 'beauty', 'hair', 'wig', 'weave', 'braids'], hint: 'gift wrap, include receipt, fragrance-free only' },
  // Electronics & Gadgets
  { keywords: ['phone', 'laptop', 'tablet', 'charger', 'cable', 'earphone', 'headphone', 'speaker', 'electronic', 'gadget', 'power bank', 'screen', 'watch', 'tv', 'camera', 'keyboard', 'mouse'], hint: 'include charger, Nigerian plug type, original warranty' },
  // Furniture & Home
  { keywords: ['furniture', 'chair', 'table', 'bed', 'sofa', 'shelf', 'wardrobe', 'cabinet', 'desk', 'mattress', 'home', 'decor', 'curtain', 'rug', 'cushion'], hint: 'assembly required, deliver to 3rd floor, avoid scratches' },
  // Books & Stationery
  { keywords: ['book', 'novel', 'textbook', 'stationery', 'pen', 'notebook', 'diary', 'planner', 'journal'], hint: 'signed copy, gift wrap, include bookmark' },
  // Groceries & Produce
  { keywords: ['grocery', 'groceries', 'produce', 'vegetable', 'fruit', 'pepper', 'tomato', 'onion', 'yam', 'plantain', 'palm oil', 'crayfish', 'spice', 'watermelon', 'banana', 'mango', 'pineapple', 'orange', 'apple', 'avocado', 'cucumber'], hint: 'ripe only, no bruises, separate from liquids' },
  // Art & Crafts
  { keywords: ['art', 'painting', 'craft', 'handmade', 'custom', 'portrait', 'print', 'photo'], hint: 'custom text, frame colour, delivery date' },
];

/**
 * Returns product-specific example hint text for the special-instructions prompt.
 *
 * Strategy (fastest to slowest, stops at first match):
 *  1. Match product category or name against NOTE_HINT_MAP — zero LLM cost.
 *  2. If no keyword matched, ask Claude Haiku for a 3–5 word example hint
 *     tailored to the product. Falls back to a safe generic hint on error.
 */
export async function getItemNoteHint(productName: string, category: string): Promise<string> {
  const haystack = `${productName} ${category}`.toLowerCase();

  for (const { keywords, hint } of NOTE_HINT_MAP) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      return hint;
    }
  }

  // No keyword match — ask the LLM for a context-aware example
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 30,
      system:
        `You write short example hints for a WhatsApp shopping bot's special-instructions prompt.\n` +
        `Given a product name and category, return 3 comma-separated example instructions a customer might add.\n` +
        `Keep it to one short line, no more than 10 words total.\n` +
        `Examples:\n` +
        `  Jollof Rice / Food → extra spicy, no onions, pack separately\n` +
        `  Apple Juice / Drinks → no ice, less sugar, room temperature\n` +
        `  Nike Air Max / Shoes → size 42, wide fit, black colourway\n` +
        `  iPhone 15 / Electronics → include charger, Nigerian plug, sealed box\n` +
        `Return ONLY the hint text — no explanation, no punctuation at the end.`,
      messages: [{ role: 'user', content: `${productName} / ${category}` }],
    });
    const raw = response.content[0];
    if (raw.type === 'text' && raw.text.trim()) return raw.text.trim();
  } catch {
    // Fall through to generic fallback
  }

  return 'add a note, special request, gift message';
}

/**
 * Extracts structured facts from a vendor's free-text business description.
 *
 * Takes raw text like "We use halal meat. No delivery to mainland." and returns
 * a clean bullet-point list that gets appended to vendor.businessContext.
 *
 * Falls back to the raw trimmed input if the LLM call fails.
 */
export async function extractBusinessFacts(rawVendorText: string): Promise<string> {
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 300,
      system:
        `You are a business context extractor for a WhatsApp commerce platform.\n` +
        `A vendor just described something about their business.\n` +
        `Extract the key facts and rewrite them as clear, concise bullet points.\n` +
        `Each bullet should be a single factual statement (not a question).\n` +
        `Keep the vendor's intent exactly — don't add information they didn't provide.\n` +
        `Return ONLY the bullet points, one per line, starting with "• ".\n` +
        `No introduction, no explanation, no trailing text.`,
      messages: [{ role: 'user', content: rawVendorText }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text.trim() : rawVendorText.trim();
  } catch (err) {
    logger.error('extractBusinessFacts failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return rawVendorText.trim();
  }
}

// ─── Quantity Resolver ────────────────────────────────────────────────────────

export interface QuantityResolution {
  /**
   * 'single' — quantity applies only to the current pending item.
   * 'bulk'   — same quantity applies to every item (current + entire queue).
   * 'list'   — explicit quantity per item, in selection order.
   * 'unknown'— could not determine; ask the customer again.
   */
  type: 'single' | 'bulk' | 'list' | 'unknown';
  /** For type=single or bulk: the resolved quantity (always ≥ 1). */
  qty?: number;
  /** For type=list: one quantity per item, in the same order as allItems. */
  quantities?: number[];
}

/**
 * Uses the LLM to resolve a natural-language quantity response from a customer.
 *
 * Called when the bot is collecting per-item quantities during checkout and
 * the customer's reply is not a plain number (e.g. "1 each for all",
 * "2 of everything", "abeg give me 1 of each").
 *
 * @param message       Raw customer message
 * @param currentItem   Name of the item quantity is currently being collected for
 * @param queueItems    Names of remaining items still in the quantity queue
 */
export async function extractQuantitiesFromMessage(
  message: string,
  currentItem: string,
  queueItems: string[],
): Promise<QuantityResolution> {
  const allItems = [currentItem, ...queueItems];
  const itemList = allItems.map((n, i) => `${i + 1}. ${n}`).join('\n');

  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 128,
      messages: [{
        role: 'user',
        content:
          `A customer is selecting quantities during a shopping checkout.\n` +
          `Items being ordered (in selection order):\n${itemList}\n\n` +
          `Customer's reply: "${message}"\n\n` +
          `Extract the intended quantities. Return ONLY valid JSON — one of:\n` +
          `{"type":"bulk","qty":N}          — same quantity N for ALL items\n` +
          `{"type":"single","qty":N}        — quantity N for item 1 only\n` +
          `{"type":"list","quantities":[..]}— one quantity per item in order\n` +
          `{"type":"unknown"}               — cannot determine\n\n` +
          `Rules:\n` +
          `- "1 each", "1 each for all", "1 for all", "all 1" → bulk qty 1\n` +
          `- "2 of everything", "2 each", "abeg give me 2 of each" → bulk qty 2\n` +
          `- "just 1", "one please" (no "each"/"all" signal) → single qty 1\n` +
          `- "2, 1, 1" or "2 1 1" → list [2,1,1]\n` +
          `- "1 for the first, 2 for the rest" → list [1, 2, 2, ...]\n` +
          `- Named quantities like "3 Aveeno and 1 each for the rest" → list matching item order\n` +
          `- Quantities must be integers 1–99. Return unknown if ambiguous.\n` +
          `Return ONLY the JSON object, nothing else.`,
      }],
    });

    const raw = response.content[0];
    if (raw.type !== 'text') return { type: 'unknown' };

    const json = raw.text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(json) as Partial<QuantityResolution>;

    if (parsed.type === 'bulk' && typeof parsed.qty === 'number' && parsed.qty >= 1 && parsed.qty <= 99) {
      return { type: 'bulk', qty: parsed.qty };
    }
    if (parsed.type === 'single' && typeof parsed.qty === 'number' && parsed.qty >= 1 && parsed.qty <= 99) {
      return { type: 'single', qty: parsed.qty };
    }
    if (parsed.type === 'list' && Array.isArray(parsed.quantities)) {
      const quantities = parsed.quantities
        .map((q) => Math.round(Number(q)))
        .filter((q) => q >= 1 && q <= 99);
      if (quantities.length > 0) return { type: 'list', quantities };
    }

    return { type: 'unknown' };
  } catch {
    return { type: 'unknown' };
  }
}
