/**
 * Learning Service — Continuous AI Improvement for Pingmart
 *
 * Every interaction on the platform is a training signal. This service:
 *   1. Logs every incoming message with intent classification metadata
 *   2. Maintains a LanguagePattern library of real Nigerian expressions
 *   3. Flags low-confidence classifications for human review
 *   4. Tracks basket analysis and drop-off points per vendor
 *   5. Generates weekly performance summaries (logged every Monday 8am Lagos)
 *   6. Suggests FAQ expansions to vendors after 20+ unanswered questions
 *
 * PRIVACY RULES (non-negotiable):
 *   - Phone numbers are always masked via maskPhone() — raw phones never stored
 *   - Payment details, bank account numbers, and Paystack keys are never logged
 *   - All writes are fire-and-forget so they never add latency to the user flow
 *   - When LEARNING_MODE=false, all write functions become no-ops
 *
 * CONFIDENCE THRESHOLDS:
 *   ≥ 0.85 → act directly + save to LanguagePattern
 *   0.60–0.84 → act but log for review (no pattern save)
 *   < 0.60 → ask clarifying question + save to UncertainInteractions
 */

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { MessageType, OrderStatus } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { messageQueue } from '../queues/message.queue';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';

// ─── Confidence thresholds (single source of truth) ──────────────────────────

export const CONFIDENCE_HIGH   = 0.85; // act directly + save pattern
export const CONFIDENCE_MEDIUM = 0.60; // act but log for review
// < CONFIDENCE_MEDIUM → uncertain: clarify + log to UncertainInteractions

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogInteractionParams {
  vendorId?: string;
  customerPhone: string;       // will be masked before storage
  sessionId?: string;
  messageType: MessageType;
  rawInput: string;
  detectedLanguage?: string;
  detectedIntent?: string;
  confidenceScore?: number;
  resolvedIntent?: string;
  flowState?: string;
  responseTimeMs?: number;
}

export interface LogUncertainParams {
  vendorId?: string;
  customerPhone: string;
  rawInput: string;
  detectedLanguage?: string;
  suggestedIntent?: string;
  confidenceScore: number;
  flowState?: string;
}

export interface LogOrderIntelligenceParams {
  vendorId: string;
  orderId: string;
  productIds: string[];
  language?: string;
  messageCount: number;
  askedForHelp: boolean;
}

// ─── Interaction Logging ──────────────────────────────────────────────────────

/**
 * Log every incoming message. Fire-and-forget — never throws, never blocks.
 * Phone is masked before storage; rawInput is stored verbatim (no PII).
 */
export function logInteraction(params: LogInteractionParams): void {
  if (!env.LEARNING_MODE) return;

  prisma.interactionLog
    .create({
      data: {
        vendorId:            params.vendorId ?? null,
        customerPhoneMasked: maskPhone(params.customerPhone),
        sessionId:           params.sessionId ?? null,
        messageType:         params.messageType,
        rawInput:            params.rawInput.slice(0, 2000), // cap at 2 KB
        detectedLanguage:    params.detectedLanguage ?? null,
        detectedIntent:      params.detectedIntent ?? null,
        confidenceScore:     params.confidenceScore ?? null,
        resolvedIntent:      params.resolvedIntent ?? null,
        flowState:           params.flowState ?? null,
        responseTimeMs:      params.responseTimeMs ?? null,
      },
    })
    .catch((err) =>
      logger.warn('logInteraction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

// ─── Uncertain Interaction Logging ───────────────────────────────────────────

/**
 * Save low-confidence (< 0.60) inputs to UncertainInteractions.
 * These are the priority training cases — the inputs the bot struggles most with.
 */
export function logUncertainInteraction(params: LogUncertainParams): void {
  if (!env.LEARNING_MODE) return;

  prisma.uncertainInteraction
    .create({
      data: {
        vendorId:            params.vendorId ?? null,
        customerPhoneMasked: maskPhone(params.customerPhone),
        rawInput:            params.rawInput.slice(0, 2000),
        detectedLanguage:    params.detectedLanguage ?? null,
        suggestedIntent:     params.suggestedIntent ?? null,
        confidenceScore:     params.confidenceScore,
        flowState:           params.flowState ?? null,
      },
    })
    .catch((err) =>
      logger.warn('logUncertainInteraction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

// ─── Language Pattern Library ─────────────────────────────────────────────────

/**
 * Check if a stored LanguagePattern covers this input.
 * Uses token-overlap similarity — no LLM needed for known patterns.
 *
 * Returns `{ intent, confidence }` or `null` if no match is good enough.
 *
 * Similarity tiers:
 *   Exact match (after lowercase+trim)          → confidence 0.97
 *   All tokens of input found in stored example → confidence 0.90
 *   ≥ 70% token overlap                         → confidence 0.82
 */
export async function findLanguagePattern(
  language: string,
  input: string,
): Promise<{ intent: string; confidence: number } | null> {
  if (!env.LEARNING_MODE) return null;

  try {
    const patterns = await prisma.languagePattern.findMany({
      where: { language },
      select: { intent: true, exampleInputs: true },
    });
    if (patterns.length === 0) return null;

    const normalised   = input.toLowerCase().trim();
    const inputTokens  = tokenise(normalised);
    if (inputTokens.length === 0) return null;

    let bestIntent: string | null = null;
    let bestScore                 = 0;

    for (const pattern of patterns) {
      for (const example of pattern.exampleInputs) {
        const exNorm = example.toLowerCase().trim();

        // Tier 1: exact match
        if (exNorm === normalised) {
          return { intent: pattern.intent, confidence: 0.97 };
        }

        // Tier 2: token overlap
        const exTokens = tokenise(exNorm);
        const overlap  = inputTokens.filter((t) => exTokens.includes(t)).length;
        const ratio    = overlap / Math.max(inputTokens.length, exTokens.length);

        if (ratio >= 0.70 && ratio > bestScore) {
          bestScore  = ratio;
          bestIntent = pattern.intent;
        }
      }
    }

    if (!bestIntent || bestScore < 0.70) return null;

    // Map ratio to confidence: 0.70 ratio → 0.82, 1.0 ratio → 0.90
    const confidence = 0.82 + (bestScore - 0.70) * (0.90 - 0.82) / 0.30;
    return { intent: bestIntent, confidence: Math.min(confidence, 0.90) };
  } catch (err) {
    logger.warn('findLanguagePattern failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Record a successful classification as a language pattern.
 * Called after high-confidence (≥ 0.85) LLM results.
 * Upserts: creates new pattern or adds the input to exampleInputs if already known.
 * Caps exampleInputs at 50 to prevent unbounded growth.
 */
export function saveLanguagePattern(
  language: string,
  intent: string,
  input: string,
  preferredResponse?: string,
): void {
  if (!env.LEARNING_MODE) return;

  const trimmed = input.trim().slice(0, 500);

  prisma.languagePattern
    .upsert({
      where: { language_intent: { language, intent } },
      create: {
        language,
        intent,
        exampleInputs:     [trimmed],
        preferredResponse: preferredResponse ?? null,
        useCount:          1,
        lastSeenAt:        new Date(),
      },
      update: {
        // Append if not already present; cap at 50 examples
        exampleInputs: {
          // Prisma doesn't support array-push with dedup natively;
          // we do a raw upsert then trim in a separate call
          push: trimmed,
        },
        useCount:          { increment: 1 },
        lastSeenAt:        new Date(),
        preferredResponse: preferredResponse ?? undefined,
      },
    })
    .then(async (record) => {
      // Trim exampleInputs to 50 unique entries (most recent kept)
      if (record.exampleInputs.length > 50) {
        const unique = Array.from(new Set(record.exampleInputs)).slice(-50);
        await prisma.languagePattern.update({
          where: { id: record.id },
          data:  { exampleInputs: unique },
        });
      }
    })
    .catch((err) =>
      logger.warn('saveLanguagePattern failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

// ─── Order Intelligence ───────────────────────────────────────────────────────

/**
 * Log basket analysis data after an order is created.
 * Powers product co-purchase suggestions and drop-off analytics.
 */
export function logOrderIntelligence(params: LogOrderIntelligenceParams): void {
  if (!env.LEARNING_MODE) return;

  // Hour + day in Lagos time (WAT = UTC+1)
  const lagosNow  = new Date(Date.now() + 60 * 60 * 1000);
  const hourOfDay = lagosNow.getUTCHours();
  const dayOfWeek = lagosNow.getUTCDay();

  prisma.orderIntelligence
    .upsert({
      where:  { orderId: params.orderId },
      create: {
        vendorId:     params.vendorId,
        orderId:      params.orderId,
        productIds:   params.productIds,
        language:     params.language ?? null,
        messageCount: params.messageCount,
        askedForHelp: params.askedForHelp,
        hourOfDay,
        dayOfWeek,
      },
      update: {
        // idempotent — no-op if already recorded
        messageCount: params.messageCount,
        askedForHelp: params.askedForHelp,
      },
    })
    .catch((err) =>
      logger.warn('logOrderIntelligence failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

// ─── Pidgin Learning Queue ────────────────────────────────────────────────────

/**
 * Logs an unrecognised Nigerian Pidgin phrase for human review.
 *
 * Writes to two places simultaneously (fire-and-forget, non-blocking):
 *   1. DB → `pidgin_learning_log` table (queryable, structured)
 *   2. File → PIDGIN.md Learning Queue section (human-readable, in the repo)
 *
 * Called from interpretMessageWithConfidence when language === 'pid'
 * and intent === 'UNKNOWN'.
 */
export function logPidginPhrase(
  phrase: string,
  inferredMeaning: string,
  context: string,
  sessionId?: string,
): void {
  if (!env.LEARNING_MODE) return;

  // Both writes are fire-and-forget — never block the response path
  Promise.all([
    prisma.pidginLearningLog.create({
      data: {
        phrase:          phrase.slice(0, 500),
        inferredMeaning: inferredMeaning.slice(0, 100),
        context:         context.slice(0, 200),
        sessionId:       sessionId ?? null,
        status:          'pending',
      },
    }),
    _appendToPidginMd(phrase, inferredMeaning, context),
  ]).catch((err) =>
    logger.warn('logPidginPhrase failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** Inserts a row into the Learning Queue table in PIDGIN.md. */
async function _appendToPidginMd(
  phrase: string,
  inferredMeaning: string,
  context: string,
): Promise<void> {
  const PIDGIN_MD_PATH = path.resolve(__dirname, '../../../pingmart/PIDGIN.md');
  const EMPTY_PLACEHOLDER = '| *(empty — add as conversations happen)* | | | |';

  try {
    const content = await fsPromises.readFile(PIDGIN_MD_PATH, 'utf8');

    // Sanitise values for Markdown table (strip pipe characters)
    const safePhrase  = phrase.replace(/\|/g, '/').slice(0, 80);
    const safeMeaning = inferredMeaning.replace(/\|/g, '/').slice(0, 40);
    const safeContext = context.replace(/\|/g, '/').slice(0, 60);
    const newRow      = `| ${safePhrase} | ${safeMeaning} | ${safeContext} | pending |`;

    let updated: string;
    if (content.includes(EMPTY_PLACEHOLDER)) {
      // First entry: replace the placeholder row, keep a blank placeholder after it
      updated = content.replace(EMPTY_PLACEHOLDER, `${newRow}\n${EMPTY_PLACEHOLDER}`);
    } else {
      // Subsequent entries: append before the empty placeholder (or at end of table)
      updated = content.replace(
        /(## Learning Queue[\s\S]*?\n\| Status \|\n\|[-| ]+\|\n)/,
        `$1${newRow}\n`,
      );
      if (updated === content) {
        // Fallback: the placeholder was already replaced — just append to end of table
        updated = content.replace(
          /(## Learning Queue[\s\S]*?\n)(---|\n## )/,
          `$1${newRow}\n$2`,
        );
      }
    }

    if (updated !== content) {
      await fsPromises.writeFile(PIDGIN_MD_PATH, updated, 'utf8');
    }
  } catch (err) {
    // File write failure is non-fatal — DB write above already captured the data
    logger.debug('_appendToPidginMd: file write failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Weekly Summary ───────────────────────────────────────────────────────────

/**
 * Compute and return a weekly learning summary as a formatted log string.
 * Called by the Monday 8am Lagos time cron job.
 */
export async function generateWeeklySummary(): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalInteractions,
    avgConfidence,
    intentCounts,
    uncertainCount,
    newPatterns,
    topDropoff,
    orderIntelCount,
  ] = await Promise.all([
    // Total interactions this week
    prisma.interactionLog.count({ where: { createdAt: { gte: since } } }),

    // Average confidence score
    prisma.interactionLog.aggregate({
      where:   { createdAt: { gte: since }, confidenceScore: { not: null } },
      _avg:    { confidenceScore: true },
    }),

    // Top 10 intents by count
    prisma.interactionLog.groupBy({
      by:      ['detectedIntent'],
      where:   { createdAt: { gte: since }, detectedIntent: { not: null } },
      _count:  { detectedIntent: true },
      orderBy: { _count: { detectedIntent: 'desc' } },
      take:    10,
    }),

    // Uncertain interactions count
    prisma.uncertainInteraction.count({ where: { createdAt: { gte: since } } }),

    // New language patterns created this week
    prisma.languagePattern.count({ where: { createdAt: { gte: since } } }),

    // Top drop-off states (states with the most interactions that didn't complete)
    prisma.interactionLog.groupBy({
      by:      ['flowState'],
      where:   { createdAt: { gte: since }, flowState: { not: null } },
      _count:  { flowState: true },
      orderBy: { _count: { flowState: 'desc' } },
      take:    5,
    }),

    // Orders recorded in intelligence table
    prisma.orderIntelligence.count({ where: { completedAt: { gte: since } } }),
  ]);

  const avgConf = avgConfidence._avg.confidenceScore;
  const intentList = intentCounts
    .map((r) => `    ${r.detectedIntent}: ${r._count.detectedIntent}`)
    .join('\n');
  const dropoffList = topDropoff
    .map((r) => `    ${r.flowState}: ${r._count.flowState}`)
    .join('\n');

  const summary = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '🤖 PINGMART AI WEEKLY LEARNING SUMMARY',
    `   Week ending ${new Date().toISOString().slice(0, 10)}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `📊 Total interactions:        ${totalInteractions.toLocaleString()}`,
    `🧠 Average confidence:        ${avgConf != null ? (avgConf * 100).toFixed(1) + '%' : 'N/A'}`,
    `❓ Uncertain interactions:    ${uncertainCount.toLocaleString()} (confidence < 60%)`,
    `🆕 New language patterns:     ${newPatterns.toLocaleString()}`,
    `📦 Orders logged:             ${orderIntelCount.toLocaleString()}`,
    '',
    '📈 Top intents this week:',
    intentList || '    (none)',
    '',
    '🚪 Most common flow states:',
    dropoffList || '    (none)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  return summary;
}

// ─── FAQ Auto-Generation ──────────────────────────────────────────────────────

/**
 * For each active vendor with 20+ interactions, find questions that resulted
 * in UNKNOWN intent (bot couldn't answer) and suggest them as FAQ additions.
 * Messages the vendor over WhatsApp with a YES/NO prompt.
 *
 * Called weekly by the summary cron job.
 */
export async function suggestFaqsToVendors(): Promise<void> {
  if (!env.LEARNING_MODE) return;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find vendors with 20+ interactions this week and some unknowns
  const vendorsWithUnknowns = await prisma.interactionLog.groupBy({
    by:      ['vendorId'],
    where:   {
      createdAt:     { gte: since },
      vendorId:      { not: null },
      detectedIntent: 'UNKNOWN',
    },
    _count:  { id: true },
    having:  { id: { _count: { gte: 3 } } }, // 3+ unknowns this week
    orderBy: { _count: { id: 'desc' } },
    take:    20,
  });

  for (const row of vendorsWithUnknowns) {
    if (!row.vendorId) continue;

    try {
      const vendor = await prisma.vendor.findUnique({
        where:  { id: row.vendorId },
        select: { ownerPhone: true, businessName: true, isActive: true },
      });
      if (!vendor?.ownerPhone || !vendor.isActive) continue;

      // Fetch the actual unknown inputs
      const unknownLogs = await prisma.interactionLog.findMany({
        where: {
          vendorId:       row.vendorId,
          createdAt:      { gte: since },
          detectedIntent: 'UNKNOWN',
        },
        select: { rawInput: true },
        take:   5,
      });

      const examples = unknownLogs
        .map((l, i) => `${i + 1}. _"${l.rawInput.slice(0, 80)}"_`)
        .join('\n');

      const totalCount = row._count.id;

      await messageQueue.add({
        to: vendor.ownerPhone,
        message:
          `📊 *Weekly Bot Insight — ${vendor.businessName}*\n\n` +
          `${totalCount} customer question${totalCount === 1 ? '' : 's'} this week ` +
          `couldn't be answered automatically:\n\n` +
          `${examples}\n\n` +
          `Would you like to add answers so I can respond automatically next time?\n\n` +
          `Reply *ADD FAQ* to add answers now, or ignore to skip.`,
      });

      logger.info('FAQ suggestion sent', { vendorId: row.vendorId, unknownCount: totalCount });
    } catch (err) {
      logger.warn('suggestFaqsToVendors: error for vendor', {
        vendorId: row.vendorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Payment Nudge ────────────────────────────────────────────────────────────

/**
 * Find orders stalled at AWAITING_PAYMENT for > 30 minutes and send a nudge.
 * Called hourly by the existing openingNotification cron or standalone.
 */
export async function sendPaymentNudges(): Promise<void> {
  if (!env.LEARNING_MODE) return;

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const twoHoursAgo      = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const stalledOrders = await prisma.order.findMany({
    where: {
      status:    { in: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_PENDING] },
      updatedAt: { gte: twoHoursAgo, lte: thirtyMinutesAgo },
    },
    select: {
      id:         true,
      customerId: true,
      vendorId:   true,
    },
    take: 50,
  });

  if (stalledOrders.length === 0) return;

  // Fetch customers and vendors in batch
  const customerIds = [...new Set(stalledOrders.map((o) => o.customerId))];
  const customers   = await prisma.customer.findMany({
    where:  { id: { in: customerIds } },
    select: { id: true, whatsappNumber: true, language: true },
  });
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const vendorIds = [...new Set(stalledOrders.map((o) => o.vendorId))];
  const vendors   = await prisma.vendor.findMany({
    where:  { id: { in: vendorIds } },
    select: { id: true, businessName: true },
  });
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  for (const order of stalledOrders) {
    const customer    = customerMap.get(order.customerId);
    const customerPhone = customer?.whatsappNumber;
    if (!customerPhone) continue;

    const lang  = (customer?.language ?? 'en') as string;
    const nudge = PAYMENT_NUDGE[lang as keyof typeof PAYMENT_NUDGE] ?? PAYMENT_NUDGE.en;

    await messageQueue
      .add({ to: customerPhone, message: nudge })
      .catch((err) =>
        logger.warn('sendPaymentNudges: failed to enqueue nudge', {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

    logger.info('Payment nudge sent', {
      orderId: order.id,
      vendor:  vendorMap.get(order.vendorId)?.businessName,
    });
  }
}

const PAYMENT_NUDGE: Record<string, string> = {
  en:  `Still need help with payment? Reply *HELP* and I'll guide you through it. 💳`,
  pid: `You never finish pay? Reply *HELP* make I help you sort am. 💳`,
  ig:  `Ị ka achọrọ enyemaka na ịkwụ ụgwọ? Zaa *HELP* ka m nyere gị aka. 💳`,
  yo:  `Ṣe o tún nílò ìrànlọ́wọ́ fún sisanwó? Fèsì *HELP* kí n ràn ọ́ lọ́wọ́. 💳`,
  ha:  `Kuna buƙatar taimako wajen biyan kuɗi? Amsa *HELP* in taimaka maka. 💳`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Tokenise a string into lowercase words for pattern matching. */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2); // skip single-char tokens
}
