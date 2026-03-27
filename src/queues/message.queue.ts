/**
 * Outbound WhatsApp message queue.
 * All messages are sent asynchronously with 3-attempt exponential backoff.
 */
import Bull from 'bull';
import { env } from '../config/env';
import { WhatsAppMessageJob } from '../types';

export const messageQueue = new Bull<WhatsAppMessageJob>('whatsapp-messages', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

messageQueue.on('failed', (job, err) => {
  const { logger, maskPhone } = require('../utils/logger');
  logger.error('WhatsApp message job failed', { to: maskPhone(job.data.to), error: err.message, attempts: job.attemptsMade });
});
