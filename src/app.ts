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

app.use(generalRateLimit);
app.use(router);

app.use(notFoundHandler);
app.use(globalErrorHandler);

logger.debug('Express app configured');

export { app };
