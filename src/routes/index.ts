import { Router } from 'express';
import { vendorRouter } from './vendor.routes';
import { webhookRouter } from './webhook.routes';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
router.use('/api/vendors', vendorRouter);
router.use('/webhooks', webhookRouter);

export { router };
