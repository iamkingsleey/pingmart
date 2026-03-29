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

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type CustomerIntent =
  | { intent: 'MENU' }
  | { intent: 'ORDER'; productHint: string; quantity?: number; note?: string }
  | { intent: 'CANCEL' }
  | { intent: 'CONFIRM' }
  | { intent: 'CART' }
  | { intent: 'PRICE_ENQUIRY'; productHint: string }
  | { intent: 'DELIVERY_ENQUIRY' }
  | { intent: 'GREETING' }
  | { intent: 'MULTI_ORDER'; items: Array<{ productHint: string; quantity?: number }> }
  | { intent: 'MODIFY_CART'; action: 'remove' | 'update_quantity' | 'increment'; productHint: string; quantity?: number }
  | { intent: 'REPEAT_ORDER' }
  | { intent: 'SHOW_CHEAPEST' }
  | { intent: 'SHOW_POPULAR' }
  | { intent: 'UNKNOWN'; rawMessage: string };

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
Possible intents and their JSON format:
- View menu: {"intent": "MENU"}
- Order a product: {"intent": "ORDER", "productHint": "product name here", "quantity": 1}
- Order with special instructions: {"intent": "ORDER", "productHint": "jollof rice", "quantity": 1, "note": "extra spicy"}
- Multiple items in one message: {"intent": "MULTI_ORDER", "items": [{"productHint": "Chapman", "quantity": 3}, {"productHint": "Sprite", "quantity": 2}]}
- Cancel order: {"intent": "CANCEL"}
- Confirm order: {"intent": "CONFIRM"}
- View cart: {"intent": "CART"}
- Ask about price OR availability: {"intent": "PRICE_ENQUIRY", "productHint": "product name here"}
- Ask about delivery: {"intent": "DELIVERY_ENQUIRY"}
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
- Always return valid JSON`;

    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 150,
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
): Promise<string> {
  const FALLBACK = "Sorry, we don't have that! Type *MENU* to see what we offer. 😊";
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 120,
      system:
        `You are a friendly Nigerian WhatsApp vendor assistant for ${vendorName}.\n` +
        `The store sells: ${productNames.join(', ')}.\n` +
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
