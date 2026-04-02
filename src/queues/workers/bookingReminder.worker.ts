/**
 * Booking Reminder Worker
 *
 * Processes delayed booking reminder jobs for Support Mode customers.
 * Each job fires at the pre-calculated reminder time (e.g. 20 mins before appointment).
 *
 * Safety checks before sending:
 *   1. DB record exists and has not been sent already
 *   2. Booking has not been cancelled
 *   3. Appointment time has not already passed
 */
import { bookingReminderQueue, BookingReminderJobData } from '../bookingReminder.queue';
import { prisma } from '../../repositories/prisma';
import { messageQueue } from '../message.queue';
import { t, Language } from '../../i18n';
import { logger, maskPhone } from '../../utils/logger';

bookingReminderQueue.process(async (job) => {
  const {
    bookingReminderId,
    customerPhone,
    serviceName,
    businessName,
    appointmentTime,
    language,
  } = job.data as BookingReminderJobData;

  logger.info('Booking reminder job firing', {
    reminderId: bookingReminderId,
    customer: maskPhone(customerPhone),
  });

  // ── Guard 1: DB record exists and has not already been sent ──────────────
  const reminder = await prisma.bookingReminder.findUnique({
    where:   { id: bookingReminderId },
    include: { booking: { select: { status: true } } },
  });

  if (!reminder) {
    logger.info('Booking reminder: record not found — skipping', { reminderId: bookingReminderId });
    return;
  }

  if (reminder.sent) {
    logger.info('Booking reminder: already sent — skipping', { reminderId: bookingReminderId });
    return;
  }

  // ── Guard 2: Booking has not been cancelled ──────────────────────────────
  if (reminder.booking.status === 'CANCELLED') {
    logger.info('Booking reminder: booking was cancelled — suppressing', { reminderId: bookingReminderId });
    await prisma.bookingReminder.update({ where: { id: bookingReminderId }, data: { sent: true } });
    return;
  }

  // ── Guard 3: Appointment time has not already passed ─────────────────────
  if (reminder.appointmentTime < new Date()) {
    logger.info('Booking reminder: appointment has already passed — suppressing', { reminderId: bookingReminderId });
    await prisma.bookingReminder.update({ where: { id: bookingReminderId }, data: { sent: true } });
    return;
  }

  // ── Send reminder ─────────────────────────────────────────────────────────
  const lang = language as Language;
  const message = t('booking_reminder_fire', lang, { serviceName, businessName, appointmentTime });

  await messageQueue.add(
    { to: customerPhone, message },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true },
  );

  await prisma.bookingReminder.update({
    where: { id: bookingReminderId },
    data:  { sent: true },
  });

  logger.info('Booking reminder sent', {
    reminderId: bookingReminderId,
    customer:   maskPhone(customerPhone),
    service:    serviceName,
  });
});

bookingReminderQueue.on('failed', (_job, err) => {
  logger.error('Booking reminder job failed', { error: err.message });
});

logger.info('Booking reminder worker started');
