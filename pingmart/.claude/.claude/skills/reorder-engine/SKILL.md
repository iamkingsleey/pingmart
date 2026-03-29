# Reorder Engine Skill — Pingmart

## Overview
The reorder engine sends personalised WhatsApp nudges to customers after a configurable number of days post-order, encouraging repeat purchases. It requires customer opt-in and uses Meta-approved message templates.

## File Location
`src/services/reorder.service.ts` — nudge builder
`src/jobs/reorder.job.ts` — scheduled Bull job

## Configuration
```
REORDER_DAYS_AFTER=7   # days after completed order to send nudge
# 7  = weekly repeat customers (food, groceries, everyday items)
# 14 = bi-weekly (household supplies, skincare)
# 30 = monthly (bulk orders, specialty items)
```

Read in code as:
```typescript
const reorderDaysAfter = parseInt(process.env.REORDER_DAYS_AFTER ?? '7', 10);
```

## Opt-In Requirement (WhatsApp Policy)
**Customers MUST opt in before receiving re-order nudges.**

After every completed order, the bot asks:
```
Would you like us to remind you when it's time to reorder?
Reply *YES* to get a nudge in {N} days 😊
```

Store opt-in as `VendorCustomer.reorderOptIn = true`.

If customer replies *NO* or never replies → do not send nudge. Respect this choice permanently until they opt in again.

## Meta Template Requirement
Re-order nudges are sent outside the 24-hour conversation window, so they MUST use a Meta-approved Message Template.

Template name: `reorder_nudge`
Template must be registered in Meta Business Manager and approved before use.

Example template:
```
Hi {{1}}, it's been a while since your last order from {{2}}.

Your last order:
{{3}}

Total: {{4}}

Ready to order again? Reply *YES* to reorder instantly or *NO* to skip. 🍽️
```

Parameters:
1. Customer first name
2. Vendor business name
3. Order items summary
4. Total amount in ₦

## Nudge Message Format (template content)
```typescript
const message =
  `Hey ${customerName}! 👋 It's been a week since you ordered from us.\n\n` +
  `Your last order was:\n${itemLines}\n\n` +
  `Total: ${formatNaira(order.totalAmount)}\n\n` +
  `Want to order the same again? Reply *YES* to reorder instantly or *NO* to skip. 🍽️`;
```

## Customer Responses to Nudge

| Reply | Action |
|---|---|
| `YES` / `yes` / `yeah` / `abeg` | Restore last order as new cart → prompt confirmation |
| `NO` / `no` / `nope` | Acknowledge, offer menu instead |
| `OPT OUT` / `stop` / `unsubscribe` | Set `reorderOptIn = false`, confirm opt-out |

## Scheduled Job
The reorder job runs daily and finds all eligible orders:

```typescript
// Pseudocode
const cutoffDate = subDays(new Date(), reorderDaysAfter);
const eligibleOrders = await prisma.order.findMany({
  where: {
    status: 'COMPLETED',
    createdAt: { lte: cutoffDate },
    reorderNudgeSent: false,
    customer: { reorderOptIn: true },
  },
  include: { customer: true, orderItems: { include: { product: true } } }
});

for (const order of eligibleOrders) {
  await sendReorderNudge(order);
  await prisma.order.update({ where: { id: order.id }, data: { reorderNudgeSent: true } });
}
```

## Reorder Execution
When customer replies YES to a nudge:
1. Load their last order's items
2. Check all products still exist and are in stock
3. Create a new cart with those items
4. Show cart summary + ask to CONFIRM or modify
5. Proceed through normal checkout flow

If any product is no longer available:
```
Some items from your last order are no longer available:
❌ Chapman (Large) — no longer on menu

Here's what we can reorder:
✅ 2x Jollof Rice — ₦5,000

Would you like to continue with the available items? Reply YES or NO.
```

## Rate Limiting
Never send more than 1 reorder nudge per customer per vendor per 7 days — regardless of how many orders they've placed. Track `lastNudgeSentAt` on `VendorCustomer`.

## Cost Awareness
Meta charges ~$0.0147 per marketing conversation (Nigeria rate as of 2025).
At 1,000 nudges/month = ~$14.70. Factor this into vendor pricing at scale.
