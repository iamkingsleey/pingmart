import { messageQueue } from '../message.queue';
import { sendTextMessage, sendButtonMessage, sendListMessage, sendImageMessage } from '../../services/whatsapp/whatsapp.service';
import { logger, maskPhone } from '../../utils/logger';

messageQueue.process(async (job) => {
  const { to, message, buttons, listSections, listButtonText, listHeader, imageUrl, imageCaption } = job.data;
  logger.debug('Processing outbound message', { jobId: job.id, to: maskPhone(to), hasImage: !!imageUrl });

  if (imageUrl) {
    // Image-only job — send as WhatsApp image message (URL-based)
    await sendImageMessage(to, imageUrl, imageCaption);
    return;
  }

  if (listSections?.length && listButtonText) {
    await sendListMessage(to, listButtonText, message, listSections, listHeader);
  } else if (buttons?.length) {
    await sendButtonMessage(to, message, buttons);
  } else {
    await sendTextMessage(to, message);
  }
});

logger.info('WhatsApp message worker started');
