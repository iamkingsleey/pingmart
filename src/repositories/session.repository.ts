/**
 * Conversation session repository.
 * One session per customer per vendor — upserted on every message.
 */
import { ConversationSession } from '@prisma/client';
import { prisma } from './prisma';
import { ConversationState, SessionData } from '../types';
import { SESSION_TIMEOUT_MS } from '../config/constants';

type PrismaJson = import('@prisma/client').Prisma.InputJsonValue;

export const sessionRepository = {
  /**
   * Returns the active session, or null if expired/non-existent.
   * Lazily deletes expired sessions.
   */
  async findActive(whatsappNumber: string, vendorId: string): Promise<ConversationSession | null> {
    const session = await prisma.conversationSession.findUnique({
      where: { whatsappNumber_vendorId: { whatsappNumber, vendorId } },
    });
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await prisma.conversationSession.delete({
        where: { whatsappNumber_vendorId: { whatsappNumber, vendorId } },
      }).catch(() => undefined); // Ignore if already deleted
      return null;
    }
    return session;
  },

  /** Creates or updates a session, resetting the 30-minute expiry on every call. */
  async upsert(
    whatsappNumber: string,
    vendorId: string,
    state: ConversationState,
    data: SessionData,
  ): Promise<ConversationSession> {
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);
    // Ensure the Customer row exists before writing the session — the FK
    // conversation_sessions_whatsappNumber_fkey requires it.
    await prisma.customer.upsert({
      where:  { whatsappNumber },
      create: { whatsappNumber },
      update: {},
    });
    // Always stamp role: 'customer' so the router can distinguish customer
    // sessions from ambiguous phone matches (e.g. a vendor owner shopping).
    const stamped: SessionData = { ...data, role: 'customer' };
    return prisma.conversationSession.upsert({
      where: { whatsappNumber_vendorId: { whatsappNumber, vendorId } },
      create: { whatsappNumber, vendorId, state, sessionData: stamped as unknown as PrismaJson, expiresAt },
      update: { state, sessionData: stamped as unknown as PrismaJson, expiresAt },
    });
  },

  /** Resets a session to IDLE with empty cart — called after order completion. */
  async reset(whatsappNumber: string, vendorId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);
    const emptyData: SessionData = { cart: [], role: 'customer' };
    // Ensure the Customer row exists before writing the session — the FK
    // conversation_sessions_whatsappNumber_fkey requires it.
    await prisma.customer.upsert({
      where:  { whatsappNumber },
      create: { whatsappNumber },
      update: {},
    });
    await prisma.conversationSession.upsert({
      where: { whatsappNumber_vendorId: { whatsappNumber, vendorId } },
      create: { whatsappNumber, vendorId, state: 'IDLE', sessionData: emptyData as unknown as PrismaJson, expiresAt },
      update: { state: 'IDLE', sessionData: emptyData as unknown as PrismaJson, expiresAt },
    });
  },

  async deleteExpired(): Promise<number> {
    const result = await prisma.conversationSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return result.count;
  },
};

export type { ConversationSession };
