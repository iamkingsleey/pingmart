/**
 * Opening Notification Worker
 *
 * Processes the opening-notification queue and schedules a cron job
 * that runs every hour to check whether any vendor just opened for business.
 */
import { openingNotificationQueue } from '../openingNotification.queue';
import { runOpeningNotificationJob } from '../../jobs/openingNotification.job';
import { logger } from '../../utils/logger';

openingNotificationQueue.process(async () => {
  await runOpeningNotificationJob();
});

// Hourly cron — checks each vendor's opening time in their local timezone
openingNotificationQueue.add(
  {},
  {
    repeat: { cron: '0 * * * *' },
    jobId: 'hourly-opening-notification',
  },
);

openingNotificationQueue.on('failed', (job, err) => {
  logger.error('Opening notification job failed', { jobId: job.id, error: err.message });
});

logger.info('Opening notification worker started');
