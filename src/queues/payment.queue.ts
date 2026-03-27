import Bull from 'bull';
import { env } from '../config/env';
import { PaymentProcessingJob } from '../types';

export const paymentQueue = new Bull<PaymentProcessingJob>('payment-processing', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
