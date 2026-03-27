/**
 * Incoming message worker — routes messages to bot or vendor command handler.
 */
import { incomingMessageQueue } from '../incomingMessage.queue';
import { processIncomingMessage } from '../../services/order/order.service';
import { handleVendorStatusCommand } from '../../services/delivery/physicalDelivery.service';
import { vendorRepository } from '../../repositories/vendor.repository';
import { logger, maskPhone } from '../../utils/logger';

incomingMessageQueue.process(async (job) => {
  const { from, message, vendorWhatsAppNumber } = job.data;
  logger.info('Processing incoming message', { from: maskPhone(from), vendor: maskPhone(vendorWhatsAppNumber) });

  // If the sender is a registered vendor, treat as a status-update command
  const senderAsVendor = await vendorRepository.findByWhatsAppNumber(from);
  if (senderAsVendor) {
    await handleVendorStatusCommand(from, message);
  } else {
    await processIncomingMessage(from, message, vendorWhatsAppNumber);
  }
});

logger.info('Incoming message worker started');
