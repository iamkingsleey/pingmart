/**
 * Support Mode Onboarding — service-based vendors (laundry, salon, repair, etc.)
 *
 * Steps (VendorSetupSession.step values):
 *   SUPPORT_ADDING_SERVICES — vendor lists their services with pricing
 *   SUPPORT_ADDING_FAQS     — vendor adds FAQ pairs (skippable)
 *   PAYMENT_SETUP           — shared with product store flow (bank / Paystack)
 *   SUPPORT_CONFIRMATION    — shows full summary, waits for GO LIVE
 *
 * Exported functions called from vendor-onboarding.service.ts (for routing) and
 * called directly by the router for support onboarding steps.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Vendor, VendorSetupSession, Prisma } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { messageQueue } from '../queues/message.queue';
import { InteractiveButton } from '../types';
import { encryptBankAccount } from '../utils/crypto';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';

type PrismaJson = Prisma.InputJsonValue;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceItemInput {
  name: string;
  price: number; // naira (converted to kobo on save)
  unit?: string; // pricing description exactly as vendor stated; absent = inferred default
  turnaroundHours?: number;
  description?: string;
}

export interface SupportCollectedData {
  // Core info (set during COLLECTING_INFO — shared)
  businessName?: string;
  storeCode?: string;
  businessType?: string;
  description?: string;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  workingDays?: string;
  paymentMethod?: string;

  // Payment details
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  paystackKeyProvided?: boolean;

  // Support-specific
  vendorMode: 'support';
  serviceLocationType?: 'fixed' | 'pickup' | 'both'; // where services are delivered
  services?: ServiceItemInput[];
  pendingServices?: ServiceItemInput[]; // awaiting confirmation gate
  faqs?: Array<{ question: string; answer: string }>;

  // Shared signals
  storeCodeConflict?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;

  // Notification numbers (collected in NOTIFICATION_SETUP, before confirmation)
  notificationNumbers?: string[];
}

// ─── LLM Client ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─── Service type vocabulary ──────────────────────────────────────────────────

const SERVICE_TYPE_LABELS: Record<string, string> = {
  laundry:    'Laundry & Dry Cleaning',
  salon:      'Salon & Spa',
  cleaning:   'Cleaning Services',
  repair:     'Repairs & Maintenance',
  tailoring:  'Tailoring & Fashion',
  logistics:  'Logistics & Delivery',
  consulting: 'Consulting & Training',
  events:     'Events & Hospitality',
};

function serviceTypeLabel(businessType?: string): string {
  return SERVICE_TYPE_LABELS[businessType ?? ''] ?? 'Services';
}

function serviceTypeEmoji(businessType?: string): string {
  const map: Record<string, string> = {
    laundry: '👔', salon: '💇', cleaning: '🧹', repair: '🔧',
    tailoring: '🧵', logistics: '🚚', consulting: '💼', events: '🎉',
  };
  return map[businessType ?? ''] ?? '🛠️';
}

function capitalise(str?: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatHours(data: SupportCollectedData): string {
  if (!data.workingHoursStart) return 'Not set';
  const days = parseDays(data.workingDays);
  return `${data.workingHoursStart} – ${data.workingHoursEnd} (${days})`;
}

function parseDays(workingDays?: string): string {
  if (!workingDays) return 'daily';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const nums = workingDays.split(',').map(Number).filter(n => n >= 0 && n <= 6);
  if (nums.length === 7) return 'daily';
  if (nums.length === 5 && !nums.includes(0) && !nums.includes(6)) return 'Mon–Fri';
  if (nums.length === 6 && !nums.includes(0)) return 'Mon–Sat';
  return nums.map(n => names[n]).join(', ');
}

function locationTypeLabel(locationType?: string): string {
  switch (locationType) {
    case 'fixed':  return '🏠 Fixed location (customers come to you)';
    case 'pickup': return '🚚 Mobile (you go to customers)';
    case 'both':   return '🔄 Both (fixed + mobile)';
    default:       return 'Not specified';
  }
}

// ─── Entry Point: Start Services Collection ───────────────────────────────────

/**
 * Called by vendor-onboarding.service.ts immediately after COLLECTING_INFO completes
 * for a service-based vendor. Shows the location type selection screen.
 */
export async function startSupportServicesStep(
  phone: string,
  data: SupportCollectedData,
): Promise<void> {
  const emoji = serviceTypeEmoji(data.businessType);
  const label = serviceTypeLabel(data.businessType);

  await messageQueue.add({
    to: phone,
    message:
      `${emoji} *Let's set up your ${label} menu!*\n\n` +
      `First — where do your customers receive your services?`,
    buttons: [
      { id: 'SVC_LOC:fixed',  title: '🏠 Fixed Location' },
      { id: 'SVC_LOC:pickup', title: '🚚 We Come to Them' },
      { id: 'SVC_LOC:both',   title: '🔄 Both' },
    ] as InteractiveButton[],
  });
}

// ─── Step: SUPPORT_ADDING_SERVICES ────────────────────────────────────────────

export async function handleSupportAddingServices(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const trimmed = message.trim();
  const upper   = trimmed.toUpperCase();
  const services = data.services ?? [];

  // ── 1. Location type selection buttons ───────────────────────────────────
  if (trimmed.startsWith('SVC_LOC:')) {
    const loc = trimmed.slice(8).toLowerCase() as 'fixed' | 'pickup' | 'both';
    if (!['fixed', 'pickup', 'both'].includes(loc)) {
      await startSupportServicesStep(phone, data);
      return;
    }
    const newData: SupportCollectedData = { ...data, serviceLocationType: loc };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });

    const label = serviceTypeLabel(data.businessType);
    await messageQueue.add({
      to: phone,
      message:
        `✅ Got it — ${locationTypeLabel(loc)}\n\n` +
        `Now list your ${label.toLowerCase()}! You can write them however makes sense for your business:\n\n` +
        `_Shirt — ₦800_\n` +
        `_Senator wear — ₦1,500_\n` +
        `_Regular wash — ₦500 per kg_\n` +
        `_Ironing only — ₦500 flat_\n` +
        `_Pick up and delivery — ₦1,000_\n\n` +
        `List as many as you like, then type *DONE* when finished.`,
    });
    return;
  }

  // ── 2. No location type yet ───────────────────────────────────────────────
  if (!data.serviceLocationType) {
    await startSupportServicesStep(phone, data);
    return;
  }

  // ── 3. Pending confirmation gate ──────────────────────────────────────────
  if (data.pendingServices?.length) {
    if (upper === 'CONFIRM_SERVICES') {
      const newServices = [...services, ...data.pendingServices];
      const newData: SupportCollectedData = {
        ...data,
        services: newServices,
        pendingServices: undefined,
      };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as PrismaJson },
      });
      const names = data.pendingServices.map((s) => `*${s.name}*`).join(', ');
      await messageQueue.add({
        to: phone,
        message:
          `✅ ${names} added!\n\n` +
          `You have *${newServices.length}* service${newServices.length !== 1 ? 's' : ''} so far.\n\n` +
          `Send more services or type *DONE* to continue. 😊`,
      });
      return;
    }

    if (upper === 'CANCEL_SERVICES') {
      const newData: SupportCollectedData = { ...data, pendingServices: undefined };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as PrismaJson },
      });
      await messageQueue.add({
        to: phone,
        message: `No problem! Send your services again — any format works. 😊`,
      });
      return;
    }

    // Anything else — re-show the confirmation
    await showPendingServicesConfirmation(phone, data.pendingServices, data.businessType);
    return;
  }

  // ── 4. DONE command ───────────────────────────────────────────────────────
  if (upper === 'DONE' || upper === 'FINISH') {
    if (services.length === 0) {
      await messageQueue.add({
        to: phone,
        message: `You haven't added any services yet! Send your first service to continue. 😊`,
      });
      return;
    }
    await advanceToFaqStep(phone, vendor, session, data);
    return;
  }

  // ── 5. Try pipe-parsing first, then LLM ──────────────────────────────────
  const pipeParsed = tryParsePipeServices(trimmed);
  let extracted: ServiceItemInput[] | null = pipeParsed;

  if (!extracted) {
    extracted = await extractServicesWithLLM(trimmed, data.businessType);
  }

  if (!extracted || extracted.length === 0) {
    await messageQueue.add({
      to: phone,
      message:
        `I couldn't quite catch that. Try something like:\n\n` +
        `_Shirt — ₦800_\n` +
        `_Regular wash — ₦500 per kg_\n` +
        `_Pick up and delivery — ₦1,000_\n\n` +
        `Or list several at once: _"Shirt 800, trousers 1000, suit 3500"_ 😊`,
    });
    return;
  }

  // Show confirmation before saving
  const newData: SupportCollectedData = { ...data, pendingServices: extracted };
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });
  await showPendingServicesConfirmation(phone, extracted, data.businessType);
}

function formatPricing(price: number, unit?: string): string {
  const naira = `₦${price.toLocaleString()}`;
  return unit ? `${naira} ${unit}` : naira;
}

async function showPendingServicesConfirmation(
  phone: string,
  services: ServiceItemInput[],
  businessType?: string,
): Promise<void> {
  const emoji = serviceTypeEmoji(businessType);

  let body: string;
  if (services.length === 1) {
    const s = services[0]!;
    body =
      `Got it! Here's what I'm adding:\n\n` +
      `${emoji} *${s.name}*\n` +
      `💰 ${formatPricing(s.price, s.unit)}\n\n` +
      `Is this correct?`;
  } else {
    const lines = services.map((s) => `• *${s.name}* — ${formatPricing(s.price, s.unit)}`);
    body =
      `Got it! Here's what I'm adding:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Save all ${services.length} services?`;
  }

  await messageQueue.add({
    to: phone,
    message: body,
    buttons: [
      { id: 'CONFIRM_SERVICES', title: '✅ Yes, Save'  },
      { id: 'CANCEL_SERVICES',  title: '✏️ Try Again' },
    ] as InteractiveButton[],
  });
}

/**
 * Fast parser for pipe-separated lines: "Name | Price" or "Name | Price | unit description"
 * Unit is optional — if absent the LLM or display layer supplies a default.
 * Falls back to null if the message has no pipe characters (LLM path handles it).
 */
function tryParsePipeServices(message: string): ServiceItemInput[] | null {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'));

  if (lines.length === 0) return null;

  const results: ServiceItemInput[] = [];
  for (const line of lines) {
    const parts = line.split('|').map((s) => s.trim());
    const [name, rawPrice, unit] = parts;

    if (!name || !rawPrice) return null;

    let priceStr = rawPrice.replace(/[₦,\s]/g, '');
    if (/^\d+(\.\d+)?k$/i.test(priceStr)) priceStr = String(parseFloat(priceStr) * 1000);
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return null;

    results.push({
      name,
      price,
      ...(unit ? { unit } : {}),
    });
  }
  return results.length > 0 ? results : null;
}

async function extractServicesWithLLM(
  message: string,
  businessType?: string,
): Promise<ServiceItemInput[] | null> {
  const prompt =
    `You are helping a ${businessType ?? 'service'} business vendor list their services for a WhatsApp store.\n\n` +
    `Extract ALL service items from this message: "${message}"\n\n` +
    `Required fields: name (string), price (number).\n` +
    `Optional field: unit — the pricing description EXACTLY as the vendor stated it.\n\n` +
    `Unit inference rules (only when vendor didn't state one):\n` +
    `- Clothing items (shirt, suit, trousers, dress, etc.) → "per item"\n` +
    `- Weight-based services → "per kg"\n` +
    `- One-time flat services (delivery, pickup, visit) → "flat fee"\n` +
    `- Session-based services (massage, haircut, etc.) → "per session"\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"services": [{"name": "...", "price": 0, "unit": "..."}], "isDone": false}\n\n` +
    `- price: plain naira number (strip ₦, commas, spaces, "naira", "k" = ×1000)\n` +
    `- Extract ALL services mentioned, even from comma-separated lists or Pidgin\n` +
    `- isDone: true if vendor says DONE/FINISH/THAT'S ALL\n` +
    `- If nothing can be extracted, return {"services": [], "isDone": false}`;

  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = result.content[0].type === 'text' ? result.content[0].text : '{}';
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText.trim();
    const parsed = JSON.parse(jsonText) as { services: ServiceItemInput[]; isDone: boolean };
    return parsed.services?.length > 0 ? parsed.services : null;
  } catch (err) {
    logger.error('Service extraction LLM error', { err });
    return null;
  }
}

async function advanceToFaqStep(
  phone: string,
  _vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { step: 'SUPPORT_ADDING_FAQS', collectedData: data as unknown as PrismaJson },
  });

  await messageQueue.add({
    to: phone,
    message:
      `🧠 *Teach your bot!*\n\n` +
      `Add common customer questions and answers so I can handle enquiries automatically.\n\n` +
      `Format each FAQ like this:\n` +
      `*Q: Your question here?*\n` +
      `*A: Your answer here.*\n\n` +
      `Example:\n` +
      `*Q: Do you offer same-day service?*\n` +
      `*A: Yes! Same-day is available for ₦500 extra within Lagos.*\n\n` +
      `You can add multiple FAQs at once. Type *SKIP* to set up payment first and add FAQs later.`,
    buttons: [
      { id: 'SKIP_FAQS', title: '⏭️ Skip for Now' },
    ] as InteractiveButton[],
  });
}

// ─── Step: SUPPORT_ADDING_FAQS ────────────────────────────────────────────────

export async function handleSupportAddingFaqs(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const upper = message.trim().toUpperCase();

  // Skip → go to payment setup
  if (upper === 'SKIP_FAQS' || upper === 'SKIP' || upper === 'DONE') {
    await advanceToPaymentSetup(phone, vendor, session, data);
    return;
  }

  // Extract FAQ pair(s) from vendor message using LLM
  const extracted = await extractFaqsWithLLM(message);

  if (!extracted || extracted.length === 0) {
    await messageQueue.add({
      to: phone,
      message:
        `I couldn't extract a Q&A pair from that. Please use this format:\n\n` +
        `*Q: Do you offer home service?*\n` +
        `*A: Yes! We pick up and deliver same day.*\n\n` +
        `Or type *SKIP* to continue without FAQs. 😊`,
    });
    return;
  }

  const currentFaqs = data.faqs ?? [];
  const newFaqs = [...currentFaqs, ...extracted];
  const newData: SupportCollectedData = { ...data, faqs: newFaqs };

  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });

  const faqLines = extracted
    .map((f) => `*Q: ${f.question}*\n_A: ${f.answer}_`)
    .join('\n\n');

  await messageQueue.add({
    to: phone,
    message:
      `✅ FAQ${extracted.length > 1 ? 's' : ''} saved!\n\n${faqLines}\n\n` +
      `You now have *${newFaqs.length}* FAQ${newFaqs.length !== 1 ? 's' : ''}. ` +
      `Add more or type *DONE* to continue with payment setup.`,
    buttons: [
      { id: 'SKIP_FAQS', title: '✅ Done with FAQs' },
    ] as InteractiveButton[],
  });
}

async function extractFaqsWithLLM(
  message: string,
): Promise<Array<{ question: string; answer: string }> | null> {
  const prompt =
    `Extract FAQ pairs from this vendor message: "${message}"\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"faqs": [{"question": "...", "answer": "..."}]}\n\n` +
    `Rules:\n` +
    `- A FAQ pair has a question and an answer\n` +
    `- Look for Q:/A: prefixes, or infer from context\n` +
    `- If no FAQ pair can be extracted, return {"faqs": []}\n` +
    `- Never invent information`;

  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = result.content[0].type === 'text' ? result.content[0].text : '{}';
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText.trim();
    const parsed = JSON.parse(jsonText) as { faqs: Array<{ question: string; answer: string }> };
    return parsed.faqs?.length > 0 ? parsed.faqs : null;
  } catch (err) {
    logger.error('FAQ extraction LLM error', { err });
    return null;
  }
}

async function advanceToPaymentSetup(
  phone: string,
  _vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: {
      step: 'PAYMENT_SETUP',
      collectedData: { ...data, paymentMethod: undefined } as unknown as PrismaJson,
    },
  });

  await messageQueue.add({
    to: phone,
    message:
      `Almost done! 🎉 Let's set up how your customers will pay.\n\n` +
      `*⚡ Paystack Transfer* — Customers transfer to a dedicated virtual account. ` +
      `Payment is confirmed automatically.\n\n` +
      `*🏦 Bank Transfer* — Customers transfer to your regular bank account and ` +
      `you manually confirm receipt.\n\n` +
      `Which would you prefer?`,
    buttons: [
      { id: 'PAYMENT_METHOD:paystack_transfer', title: '⚡ Paystack Transfer' },
      { id: 'PAYMENT_METHOD:bank_transfer',     title: '🏦 Bank Transfer' },
    ] as InteractiveButton[],
  });
}

// ─── Step: SUPPORT_CONFIRMATION ───────────────────────────────────────────────

export async function handleSupportConfirmation(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const upper = message.trim().toUpperCase();

  // Bank details confirmation gate (YES = confirmed, NO = re-enter)
  if (upper === 'YES' && data.bankAccountNumber && !data.bankName?.startsWith('confirmed:')) {
    const newData: SupportCollectedData = { ...data, bankName: `confirmed:${data.bankName}` };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await showSupportConfirmation(phone, vendor, newData);
    return;
  }

  if (upper === 'NO' && data.bankAccountNumber && !data.bankName?.startsWith('confirmed:')) {
    // Re-enter bank details — go back to PAYMENT_SETUP with paymentMethod=bank
    const newData: SupportCollectedData = {
      ...data,
      bankName: undefined,
      bankAccountNumber: undefined,
      bankAccountName: undefined,
    };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { step: 'PAYMENT_SETUP', collectedData: newData as unknown as PrismaJson },
    });
    await messageQueue.add({
      to: phone,
      message:
        `No problem! Please re-enter your bank details:\n` +
        `*Bank Name | Account Number | Account Name*\n\n` +
        `Example: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
    });
    return;
  }

  if (upper === 'GO LIVE' || upper === 'GO_LIVE') {
    await activateSupportStore(phone, vendor, session, data);
    return;
  }

  if (upper === 'CHANGE') {
    await showSupportConfirmation(phone, vendor, data);
    await messageQueue.add({
      to: phone,
      message: `What would you like to change? Just tell me and I'll update it. 😊`,
    });
    return;
  }

  // Any other message — re-show summary
  await showSupportConfirmation(phone, vendor, data);
}

export async function showSupportConfirmation(
  phone: string,
  vendor: Vendor,
  data: SupportCollectedData,
): Promise<void> {
  const services  = data.services ?? [];
  const faqs      = data.faqs ?? [];
  const storeCode = data.storeCode ?? vendor.storeCode ?? 'YOURCODE';
  const bankDisplay = data.bankName?.replace('confirmed:', '') ?? '—';
  const emoji     = serviceTypeEmoji(data.businessType);

  const topServices = services.slice(0, 5).map((s) =>
    `  • ${s.name} — ₦${s.price.toLocaleString()} ${s.unit}`
  ).join('\n');
  const moreServices = services.length > 5 ? `\n  _...and ${services.length - 5} more_` : '';

  const summary =
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${emoji} *${data.businessName ?? vendor.businessName}*\n` +
    `🔑 Store Code: *${storeCode}*\n` +
    `🏷️ Type: ${serviceTypeLabel(data.businessType)}\n` +
    `📍 Location: ${locationTypeLabel(data.serviceLocationType)}\n` +
    `🛠️ Services: ${services.length} item${services.length !== 1 ? 's' : ''}\n` +
    (topServices ? `${topServices}${moreServices}\n` : '') +
    `🧠 FAQs: ${faqs.length} question${faqs.length !== 1 ? 's' : ''}\n` +
    `💳 Payment: ${capitalise(data.paymentMethod ?? 'bank')}${data.bankName ? ` (${bankDisplay})` : ''}\n` +
    `🕐 Hours: ${formatHours(data)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Everything look good? Tap *Go Live* to launch your support page!`;

  await messageQueue.add({
    to: phone,
    message: summary,
    buttons: [
      { id: 'GO LIVE', title: '🚀 Go Live!' },
      { id: 'CHANGE',  title: '✏️ Make Changes' },
    ] as InteractiveButton[],
  });
}

// ─── Activation ───────────────────────────────────────────────────────────────

async function activateSupportStore(
  phone: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  const storeCode     = data.storeCode ?? '';

  await prisma.$transaction(async (tx) => {
    // 1. Save bank details (encrypted)
    const bankAccountNumber = data.bankAccountNumber
      ? encryptBankAccount(data.bankAccountNumber.replace('confirmed:', ''), env.ENCRYPTION_KEY)
      : null;

    await tx.vendor.update({
      where: { id: vendor.id },
      data: {
        businessName: data.businessName ?? vendor.businessName,
        storeCode:    storeCode.toUpperCase(),
        businessType: data.businessType ?? 'general',
        description:  data.description,
        workingHoursStart: data.workingHoursStart ?? '08:00',
        workingHoursEnd:   data.workingHoursEnd   ?? '21:00',
        workingDays:       data.workingDays        ?? '1,2,3,4,5,6',
        acceptedPayments:  data.paymentMethod ?? 'bank',
        bankName:          data.bankName?.replace('confirmed:', '') ?? null,
        bankAccountNumber,
        bankAccountName:   data.bankAccountName ?? null,
        isActive:  true,
        isPaused:  false,
        mode:      'SUPPORT',
      },
    });

    // 2. Create ServiceItem records
    if (data.services && data.services.length > 0) {
      await tx.serviceItem.createMany({
        data: data.services.map((s) => ({
          vendorId:       vendor.id,
          name:           s.name,
          price:          Math.round(s.price * 100), // naira → kobo
          unit:           s.unit ?? 'per item',
          turnaroundHours: s.turnaroundHours ?? null,
          description:    s.description ?? null,
          isAvailable:    true,
        })),
      });
    }

    // 3. Create SupportKnowledge records for FAQs
    if (data.faqs && data.faqs.length > 0) {
      await tx.supportKnowledge.createMany({
        data: data.faqs.map((f) => ({
          vendorId: vendor.id,
          question: f.question,
          answer:   f.answer,
        })),
      });
    }

    // 4. Save all notification numbers (owner first, then any extras from NOTIFICATION_SETUP)
    const allNotifNumbers = Array.from(new Set([phone, ...(data.notificationNumbers ?? [])]));
    for (const [idx, notifPhone] of allNotifNumbers.entries()) {
      await tx.vendorNotificationNumber.upsert({
        where:  { vendorId_phone: { vendorId: vendor.id, phone: notifPhone } },
        create: {
          vendorId:  vendor.id,
          phone:     notifPhone,
          label:     idx === 0 ? 'Main' : `Staff ${idx}`,
          isPrimary: idx === 0,
          isActive:  true,
        },
        update: { isPrimary: idx === 0, isActive: true },
      });
    }

    // 5. Mark setup session complete
    await tx.vendorSetupSession.update({
      where: { id: session.id },
      data: {
        step:        'COMPLETE',
        completedAt: new Date(),
        collectedData: data as unknown as PrismaJson,
      },
    });
  });

  logger.info('Support vendor activated', { vendorId: vendor.id, storeCode, phone: maskPhone(phone) });

  // Message 1 — celebration + store link
  await messageQueue.add({
    to: phone,
    message:
      `🚀 *${data.businessName} is now LIVE on Pingmart!*\n\n` +
      `🔗 *Your Store Link*\n` +
      `wa.me/${pingmartPhone}?text=${storeCode}\n\n` +
      `_Share this link with customers and they can:_\n` +
      `📋 View your services\n` +
      `📅 Book appointments\n` +
      `💬 Ask questions — answered by your bot 24/7\n\n` +
      `📣 *Share your link on:*\n` +
      `📱 WhatsApp Status · 📸 Instagram Bio · 💬 Customer groups`,
  });

  // Message 2 — vendor dashboard
  await messageQueue.add({
    to: phone,
    message: `What would you like to do first?`,
    listSections: [
      {
        title: '🛠️ Manage Your Support Page',
        rows: [
          { id: 'MY BOOKINGS',  title: '📅 My Bookings',   description: 'View and manage booking requests' },
          { id: 'MY SERVICES',  title: '🛠️ My Services',   description: 'View, add, or remove your services' },
          { id: 'ADD FAQ',      title: '🧠 Add FAQ',        description: 'Teach the bot new Q&A pairs' },
          { id: 'MY LINK',      title: '🔗 My Link',        description: 'Get your shareable store link' },
          { id: 'PAUSE STORE',  title: '⏸️ Pause Store',    description: 'Temporarily stop taking bookings' },
          { id: 'SETTINGS',     title: '⚙️ Settings',       description: 'Update hours, payment, description' },
        ],
      },
    ],
    listButtonText: '📋 Dashboard',
  });
}
