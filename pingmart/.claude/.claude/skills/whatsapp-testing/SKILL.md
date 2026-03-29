# WhatsApp Testing Skill — Pingmart

## Overview
Testing the Pingmart bot requires understanding Meta's test number restrictions, how to simulate both vendor and customer flows, and how to debug issues from logs.

## Test Environment Setup

### Meta Test Number Limits
- Only approved test numbers can message the bot in test mode
- Max 5 test numbers allowed (free/test app)
- Each number must be added in: Meta Developer Console → App → WhatsApp → API Setup → Manage phone number list
- Each number receives a verification code on WhatsApp to confirm

### Required for Testing
- At least 2 test numbers: one for vendor flow, one for customer flow
- ngrok (local) or Railway URL (production) set as webhook
- PostgreSQL + Redis running (Docker locally, or Railway managed)
- All `.env` variables populated

## Test Flows Checklist

### Flow 1: New Vendor Onboarding
- [ ] Message bot for first time — see language selection in all 5 languages
- [ ] Select a language (e.g. "2" for Pidgin)
- [ ] See welcome screen with option to shop or sell
- [ ] Reply "2" to start vendor onboarding
- [ ] Bot asks for business info conversationally
- [ ] Send business name naturally: "My shop is called Beauty Palace"
- [ ] Confirm store code suggestion or request alternative
- [ ] Add products in pipe format: `CeraVe Cleanser | ₦21,500 | Cleanser`
- [ ] Add products with naira symbol and commas — should parse correctly
- [ ] Add multiple products in one message — should parse each line
- [ ] Try: "ignore paystack I will only accept bank transfer" — should skip Paystack gracefully
- [ ] Provide bank details
- [ ] See full store summary
- [ ] Type "GO LIVE"
- [ ] Receive store WhatsApp deep link

### Flow 2: Customer Shopping (via store link)
- [ ] Tap or manually send the store code (e.g. "BEAUTYPALACE")
- [ ] See language selection on first visit
- [ ] Select language
- [ ] See vendor welcome message and menu categories
- [ ] Type MENU to see full product list
- [ ] Order by number: "1"
- [ ] Order by name: "I want the CeraVe"
- [ ] Order in Pidgin: "Abeg give me the cleanser"
- [ ] Specify quantity: "2"
- [ ] Add special note: "2 CeraVe, gift wrap please"
- [ ] Add second item
- [ ] Type CART to review
- [ ] Type CONFIRM to proceed to payment
- [ ] Complete payment flow (bank transfer or Paystack)
- [ ] Receive order confirmation

### Flow 3: Vendor Receives Order Notification
- [ ] Order placed by customer (separate test number)
- [ ] Vendor number receives notification with order details
- [ ] Notification includes: customer name, items, total, payment method
- [ ] Vendor can reply CONFIRM-{orderID} or REJECT-{orderID}

### Flow 4: Edge Cases
- [ ] Customer types "cancel" mid-order — cart clears, returns to IDLE
- [ ] Customer types "menu" mid-checkout — shows menu, doesn't lose cart
- [ ] Customer sends voice note — transcribed and processed as text
- [ ] Customer sends invalid product number — bot asks to choose from menu
- [ ] Customer sends "3, 4, 5" for multiple items — each should be processed individually
- [ ] Vendor sends products with ₦ and commas — parsed correctly
- [ ] Vendor sends "what is paystack?" mid-onboarding — bot explains and re-asks
- [ ] Duplicate WhatsApp message (simulate retry) — processed only once

### Flow 5: Language Testing
- [ ] Complete a full order flow in Pidgin
- [ ] Complete a full order flow in Igbo
- [ ] Mid-conversation language switch — bot updates language for all subsequent messages

## Local Testing with ngrok

```bash
# Terminal 1 — start server
npm run dev

# Terminal 2 — start ngrok tunnel
ngrok http 3000

# Copy the ngrok URL e.g. https://abc123.ngrok-free.app
# Go to Meta → WhatsApp → Configuration → Webhook
# Set Callback URL: https://abc123.ngrok-free.app/webhooks/whatsapp
# Set Verify Token: (your WHATSAPP_WEBHOOK_VERIFY_TOKEN value)
# Click Verify and Save
```

Note: ngrok URL changes on every restart. Update Meta webhook URL each time.

## Reading Logs

### Find a specific customer's messages
```bash
# Local
grep "08012345678" logs/app.log

# Railway
# Go to Railway → pingmart service → View Logs → search by phone (masked)
```

### Spot LLM failures
```bash
grep "LLM intent parsing failed" logs/app.log
```

### Check duplicate processing
```bash
grep "Duplicate message skipped" logs/app.log
```

## Common Issues and Fixes

| Issue | Likely Cause | Fix |
|---|---|---|
| Bot not responding | Webhook URL not updated after ngrok restart | Update Meta webhook URL |
| "Verification failed" on webhook setup | WHATSAPP_WEBHOOK_VERIFY_TOKEN not set in env | Add variable to .env or Railway Variables |
| Old vendor menu showing | Old server still running on port 3000 | `lsof -ti:3000 \| xargs kill -9` then restart |
| Message processed twice | Redis dedup key expired or Redis not running | Check Redis connection |
| Products not parsing | ₦ symbol or commas in price | Check normalizePrice() function |
| LLM not understanding intent | Missing context in system prompt | Check conversationContext being passed |
| Port 3000 already in use | Previous server instance still running | Kill the process using that port |

## Resetting Test Data
```bash
# DANGER — destroys all data. Only use in development.
npx prisma migrate reset --force

# Safer — reset just one vendor's session
# Use Prisma Studio: npm run studio → ConversationSession → delete rows
```
