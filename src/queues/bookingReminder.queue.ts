/**
 * Booking Reminder Queue
 *
 * Delayed jobs that fire at a pre-calculated time before a customer's
 * Support Mode appointment. One job per BookingReminder DB record.
 *
 * Job lifecycle:
 *   1. support-reminder.service.ts adds a delayed job after booking confirmation
 *   2. Worker fires, checks booking is still active, sends WhatsApp message
 *   3. BookingReminder.sent is set to true
 *   4. If booking is cancelled: job is removed via Bull job ID stored in DB
 */
import Bull from 'bull';
import { env } from '../config/env';

export interface BookingReminderJobData {
  /** DB primary key of the BookingReminder record */
  bookingReminderId: string;
  customerPhone: string;
  serviceName: string;
  businessName: string;
  /** Human-readable appointment time string shown in the reminder message */
  appointmentTime: string;
  language: string;
}

export const bookingReminderQueue = new Bull<BookingReminderJobData>('booking-reminders', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
