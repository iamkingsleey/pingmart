/**
 * Server entry point — validates env, starts HTTP server, initialises workers.
 */

// Suppress DEP0169 url.parse() deprecation — originates inside bull@4's queue.js,
// a third-party dependency we do not control. All other process warnings are kept.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'DeprecationWarning' && w.message.includes('url.parse')) return;
  process.stderr.write(`Warning: ${w.name}: ${w.message}\n`);
});

import { env } from './config/env'; // Must be first — crashes if env is invalid

import { app } from './app';
import { logger } from './utils/logger';
import { prisma } from './repositories/prisma';

// Start all queue workers by importing them
import './queues/workers/message.worker';
import './queues/workers/payment.worker';
import './queues/workers/digitalDelivery.worker';
import './queues/workers/incomingMessage.worker';
import './queues/workers/reorder.worker';
import './queues/workers/openingNotification.worker';
import './queues/workers/sessionTimeout.worker';

import { messageQueue } from './queues/message.queue';
import { paymentQueue } from './queues/payment.queue';
import { incomingMessageQueue } from './queues/incomingMessage.queue';
import { digitalDeliveryQueue } from './queues/digitalDelivery.queue';
import { reorderQueue } from './queues/reorder.queue';
import { openingNotificationQueue } from './queues/openingNotification.queue';
import { sessionTimeoutQueue } from './queues/sessionTimeout.queue';

const server = app.listen(env.PORT, () => {
  logger.info('🚀 Server started', { port: env.PORT, env: env.NODE_ENV, pid: process.pid });
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — graceful shutdown...`);
  server.close(async () => {
    await Promise.allSettled([
      messageQueue.close(),
      paymentQueue.close(),
      incomingMessageQueue.close(),
      digitalDeliveryQueue.close(),
      reorderQueue.close(),
      openingNotificationQueue.close(),
      sessionTimeoutQueue.close(),
    ]);
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => { logger.error('Forced shutdown after timeout'); process.exit(1); }, 30_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (r) => logger.error('Unhandled rejection', { reason: String(r) }));
process.on('uncaughtException', (e) => { logger.error('Uncaught exception', { error: e.message }); process.exit(1); });
