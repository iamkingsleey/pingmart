# Error Handling Skill — Pingmart

## Overview
Errors in Pingmart must be caught, logged internally, and responded to with safe, user-friendly messages. Stack traces and internal details must NEVER reach the customer or vendor over WhatsApp.

## File Location
`src/utils/logger.ts` — structured logger
`src/middlewares/` — Express error middleware
`src/services/` — domain-level error handling

## The Golden Rule
```
User sees: friendly message
Logs see: full error + context
```

Never do this:
```typescript
// WRONG — leaks internal details
res.status(500).json({ error: error.message, stack: error.stack });
```

Always do this:
```typescript
// CORRECT — safe user message + internal logging
logger.error('Order creation failed', { error: error.message, orderId, phone: maskPhone(phone) });
await sendWhatsAppMessage(phone, "Something went wrong. Please try again or type MENU to restart. 😊");
```

## Logger Usage
Use the structured logger in `src/utils/logger.ts` — never use `console.log` in production code:

```typescript
import { logger, maskPhone } from '../utils/logger';

// Info — normal operations
logger.info('Order created', { orderId, vendorId });

// Warn — unexpected but non-critical
logger.warn('Duplicate message received', { messageId });

// Error — something failed
logger.error('LLM call failed', { error: err.message, phone: maskPhone(phone) });

// Debug — verbose, only in development
logger.debug('LLM raw response', { raw: jsonText.substring(0, 200) });
```

## maskPhone() — Always Use for Phone Numbers in Logs
Phone numbers are PII — never log them in full:
```typescript
maskPhone('+2348012345678') → '+234801****678'
```

Always import and use `maskPhone()` when logging phone numbers.

## Never Log These
- Passwords or API keys
- Full phone numbers (use maskPhone)
- Paystack keys
- Bank account numbers
- Any decrypted sensitive data
- Customer names combined with order details (PII)

## Error Recovery Patterns

### LLM Failure
```typescript
try {
  return await interpretMessage(text, products, context);
} catch (err) {
  logger.error('LLM intent parsing failed', { error: err.message });
  // Graceful fallback — treat as UNKNOWN, let keyword matching handle it
  return { intent: 'UNKNOWN', rawMessage: text };
}
```

### Database Failure
```typescript
try {
  await prisma.order.create({ data });
} catch (err) {
  logger.error('Order creation failed', { error: err.message, vendorId, phone: maskPhone(phone) });
  await messageQueue.add({ to: phone, message: "Sorry, we couldn't place your order. Please try again. 😊" });
}
```

### WhatsApp Send Failure
The message queue handles retries automatically (3 attempts, exponential backoff). If all 3 fail, log the final failure — do not crash the worker.

### Webhook Processing Failure
```typescript
try {
  await processMessage(message);
} catch (err) {
  // Log but do not rethrow — we already sent 200 to Meta
  logger.error('Webhook processing error', { error: err.message });
}
```

## User-Facing Error Messages
All error messages to customers/vendors must be:
- Warm and helpful — never robotic
- In the user's chosen language
- Actionable — tell them what they can do next

| Scenario | Message |
|---|---|
| General error | "Something went wrong. Please try again or type MENU to start over. 😊" |
| Product not found | "Hmm, I couldn't find that item. Type MENU to see what's available." |
| Payment failed | "Your payment didn't go through. Please try again or choose a different payment method." |
| Store closed | "We're currently closed. We open at {time}. You can leave your order and we'll process it when we open! 🌙" |
| LLM unavailable | Fall back silently to keyword matching — never tell the user the AI is down |

## Express Error Middleware
Global error handler catches any unhandled errors in Express routes:

```typescript
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled Express error', { error: err.message, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
  // Never send err.message or err.stack to the client
});
```

## Uncaught Exception Handler
In `src/server.ts`, handle uncaught exceptions to prevent silent crashes:

```typescript
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1); // Let Railway/PM2 restart the process
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});
```
