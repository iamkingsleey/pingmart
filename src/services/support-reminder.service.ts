/**
 * Support Mode Booking Reminder Service
 *
 * Handles all reminder scheduling logic for Support Mode (service-based) bookings.
 * Intentionally isolated from the main order flow — only imported by
 * support-customer.service.ts and support-vendor.service.ts.
 *
 * Responsibilities:
 *   1. Parse natural-language appointment dates to JS Date objects (LLM)
 *   2. Parse natural-language reminder durations to minutes (LLM)
 *   3. Detect "decline reminder" intent in customer messages (fast-path + LLM)
 *   4. Detect mid-flow reminder requests from customers (intent detection)
 *   5. Schedule a Bull delayed job + create a BookingReminder DB record
 *   6. Cancel pending reminders (called when booking is cancelled by vendor)
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../repositories/prisma';
import { bookingReminderQueue } from '../queues/bookingReminder.queue';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─── Date & Duration Parsing ──────────────────────────────────────────────────

/**
 * Parse a natural-language date/time string to a JS Date object.
 *
 * Handles phrases like "tomorrow at 10am", "Friday 3pm", "next Monday morning".
 * Assumes Lagos timezone (WAT = UTC+1).
 * Returns null when the string is too vague to parse confidently.
 */
export async function parseAppointmentDate(dateStr: string): Promise<Date | null> {
  if (!dateStr?.trim()) return null;

  const lagosNowStr = new Date().toLocaleString('en-NG', {
    timeZone:  'Africa/Lagos',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  try {
    const response = await anthropic.messages.create({
      model:      env.ANTHROPIC_MODEL,
      max_tokens: 40,
      system:
        `You are a date/time parser for a Nigerian WhatsApp booking bot.\n` +
        `Current date/time in Lagos (UTC+1): ${lagosNowStr}\n` +
        `Parse the booking time to ISO 8601 with UTC+1 offset, e.g. "2024-11-15T14:00:00+01:00".\n` +
        `If no specific time is given, default to 09:00:00.\n` +
        `If you cannot determine the date, reply exactly: UNKNOWN\n` +
        `Return ONLY the ISO string or UNKNOWN — no explanation.`,
      messages: [{ role: 'user', content: dateStr }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (!text || text === 'UNKNOWN') return null;

    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch (err) {
    logger.warn('parseAppointmentDate: LLM failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Extract a duration in minutes from a natural-language string.
 * "45 minutes" → 45 | "2 hours" → 120 | "half an hour" → 30
 * Returns null if the message doesn't contain a parseable duration.
 */
export async function parseDurationMinutes(text: string): Promise<number | null> {
  try {
    const response = await anthropic.messages.create({
      model:      env.ANTHROPIC_MODEL,
      max_tokens: 10,
      system:
        `Extract a time duration from this message as an integer number of minutes.\n` +
        `Examples: "45 minutes" → 45, "1 hour" → 60, "2 hours" → 120, "half an hour" → 30, "30 mins" → 30\n` +
        `Return ONLY the integer. If no duration is present, return UNKNOWN.`,
      messages: [{ role: 'user', content: text }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    if (!raw || raw === 'UNKNOWN') return null;
    const mins = parseInt(raw, 10);
    return isNaN(mins) || mins <= 0 ? null : mins;
  } catch {
    return null;
  }
}

// ─── Intent Detection ─────────────────────────────────────────────────────────

/**
 * Returns true when the message is a clear refusal to set a reminder.
 * Fast word-list check first; LLM only for ambiguous cases.
 */
export async function isDeclineIntent(message: string): Promise<boolean> {
  const lower = message.trim().toLowerCase();
  const DECLINE_WORDS = [
    'no', 'nah', 'nope', 'no need', 'no thanks', 'e no necessary',
    'skip', "don't", 'dont', 'not now', 'maybe later', 'never mind',
    'nevermind', 'cancel', 'na', 'abeg no',
  ];
  if (
    DECLINE_WORDS.some(
      (w) => lower === w || lower.startsWith(w + ' ') || lower.endsWith(' ' + w),
    )
  ) {
    return true;
  }

  // LLM for ambiguous phrasing
  try {
    const response = await anthropic.messages.create({
      model:      env.ANTHROPIC_MODEL,
      max_tokens: 5,
      system:     `Is this message declining or refusing a reminder offer? Reply YES or NO only.`,
      messages:   [{ role: 'user', content: message }],
    });
    const text = response.content[0]?.type === 'text'
      ? response.content[0].text.trim().toUpperCase()
      : 'NO';
    return text.startsWith('YES');
  } catch {
    return false;
  }
}

/**
 * Detects whether a message contains a mid-flow reminder request.
 * e.g. "remind me 30 mins before", "ping me before the appointment", "don't let me forget"
 *
 * Returns { isReminder: true, durationMins } when detected.
 * durationMins defaults to 30 when no explicit duration is mentioned.
 */
export async function detectReminderIntent(
  message: string,
): Promise<{ isReminder: boolean; durationMins?: number }> {
  const lower = message.trim().toLowerCase();
  const REMINDER_TRIGGERS = [
    'remind me', 'ping me', "don't let me forget", 'dont let me forget',
    'reminder', 'remind am', 'ping am', 'make i no forget', 'set reminder',
    'give me a reminder', 'notify me', 'alert me',
  ];
  if (!REMINDER_TRIGGERS.some((trigger) => lower.includes(trigger))) {
    return { isReminder: false };
  }

  const durationMins = await parseDurationMinutes(message);
  return { isReminder: true, durationMins: durationMins ?? 30 };
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

/** Formats a minute count as human-readable text. e.g. 20 → "20 minutes", 60 → "1 hour" */
export function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} hour${h !== 1 ? 's' : ''}`;
  return `${h}h ${m}m`;
}

/** Formats a Date as "Mon, 15 Nov · 2:00 PM" in Lagos timezone */
export function formatLagosTime(date: Date): string {
  return date.toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday:  'short',
    month:    'short',
    day:      'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
  });
}

export type ScheduleReminderOutcome =
  | { ok: true;  reminderTime: Date; formattedReminderTime: string; formattedApptTime: string }
  | { ok: false; reason: 'parse_failed' }
  | { ok: false; reason: 'appointment_passed' }
  | { ok: false; reason: 'too_soon'; minsUntilAppt: number; suggestedMins: number };

/**
 * Parse the appointment date, apply the requested lead-time, then schedule
 * a delayed Bull job and create a BookingReminder DB record.
 *
 * Returns a typed outcome so the caller can respond appropriately in each case.
 */
export async function scheduleReminder(params: {
  bookingId:      string;
  customerId?:    string;
  customerPhone:  string;
  serviceName:    string;
  businessName:   string;
  scheduledDate:  string;        // raw free-text from Booking.scheduledDate
  durationMins:   number;        // how many minutes before appointment to remind
  language:       string;
  parsedApptTime?: Date;         // optional pre-parsed date (avoids a second LLM call)
}): Promise<ScheduleReminderOutcome> {
  const {
    bookingId, customerId, customerPhone, serviceName, businessName,
    scheduledDate, durationMins, language,
  } = params;

  // ── Parse appointment time ────────────────────────────────────────────────
  const apptTime = params.parsedApptTime ?? await parseAppointmentDate(scheduledDate);
  if (!apptTime) return { ok: false, reason: 'parse_failed' };

  const now = new Date();

  if (apptTime <= now) return { ok: false, reason: 'appointment_passed' };

  const minsUntilAppt = Math.floor((apptTime.getTime() - now.getTime()) / 60_000);

  // ── Too-soon edge case ────────────────────────────────────────────────────
  if (durationMins >= minsUntilAppt) {
    const suggestedMins = Math.max(5, Math.floor(minsUntilAppt / 2));
    return { ok: false, reason: 'too_soon', minsUntilAppt, suggestedMins };
  }

  const reminderTime = new Date(apptTime.getTime() - durationMins * 60_000);

  const formattedApptTime    = formatLagosTime(apptTime);
  const formattedReminderTime = formatLagosTime(reminderTime);

  // ── Create DB record ──────────────────────────────────────────────────────
  const dbRecord = await prisma.bookingReminder.create({
    data: {
      bookingId,
      customerId:     customerId ?? null,
      customerPhone,
      serviceName,
      businessName,
      reminderTime,
      appointmentTime: apptTime,
      language,
      sent: false,
    },
  });

  // ── Schedule Bull delayed job ─────────────────────────────────────────────
  const delay = Math.max(reminderTime.getTime() - Date.now(), 0);
  const job   = await bookingReminderQueue.add(
    {
      bookingReminderId: dbRecord.id,
      customerPhone,
      serviceName,
      businessName,
      appointmentTime: formattedApptTime,
      language,
    },
    {
      delay,
      jobId:            `booking-reminder:${dbRecord.id}`,
      removeOnComplete: true,
      removeOnFail:     false,
    },
  );

  // Store Bull job ID for later cancellation
  await prisma.bookingReminder.update({
    where: { id: dbRecord.id },
    data:  { bullJobId: String(job.id) },
  });

  logger.info('Booking reminder scheduled', {
    bookingId,
    reminderId:  dbRecord.id,
    reminderAt:  reminderTime.toISOString(),
    durationMins,
  });

  return { ok: true, reminderTime, formattedReminderTime, formattedApptTime };
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

/**
 * Cancel all unsent reminders for a booking.
 * Called by support-vendor.service.ts when a vendor marks a booking CANCELLED.
 * Removes the Bull delayed job and marks the DB record as sent (suppressed).
 */
export async function cancelBookingReminders(bookingId: string): Promise<void> {
  const reminders = await prisma.bookingReminder.findMany({
    where:  { bookingId, sent: false },
    select: { id: true, bullJobId: true },
  });

  if (reminders.length === 0) return;

  for (const reminder of reminders) {
    if (reminder.bullJobId) {
      try {
        const job = await bookingReminderQueue.getJob(reminder.bullJobId);
        await job?.remove();
      } catch (err) {
        // Non-fatal — the worker will suppress the job when it fires
        logger.warn('cancelBookingReminders: could not remove Bull job (non-fatal)', {
          bullJobId: reminder.bullJobId,
          err:       err instanceof Error ? err.message : String(err),
        });
      }
    }
    await prisma.bookingReminder.update({
      where: { id: reminder.id },
      data:  { sent: true },
    });
  }

  logger.info('Booking reminders cancelled', { bookingId, count: reminders.length });
}
