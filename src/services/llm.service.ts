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
  | { intent: 'ORDER'; productHint: string; quantity?: number }
  | { intent: 'CANCEL' }
  | { intent: 'CONFIRM' }
  | { intent: 'CART' }
  | { intent: 'PRICE_ENQUIRY'; productHint: string }
  | { intent: 'DELIVERY_ENQUIRY' }
  | { intent: 'GREETING' }
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
- Cancel order: {"intent": "CANCEL"}
- Confirm order: {"intent": "CONFIRM"}
- View cart: {"intent": "CART"}
- Ask about price OR availability: {"intent": "PRICE_ENQUIRY", "productHint": "product name here"}
- Ask about delivery: {"intent": "DELIVERY_ENQUIRY"}
- Greeting (hi, hello, hey): {"intent": "GREETING"}
- Anything else: {"intent": "UNKNOWN", "rawMessage": "original message here"}
Rules:
- Nigerian Pidgin English is common — understand it (e.g. "abeg", "wetin", "I wan", "make I")
- Quantities can be written as words: "two", "three" → convert to numbers
- If a product name is approximate (e.g. "jollof" for "Jollof Rice"), match it to the closest available product
- Availability questions like "Do you have X?", "Is X available?", "Do you sell X?", "Any X today?" → PRICE_ENQUIRY
- Examples: "Do you have jollof rice?" → {"intent": "PRICE_ENQUIRY", "productHint": "jollof rice"}
- Examples: "Is chicken available?" → {"intent": "PRICE_ENQUIRY", "productHint": "chicken"}
- Examples: "Do you sell eba?" → {"intent": "PRICE_ENQUIRY", "productHint": "eba"}
- Examples: "Any dodo today?" → {"intent": "PRICE_ENQUIRY", "productHint": "dodo"}
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
