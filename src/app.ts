/**
 * Express application configuration.
 * Separated from server.ts so tests can import the app without starting HTTP.
 *
 * Body parsing strategy:
 *   - A single global express.json() with the captureRawBody verify hook.
 *   - This ensures req.rawBody (raw Buffer) is available on ALL routes,
 *     which is required for HMAC signature verification on webhook endpoints.
 *   - Webhook routes do NOT add their own body parser — they rely on this one.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { router } from './routes';
import { generalRateLimit } from './middlewares/rateLimit.middleware';
import { globalErrorHandler, notFoundHandler } from './middlewares/error.middleware';
import { captureRawBody } from './middlewares/webhookSignature.middleware';
import { env } from './config/env';
import { logger } from './utils/logger';

const app = express();

// Trust the first proxy (Vite dev proxy, ngrok, or a reverse proxy in prod).
// Required so express-rate-limit can read X-Forwarded-For without throwing
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR in development.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.NODE_ENV === 'production' ? false : true }));

if (env.NODE_ENV === 'development') app.use(morgan('dev'));

// Single global body parser that also captures the raw bytes for HMAC verification.
// This runs once — webhook routes must NOT add a second express.json() middleware.
app.use(express.json({ limit: '1mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health check must be BEFORE rate limiting so Railway's health checker never gets 429
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Landing page — static assets served directly, bypasses rate limiting
app.use(express.static(path.join(__dirname, '..', 'website')));

app.use(generalRateLimit);
app.use(router);

// Landing page form submission — forwards signup to Google Sheets via Apps Script
app.post('/submit', async (req, res) => {
  const { name, phone, email, timestamp } = req.body ?? {};
  if (!name || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;
  if (!webhookUrl) {
    logger.error('[/submit] GOOGLE_SHEET_WEBHOOK env var is not set');
    return res.status(500).json({ error: 'Not configured' });
  }
  try {
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:      String(name).trim(),
        // Apostrophe prefix forces Google Sheets to treat the value as plain
        // text rather than a formula — prevents #ERROR! when the number
        // starts with '+' (international dial code).
        phone:     "'" + String(phone).trim(),
        email:     String(email).trim().toLowerCase(),
        timestamp: timestamp ?? new Date().toISOString(),
      }),
      redirect: 'follow', // Google Apps Script returns 302 on POST; follow it
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      throw new Error(`Upstream ${upstream.status}: ${body.slice(0, 120)}`);
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error('[/submit] Webhook forward failed', { err: String(err) });
    return res.status(500).json({ error: 'Submission failed' });
  }
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

logger.debug('Express app configured');

export { app };
