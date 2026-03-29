/**
 * NLP Router — bridges LLM intent with the existing conversation state machine
 */
import { interpretMessage, CustomerIntent } from './llm.service';
import { Product } from '@prisma/client';

export interface NormalisedMessage {
  text: string;
  intent: CustomerIntent;
}

// Single digits and common keywords are already in canonical form — skip LLM entirely
const KNOWN_KEYWORDS = new Set([
  'MENU', 'CANCEL', 'STOP', 'QUIT', 'EXIT', 'BACK',
  'CONFIRM', 'CART', 'DONE', 'CHECKOUT', 'CLEAR',
  'BUY', 'YES', 'NO', 'SKIP',
  'HELP', 'STATUS', 'ORDER STATUS',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

export async function normaliseMessage(
  rawMessage: string,
  products: Product[],
  sessionState: string,
): Promise<NormalisedMessage> {
  // Normalize internal whitespace so "order  status" matches "ORDER STATUS"
  const upper = rawMessage.trim().toUpperCase().replace(/\s+/g, ' ');

  // Skip LLM for canonical commands
  if (KNOWN_KEYWORDS.has(upper)) {
    return { text: rawMessage, intent: { intent: 'UNKNOWN', rawMessage } };
  }

  // Detect comma/space-separated numbers for multi-item selection (e.g. "3, 4, 5" or "1 2 3")
  const multiSelectRaw = rawMessage.trim();
  const multiNums = multiSelectRaw.match(/^\d+(?:[\s,]+\d+)+$/);
  if (multiNums) {
    const nums = (multiSelectRaw.match(/\d+/g) ?? []).map(Number);
    if (nums.length > 1 && nums.every(n => n >= 1 && n <= products.length)) {
      return {
        text: `MULTI_SELECT:${nums.join(',')}`,
        intent: { intent: 'UNKNOWN', rawMessage },
      };
    }
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
      return { text: 'MENU', intent };

    case 'MULTI_ORDER':
      return { text: 'MULTI_ORDER', intent };

    case 'MODIFY_CART':
      return { text: 'MODIFY_CART', intent };

    case 'REPEAT_ORDER':
      return { text: 'REPEAT_ORDER', intent };

    case 'SHOW_CHEAPEST':
      return { text: 'SHOW_CHEAPEST', intent };

    case 'SHOW_POPULAR':
      return { text: 'SHOW_POPULAR', intent };

    case 'ORDER': {
      const match = products.find(
        (p) =>
          p.name.toLowerCase().includes(intent.productHint.toLowerCase()) ||
          intent.productHint.toLowerCase().includes(p.name.toLowerCase()),
      );
      if (match) {
        const productIndex = products.indexOf(match) + 1;
        return { text: String(productIndex), intent };
      }
      return { text: 'ORDER:NOT_FOUND', intent };
    }

    case 'PRICE_ENQUIRY': {
      const match = products.find((p) =>
        p.name.toLowerCase().includes(intent.productHint.toLowerCase()) ||
        intent.productHint.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]),
      );
      return { text: match ? `PRICE:${match.id}` : 'PRICE:NOT_FOUND', intent };
    }

    case 'DELIVERY_ENQUIRY':
      return { text: 'DELIVERY_INFO', intent };

    default:
      return { text: rawMessage, intent };
  }
}
