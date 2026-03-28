import Bull from 'bull';
import { env } from '../config/env';

// Empty job payload — the job fetches its own data from the DB
export const reorderQueue = new Bull<Record<string, never>>('reorder', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
