/**
 * WhatsApp Cloud API webhook handlers.
 * GET  /webhooks/whatsapp — Meta verification (one-time setup)
 * POST /webhooks/whatsapp — Incoming messages (must respond 200 immediately)
 */
import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger, maskPhone } from '../utils/logger';
import { incomingMessageQueue } from '../queues/incomingMessage.queue';
import { messageQueue } from '../queues/message.queue';
import { WhatsAppWebhookPayload, WhatsAppMessage } from '../types/whatsapp';
import { msgFallback } from '../services/whatsapp/templates';
import { normalisePhone } from '../utils/formatters';
import { customerRepository } from '../repositories/customer.repository';
import { Language } from '../i18n';
import { transcribeVoiceNote } from '../services/transcription.service';
import { redis } from '../utils/redis';

export function handleWhatsAppVerification(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed');
    res.status(403).json({ error: 'Verification failed' });
  }
}

export async function handleWhatsAppWebhook(req: Request, res: Response): Promise<void> {
  // Always respond 200 first — Meta will retry if we take too long
  res.status(200).json({ status: 'received' });

  const payload = req.body as WhatsAppWebhookPayload;

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value.messages?.length) continue;

        // Verify this message is for our registered phone number
        if (value.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID) continue;

        // Normalise display_phone_number to E.164 — Meta sends it with spaces/dashes
        // e.g. "+1 555-193-1414" → "+15551931414" so it matches the vendor DB record
        const rawDisplayNumber = value.metadata.display_phone_number;
        if (!rawDisplayNumber) continue;
        const vendorDisplayNumber = normalisePhone(rawDisplayNumber);

        for (const message of value.messages) {
          await routeIncomingMessage(message, vendorDisplayNumber);
        }
      }
    }
  } catch (err) {
    logger.error('WhatsApp webhook processing error', { error: (err as Error).message });
  }
}

async function routeIncomingMessage(
  message: WhatsAppMessage,
  vendorWhatsAppNumber: string,
): Promise<void> {
  const from = message.from;
  logger.info('Incoming WhatsApp message', { from: maskPhone(from), type: message.type, id: message.id });

  let textContent: string | null = null;

  if (message.type === 'text' && message.text?.body) {
    textContent = message.text.body;

  } else if (message.type === 'interactive') {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    // Use reply.id — IDs encode the actual commands the handlers expect.
    // reply.title is display-only and may be truncated or localised.
    if (reply) textContent = reply.id;

  } else if (message.type === 'audio' && message.audio?.id) {
    // ── Voice note — transcribe via Groq Whisper then process as text ────────
    const mediaId  = message.audio.id;
    const mimeType = (message.audio.mime_type ?? 'audio/ogg').split(';')[0].trim();

    // Rate limit: 5 voice notes per customer per hour (guard against Groq quota burn)
    const rateKey = `transcription:${from}`;
    const count   = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, 3600);

    if (count > 5) {
      await messageQueue.add({
        to: from,
        message: "You've sent a lot of voice notes! Please type your order instead. 😊",
      });
      return;
    }

    // Acknowledge receipt while transcription runs (takes 1–3 s)
    await messageQueue.add({ to: from, message: '🎙️ Got your voice note! Give me a second...' });

    const transcription = await transcribeVoiceNote(mediaId, mimeType);
    if (!transcription) {
      await messageQueue.add({
        to: from,
        message: "Sorry, I couldn't understand that voice note. Could you type your order instead? 😊",
      });
      return;
    }

    // Echo back so customer can confirm what was heard
    await messageQueue.add({
      to: from,
      message: `🎙️ I heard: _"${transcription}"_\n\nProcessing your request...`,
    });

    textContent = transcription; // falls through to queue below

  } else if (message.type === 'image' && message.image?.id) {
    // Queue image messages so the router can route them appropriately:
    //  • Vendors in ADDING_PRODUCTS photo mode → product photo extraction
    //  • Everyone else → standard "type MENU" nudge (handled inside the router)
    await incomingMessageQueue.add({
      from,
      message: '',                           // no text — imageMediaId carries the payload
      vendorWhatsAppNumber,
      messageId: message.id,
      timestamp: message.timestamp,
      imageMediaId: message.image.id,
      imageCaption: message.image.caption ?? '',
    });
    return;

  } else {
    // Stickers, documents, contacts, location, and anything else
    const customer = await customerRepository.findByWhatsAppNumber(from);
    const lang = (customer?.language as Language | undefined) ?? 'en';
    await messageQueue.add({ to: from, message: msgFallback(lang) });
    return;
  }

  if (!textContent) return;

  await incomingMessageQueue.add({
    from,
    message: textContent,
    vendorWhatsAppNumber,
    messageId: message.id,
    timestamp: message.timestamp,
  });
}
