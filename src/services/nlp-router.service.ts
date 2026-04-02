/**
 * NLP Router — bridges LLM intent with the existing conversation state machine
 */
import { interpretMessage, CustomerIntent, extractItemSelections } from './llm.service';
import { Product } from '@prisma/client';
import { BROWSE_COMMAND_ALIASES } from '../utils/store-vocabulary';

export interface NormalisedMessage {
  text: string;
  intent: CustomerIntent;
}

// Single digits and common keywords are already in canonical form — skip LLM entirely.
// Button reply IDs (CONFIRM_CART, EDIT_CART, etc.) MUST be listed here so they
// are never transformed by the LLM — the awaitingCartReview handler matches them verbatim.
const KNOWN_KEYWORDS = new Set([
  'MENU', 'CANCEL', 'STOP', 'QUIT', 'EXIT', 'BACK',
  'CONFIRM', 'CART', 'DONE', 'CHECKOUT', 'CLEAR',
  'BUY', 'YES', 'NO', 'SKIP',
  'HELP', 'STATUS', 'ORDER STATUS',
  // Cart review button IDs — must pass through unchanged
  'CONFIRM_CART', 'EDIT_CART',
  // Global command aliases (COMMANDS.md) — interceptor normalizes these before
  // NLP router runs, but listing them here ensures they skip LLM if they ever
  // reach this layer (e.g. in processIncomingMessage for active customer sessions).
  'HOME',         // → MENU
  'ASSIST',       // → HELP
  'COMOT',        // → CANCEL (Pidgin)
  'MY CART',      // → CART  (Pidgin)
  'I DON FINISH', // → DONE  (Pidgin)
  'ORDERS',       // customer order history command
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

export async function normaliseMessage(
  rawMessage: string,
  products: Product[],
  sessionState: string,
  onBeforeLlm?: () => Promise<void>,
): Promise<NormalisedMessage> {
  // Normalize internal whitespace so "order  status" matches "ORDER STATUS"
  const upper = rawMessage.trim().toUpperCase().replace(/\s+/g, ' ');

  // Vocabulary-adapted browse commands (CATALOGUE, PRODUCTS, OFFERINGS, etc.)
  // Route to MENU so the state machine always sees the canonical keyword.
  if (BROWSE_COMMAND_ALIASES.has(upper)) {
    return { text: 'MENU', intent: { intent: 'MENU' } };
  }

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

  // Detect natural-language multi-item-by-number selection:
  // "I also selected 10 and 14 in addition to 5", "Items 4 and 9 please",
  // "I wan take number 2, 5 and 8", "Give me 2 of item 3 and 1 of item 7"
  //
  // Heuristic: message contains ≥2 distinct numbers in the valid catalogue range.
  // Pure "1 2 3" is already caught by the regex above; this handles mixed NL.
  // Only runs when the catalogue has ≥2 products to avoid false positives.
  if (products.length >= 2) {
    const allNums = (rawMessage.match(/\b\d{1,2}\b/g) ?? []).map(Number);
    const inRange   = allNums.filter(n => n >= 1 && n <= products.length);
    const uniqueInRange = [...new Set(inRange)];
    if (uniqueInRange.length >= 2) {
      // Likely a multi-item selection — use LLM to extract items + quantities precisely
      if (onBeforeLlm) await onBeforeLlm();
      const selections = await extractItemSelections(rawMessage, products.length);
      if (selections.length >= 2) {
        const token = selections.map(s => `${s.itemNumber}:${s.quantity}`).join(',');
        return {
          text: `MULTI_SELECT_QTY:${token}`,
          intent: { intent: 'UNKNOWN', rawMessage },
        };
      }
      // Fewer than 2 items parsed — fall through to standard LLM classification
    }
  }

  const productNames = products.map((p) => p.name);
  // Notify caller we're about to make the slow LLM call — lets them send an ack message
  if (onBeforeLlm) await onBeforeLlm();
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

    case 'TRACK_ORDER':
      return { text: 'TRACK_ORDER', intent };

    case 'SPEAK_TO_VENDOR':
      return { text: 'SPEAK_TO_VENDOR', intent };

    case 'HELP':
      return { text: 'HELP', intent };

    default:
      return { text: rawMessage, intent };
  }
}
