/**
 * Conversation history — last N message exchanges per user.
 * Stored in Redis as a capped list, TTL 24 hours.
 * Used as context for classifyIntent() so the LLM understands
 * what was just said before classifying the current message.
 */
import { redis } from './redis';
import { CONVERSATION_HISTORY_MAX_EXCHANGES } from '../config/constants';

export interface ConversationHistoryEntry {
  role: 'user' | 'bot';
  message: string;
  ts: number;
}

const historyKey = (phone: string) => `conv:history:${phone}`;
// 2 messages (1 exchange) × max exchanges
const MAX_MESSAGES = CONVERSATION_HISTORY_MAX_EXCHANGES * 2;
const TTL_SECS = 24 * 60 * 60; // 24 hours

/**
 * Appends a message to the conversation history for this phone.
 * Best-effort — never throws.
 */
export async function appendToHistory(
  phone: string,
  role: 'user' | 'bot',
  message: string,
): Promise<void> {
  try {
    const key = historyKey(phone);
    const entry: ConversationHistoryEntry = {
      role,
      message: message.slice(0, 500), // cap to avoid huge Redis values
      ts: Date.now(),
    };
    await redis.rpush(key, JSON.stringify(entry));
    await redis.ltrim(key, -MAX_MESSAGES, -1); // keep only the last MAX_MESSAGES
    await redis.expire(key, TTL_SECS);
  } catch {
    // History is best-effort — never block the main flow
  }
}

/**
 * Returns the stored history entries for this phone (oldest first).
 * Returns [] on any error.
 */
export async function getHistory(
  phone: string,
): Promise<ConversationHistoryEntry[]> {
  try {
    const raw = await redis.lrange(historyKey(phone), 0, -1);
    return raw.map((s) => JSON.parse(s) as ConversationHistoryEntry);
  } catch {
    return [];
  }
}

/**
 * Formats history as a compact string for LLM prompts.
 * Example output:
 *   User: give me a moment, remind me in 1 hour
 *   Bot: No problem! I'll remind you in an hour.
 *   User: I'm back
 */
export function formatHistoryForLLM(history: ConversationHistoryEntry[]): string {
  return history
    .map((h) => `${h.role === 'user' ? 'User' : 'Bot'}: ${h.message}`)
    .join('\n');
}

/**
 * Clears conversation history for a phone (e.g. on RESET).
 * Best-effort — never throws.
 */
export async function clearHistory(phone: string): Promise<void> {
  try {
    await redis.del(historyKey(phone));
  } catch {
    // Best-effort
  }
}
