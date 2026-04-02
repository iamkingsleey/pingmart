/**
 * Support Mode Customer Flow
 *
 * Handles customer interactions with service-based vendors.
 * Customers can: view services, ask questions (FAQ + LLM fallback), book services,
 * and set appointment reminders.
 *
 * Substate is tracked in ConversationSession.sessionData.supportState (string).
 * The ConversationSession.state is set to BROWSING while the customer is active.
 *
 * Reminder sub-states (scoped to this flow only):
 *   REMINDER_PENDING       — 3-button prompt sent; waiting for tap or decline
 *   REMINDER_CUSTOM_WAIT   — asked "how long before?"; waiting for free-text duration
 *   REMINDER_TOO_SOON      — appointment is too soon for requested lead-time;
 *                            waiting for yes/no on suggested shorter time
 */
import Anthropic from '@anthropic-ai/sdk';
import { Vendor } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { sessionRepository } from '../repositories/session.repository';
import { messageQueue } from '../queues/message.queue';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';
import { formatNaira } from '../utils/formatters';
import { t, Language } from '../i18n';
import { ConversationState, SessionData, InteractiveButton, InteractiveListSection } from '../types';
import {
  scheduleReminder,
  cancelBookingReminders as _cancelBookingReminders,
  parseDurationMinutes,
  isDeclineIntent,
  detectReminderIntent,
  formatMinutes,
  parseAppointmentDate,
} from './support-reminder.service';

// Re-export so support-vendor.service.ts can call it without knowing about the reminder service
export { _cancelBookingReminders as cancelBookingReminders };

// ─── LLM Client ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─── Support Session Data ─────────────────────────────────────────────────────

interface SupportSessionData {
  role?: 'customer';
  supportState: string;
  /** Booking in progress — populated during the BOOKING_* states */
  pendingBooking?: {
    serviceItemId: string;
    serviceRequested: string;
    scheduledDate?: string;
    deliveryAddress?: string;
  };
  /** Reminder in progress — populated after booking confirmation */
  pendingReminder?: {
    bookingId:       string;
    serviceRequested: string;
    scheduledDate:   string;
    vendorName:      string;
    language:        string;
    /** ISO string once parsed — cached to avoid a second LLM call */
    parsedApptTime?: string;
    /** Suggested minutes for the REMINDER_TOO_SOON state */
    suggestedMins?:  number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function getCustomerLanguage(phone: string): Promise<Language> {
  const customer = await prisma.customer.findUnique({
    where:  { whatsappNumber: phone },
    select: { language: true },
  });
  return (customer?.language as Language | undefined) ?? 'en';
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function handleSupportCustomerMessage(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  // Get or create session
  const session = await sessionRepository.findActive(phone, vendor.id);
  const data    = ((session?.sessionData ?? { cart: [], supportState: '', role: 'customer' }) as unknown) as SupportSessionData;
  const state   = data.supportState ?? '';
  const trimmed = message.trim();
  const upper   = trimmed.toUpperCase();

  // Always-available commands
  if (upper === 'MENU' || upper === 'HOME' || upper === 'BACK') {
    await showSupportWelcome(phone, vendor);
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: '', role: 'customer' });
    return;
  }

  if (upper === 'MY_BOOKING_STATUS' || upper === 'MY BOOKINGS' || upper === 'MY BOOKING') {
    await showCustomerBookings(phone, vendor);
    return;
  }

  // Route by button IDs (shown in welcome)
  if (upper === 'VIEW_SERVICES') {
    await showServicesList(phone, vendor);
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: 'VIEWING_SERVICES', role: 'customer' });
    return;
  }

  if (upper === 'BOOK_SERVICE') {
    await showServicesForBooking(phone, vendor);
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: 'BOOKING_SELECT', role: 'customer' });
    return;
  }

  if (upper === 'ASK_QUESTION') {
    await messageQueue.add({
      to: phone,
      message: `💬 Sure! What would you like to know about *${vendor.businessName}*? Just ask. 😊`,
    });
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: 'ASKING_QUESTION', role: 'customer' });
    return;
  }

  // State-based routing
  switch (state) {
    case 'ASKING_QUESTION':
      await handleQuestion(phone, trimmed, vendor);
      return;

    case 'BOOKING_SELECT':
      if (upper.startsWith('BOOK:')) {
        const serviceItemId = trimmed.slice(5);
        await handleBookingServiceSelected(phone, vendor, data, serviceItemId);
        return;
      }
      // Unrecognised — re-show services for booking
      await showServicesForBooking(phone, vendor);
      return;

    case 'BOOKING_DATE':
      await handleBookingDate(phone, trimmed, vendor, data);
      return;

    case 'BOOKING_ADDRESS':
      await handleBookingAddress(phone, trimmed, vendor, data);
      return;

    case 'BOOKING_CONFIRM':
      await handleBookingConfirm(phone, upper, vendor, data);
      return;

    // ── Reminder sub-states ────────────────────────────────────────────────

    case 'REMINDER_PENDING':
      await handleReminderPending(phone, upper, trimmed, vendor, data);
      return;

    case 'REMINDER_CUSTOM_WAIT':
      await handleReminderCustomWait(phone, trimmed, vendor, data);
      return;

    case 'REMINDER_TOO_SOON':
      await handleReminderTooSoon(phone, upper, trimmed, vendor, data);
      return;

    default: {
      // ── Mid-flow reminder request (outside REMINDER_PENDING state) ───────
      // Customer may say "remind me 30 mins before" at any point in the conversation.
      const intentResult = await detectReminderIntent(trimmed);
      if (intentResult.isReminder) {
        // Find their most recent CONFIRMED or PENDING booking with this vendor
        const recentBooking = await prisma.booking.findFirst({
          where:   { vendorId: vendor.id, customerPhone: phone, status: { in: ['CONFIRMED', 'PENDING'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (recentBooking && recentBooking.scheduledDate) {
          const lang = await getCustomerLanguage(phone);
          const customer = await prisma.customer.findUnique({ where: { whatsappNumber: phone }, select: { id: true } });
          await processMidFlowReminderRequest(
            phone, vendor, recentBooking, intentResult.durationMins ?? 30, lang, customer?.id,
          );
          return;
        }
      }

      // Unknown message in idle/unknown state — show welcome
      await showSupportWelcome(phone, vendor);
      await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: '', role: 'customer' });
    }
  }
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

export async function showSupportWelcome(phone: string, vendor: Vendor): Promise<void> {
  const greeting = vendor.description
    ? `👋 Welcome to *${vendor.businessName}*!\n\n_${vendor.description}_\n\nHow can we help you today?`
    : `👋 Welcome to *${vendor.businessName}*!\n\nHow can we help you today?`;

  await messageQueue.add({
    to: phone,
    message: greeting,
    buttons: [
      { id: 'VIEW_SERVICES', title: '📋 View Services'  },
      { id: 'BOOK_SERVICE',  title: '📅 Book a Service' },
      { id: 'ASK_QUESTION',  title: '💬 Ask a Question' },
    ] as InteractiveButton[],
  });
}

// ─── View Services ────────────────────────────────────────────────────────────

async function showServicesList(phone: string, vendor: Vendor): Promise<void> {
  const items = await prisma.serviceItem.findMany({
    where:   { vendorId: vendor.id, isAvailable: true },
    orderBy: { createdAt: 'asc' },
  });

  if (items.length === 0) {
    await messageQueue.add({
      to: phone,
      message:
        `🛠️ *${vendor.businessName} Services*\n\n` +
        `No services listed yet. Please contact us directly for information.`,
    });
    return;
  }

  const lines = items.map((s) => {
    const price      = formatNaira(s.price);
    const turnaround = s.turnaroundHours
      ? ` · ${s.turnaroundHours < 24 ? `${s.turnaroundHours}h` : `${Math.round(s.turnaroundHours / 24)}d`} turnaround`
      : '';
    const desc = s.description ? `\n   _${s.description}_` : '';
    return `• *${s.name}* — ${price} ${s.unit}${turnaround}${desc}`;
  });

  await messageQueue.add({
    to: phone,
    message:
      `🛠️ *${vendor.businessName} — Services*\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Reply *MENU* to go back or *BOOK SERVICE* to make a booking.`,
  });
}

// ─── Booking Flow ─────────────────────────────────────────────────────────────

async function showServicesForBooking(phone: string, vendor: Vendor): Promise<void> {
  const items = await prisma.serviceItem.findMany({
    where:   { vendorId: vendor.id, isAvailable: true },
    orderBy: { createdAt: 'asc' },
  });

  if (items.length === 0) {
    await messageQueue.add({
      to: phone,
      message:
        `😔 *${vendor.businessName}* doesn't have any services listed yet.\n\n` +
        `Please contact them directly to arrange a booking.`,
    });
    return;
  }

  const sections: InteractiveListSection[] = [
    {
      title: '🛠️ Choose a Service',
      rows: items.map((s) => ({
        id:          `BOOK:${s.id}`,
        title:       s.name.slice(0, 24),
        description: `${formatNaira(s.price)} ${s.unit}`.slice(0, 72),
      })),
    },
  ];

  await messageQueue.add({
    to: phone,
    message: `📅 *Book a Service*\n\nWhich service would you like to book?`,
    listSections:   sections,
    listButtonText: 'Choose Service',
  });
}

async function handleBookingServiceSelected(
  phone: string,
  vendor: Vendor,
  data: SupportSessionData,
  serviceItemId: string,
): Promise<void> {
  const serviceItem = await prisma.serviceItem.findFirst({
    where: { id: serviceItemId, vendorId: vendor.id, isAvailable: true },
  });

  if (!serviceItem) {
    await showServicesForBooking(phone, vendor);
    return;
  }

  const pendingBooking = {
    serviceItemId: serviceItem.id,
    serviceRequested: serviceItem.name,
  };

  await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
    ...data as unknown as SessionData,
    supportState: 'BOOKING_DATE',
    pendingBooking,
  });

  await messageQueue.add({
    to: phone,
    message:
      `📅 *${serviceItem.name}*\n` +
      `${formatNaira(serviceItem.price)} ${serviceItem.unit}\n\n` +
      `When would you like this service?\n\n` +
      `_Just describe when works for you, e.g. "Tomorrow at 10am", "Friday afternoon", "Any time next week"._`,
  });
}

async function handleBookingDate(
  phone: string,
  dateText: string,
  vendor: Vendor,
  data: SupportSessionData,
): Promise<void> {
  if (!data.pendingBooking) {
    await showSupportWelcome(phone, vendor);
    return;
  }

  const updatedBooking = { ...data.pendingBooking, scheduledDate: dateText };
  const needsAddress   = await vendorNeedsPickupAddress(vendor.id);

  if (needsAddress) {
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
      ...data as unknown as SessionData,
      supportState: 'BOOKING_ADDRESS',
      pendingBooking: updatedBooking,
    });
    await messageQueue.add({ to: phone, message: `📍 Please provide your address or location for this service.` });
  } else {
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
      ...data as unknown as SessionData,
      supportState: 'BOOKING_CONFIRM',
      pendingBooking: updatedBooking,
    });
    await showBookingConfirmation(phone, vendor, updatedBooking);
  }
}

async function handleBookingAddress(
  phone: string,
  address: string,
  vendor: Vendor,
  data: SupportSessionData,
): Promise<void> {
  if (!data.pendingBooking) {
    await showSupportWelcome(phone, vendor);
    return;
  }

  const updatedBooking = { ...data.pendingBooking, deliveryAddress: address };

  await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
    ...data as unknown as SessionData,
    supportState: 'BOOKING_CONFIRM',
    pendingBooking: updatedBooking,
  });

  await showBookingConfirmation(phone, vendor, updatedBooking);
}

async function showBookingConfirmation(
  phone: string,
  vendor: Vendor,
  booking: NonNullable<SessionData['pendingBooking']>,
): Promise<void> {
  const addressLine = booking.deliveryAddress ? `📍 Address: ${booking.deliveryAddress}\n` : '';

  await messageQueue.add({
    to: phone,
    message:
      `📅 *Confirm Your Booking*\n\n` +
      `🛠️ Service: *${booking.serviceRequested}*\n` +
      `🕐 When: ${booking.scheduledDate}\n` +
      `${addressLine}\n` +
      `Shall I send this booking request to *${vendor.businessName}*?`,
    buttons: [
      { id: 'CONFIRM_BOOKING', title: '✅ Yes, Book It' },
      { id: 'CANCEL_BOOKING',  title: '❌ Cancel'       },
    ] as InteractiveButton[],
  });
}

async function handleBookingConfirm(
  phone: string,
  upper: string,
  vendor: Vendor,
  data: SupportSessionData,
): Promise<void> {
  if (upper === 'CANCEL_BOOKING') {
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: '', role: 'customer' });
    await messageQueue.add({ to: phone, message: `Booking cancelled. 👍 Reply *MENU* to go back.` });
    return;
  }

  if (upper !== 'CONFIRM_BOOKING') {
    if (data.pendingBooking) await showBookingConfirmation(phone, vendor, data.pendingBooking);
    return;
  }

  if (!data.pendingBooking) {
    await showSupportWelcome(phone, vendor);
    return;
  }

  // Lookup customer
  const customer = await prisma.customer.findUnique({ where: { whatsappNumber: phone } });
  const lang     = (customer?.language as Language | undefined) ?? 'en';

  // Create booking record
  const booking = await prisma.booking.create({
    data: {
      vendorId:         vendor.id,
      customerPhone:    phone,
      customerName:     customer?.name ?? null,
      serviceRequested: data.pendingBooking.serviceRequested,
      scheduledDate:    data.pendingBooking.scheduledDate ?? null,
      deliveryAddress:  data.pendingBooking.deliveryAddress ?? null,
      status:           'PENDING',
    },
  });

  // ── Set state to REMINDER_PENDING before sending any messages ────────────
  // (prevents a race condition where customer replies before state is written)
  await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
    cart:        [],
    role:        'customer',
    supportState: 'REMINDER_PENDING',
    pendingReminder: {
      bookingId:        booking.id,
      serviceRequested: booking.serviceRequested,
      scheduledDate:    booking.scheduledDate ?? '',
      vendorName:       vendor.businessName,
      language:         lang,
    },
  } as unknown as SessionData);

  const bookingId   = formatBookingId(booking.id);
  const addressLine = booking.deliveryAddress ? `\n📍 Address: ${booking.deliveryAddress}` : '';

  // ── Confirm booking to customer ───────────────────────────────────────────
  await messageQueue.add({
    to: phone,
    message:
      `✅ *Booking Sent!* (${bookingId})\n\n` +
      `🛠️ *${booking.serviceRequested}*\n` +
      `🕐 Requested: ${booking.scheduledDate ?? 'Flexible'}` +
      `${addressLine}\n\n` +
      `*${vendor.businessName}* will confirm shortly. ` +
      `Reply *MY BOOKINGS* to check your status anytime.`,
  });

  // ── Reminder prompt ───────────────────────────────────────────────────────
  await sendReminderPrompt(phone, lang);

  // ── Notify vendor ─────────────────────────────────────────────────────────
  const notifNumbers = await prisma.vendorNotificationNumber.findMany({
    where: { vendorId: vendor.id, isActive: true },
  });

  const vendorMsg =
    `📅 *New Booking Request!* (${bookingId})\n\n` +
    `👤 Customer: ${phone}${customer?.name ? ` (${customer.name})` : ''}\n` +
    `🛠️ Service: *${booking.serviceRequested}*\n` +
    `🕐 Requested: ${booking.scheduledDate ?? 'Flexible'}` +
    (booking.deliveryAddress ? `\n📍 Address: ${booking.deliveryAddress}` : '') +
    `\n\n` +
    `Reply:\n` +
    `*CONFIRM_BK ${bookingId.slice(3)}* — to confirm\n` +
    `*CANCEL_BK ${bookingId.slice(3)}* — to decline`;

  for (const num of notifNumbers) {
    await messageQueue.add({ to: num.phone, message: vendorMsg });
  }

  logger.info('Booking created', { bookingId: booking.id, vendorId: vendor.id, phone: maskPhone(phone) });
}

// ─── Reminder Flow ────────────────────────────────────────────────────────────

/**
 * Sends the three-button reminder prompt immediately after booking confirmation.
 */
async function sendReminderPrompt(phone: string, lang: Language): Promise<void> {
  await messageQueue.add({
    to:      phone,
    message: t('booking_reminder_prompt', lang),
    buttons: [
      { id: 'REMIND_20M',    title: '⏰ 20 mins before' },
      { id: 'REMIND_1H',     title: '⏰ 1 hour before'  },
      { id: 'REMIND_CUSTOM', title: '✏️ Custom time'    },
    ] as InteractiveButton[],
  });
}

/**
 * Handles customer response while in REMINDER_PENDING state.
 * Accepts button taps (REMIND_20M, REMIND_1H, REMIND_CUSTOM) or decline intent.
 */
async function handleReminderPending(
  phone: string,
  upper: string,
  trimmed: string,
  vendor: Vendor,
  data: SupportSessionData,
): Promise<void> {
  const pr = data.pendingReminder;
  if (!pr) {
    // Stale state — clear it
    await clearToIdle(phone, vendor.id);
    return;
  }

  if (upper === 'REMIND_20M')   { await attemptScheduleReminder(phone, vendor, data, pr, 20);  return; }
  if (upper === 'REMIND_1H')    { await attemptScheduleReminder(phone, vendor, data, pr, 60);  return; }
  if (upper === 'REMIND_CUSTOM') {
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
      ...data as unknown as SessionData,
      supportState: 'REMINDER_CUSTOM_WAIT',
    });
    await messageQueue.add({ to: phone, message: t('booking_reminder_custom_ask', pr.language as Language) });
    return;
  }

  // Check for decline intent (no / nah / e no necessary / etc.)
  const declined = await isDeclineIntent(trimmed);
  if (declined) {
    await clearToIdle(phone, vendor.id);
    await messageQueue.add({ to: phone, message: t('booking_reminder_declined', pr.language as Language) });
    return;
  }

  // Unrecognised — re-send prompt
  await sendReminderPrompt(phone, pr.language as Language);
}

/**
 * Handles the customer's free-text duration reply in REMINDER_CUSTOM_WAIT state.
 * e.g. "45 minutes", "2 hours", "half an hour"
 */
async function handleReminderCustomWait(
  phone: string,
  trimmed: string,
  vendor: Vendor,
  data: SupportSessionData,
): Promise<void> {
  const pr = data.pendingReminder;
  if (!pr) {
    await clearToIdle(phone, vendor.id);
    return;
  }

  const mins = await parseDurationMinutes(trimmed);
  if (!mins) {
    // Could not parse — ask again
    await messageQueue.add({ to: phone, message: t('booking_reminder_custom_ask', pr.language as Language) });
    return;
  }

  await attemptScheduleReminder(phone, vendor, data, pr, mins);
}

/**
 * Handles the yes/no response for the "too soon" alternative suggestion.
 * REMIND_ACCEPT_SUGGEST → schedule with suggestedMins
 * REMIND_DECLINE / decline intent → "No problem!"
 */
async function handleReminderTooSoon(
  phone: string,
  upper: string,
  trimmed: string,
  vendor: Vendor,
  data: SupportSessionData,
): Promise<void> {
  const pr = data.pendingReminder;
  if (!pr || !pr.suggestedMins) {
    await clearToIdle(phone, vendor.id);
    return;
  }

  if (upper === 'REMIND_ACCEPT_SUGGEST') {
    await attemptScheduleReminder(phone, vendor, data, pr, pr.suggestedMins);
    return;
  }

  if (upper === 'REMIND_DECLINE') {
    await clearToIdle(phone, vendor.id);
    await messageQueue.add({ to: phone, message: t('booking_reminder_declined', pr.language as Language) });
    return;
  }

  const declined = await isDeclineIntent(trimmed);
  if (declined) {
    await clearToIdle(phone, vendor.id);
    await messageQueue.add({ to: phone, message: t('booking_reminder_declined', pr.language as Language) });
    return;
  }

  // Unrecognised — re-send the alternative offer
  await sendTooSoonPrompt(phone, pr.language as Language, pr.suggestedMins, pr.suggestedMins);
}

/**
 * Calls scheduleReminder and handles every possible outcome with the right message.
 * Pre-parsed apptTime (if cached in session) is passed through to avoid double LLM calls.
 */
async function attemptScheduleReminder(
  phone: string,
  vendor: Vendor,
  data: SupportSessionData,
  pr: NonNullable<SupportSessionData['pendingReminder']>,
  durationMins: number,
): Promise<void> {
  const lang         = pr.language as Language;
  const parsedApptTime = pr.parsedApptTime ? new Date(pr.parsedApptTime) : undefined;

  const customer = await prisma.customer.findUnique({ where: { whatsappNumber: phone }, select: { id: true } });

  const result = await scheduleReminder({
    bookingId:      pr.bookingId,
    customerId:     customer?.id,
    customerPhone:  phone,
    serviceName:    pr.serviceRequested,
    businessName:   pr.vendorName,
    scheduledDate:  pr.scheduledDate,
    durationMins,
    language:       pr.language,
    parsedApptTime,
  });

  if (result.ok) {
    // Success — confirm and return to idle
    await clearToIdle(phone, vendor.id);
    await messageQueue.add({
      to:      phone,
      message: t('booking_reminder_set', lang, {
        reminderTime: result.formattedReminderTime,
        serviceName:  pr.serviceRequested,
      }),
    });
    return;
  }

  switch (result.reason) {
    case 'parse_failed': {
      // Could not parse scheduledDate → ask for exact time and fall back to custom flow
      await clearToIdle(phone, vendor.id);
      await messageQueue.add({ to: phone, message: t('booking_reminder_parse_fail', lang) });
      return;
    }

    case 'appointment_passed': {
      await clearToIdle(phone, vendor.id);
      await messageQueue.add({ to: phone, message: t('booking_reminder_past', lang) });
      return;
    }

    case 'too_soon': {
      const { minsUntilAppt, suggestedMins } = result;

      // Cache the parsed appt time (it was successfully parsed before the too-soon check)
      // We re-parse here but ideally the service returns it. For now, parse and cache.
      const freshParsed = parsedApptTime
        ?? (pr.scheduledDate ? await parseAppointmentDate(pr.scheduledDate) : null);

      await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
        ...data as unknown as SessionData,
        supportState: 'REMINDER_TOO_SOON',
        pendingReminder: {
          ...pr,
          parsedApptTime: freshParsed?.toISOString() ?? pr.parsedApptTime,
          suggestedMins,
        },
      });

      await sendTooSoonPrompt(phone, lang, minsUntilAppt, suggestedMins);
      return;
    }
  }
}

/**
 * Sends the "appointment is in less than X" alternative offer.
 */
async function sendTooSoonPrompt(
  phone: string,
  lang: Language,
  minsUntilAppt: number,
  suggestedMins: number,
): Promise<void> {
  const actualTimeStr    = formatMinutes(minsUntilAppt);
  const suggestedTimeStr = formatMinutes(suggestedMins);
  const btnLabel         = `⏰ ${suggestedMins < 60 ? `${suggestedMins}m` : `${Math.floor(suggestedMins / 60)}h`} before`.slice(0, 20);

  await messageQueue.add({
    to:      phone,
    message: t('booking_reminder_too_soon', lang, {
      actualTime:    actualTimeStr,
      suggestedTime: suggestedTimeStr,
    }),
    buttons: [
      { id: 'REMIND_ACCEPT_SUGGEST', title: btnLabel         },
      { id: 'REMIND_CUSTOM',         title: '✏️ Custom time' },
      { id: 'REMIND_DECLINE',        title: '❌ Skip'         },
    ] as InteractiveButton[],
  });
}

/**
 * Handles a mid-conversation reminder request (outside the REMINDER_PENDING state).
 * The customer may say "remind me 30 mins before" at any point.
 */
async function processMidFlowReminderRequest(
  phone: string,
  vendor: Vendor,
  booking: { id: string; serviceRequested: string; scheduledDate: string | null; customerPhone: string },
  durationMins: number,
  lang: Language,
  customerId?: string,
): Promise<void> {
  const result = await scheduleReminder({
    bookingId:     booking.id,
    customerId,
    customerPhone: phone,
    serviceName:   booking.serviceRequested,
    businessName:  vendor.businessName,
    scheduledDate: booking.scheduledDate ?? '',
    durationMins,
    language:      lang,
  });

  if (result.ok) {
    await messageQueue.add({
      to:      phone,
      message: t('booking_reminder_set', lang, {
        reminderTime: result.formattedReminderTime,
        serviceName:  booking.serviceRequested,
      }),
    });
    return;
  }

  switch (result.reason) {
    case 'parse_failed':
      await messageQueue.add({ to: phone, message: t('booking_reminder_parse_fail', lang) });
      break;
    case 'appointment_passed':
      await messageQueue.add({ to: phone, message: t('booking_reminder_past', lang) });
      break;
    case 'too_soon': {
      const { minsUntilAppt, suggestedMins } = result;
      // Store context then show the too-soon prompt
      const session = await sessionRepository.findActive(phone, vendor.id);
      const data    = ((session?.sessionData ?? { cart: [], supportState: '', role: 'customer' }) as unknown) as SupportSessionData;
      await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, {
        ...data as unknown as SessionData,
        supportState: 'REMINDER_TOO_SOON',
        pendingReminder: {
          bookingId:        booking.id,
          serviceRequested: booking.serviceRequested,
          scheduledDate:    booking.scheduledDate ?? '',
          vendorName:       vendor.businessName,
          language:         lang,
          suggestedMins,
        },
      });
      await sendTooSoonPrompt(phone, lang, minsUntilAppt, suggestedMins);
      break;
    }
  }
}

// ─── FAQ / Question Handling ──────────────────────────────────────────────────

async function handleQuestion(
  phone: string,
  question: string,
  vendor: Vendor,
): Promise<void> {
  const faqs = await prisma.supportKnowledge.findMany({ where: { vendorId: vendor.id } });

  let answer: string | null = null;
  if (faqs.length > 0) {
    answer = await answerFromFaqs(question, faqs.map((f) => ({ q: f.question, a: f.answer })), vendor);
  }

  if (answer) {
    await messageQueue.add({
      to:      phone,
      message: `${answer}\n\n_Reply *MENU* to go back or ask another question._`,
    });
    await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: '', role: 'customer' });
    return;
  }

  if (vendor.businessContext) {
    const llmAnswer = await answerFromContext(question, vendor);
    if (llmAnswer) {
      await messageQueue.add({
        to:      phone,
        message: `${llmAnswer}\n\n_Reply *MENU* to go back or ask another question._`,
      });
      await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: '', role: 'customer' });
      return;
    }
  }

  // Escalate to vendor
  await messageQueue.add({
    to: phone,
    message:
      `I don't have the answer to that right now, but I've sent your question to the *${vendor.businessName}* team.\n\n` +
      `They'll get back to you as soon as possible. 😊\n\n` +
      `_In the meantime, reply *MENU* to see our services._`,
  });

  const notifNumbers = await prisma.vendorNotificationNumber.findMany({ where: { vendorId: vendor.id, isActive: true } });
  for (const num of notifNumbers) {
    await messageQueue.add({
      to:      num.phone,
      message:
        `💬 *Customer Question*\n\n` +
        `From: ${phone}\n` +
        `Question: "${question}"\n\n` +
        `The bot couldn't answer this — please reply to ${phone} directly.`,
    });
  }

  await sessionRepository.upsert(phone, vendor.id, ConversationState.BROWSING, { cart: [], supportState: '', role: 'customer' });
}

async function answerFromFaqs(
  question: string,
  faqs: Array<{ q: string; a: string }>,
  vendor: Vendor,
): Promise<string | null> {
  const faqText = faqs.map((f, i) => `${i + 1}. Q: ${f.q}\n   A: ${f.a}`).join('\n\n');
  try {
    const result = await anthropic.messages.create({
      model:      env.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages:   [{
        role:    'user',
        content:
          `You are a customer support bot for "${vendor.businessName}".\n\n` +
          `Customer question: "${question}"\n\n` +
          `Available FAQs:\n${faqText}\n\n` +
          `If one of the FAQs directly answers the customer's question, reply with a friendly, natural answer based on it.\n` +
          `If none of the FAQs answer the question, reply with exactly: ESCALATE`,
      }],
    });
    const text = result.content[0].type === 'text' ? result.content[0].text.trim() : '';
    if (text === 'ESCALATE' || !text) return null;
    return text;
  } catch (err) {
    logger.error('FAQ answer LLM error', { err });
    return null;
  }
}

async function answerFromContext(
  question: string,
  vendor: Vendor,
): Promise<string | null> {
  try {
    const result = await anthropic.messages.create({
      model:      env.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages:   [{
        role:    'user',
        content:
          `You are a customer support bot for "${vendor.businessName}".\n\n` +
          `Business context: ${vendor.businessContext}\n\n` +
          `Customer question: "${question}"\n\n` +
          `If you can confidently answer based on the business context, do so in a friendly, concise way (2-3 sentences max).\n` +
          `If you are not confident, reply with exactly: ESCALATE`,
      }],
    });
    const text = result.content[0].type === 'text' ? result.content[0].text.trim() : '';
    if (text === 'ESCALATE' || !text) return null;
    return text;
  } catch (err) {
    logger.error('Context answer LLM error', { err });
    return null;
  }
}

// ─── Customer Bookings ────────────────────────────────────────────────────────

async function showCustomerBookings(phone: string, vendor: Vendor): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where:   { vendorId: vendor.id, customerPhone: phone },
    orderBy: { createdAt: 'desc' },
    take:    5,
  });

  if (bookings.length === 0) {
    await messageQueue.add({
      to:      phone,
      message:
        `You don't have any bookings with *${vendor.businessName}* yet.\n\n` +
        `Reply *BOOK SERVICE* to make one! 😊`,
    });
    return;
  }

  const lines = bookings.map((b) => {
    const id     = formatBookingId(b.id);
    const status = bookingStatusLabel(b.status);
    const date   = b.scheduledDate ? ` · ${b.scheduledDate}` : '';
    return `*${id}* — ${b.serviceRequested}${date}\n${status}`;
  });

  await messageQueue.add({
    to:      phone,
    message:
      `📅 *Your Bookings with ${vendor.businessName}*\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Reply *MENU* to go back.`,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function clearToIdle(phone: string, vendorId: string): Promise<void> {
  await sessionRepository.upsert(phone, vendorId, ConversationState.BROWSING, {
    cart: [], supportState: '', role: 'customer',
  });
}

async function vendorNeedsPickupAddress(vendorId: string): Promise<boolean> {
  const session = await prisma.vendorSetupSession.findUnique({ where: { vendorId } });
  if (!session) return false;
  const data = session.collectedData as Record<string, unknown>;
  const loc  = data.serviceLocationType as string | undefined;
  return loc === 'pickup' || loc === 'both';
}
