/**
 * Digital product delivery queue — high priority.
 *
 * This queue has the highest priority because customers are waiting for their
 * purchase immediately after payment. 5 retry attempts with exponential backoff.
 * If all retries fail, the worker calls handleDeliveryFailure() to alert the vendor.
 */
import Bull from 'bull';
import { env } from '../config/env';
import { DigitalDeliveryJob } from '../types';
import { DIGITAL_DELIVERY_JOB_ATTEMPTS, JOB_BACKOFF_DELAY_MS } from '../config/constants';

export const digitalDeliveryQueue = new Bull<DigitalDeliveryJob>('digital-delivery', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: DIGITAL_DELIVERY_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

digitalDeliveryQueue.on('failed', (job, err) => {
  const { logger, maskPhone } = require('../utils/logger');
  logger.error('Digital delivery job failed', {
    orderId: job.data.orderId,
    customer: maskPhone(job.data.customerPhone),
    error: err.message,
    attempts: job.attemptsMade,
  });
});
