import Bull from 'bull';
import { env } from '../config/env';
import { IncomingMessageJob } from '../types';

export const incomingMessageQueue = new Bull<IncomingMessageJob>('incoming-messages', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
