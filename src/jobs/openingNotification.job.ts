/**
 * Opening Notification Job
 *
 * Runs every hour. For each active vendor, checks whether the current time
 * in the vendor's timezone matches their opening hour. If it does, sends a
 * "we're now open!" WhatsApp message to every customer who messaged while
 * the store was closed in the last 24 hours and hasn't yet been notified.
 */
import { formatInTimeZone } from 'date-fns-tz';
import { vendorRepository } from '../repositories/vendor.repository';
import { offHoursContactRepository } from '../repositories/offHoursContact.repository';
import { messageQueue } from '../queues/message.queue';
import { logger } from '../utils/logger';

export async function runOpeningNotificationJob(): Promise<void> {
  const now = new Date();
  const vendors = await vendorRepository.findAllActive();

  for (const vendor of vendors) {
    try {
      // Skip vendors who accept orders around the clock
      if (vendor.acceptOffHoursOrders) continue;

      const timezone = vendor.timezone ?? 'Africa/Lagos';
      const currentHHMM = formatInTimeZone(now, timezone, 'HH:mm');
      const openingHHMM = vendor.workingHoursStart ?? '08:00';

      // Only act if the current time matches the opening time (±0 min precision)
      if (currentHHMM !== openingHHMM) continue;

      const pending = await offHoursContactRepository.findPendingForVendor(vendor.id);
      if (!pending.length) continue;

      logger.info('Sending opening notifications', {
        vendorId: vendor.id,
        count: pending.length,
      });

      const opts = { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true };
      const queueJobs = pending.map(({ customerPhone }) =>
        messageQueue.add(
          {
            to: customerPhone,
            message:
              `Good morning! 🌅 *${vendor.businessName}* is now open.\n\n` +
              `Ready to take your order — type *MENU* to get started! 😊`,
          },
          opts,
        ),
      );
      await Promise.allSettled(queueJobs);
      await offHoursContactRepository.markNotified(pending.map(c => c.id));
    } catch (err) {
      logger.error('Opening notification failed for vendor', {
        vendorId: vendor.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
