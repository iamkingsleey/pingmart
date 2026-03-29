# Vendor Onboarding Skill — Pingmart

## Overview
Vendor onboarding is a fully conversational, LLM-powered flow that guides a new vendor through setting up their Pingmart store over WhatsApp. It must feel like talking to a helpful assistant — not filling out a form.

## File Location
`src/services/vendor-onboarding.service.ts`

## Who Triggers Onboarding
When a message arrives from an unknown phone number on the Pingmart number, the router shows two options:
1. Shop from a vendor (customer)
2. Open my own store (vendor)

If they reply "2" → `startVendorOnboarding(phone)` is called.

## Onboarding States

| Step | State | What's collected |
|---|---|---|
| 1 | `COLLECTING_INFO` | Business name, store code, business type, description, working hours, payment preference |
| 2 | `ADDING_PRODUCTS` | Product list (name, price, category, optional description) |
| 3 | `PAYMENT_SETUP` | Paystack key OR bank name + account number + account name |
| 4 | `CONFIRMATION` | Full summary shown — vendor types "GO LIVE" |
| 5 | `COMPLETE` | `vendor.isActive = true`, store link generated |

## LLM Agent Rules

### COLLECTING_INFO
The LLM must extract these fields from natural conversation:
- `businessName` — "Mama Tee's Kitchen" / "my shop is called..." / just a name
- `storeCode` — auto-suggested from business name (e.g. MAMATEE). Must be unique. Check DB.
- `businessType` — food | fashion | beauty | digital | general
- `description` — 1-2 sentence store description customers will see
- `workingHoursStart` / `workingHoursEnd` — "8am to 10pm" → "08:00" / "22:00"
- `workingDays` — "Monday to Saturday" → "1,2,3,4,5,6"
- `paymentMethod` — paystack | bank | both

The LLM maintains conversation history (last 20 exchanges) so it has full context. It must ask follow-up questions naturally until ALL required fields are collected.

### ADDING_PRODUCTS
Accept products in multiple formats:
```
Product Name | Price | Category
Product Name | Price | Category | Description
```

Price formats to accept (strip and normalize all of these):
- `₦21,500` → 2150000 kobo
- `21,500` → 2150000 kobo
- `₦21500` → 2150000 kobo
- `21500` → 2150000 kobo

**All monetary values stored in KOBO (multiply ₦ by 100)**

Multi-line bulk entry: vendor can paste 10 products at once. Parse each line independently. Report back a summary: "Got it! Added 10 products ✅" — list them back for confirmation.

Type "DONE" to finish adding products and advance to PAYMENT_SETUP.

### PAYMENT_SETUP — Critical Rules

**ALWAYS run LLM intent check before format validation in this step.**

Classify vendor input as one of:
- `PROVIDING_PAYSTACK_KEY` — starts with sk_live_ or sk_test_
- `SKIP_PAYSTACK` — "ignore paystack", "bank transfer only", "I don't use paystack"
- `PROVIDING_BANK_DETAILS` — bank name + account number mentioned
- `ASKING_HELP` — confused, asking what Paystack is

If `SKIP_PAYSTACK`:
- Set `paymentMethod: 'bank_transfer'` on vendor
- Skip Paystack step entirely
- Reply: "No problem! We'll use bank transfer only. Your customers will see your bank details at checkout. ✅"
- Advance to collecting bank details

**Paystack key stored AES-256-GCM encrypted** — never plaintext in DB.
**Bank account number stored AES-256-GCM encrypted** — never plaintext in DB.

### CONFIRMATION
Show a full summary before going live:
```
🏪 *[Business Name]*
📦 Store Code: [STORECODE]
🕐 Hours: [Mon-Sat, 8am-10pm]
💳 Payment: [Bank Transfer]
🛍️ Products: [X items added]

Type *GO LIVE* to publish your store, or tell me what to change.
```

After "GO LIVE":
1. Set `vendor.isActive = true`
2. Generate the store WhatsApp deep link: `wa.me/{PINGMART_NUMBER}?text={STORECODE}`
3. Send the link to the vendor with instructions to share it with customers

## Store Link Format
```
Your store is live! 🎉

Share this link with your customers:
https://wa.me/2348XXXXXXXXX?text=MAMATEE

When they tap it, they'll land directly on your store. 🛍️
```

## Conversation History
History is stored in `VendorSetupSession.collectedData.history` as an array of `{role, content}` objects. Keep last 20 exchanges max to stay within LLM context limits. Trim oldest entries when limit is reached.

## Resuming Onboarding
If a vendor messages the bot again mid-onboarding (e.g. they closed WhatsApp and came back), the bot must resume from their last saved step — not restart from the beginning. Always load `VendorSetupSession` first.

## Error Recovery
If a vendor provides invalid info (e.g. store code already taken):
- Suggest 3 alternative store codes
- Don't ask them to start over — just fix that one field
- Keep all other collected data intact
