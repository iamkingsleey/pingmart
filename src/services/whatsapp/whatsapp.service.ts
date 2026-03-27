/**
 * WhatsApp Cloud API — outbound message sending.
 */
import fetch from 'node-fetch';
import { env } from '../../config/env';
import { WHATSAPP_API_BASE_URL } from '../../config/constants';
import { logger, maskPhone } from '../../utils/logger';
import { InteractiveButton } from '../../types';
import { SendTextMessageBody, SendInteractiveButtonsBody } from '../../types/whatsapp';

const MESSAGES_URL = `${WHATSAPP_API_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

export async function sendTextMessage(to: string, message: string): Promise<void> {
  const body: SendTextMessageBody = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: message },
  };
  await callWhatsAppAPI(body, to);
}

export async function sendButtonMessage(
  to: string,
  message: string,
  buttons: InteractiveButton[],
): Promise<void> {
  const body: SendInteractiveButtonsBody = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: message },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };
  await callWhatsAppAPI(body, to);
}

async function callWhatsAppAPI(
  body: SendTextMessageBody | SendInteractiveButtonsBody,
  to: string,
): Promise<void> {
  logger.debug('Sending WhatsApp message', { to: maskPhone(to), type: body.type });

  const res = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error('WhatsApp API error', { status: res.status, to: maskPhone(to), error: err });
    throw new Error(`WhatsApp API ${res.status}: ${err}`);
  }

  logger.info('WhatsApp message sent', { to: maskPhone(to), type: body.type });
}
