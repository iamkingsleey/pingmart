/**
 * Digital delivery worker — processes delivery jobs with retry logic.
 * When ALL retries fail, calls handleDeliveryFailure() to alert the vendor.
 */
import { digitalDeliveryQueue } from '../digitalDelivery.queue';
import { deliverDigitalProduct, handleDeliveryFailure } from '../../services/digitalProduct/digitalDelivery.service';
import { logger, maskPhone } from '../../utils/logger';

digitalDeliveryQueue.process(async (job) => {
  logger.info('Processing digital delivery', {
    jobId: job.id,
    orderId: job.data.orderId,
    customer: maskPhone(job.data.customerPhone),
  });
  await deliverDigitalProduct(job.data);
});

// When all retry attempts are exhausted, trigger the failure handler
digitalDeliveryQueue.on('failed', async (job, err) => {
  // Bull emits 'failed' on every failed attempt. Only act when no more retries remain.
  const maxAttempts = job.opts.attempts ?? 5;
  if (job.attemptsMade >= maxAttempts) {
    logger.error('Digital delivery exhausted all retries', {
      orderId: job.data.orderId,
      error: err.message,
    });
    await handleDeliveryFailure(job.data.orderId).catch((e) =>
      logger.error('handleDeliveryFailure itself failed', { error: e.message }),
    );
  }
});

logger.info('Digital delivery worker started');
