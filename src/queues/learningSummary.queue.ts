import Bull from 'bull';
import { env } from '../config/env';

export const learningSummaryQueue = new Bull('learning-summary', env.REDIS_URL);
