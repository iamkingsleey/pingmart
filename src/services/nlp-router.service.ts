/**
 * NLP Router — bridges LLM intent with the existing conversation state machine
 *
 * This acts as a middleware layer. Before processing a message with the existing
 * keyword-based state machine, we first run it through the LLM to extract intent.
 * The extracted intent is then normalised into a format the state machine understands.
 *
 * This approach means:
 * - We don't rewrite the state machine (safe, no regressions)
 * - LLM only runs when needed (cost efficient)
 * - Existing keyword flows still work as fallback
 */
import { interpretMessage, CustomerIntent } from './llm.service';
import { Product } from '@prisma/client';

export interface NormalisedMessage {
  text: string;       // The normalised text to pass to the state machine
  intent: CustomerIntent;
}

// Single digits and common keywords are already in canonical form — skip LLM entirely
const KNOWN_KEYWORDS = new Set([
  'MENU', 'CANCEL', 'STOP', 'QUIT', 'EXIT', 'BACK',
  'CONFIRM', 'CART', 'DONE', 'CHECKOUT', 'CLEAR',
  'BUY', 'YES', 'NO',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

export async function normaliseMessage(
  rawMessage: string,
  products: Product[],
  sessionState: string,
): Promise<NormalisedMessage> {
  // Skip LLM for messages that are already canonical commands or single digits
  const upper = rawMessage.trim().toUpperCase();
  if (KNOWN_KEYWORDS.has(upper)) {
    return { text: rawMessage, intent: { intent: 'UNKNOWN', rawMessage } };
  }

  const productNames = products.map((p) => p.name);
  const intent = await interpretMessage(rawMessage, productNames, sessionState);

  switch (intent.intent) {
    case 'MENU':
      return { text: 'MENU', intent };

    case 'CANCEL':
      return { text: 'CANCEL', intent };

    case 'CONFIRM':
      return { text: 'CONFIRM', intent };

    case 'CART':
      return { text: 'CART', intent };

    case 'GREETING':
      return { text: 'MENU', intent }; // greetings trigger the menu

    case 'ORDER': {
      // Find the matching product by name (fuzzy match)
      const match = products.find(
        (p) =>
          p.name.toLowerCase().includes(intent.productHint.toLowerCase()) ||
          intent.productHint.toLowerCase().includes(p.name.toLowerCase()),
      );
      if (match) {
        const productIndex = products.indexOf(match) + 1;
        // If a quantity was extracted, return "N Q" format (index + space + quantity)
        // The state machine handles quantities separately so we just return the index
        return { text: String(productIndex), intent };
      }
      // No product match — signal order.service.ts to handle gracefully
      return { text: 'ORDER:NOT_FOUND', intent };
    }

    case 'PRICE_ENQUIRY': {
      const match = products.find((p) =>
        p.name.toLowerCase().includes(intent.productHint.toLowerCase()) ||
        intent.productHint.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]),
      );
      // Return PRICE:NOT_FOUND so order.service.ts can send a "not on menu" reply
      return { text: match ? `PRICE:${match.id}` : 'PRICE:NOT_FOUND', intent };
    }

    case 'DELIVERY_ENQUIRY':
      return { text: 'DELIVERY_INFO', intent };

    default:
      // UNKNOWN — pass raw message to existing handler unchanged
      return { text: rawMessage, intent };
  }
}
