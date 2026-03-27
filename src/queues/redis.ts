import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => logger.info('Redis connected'));
redisConnection.on('error', (err) => logger.error('Redis error', { error: err.message }));
