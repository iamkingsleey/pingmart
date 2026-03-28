/**
 * Transcription Service — Voice Note to Text for Pingmart
 *
 * Downloads audio files from Meta's WhatsApp servers and transcribes
 * them using Groq's free Whisper API.
 *
 * Groq is used because it offers Whisper transcription for free with
 * generous daily limits (7,200 seconds/day).
 *
 * Flow:
 *   1. Receive audio message with Meta media ID
 *   2. Fetch the download URL from Meta Graph API
 *   3. Download the audio file as a buffer
 *   4. Send to Groq Whisper with Nigerian English context prompt
 *   5. Return transcribed text
 */
import Groq, { toFile } from 'groq-sdk';
import fetch from 'node-fetch';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg':  'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4':  'mp4',
  'audio/webm': 'webm',
  'audio/wav':  'wav',
};

/**
 * Step 1 — Get the CDN download URL for a WhatsApp media file.
 * Meta requires a separate Graph API call to resolve the actual URL.
 */
async function getMediaUrl(mediaId: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Media URL fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { url: string };
  return data.url;
}

/**
 * Step 2 — Download the audio file from Meta's CDN.
 */
async function downloadAudioBuffer(mediaUrl: string): Promise<Buffer> {
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Audio download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Step 3 — Transcribe via Groq Whisper.
 * The prompt primes Whisper with Nigerian Pidgin vocabulary so common
 * food and order terms are recognised even with heavy accent.
 */
async function transcribeBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = MIME_TO_EXT[mimeType] ?? 'ogg'; // WhatsApp defaults to ogg/opus
  const file = await toFile(buffer, `voice_note.${ext}`, { type: mimeType });

  const result = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo', // fastest free-tier model
    // No language lock — auto-detects English, Pidgin, Yoruba, Igbo, Hausa
    prompt:
      'Nigerian customer placing a WhatsApp food order. ' +
      'May use Nigerian Pidgin English. ' +
      'Common words: abeg, wetin, jollof, dodo, eba, pounded yam, egusi, naira, ₦.',
  });

  return result.text.trim();
}

/**
 * Main export — transcribes a WhatsApp voice note given its Meta media ID.
 * Returns null when transcription fails so the caller can respond gracefully.
 */
export async function transcribeVoiceNote(
  mediaId: string,
  mimeType: string = 'audio/ogg',
): Promise<string | null> {
  try {
    logger.info('Transcribing voice note', { mediaId: mediaId.slice(-6) });
    const url    = await getMediaUrl(mediaId);
    const buffer = await downloadAudioBuffer(url);
    const text   = await transcribeBuffer(buffer, mimeType);
    logger.info('Voice note transcribed', { mediaId: mediaId.slice(-6), chars: text.length });
    return text;
  } catch (err) {
    logger.error('Voice note transcription failed', {
      mediaId: mediaId.slice(-6),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
