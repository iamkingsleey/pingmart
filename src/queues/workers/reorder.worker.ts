/**
 * Reorder worker — processes the daily re-order nudge job.
 * Schedules itself with a cron pattern at startup (10:00 AM every day).
 */
import { reorderQueue } from '../reorder.queue';
import { runReorderJob } from '../../jobs/reorder.job';
import { logger } from '../../utils/logger';

reorderQueue.process(async () => {
  await runReorderJob();
});

reorderQueue.on('failed', (_job, err) => {
  logger.error('Reorder job failed', { error: err.message });
});

// Schedule the daily cron — Bull deduplicates repeated jobs by key
reorderQueue.add(
  {},
  {
    repeat: { cron: '0 10 * * *' }, // every day at 10:00 AM
    removeOnComplete: true,
    removeOnFail: false,
    jobId: 'daily-reorder', // stable ID prevents duplicate cron registrations
  },
);

logger.info('Reorder worker started');
