/**
 * Store Vocabulary — adapts bot language to match the vendor's business category.
 *
 * Food vendors → "Menu", "Order", "Dish"
 * Fashion vendors → "Catalogue", "Shop", "Piece"
 * Beauty/Skincare → "Catalogue", "Shop", "Product"
 * Electronics → "Products", "Browse", "Device"
 * Digital → "Store", "Browse", "Product"
 * Groceries → "Store", "Shop", "Item"
 * Health/Pharma → "Products", "Browse", "Product"
 * General → "Catalogue", "Browse", "Item"
 *
 * Vocabulary is resolved once from vendor.businessType and injected via
 * AsyncLocalStorage so every outgoing message is automatically adapted
 * without threading the value through every function call.
 */

import { StoreVocabulary } from '../types';

/**
 * Derives the correct vocabulary set from a vendor's businessType string.
 * The match is regex-based so partial and compound values ("food & drink",
 * "fashion boutique") are handled naturally.
 */
export function resolveStoreVocabulary(businessType: string): StoreVocabulary {
  const bt = (businessType ?? 'general').toLowerCase().trim();

  // Food & Drink, Restaurant, Bakery, Juice bar, etc.
  if (/food|drink|restaurant|bakery|juice|cafe|bar|snack|kitchen|eatery|grill|lounge/.test(bt)) {
    return {
      browseCommand:   'MENU',
      browseNoun:      'menu',
      browseNounTitle: 'Menu',
      actionVerb:      'browse',
      itemNoun:        'dish',
      itemNounPlural:  'dishes',
    };
  }

  // Fashion, Clothing, Footwear, Accessories
  if (/fashion|cloth|footwear|shoe|accessor|apparel|wear|outfit|boutique/.test(bt)) {
    return {
      browseCommand:   'CATALOGUE',
      browseNoun:      'catalogue',
      browseNounTitle: 'Catalogue',
      actionVerb:      'shop',
      itemNoun:        'piece',
      itemNounPlural:  'pieces',
    };
  }

  // Beauty & Skincare, Cosmetics, Haircare, Nails, Lashes
  if (/beauty|skincare|cosmetic|haircare|makeup|nail|lash|spa/.test(bt)) {
    return {
      browseCommand:   'CATALOGUE',
      browseNoun:      'catalogue',
      browseNounTitle: 'Catalogue',
      actionVerb:      'shop',
      itemNoun:        'product',
      itemNounPlural:  'products',
    };
  }

  // Electronics, Gadgets, Tech
  if (/electron|gadget|tech|device|computer|phone|appliance|hardware/.test(bt)) {
    return {
      browseCommand:   'PRODUCTS',
      browseNoun:      'products',
      browseNounTitle: 'Products',
      actionVerb:      'browse',
      itemNoun:        'device',
      itemNounPlural:  'devices',
    };
  }

  // Digital Products, Software, Courses
  if (/digital|software|course|ebook|download|subscription|license/.test(bt)) {
    return {
      browseCommand:   'STORE',
      browseNoun:      'store',
      browseNounTitle: 'Store',
      actionVerb:      'browse',
      itemNoun:        'product',
      itemNounPlural:  'products',
    };
  }

  // Furniture, Home Decor
  if (/furniture|decor|interior|furnish/.test(bt)) {
    return {
      browseCommand:   'CATALOGUE',
      browseNoun:      'catalogue',
      browseNounTitle: 'Catalogue',
      actionVerb:      'browse',
      itemNoun:        'piece',
      itemNounPlural:  'pieces',
    };
  }

  // Groceries, Supermarket
  if (/grocer|supermarket|mart|fresh produce|farm/.test(bt)) {
    return {
      browseCommand:   'STORE',
      browseNoun:      'store',
      browseNounTitle: 'Store',
      actionVerb:      'shop',
      itemNoun:        'item',
      itemNounPlural:  'items',
    };
  }

  // Health & Wellness, Pharmacy
  if (/health|pharmacy|medical|drug|hospital|clinic|wellness/.test(bt)) {
    return {
      browseCommand:   'PRODUCTS',
      browseNoun:      'products',
      browseNounTitle: 'Products',
      actionVerb:      'browse',
      itemNoun:        'product',
      itemNounPlural:  'products',
    };
  }

  // General / Unknown — default
  return {
    browseCommand:   'CATALOGUE',
    browseNoun:      'catalogue',
    browseNounTitle: 'Catalogue',
    actionVerb:      'browse',
    itemNoun:        'item',
    itemNounPlural:  'items',
  };
}

/**
 * Replaces all customer-visible MENU/menu/Menu references in a message with the
 * correct vocabulary word for the store's category.
 *
 * Fast path: food stores use MENU (the default) — no substitution is performed.
 *
 * Replacements applied in order:
 *   1. *MENU*  → *{browseCommand}*       (WhatsApp bold command)
 *   2. MENU    → {browseCommand}         (plain uppercase command)
 *   3. Menu    → {browseNounTitle}       (title-case display noun)
 *   4. menu    → {browseNoun}            (lowercase display noun)
 */
export function applyVocabulary(text: string, vocab: StoreVocabulary): string {
  if (vocab.browseCommand === 'MENU') return text; // no-op for food stores
  return text
    .replace(/\*MENU\*/g, `*${vocab.browseCommand}*`)
    .replace(/\bMENU\b/g, vocab.browseCommand)
    .replace(/\bMenu\b/g, vocab.browseNounTitle)
    .replace(/\bmenu\b/g, vocab.browseNoun);
}

/**
 * Command words customers may type after seeing vocabulary-adapted messages.
 * All of these should be treated as MENU by the state machine and LLM router.
 */
export const BROWSE_COMMAND_ALIASES = new Set([
  'CATALOGUE', 'CATALOG', 'PRODUCTS', 'OFFERINGS', 'OUR STORE',
]);
