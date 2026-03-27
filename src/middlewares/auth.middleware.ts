/**
 * API key authentication middleware.
 * Expects: Authorization: Bearer orb_<key>
 * Validates key against bcrypt hash in DB, verifies vendor ownership.
 */
import { Request, Response, NextFunction } from 'express';
import { vendorRepository } from '../repositories/vendor.repository';
import { verifyApiKey } from '../utils/crypto';
import { logger } from '../utils/logger';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

declare global {
  namespace Express {
    interface Request { vendorId?: string; }
  }
}

export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedError('Missing or invalid Authorization header');

    const rawKey = auth.slice(7);
    if (!rawKey.startsWith('orb_')) throw new UnauthorizedError('Invalid API key format');

    const vendorId = req.params['vendorId'] ?? req.params['id'];
    if (!vendorId) throw new UnauthorizedError('No vendor ID in path');

    const vendor = await vendorRepository.findById(vendorId);
    if (!vendor) throw new UnauthorizedError('Invalid API key');
    if (!vendor.isActive) throw new ForbiddenError('Vendor account is inactive');

    if (!(await verifyApiKey(rawKey, vendor.apiKeyHash))) {
      logger.warn('Failed API key attempt', { vendorId });
      throw new UnauthorizedError('Invalid API key');
    }

    req.vendorId = vendor.id;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireVendorOwnership(req: Request, _res: Response, next: NextFunction): void {
  const urlId = req.params['vendorId'] ?? req.params['id'];
  if (!req.vendorId || req.vendorId !== urlId) {
    next(new ForbiddenError('You can only access your own vendor data'));
    return;
  }
  next();
}
