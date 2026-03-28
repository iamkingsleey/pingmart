/**
 * Meta WhatsApp Cloud API webhook payload types.
 */

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: string;
}

export interface WhatsAppChangeValue {
  messaging_product: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'interactive' | 'audio' | 'document' | 'sticker' | 'unknown';
  text?: { body: string };
  interactive?: WhatsAppInteractiveReply;
  /** Present when type === 'audio' — voice notes sent by WhatsApp users */
  audio?: { id: string; mime_type?: string };
  /** Present when type === 'image' */
  image?: { id: string; mime_type?: string; caption?: string };
}

export interface WhatsAppInteractiveReply {
  type: 'button_reply' | 'list_reply';
  button_reply?: { id: string; title: string };
  list_reply?: { id: string; title: string };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

export interface SendTextMessageBody {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

export interface SendInteractiveButtonsBody {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    body: { text: string };
    action: {
      buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
    };
  };
}

export type SendMessageBody = SendTextMessageBody | SendInteractiveButtonsBody;
