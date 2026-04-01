/**
 * Support Mode Vendor Dashboard
 *
 * Handles vendor commands for service-based businesses (Support Mode).
 * Manages bookings, services, FAQs, store settings.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Vendor } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { redis } from '../utils/redis';
import { messageQueue } from '../queues/message.queue';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';
import { formatNaira } from '../utils/formatters';
import { InteractiveListSection } from '../types';
import { ServiceItemInput } from './support-onboarding.service';

// ─── LLM Client ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─── Redis state for vendor flows ────────────────────────────────────────────

const VENDOR_STATE_TTL = 30 * 60; // 30 minutes
const vendorStateKey   = (phone: string) => `vendor:support:state:${phone}`;

function formatBookingId(id: string): string {
  return `BK-${id.slice(0, 6).toUpperCase()}`;
}

function bookingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING:     '⏳ Pending',
    CONFIRMED:   '✅ Confirmed',
    IN_PROGRESS: '🔧 In Progress',
    READY:       '✅ Ready',
    COMPLETED:   '🎉 Completed',
    CANCELLED:   '❌ Cancelled',
  };
  return labels[status] ?? status;
}

function bookingStatusNext(cmd: string): string | null {
  const map: Record<string, string> = {
    CONFIRM:     'CONFIRMED',
    START:       'IN_PROGRESS',
    READY:       'READY',
    COMPLETE:    'COMPLETED',
    DONE:        'COMPLETED',
    CANCEL:      'CANCELLED',
  };
  return map[cmd] ?? null;
}

function bookingStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    CONFIRMED:   '✅',
    IN_PROGRESS: '🔧',
    READY:       '✅',
    COMPLETED:   '🎉',
    CANCELLED:   '❌',
  };
  return map[status] ?? '📅';
}

function customerStatusMessage(serviceName: string, status: string, vendorName: string): string {
  switch (status) {
    case 'CONFIRMED':   return `✅ Great news! *${vendorName}* has confirmed your booking for *${serviceName}*.`;
    case 'IN_PROGRESS': return `🔧 *${vendorName}* has started working on your *${serviceName}* request.`;
    case 'READY':       return `✅ Your *${serviceName}* is ready! *${vendorName}* will reach out with next steps.`;
    case 'COMPLETED':   return `🎉 Your *${serviceName}* has been completed! Thanks for choosing *${vendorName}*.`;
    case 'CANCELLED':   return `❌ Your booking for *${serviceName}* with *${vendorName}* has been cancelled. Contact them for more info.`;
    default:            return `📅 Your booking status for *${serviceName}* has been updated: *${status}*.`;
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function handleSupportVendorDashboard(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const trimmed = message.trim();
  const upper   = trimmed.toUpperCase();

  // ── Booking status update commands ────────────────────────────────────────
  // Format: CONFIRM_BK ABCDEF | START_BK ABCDEF | READY_BK ABCDEF | DONE_BK ABCDEF | CANCEL_BK ABCDEF
  const bookingCmdMatch = upper.match(/^(CONFIRM|START|READY|DONE|COMPLETE|CANCEL)_BK\s+([A-Z0-9]{6})$/);
  if (bookingCmdMatch) {
    const [, cmd, shortId] = bookingCmdMatch;
    await updateBookingStatus(phone, vendor, cmd, shortId.toLowerCase());
    return;
  }

  // ── Active vendor flow state (e.g. ADD_FAQ, ADD_SERVICE) ─────────────────
  const vendorState = await redis.get(vendorStateKey(phone));

  if (vendorState === 'ADD_FAQ') {
    await handleAddFaqReply(phone, trimmed, vendor);
    return;
  }

  if (vendorState === 'ADD_SERVICE') {
    await handleAddServiceReply(phone, trimmed, vendor);
    return;
  }

  // ── Dashboard commands ────────────────────────────────────────────────────
  switch (upper) {
    case 'MY BOOKINGS':
    case 'BOOKINGS':
    case 'VIEW BOOKINGS':
      await showBookingsList(phone, vendor, 'PENDING');
      return;

    case 'ALL BOOKINGS':
      await showBookingsList(phone, vendor, 'ALL');
      return;

    case 'MY SERVICES':
    case 'VIEW SERVICES':
      await showVendorServices(phone, vendor);
      return;

    case 'ADD SERVICE':
      await startAddService(phone, vendor);
      return;

    case 'ADD FAQ':
    case 'TEACH BOT':
      await startAddFaq(phone, vendor);
      return;

    case 'MY LINK':
    case 'SHARE LINK':
      await showStoreLink(phone, vendor);
      return;

    case 'PAUSE STORE':
      await togglePause(phone, vendor, true);
      return;

    case 'RESUME STORE':
      await togglePause(phone, vendor, false);
      return;

    default:
      await showSupportDashboard(phone, vendor);
  }
}

// ─── Dashboard Overview ───────────────────────────────────────────────────────

async function showSupportDashboard(phone: string, vendor: Vendor): Promise<void> {
  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  const storeCode     = vendor.storeCode ?? '—';

  const pending = await prisma.booking.count({
    where: { vendorId: vendor.id, status: 'PENDING' },
  });

  const header =
    `🏪 *${vendor.businessName}*\n` +
    `🔗 wa.me/${pingmartPhone}?text=${storeCode}\n` +
    (vendor.isPaused ? `\n⚠️ *Store is PAUSED*\n` : '') +
    (pending > 0 ? `\n📅 *${pending} pending booking${pending !== 1 ? 's' : ''}*\n` : '') +
    `\nWhat would you like to do?`;

  const sections: InteractiveListSection[] = [
    {
      title: '📅 Bookings',
      rows: [
        { id: 'MY BOOKINGS',  title: '📅 My Bookings',  description: `${pending} pending — view and update` },
        { id: 'ALL BOOKINGS', title: '🗂️ All Bookings',  description: 'See your full booking history' },
      ],
    },
    {
      title: '🛠️ Services & Bot',
      rows: [
        { id: 'MY SERVICES', title: '🛠️ My Services',  description: 'View and manage your service list' },
        { id: 'ADD SERVICE', title: '➕ Add Service',   description: 'Add a new service to your menu' },
        { id: 'ADD FAQ',     title: '🧠 Add FAQ',       description: 'Teach the bot a new Q&A pair' },
      ],
    },
    {
      title: '⚙️ Store',
      rows: [
        { id: 'MY LINK',     title: '🔗 My Link',      description: 'Get your shareable store link' },
        { id: vendor.isPaused ? 'RESUME STORE' : 'PAUSE STORE',
          title: vendor.isPaused ? '▶️ Resume Store' : '⏸️ Pause Store',
          description: vendor.isPaused ? 'Start accepting bookings again' : 'Temporarily pause bookings' },
      ],
    },
  ];

  await messageQueue.add({
    to: phone,
    message: header,
    listSections: sections,
    listButtonText: '📋 Dashboard',
  });
}

// ─── Bookings Management ──────────────────────────────────────────────────────

async function showBookingsList(
  phone: string,
  vendor: Vendor,
  filter: 'PENDING' | 'ALL',
): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where: filter === 'PENDING'
      ? { vendorId: vendor.id, status: 'PENDING' }
      : { vendorId: vendor.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (bookings.length === 0) {
    const msg = filter === 'PENDING'
      ? `📅 No pending bookings right now. Type *ALL BOOKINGS* to see history.`
      : `📅 No bookings yet.`;
    await messageQueue.add({ to: phone, message: msg });
    return;
  }

  const lines = bookings.map((b) => {
    const id   = formatBookingId(b.id);
    const status = bookingStatusLabel(b.status);
    const date   = b.scheduledDate ? `\n   🕐 ${b.scheduledDate}` : '';
    const addr   = b.deliveryAddress ? `\n   📍 ${b.deliveryAddress}` : '';
    return `*${id}* — ${b.serviceRequested}\n${status} · ${b.customerPhone}${date}${addr}`;
  });

  const title = filter === 'PENDING' ? '⏳ Pending Bookings' : '📅 All Bookings';
  await messageQueue.add({
    to: phone,
    message:
      `${title}\n\n${lines.join('\n\n')}\n\n` +
      `To update a booking:\n` +
      `*CONFIRM_BK [ID]* · *START_BK [ID]* · *READY_BK [ID]* · *DONE_BK [ID]* · *CANCEL_BK [ID]*`,
  });
}

async function updateBookingStatus(
  phone: string,
  vendor: Vendor,
  cmd: string,
  shortId: string,
): Promise<void> {
  const newStatus = bookingStatusNext(cmd);
  if (!newStatus) {
    await messageQueue.add({ to: phone, message: `Unknown command. Use CONFIRM_BK, START_BK, READY_BK, DONE_BK, or CANCEL_BK.` });
    return;
  }

  const booking = await prisma.booking.findFirst({
    where: { id: { startsWith: shortId }, vendorId: vendor.id },
  });

  if (!booking) {
    await messageQueue.add({ to: phone, message: `❌ Booking *BK-${shortId.toUpperCase()}* not found.` });
    return;
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: newStatus as any },
  });

  const bookingId = formatBookingId(booking.id);
  const emoji = bookingStatusEmoji(newStatus);

  await messageQueue.add({
    to: phone,
    message: `${emoji} Booking *${bookingId}* (${booking.serviceRequested}) marked as *${newStatus.replace('_', ' ')}*.`,
  });

  // Notify customer
  await messageQueue.add({
    to: booking.customerPhone,
    message: customerStatusMessage(booking.serviceRequested, newStatus, vendor.businessName),
  });

  logger.info('Booking status updated', {
    bookingId: booking.id,
    newStatus,
    vendorId: vendor.id,
    phone: maskPhone(phone),
  });
}

// ─── Services Management ──────────────────────────────────────────────────────

async function showVendorServices(phone: string, vendor: Vendor): Promise<void> {
  const items = await prisma.serviceItem.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: 'asc' },
  });

  if (items.length === 0) {
    await messageQueue.add({
      to: phone,
      message: `You have no services listed yet. Type *ADD SERVICE* to add one.`,
    });
    return;
  }

  const lines = items.map((s, i) => {
    const avail = s.isAvailable ? '' : ' _(unavailable)_';
    return `${i + 1}. *${s.name}* — ${formatNaira(s.price)} ${s.unit}${avail}`;
  });

  await messageQueue.add({
    to: phone,
    message:
      `🛠️ *Your Services (${items.length})*\n\n` +
      `${lines.join('\n')}\n\n` +
      `Type *ADD SERVICE* to add more.`,
  });
}

async function startAddService(phone: string, _vendor: Vendor): Promise<void> {
  await redis.setex(vendorStateKey(phone), VENDOR_STATE_TTL, 'ADD_SERVICE');
  await messageQueue.add({
    to: phone,
    message:
      `➕ *Add a Service*\n\n` +
      `Send the service details:\n` +
      `*Service Name | Price | Unit*\n\n` +
      `Example: _AC repair | 8,000 | per visit_\n\n` +
      `Or describe it naturally. Type *CANCEL* to go back.`,
  });
}

async function handleAddServiceReply(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  if (message.trim().toUpperCase() === 'CANCEL') {
    await redis.del(vendorStateKey(phone));
    await showSupportDashboard(phone, vendor);
    return;
  }

  // Try pipe-parse first
  const pipeParsed = tryParsePipeService(message.trim());
  let service: ServiceItemInput | null = pipeParsed;

  if (!service) {
    service = await extractSingleServiceWithLLM(message.trim(), vendor.businessType);
  }

  if (!service) {
    await messageQueue.add({
      to: phone,
      message:
        `I couldn't extract a service from that. Try:\n` +
        `*Service Name | Price | Unit*\n` +
        `Example: _Full body massage | 15,000 | per session_`,
    });
    return;
  }

  await prisma.serviceItem.create({
    data: {
      vendorId: vendor.id,
      name:     service.name,
      price:    Math.round(service.price * 100), // naira → kobo
      unit:     service.unit ?? '',
      turnaroundHours: service.turnaroundHours ?? null,
      description:     service.description ?? null,
      isAvailable:     true,
    },
  });

  await redis.del(vendorStateKey(phone));

  await messageQueue.add({
    to: phone,
    message:
      `✅ *${service.name}* added — ${formatNaira(service.price * 100)}${service.unit ? ` ${service.unit}` : ''}\n\n` +
      `Type *MY SERVICES* to see your full list.`,
  });
}

function tryParsePipeService(message: string): ServiceItemInput | null {
  if (!message.includes('|')) return null;
  const parts = message.split('|').map((s) => s.trim());
  const [name, rawPrice, unit, rawTurnaround, description] = parts;
  if (!name || !rawPrice) return null;

  let priceStr = rawPrice.replace(/[₦,\s]/g, '');
  if (/^\d+(\.\d+)?k$/i.test(priceStr)) priceStr = String(parseFloat(priceStr) * 1000);
  const price = parseFloat(priceStr);
  if (isNaN(price) || price <= 0) return null;

  let turnaroundHours: number | undefined;
  if (rawTurnaround) {
    const tMatch = rawTurnaround.match(/(\d+)\s*(h|hr|hour|day|d)/i);
    if (tMatch) {
      const val = parseInt(tMatch[1]);
      turnaroundHours = /d/i.test(tMatch[2]) ? val * 24 : val;
    }
  }

  return {
    name,
    price,
    ...(unit ? { unit } : {}),
    ...(turnaroundHours ? { turnaroundHours } : {}),
    ...(description ? { description } : {}),
  };
}

async function extractSingleServiceWithLLM(
  message: string,
  _businessType: string,
): Promise<ServiceItemInput | null> {
  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content:
          `Extract one service from: "${message}"\n\n` +
          `Return ONLY JSON with required fields: {"name":"...","price":0}\n` +
          `Optional fields: unit (pricing description exactly as stated, e.g. "per kg", "per session", "flat fee"), turnaroundHours, description.\n` +
          `price: naira number (strip ₦, commas). Omit optional fields if not mentioned. Return {} if nothing found.`,
      }],
    });
    const raw = result.content[0].type === 'text' ? result.content[0].text.trim() : '{}';
    const json = raw.startsWith('```') ? raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim() : raw;
    const parsed = JSON.parse(json) as Partial<ServiceItemInput>;
    if (!parsed.name || !parsed.price) return null;
    return parsed as ServiceItemInput;
  } catch {
    return null;
  }
}

// ─── FAQ Management ───────────────────────────────────────────────────────────

async function startAddFaq(phone: string, _vendor: Vendor): Promise<void> {
  await redis.setex(vendorStateKey(phone), VENDOR_STATE_TTL, 'ADD_FAQ');
  await messageQueue.add({
    to: phone,
    message:
      `🧠 *Add an FAQ*\n\n` +
      `Format:\n` +
      `*Q: Your question here?*\n` +
      `*A: Your answer here.*\n\n` +
      `Example:\n` +
      `*Q: Do you offer home service?*\n` +
      `*A: Yes! We pick up and deliver same day within Lagos for ₦500 extra.*\n\n` +
      `Type *CANCEL* to go back.`,
  });
}

async function handleAddFaqReply(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  if (message.trim().toUpperCase() === 'CANCEL') {
    await redis.del(vendorStateKey(phone));
    await showSupportDashboard(phone, vendor);
    return;
  }

  const faq = await extractFaqWithLLM(message);

  if (!faq) {
    await messageQueue.add({
      to: phone,
      message:
        `I couldn't extract a Q&A pair. Use:\n\n` +
        `*Q: Do you offer same-day service?*\n` +
        `*A: Yes, for ₦500 extra.*\n\n` +
        `Or type *CANCEL* to go back.`,
    });
    return;
  }

  await prisma.supportKnowledge.create({
    data: { vendorId: vendor.id, question: faq.question, answer: faq.answer },
  });

  await redis.del(vendorStateKey(phone));

  await messageQueue.add({
    to: phone,
    message:
      `🧠 *FAQ saved!*\n\n` +
      `*Q: ${faq.question}*\n` +
      `_A: ${faq.answer}_\n\n` +
      `Type *ADD FAQ* to add another.`,
  });
}

async function extractFaqWithLLM(
  message: string,
): Promise<{ question: string; answer: string } | null> {
  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content:
          `Extract a FAQ pair from: "${message}"\n\n` +
          `Return ONLY JSON: {"question":"...","answer":"..."}\n` +
          `Look for Q:/A: prefixes or infer from context.\n` +
          `Return {} if no FAQ pair found.`,
      }],
    });
    const raw = result.content[0].type === 'text' ? result.content[0].text.trim() : '{}';
    const json = raw.startsWith('```') ? raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim() : raw;
    const parsed = JSON.parse(json) as { question?: string; answer?: string };
    if (!parsed.question || !parsed.answer) return null;
    return { question: parsed.question, answer: parsed.answer };
  } catch {
    return null;
  }
}

// ─── Store Management ─────────────────────────────────────────────────────────

async function showStoreLink(phone: string, vendor: Vendor): Promise<void> {
  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  const storeCode     = vendor.storeCode ?? '—';

  await messageQueue.add({
    to: phone,
    message:
      `🔗 *Your Pingmart Link*\n\n` +
      `wa.me/${pingmartPhone}?text=${storeCode}\n\n` +
      `Share this link on:\n` +
      `📱 WhatsApp Status · 📸 Instagram Bio · 💬 Customer groups\n\n` +
      `Customers who tap the link can view your services, ask questions, and book appointments.`,
  });
}

async function togglePause(phone: string, vendor: Vendor, pause: boolean): Promise<void> {
  await prisma.vendor.update({ where: { id: vendor.id }, data: { isPaused: pause } });
  await messageQueue.add({
    to: phone,
    message: pause
      ? `⏸️ Your store is now *PAUSED*. Customers will see a "not taking bookings" message.\n\nType *RESUME STORE* to go live again.`
      : `▶️ Your store is now *LIVE* again! Customers can book services.`,
  });
}
