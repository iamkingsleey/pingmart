import { messageQueue } from '../message.queue';
import { sendTextMessage, sendButtonMessage } from '../../services/whatsapp/whatsapp.service';
import { logger, maskPhone } from '../../utils/logger';

messageQueue.process(async (job) => {
  const { to, message, buttons } = job.data;
  logger.debug('Processing outbound message', { jobId: job.id, to: maskPhone(to) });

  if (buttons?.length) {
    await sendButtonMessage(to, message, buttons);
  } else {
    await sendTextMessage(to, message);
  }
});

logger.info('WhatsApp message worker started');
