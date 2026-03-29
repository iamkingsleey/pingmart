/**
 * Incoming message worker — delegates to the Phase 2 smart router.
 *
 * The router handles all routing logic: vendor detection, store code lookup,
 * active session continuation, and the "shop or sell?" screen for unknowns.
 * This worker is intentionally thin — it just dequeues and dispatches.
 */
import { incomingMessageQueue } from '../incomingMessage.queue';
import { routeIncomingMessage } from '../../services/router.service';
import { logger, maskPhone } from '../../utils/logger';

incomingMessageQueue.process(async (job) => {
  const { from, message, vendorWhatsAppNumber, messageId } = job.data;
  logger.info('Processing incoming message', { from: maskPhone(from) });
  await routeIncomingMessage(from, message, vendorWhatsAppNumber, messageId ?? '');
});

logger.info('Incoming message worker started');
