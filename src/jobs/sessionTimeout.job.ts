/**
 * Session Timeout Job — inactivity nudge + auto-cancel
 *
 * Flow:
 *   1. Customer stops responding mid-order
 *   2. After 10 min → send a nudge ("Still there?")
 *   3. After 5 more min → auto-cancel the session and notify customer
 *
 * A nonce stored in the session is used to detect if the customer
 * has already responded (new message = new nonce, so old job skips).
 */
import { Job } from 'bull';
import { sessionRepository } from '../repositories/session.repository';
import { vendorRepository } from '../repositories/vendor.repository';
import { messageQueue } from '../queues/message.queue';
import { sessionTimeoutQueue } from '../queues/sessionTimeout.queue';
import { ConversationState, SessionData } from '../types';
import { logger, maskPhone } from '../utils/logger';
import { resolveStoreVocabulary, applyVocabulary } from '../utils/store-vocabulary';

export interface SessionTimeoutJobData {
  from: string;
  vendorId: string;
  nonce: string;
  type: 'nudge' | 'cancel';
}

/** States where inactivity timeouts apply */
const ACTIVE_STATES: ConversationState[] = [
  ConversationState.BROWSING,
  ConversationState.ORDERING,
  ConversationState.AWAITING_ADDRESS,
  ConversationState.AWAITING_PAYMENT,
];

export async function processSessionTimeout(job: Job<SessionTimeoutJobData>): Promise<void> {
  const { from, vendorId, nonce, type } = job.data;

  const session = await sessionRepository.findActive(from, vendorId);
  if (!session) return; // session already expired or cleared

  const data = session.sessionData as unknown as SessionData;
  // If the nonce doesn't match, the customer has already responded — skip
  if (data.timeoutNonce !== nonce) return;

  const state = session.state as ConversationState;
  if (!ACTIVE_STATES.includes(state)) return;

  if (type === 'nudge') {
    logger.info('Sending inactivity nudge', { from: maskPhone(from), vendorId, state });

    await messageQueue.add({
      to: from,
      message:
        '👋 Still there? Your order is waiting!\n\n' +
        'Reply to continue or type *CANCEL* to cancel your order.',
    });

    // Schedule auto-cancel in 5 minutes with the same nonce
    const cancelJobId = `timeout:cancel:${from}:${vendorId}`;
    const existing = await sessionTimeoutQueue.getJob(cancelJobId);
    await existing?.remove();

    await sessionTimeoutQueue.add(
      { from, vendorId, nonce, type: 'cancel' } satisfies SessionTimeoutJobData,
      { delay: 5 * 60 * 1000, jobId: cancelJobId, removeOnComplete: true, removeOnFail: true },
    );
  } else {
    logger.info('Auto-cancelling session due to inactivity', { from: maskPhone(from), vendorId, state });

    // Reset session to IDLE — clears cart and all pending state
    await sessionRepository.upsert(from, vendorId, ConversationState.IDLE, { cart: [] });

    const vendor = await vendorRepository.findById(vendorId);
    const vocab = resolveStoreVocabulary(vendor?.businessType ?? 'general');
    await messageQueue.add({
      to: from,
      message: applyVocabulary(
        "⏰ Your session has timed out due to inactivity.\n\n" +
        "Your order has been cancelled. Type *MENU* to start a new order whenever you're ready! 😊",
        vocab,
      ),
    });
  }
}
