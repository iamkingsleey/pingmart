import Bull from 'bull';
import { env } from '../config/env';

export const sessionTimeoutQueue = new Bull('session-timeout', env.REDIS_URL);
