import { sessionTimeoutQueue } from '../sessionTimeout.queue';
import { processSessionTimeout } from '../../jobs/sessionTimeout.job';
import { logger } from '../../utils/logger';

sessionTimeoutQueue.process(async (job) => {
  await processSessionTimeout(job);
});

sessionTimeoutQueue.on('failed', (job, err) => {
  logger.error('Session timeout job failed', { jobId: job.id, error: err.message });
});

logger.info('Session timeout worker started');
