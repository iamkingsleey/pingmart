/**
 * Shared Redis client — used for lightweight key-value operations
 * (e.g. rate limiting) that don't need a full Bull queue.
 *
 * Uses the same REDIS_URL as Bull so no extra connection config is needed.
 */
import Redis from 'ioredis';
import { env } from '../config/env';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
});
