/**
 * Singleton Prisma client — prevents connection pool exhaustion on hot reloads.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

// Log unhandled Prisma errors at module level
prisma.$connect().catch((err: Error) =>
  logger.error('Prisma initial connection error', { error: err.message }),
);

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
