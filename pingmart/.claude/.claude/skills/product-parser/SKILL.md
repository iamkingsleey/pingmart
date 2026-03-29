# Product Parser Skill — Pingmart

## Overview
The product parser handles how vendor-submitted product strings are parsed into structured database records. It must be resilient to all real-world formatting variations Nigerian vendors will use.

## File Location
Product parsing logic lives in `src/services/vendor-onboarding.service.ts` in the `ADDING_PRODUCTS` step handler.

## Input Formats Supported

### Pipe-separated (primary format)
```
Product Name | Price | Category
Product Name | Price | Category | Description
```

### Multi-line bulk (vendor pastes many at once)
```
CeraVe Foaming Facial Cleanser | ₦21,500 | Cleanser
Neutrogena Men Face Wash | ₦21,300 | Cleanser
Kiehl's Moisturizer | ₦64,600 | Moisturizer
```
Each line is parsed independently. Return a summary count, not individual confirmations.

### Natural language (LLM extracts)
```
"I have chicken shawarma for 2500 and beef shawarma for 2000"
```
Use LLM to extract: `[{name: "Chicken Shawarma", price: 2500}, {name: "Beef Shawarma", price: 2000}]`

## Price Normalization — CRITICAL

All prices must be converted to KOBO (multiply by 100) before storing in DB.

Strip and normalize ALL of these formats:
```typescript
function normalizePrice(raw: string): number {
  // Remove naira symbol, commas, whitespace
  const cleaned = raw
    .replace(/₦/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();

  const naira = parseFloat(cleaned);
  if (isNaN(naira) || naira <= 0) throw new Error(`Invalid price: ${raw}`);

  return Math.round(naira * 100); // convert to kobo
}
```

Accepted price input formats:
- `₦21,500` ✅
- `21,500` ✅
- `₦21500` ✅
- `21500` ✅
- `21.5k` ✅ → 21500 → 2150000 kobo
- `N21500` ✅ (some vendors type N instead of ₦)

## Field Trimming
Always trim whitespace around pipe-separated values:
```typescript
const parts = line.split('|').map(p => p.trim());
```

This handles:
- `Name | Price | Category` (spaces around pipes)
- `Name|Price|Category` (no spaces)
- `Name  |  Price  |  Category` (extra spaces)

## Minimum Required Fields
- `name` — required
- `price` — required (must be valid number > 0)
- `category` — required
- `description` — optional (4th field if present)

## Validation Rules
- Name: max 100 characters, not empty
- Price: must be a positive number in kobo after conversion. Reject 0 or negative.
- Category: max 50 characters, not empty
- Description: max 255 characters if provided

## Error Handling Per Line
When parsing multi-line bulk submissions, don't reject the whole batch if one line fails.
Track successes and failures separately:

```typescript
const results = { added: [], failed: [] };
for (const line of lines) {
  try {
    results.added.push(parseProductLine(line));
  } catch (e) {
    results.failed.push({ line, reason: e.message });
  }
}
```

Reply with:
```
Added 9 products ✅
1 product couldn't be read — please re-send this one:
"Jack Black Pure | abc | Exfoliator" (price format issue)
```

## Category Auto-Suggestions
If the vendor provides a category that doesn't match common categories, accept it as-is but log it. Do NOT reject unknown categories — vendors know their business better.

Common Nigerian vendor categories:
- Food: Rice Dishes, Proteins, Drinks, Soups, Snacks, Grills
- Beauty: Cleanser, Moisturizer, Serum, Sunscreen, Exfoliator, Toner
- Fashion: Tops, Bottoms, Dresses, Shoes, Accessories
- General: keep as provided

## Display Formatting (Customer-facing)
When showing products to customers, format prices back from kobo to naira:
```typescript
function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}
// 2150000 → "₦21,500"
```
