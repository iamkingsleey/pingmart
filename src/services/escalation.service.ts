/**
 * Human Escalation Service — Phase 8
 *
 * Detects when a customer needs a real person and routes them gracefully.
 *
 * Triggers:
 *  1. Keyword-based — explicit phrases ("speak to human", "manager", "complaint", …)
 *  2. Confusion loop — 3 consecutive NLU UNKNOWN intents in the same session
 *
 * Flow:
 *  1. Customer triggers escalation → bot acknowledges + notifies ALL vendor numbers
 *  2. Vendor (any notif number / owner) replies HANDLED → bot confirms to customer
 *
 * Pending escalations are stored in Redis with a 24-hour TTL.
 * One record per vendor — subsequent escalations overwrite the previous.
 */
import { redis } from '../utils/redis';
import { messageQueue } from '../queues/message.queue';
import { notifyVendorNumbers } from './vendor-notify.service';
import { formatNaira, formatOrderId } from '../utils/formatters';
import { logger, maskPhone } from '../utils/logger';

// ─── Escalation Triggers ─────────────────────────────────────────────────────

const ESCALATION_TRIGGERS = [
  // Explicit human-contact requests
  'speak to human', 'talk to someone', 'real person', 'customer service',
  'manager', 'owner', 'complaint', 'this is wrong', 'i want to complain',
  // Frustration signals
  'this is rubbish', 'useless bot', 'nonsense', 'stupid',
  'i am angry', 'very annoyed', 'this is frustrating',
  // Complex requests the bot cannot handle
  'bulk order', 'event catering', 'partnership', 'wholesale',
];

/**
 * Returns true if `message` contains any escalation trigger phrase.
 * Matching is case-insensitive substring.
 */
export function detectEscalationTrigger(message: string): boolean {
  const lower = message.toLowerCase();
  return ESCALATION_TRIGGERS.some((trigger) => lower.includes(trigger));
}

// ─── Redis Record ─────────────────────────────────────────────────────────────

const ESCALATION_TTL_SECS = 24 * 60 * 60; // 24 hours
const escalationKey = (vendorId: string) => `escalation:vendor:${vendorId}`;

interface EscalationRecord {
  customerPhone: string;
  customerName: string;
  lastMessage: string;
  reason: string;
  orderId?: string;
  orderTotal?: number;
}

// ─── Trigger ─────────────────────────────────────────────────────────────────

/**
 * Sends the escalation acknowledgement to the customer and fires an alert to
 * all active vendor notification numbers (fan-out via notifyVendorNumbers).
 */
export async function triggerHumanEscalation(params: {
  customerPhone: string;
  customerName: string;
  lastMessage: string;
  reason: string;
  vendor: { id: string; businessName: string; whatsappNumber: string };
  orderId?: string;
  orderTotal?: number;
}): Promise<void> {
  const record: EscalationRecord = {
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    lastMessage: params.lastMessage,
    reason: params.reason,
    orderId: params.orderId,
    orderTotal: params.orderTotal,
  };
  await redis.setex(escalationKey(params.vendor.id), ESCALATION_TTL_SECS, JSON.stringify(record));

  // ── Tell the customer we're connecting them ───────────────────────────────
  await messageQueue.add({
    to: params.customerPhone,
    message:
      `I completely understand — let me connect you with the team at *${params.vendor.businessName}* right away. 🙏\n\n` +
      `I'm notifying them now. Someone will reply you shortly.\n\n` +
      `In the meantime, is there anything quick I can help with while you wait? 😊`,
  });

  // ── Build vendor alert ────────────────────────────────────────────────────
  const displayPhone = maskPhone(params.customerPhone);
  let vendorMsg =
    `🚨 *CUSTOMER NEEDS ATTENTION*\n\n` +
    `Customer: ${params.customerName} (${displayPhone})\n` +
    `Reason: ${params.reason}\n` +
    `Last message: "${params.lastMessage.substring(0, 100)}"`;

  if (params.orderId && params.orderTotal !== undefined) {
    vendorMsg += `\n\nOrder in progress: ${formatOrderId(params.orderId)} — ${formatNaira(params.orderTotal)}`;
  }

  vendorMsg +=
    `\n\nPlease reply to this customer directly on WhatsApp.\n` +
    `Their number: ${params.customerPhone}\n\n` +
    `Reply *HANDLED* when you've spoken to them.`;

  await notifyVendorNumbers(params.vendor.id, params.vendor.whatsappNumber, vendorMsg);

  logger.info('Human escalation triggered', {
    vendorId: params.vendor.id,
    customer: maskPhone(params.customerPhone),
    reason: params.reason,
  });
}

// ─── Resolve (HANDLED command) ────────────────────────────────────────────────

/**
 * Called when a vendor (owner or primary notif number) replies HANDLED.
 * Looks up the pending escalation record, sends the customer a confirmation,
 * and clears the record from Redis.
 *
 * @returns true if an escalation was found and resolved, false otherwise.
 */
export async function resolveEscalation(
  vendorPhone: string,
  vendor: { id: string; businessName: string },
): Promise<boolean> {
  const raw = await redis.get(escalationKey(vendor.id));
  if (!raw) {
    await messageQueue.add({
      to: vendorPhone,
      message: `ℹ️ No pending customer escalations found for *${vendor.businessName}*.`,
    });
    return false;
  }

  const record = JSON.parse(raw) as EscalationRecord;
  await redis.del(escalationKey(vendor.id));

  // Confirm to the customer
  const name = record.customerName || 'there';
  await messageQueue.add({
    to: record.customerPhone,
    message:
      `The team has been notified and will reach out to you directly.\n\n` +
      `Thanks for your patience, ${name}! 😊`,
  });

  // Confirm to the vendor who typed HANDLED
  await messageQueue.add({
    to: vendorPhone,
    message: `✅ Done! *${name}* has been notified that the team will be in touch.`,
  });

  logger.info('Escalation resolved', {
    vendorId: vendor.id,
    vendor: maskPhone(vendorPhone),
    customer: maskPhone(record.customerPhone),
  });

  return true;
}
