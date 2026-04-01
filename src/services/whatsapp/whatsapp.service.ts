/**
 * WhatsApp Cloud API — outbound message sending.
 */
import fetch from 'node-fetch';
import { env } from '../../config/env';
import { WHATSAPP_API_BASE_URL } from '../../config/constants';
import { logger, maskPhone } from '../../utils/logger';
import { InteractiveButton, InteractiveListSection } from '../../types';
import { SendTextMessageBody, SendInteractiveButtonsBody, SendInteractiveListBody, SendImageMessageBody } from '../../types/whatsapp';

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

export async function sendListMessage(
  to: string,
  buttonText: string,
  bodyText: string,
  sections: InteractiveListSection[],
  headerText?: string,
): Promise<void> {
  const body: SendInteractiveListBody = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(headerText ? { header: { type: 'text', text: headerText } } : {}),
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: sections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            ...(r.description ? { description: r.description.slice(0, 72) } : {}),
          })),
        })),
      },
    },
  };
  await callWhatsAppAPI(body, to);
}

export async function sendImageMessage(
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<void> {
  const body: SendImageMessageBody = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: {
      link: imageUrl,
      ...(caption ? { caption: caption.slice(0, 1024) } : {}),
    },
  };
  await callWhatsAppAPI(body, to);
}

/**
 * Marks an incoming message as read, turning the double-tick blue immediately.
 * Reduces perceived latency — the sender sees Pingmart has seen their message
 * even before a response arrives.
 * Fire-and-forget safe: errors are logged and never rethrown.
 */
export async function markMessageRead(messageId: string): Promise<void> {
  if (!messageId) return;
  try {
    const res = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
    if (!res.ok) {
      logger.warn('markMessageRead API error', { status: res.status });
    }
  } catch (err) {
    logger.warn('markMessageRead failed', { messageId: messageId.slice(-8), err });
  }
}

async function callWhatsAppAPI(
  body: SendTextMessageBody | SendInteractiveButtonsBody | SendInteractiveListBody | SendImageMessageBody,
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
