import { paymentQueue } from '../payment.queue';
import { handlePaymentConfirmed } from '../../services/order/order.service';
import { logger, maskReference } from '../../utils/logger';

paymentQueue.process(async (job) => {
  const { paystackReference, event } = job.data;
  logger.info('Processing payment job', { event, reference: maskReference(paystackReference) });

  if (event === 'charge.success') {
    await handlePaymentConfirmed(paystackReference);
  } else {
    logger.info('Unhandled payment event', { event });
  }
});

logger.info('Payment worker started');
