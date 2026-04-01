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
import { markMessageRead } from '../../services/whatsapp/whatsapp.service';
import { logger, maskPhone } from '../../utils/logger';

incomingMessageQueue.process(async (job) => {
  const {
    from,
    message,
    vendorWhatsAppNumber,
    messageId,
    imageMediaId,
    imageCaption,
    documentMediaId,
    documentFileName,
    documentMimeType,
  } = job.data;

  const startMs = Date.now();

  // Mark the incoming message as read immediately — turns double-tick blue,
  // reducing perceived latency before the bot's response arrives.
  if (messageId) {
    markMessageRead(messageId).catch((err) =>
      logger.warn('markMessageRead failed in worker', { err }),
    );
  }

  logger.info('Processing incoming message', {
    from: maskPhone(from),
    hasImage: !!imageMediaId,
    hasDocument: !!documentMediaId,
  });

  // Determine message type for learning log
  const messageType: MessageType =
    imageMediaId || documentMediaId  ? MessageType.IMAGE   // documents treated as IMAGE in log
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
    documentMediaId,
    documentFileName,
    documentMimeType,
  );

  // Log the interaction after routing completes (fire-and-forget — never blocks)
  logInteraction({
    customerPhone:  from,
    messageType,
    rawInput:       imageMediaId
      ? (imageCaption ?? '[image]')
      : documentMediaId
        ? (documentFileName ?? '[document]')
        : message,
    responseTimeMs: Date.now() - startMs,
  });
});

logger.info('Incoming message worker started');
