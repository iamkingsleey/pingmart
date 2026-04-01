/**
 * Learning Summary Worker
 *
 * Runs every Monday at 08:00 Lagos time (WAT = UTC+1, so 07:00 UTC).
 * Computes the weekly AI learning summary and logs it to Railway so the
 * team can monitor model improvement over time without a separate dashboard.
 *
 * Also calls:
 *   - suggestFaqsToVendors() — prompts vendors to fill FAQ gaps
 *   - sendPaymentNudges()    — nudges customers stalled at payment step
 */
import { learningSummaryQueue } from '../learningSummary.queue';
import {
  generateWeeklySummary,
  suggestFaqsToVendors,
  sendPaymentNudges,
} from '../../services/learning.service';
import { logger } from '../../utils/logger';

learningSummaryQueue.process(async () => {
  logger.info('Running weekly learning summary...');

  // 1. Weekly AI summary — logged to Railway stdout
  const summary = await generateWeeklySummary();
  logger.info(summary);

  // 2. Suggest FAQ additions to vendors with unanswered questions
  await suggestFaqsToVendors();

  // 3. Nudge customers stalled at payment step (> 30 min)
  await sendPaymentNudges();
});

// Monday 08:00 Lagos time (WAT = UTC+1 → 07:00 UTC)
learningSummaryQueue.add(
  {},
  {
    repeat:  { cron: '0 7 * * 1' },
    jobId:   'weekly-learning-summary',
  },
);

learningSummaryQueue.on('failed', (job, err) => {
  logger.error('Learning summary job failed', { jobId: job.id, error: err.message });
});

logger.info('Learning summary worker started (runs every Monday 08:00 Lagos)');
