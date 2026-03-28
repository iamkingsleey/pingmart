import Bull from 'bull';
import { env } from '../config/env';

export const openingNotificationQueue = new Bull('opening-notification', env.REDIS_URL);
