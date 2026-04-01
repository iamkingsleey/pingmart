/**
 * Incoming message worker — delegates to the Phase 2 smart router.
 *
 * The router handles all routing logic: vendor detection, store code lookup,
 * active session continuation, and the "shop or sell?" screen for unknowns.
 * This worker is intentionally thin — it just dequeues and dispatches.
 *
 * Learning layer: every message is logged here (fire-and-forget) so the
 * InteractionLog table receives 100% of incoming traffic as training data.
 */
import { MessageType } from '@prisma/client';
import { incomingMessageQueue } from '../incomingMessage.queue';
import { routeIncomingMessage } from '../../services/router.service';
import { logInteraction } from '../../services/learning.service';
import { logger, maskPhone } from '../../utils/logger';

incomingMessageQueue.process(async (job) => {
  const {
    from,
    message,
    vendorWhatsAppNumber,
    messageId,
    imageMediaId,
    imageCaption,
  } = job.data;

  const startMs = Date.now();

  logger.info('Processing incoming message', {
    from: maskPhone(from),
    hasImage: !!imageMediaId,
  });

  // Determine message type for learning log
  const messageType: MessageType =
    imageMediaId                     ? MessageType.IMAGE
    : message === '__VOICE__'        ? MessageType.VOICE
    : message.startsWith('BUTTON:')  ? MessageType.INTERACTIVE
    : MessageType.TEXT;

  // Route the message (main processing — all business logic happens here)
  await routeIncomingMessage(
    from,
    message,
    vendorWhatsAppNumber,
    messageId ?? '',
    imageMediaId,
    imageCaption,
  );

  // Log the interaction after routing completes (fire-and-forget — never blocks)
  logInteraction({
    customerPhone:  from,
    messageType,
    rawInput:       imageMediaId ? (imageCaption ?? '[image]') : message,
    responseTimeMs: Date.now() - startMs,
  });
});

logger.info('Incoming message worker started');
