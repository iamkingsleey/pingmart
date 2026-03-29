# Webhook Handler Skill — Pingmart

## Overview
The WhatsApp webhook is the entry point for ALL incoming messages. It must respond to Meta within 200ms or Meta will retry — causing duplicate processing. All heavy work happens asynchronously via Bull queues.

## File Location
`src/webhooks/whatsapp.webhook.ts`
`src/queues/incomingMessage.queue.ts`
`src/queues/message.queue.ts` — outgoing messages

## Two Webhook Endpoints

### GET /webhooks/whatsapp — Verification (one-time setup)
Meta calls this to verify your webhook is real.

```typescript
export function handleWhatsAppVerification(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge); // Must send challenge as plain text
  } else {
    res.status(403).json({ error: 'Verification failed' });
  }
}
```

**Common failure reasons:**
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` not set in environment
- App not running when Meta sends verification
- Wrong URL in Meta console (must end in `/webhooks/whatsapp` not just `/webhook`)

### POST /webhooks/whatsapp — Incoming Messages
```typescript
export async function handleWhatsAppWebhook(req: Request, res: Response): Promise<void> {
  // Step 1: IMMEDIATELY respond 200 — do not wait for processing
  res.status(200).json({ status: 'received' });

  // Step 2: Enqueue for async processing
  // All logic happens in the queue worker — not here
}
```

**Never do database queries or LLM calls in the webhook handler.** Only enqueue.

## Message Deduplication
Meta can send the same message multiple times (retries). Use Redis to deduplicate:

```typescript
const dedupKey = `msg:processed:${message.id}`;
const isNew = await redis.set(dedupKey, '1', 'EX', 86400, 'NX');
if (!isNew) {
  logger.warn('Duplicate message skipped', { id: message.id });
  return;
}
```

TTL of 86400 seconds (24 hours) is sufficient since Meta retries within minutes.

## Message Types Handled

| Type | Source | How handled |
|---|---|---|
| `text` | Customer/vendor types | `message.text.body` |
| `interactive` | Button/list reply | `message.interactive.button_reply.title` or `list_reply.title` |
| `audio` | Voice note | Transcribe via Groq Whisper → treat as text |
| `image` | Photo sent | Acknowledge receipt, log for vendor review |
| `document` | File sent | Acknowledge receipt |
| `status` | Delivery receipt | Log only, no user-facing action |

## Phone Number Normalization
Meta sends phone numbers in inconsistent formats. Always normalize to E.164:

```typescript
// normalisePhone() in src/utils/formatters.ts
// "+1 555-193-1414" → "+15551931414"
// "2348012345678" → "+2348012345678"
```

## Payload Structure
```typescript
interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        metadata: { phone_number_id: string; display_phone_number: string };
        messages?: WhatsAppMessage[];
        statuses?: WhatsAppStatus[];
      };
    }>;
  }>;
}
```

Always guard against empty arrays: `payload.entry ?? []`, `entry.changes ?? []`, `value.messages ?? []`

## Outgoing Message Queue
All bot responses are sent via Bull queue — never directly from handlers:

```typescript
await messageQueue.add(
  { to: customerPhone, message: responseText },
  { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true }
);
```

Queue config:
- `attempts: 3` — retry failed sends up to 3 times
- `backoff: exponential` — wait longer between each retry
- `removeOnComplete: true` — clean up queue after success

## Webhook App Secret Verification
For production, verify Meta's `x-hub-signature-256` header on every POST:

```typescript
const signature = req.headers['x-hub-signature-256'];
const expectedSig = 'sha256=' + crypto
  .createHmac('sha256', env.WHATSAPP_APP_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== expectedSig) {
  logger.warn('Invalid webhook signature');
  return res.status(403).end();
}
```

## Changing the Webhook URL
When the URL changes (e.g. new ngrok, Railway deploy):
1. Go to Meta Developer Console → App → WhatsApp → Configuration
2. Update Callback URL
3. Click "Verify and Save" — Meta sends a GET to verify immediately
4. If verification fails, the bot stops receiving messages silently

Always check Railway logs after a URL change to confirm webhook is live.
