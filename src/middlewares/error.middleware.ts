import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function globalErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const isKnown = err instanceof AppError;
  const status = isKnown ? err.statusCode : 500;
  const code = isKnown ? err.code : 'INTERNAL_ERROR';
  const message = isKnown ? err.message : 'An unexpected error occurred. Please try again.';

  if (status >= 500) {
    logger.error('Server error', { path: req.path, method: req.method, status, error: err.message, stack: err.stack });
  } else {
    logger.warn('Client error', { path: req.path, method: req.method, status, error: err.message });
  }

  res.status(status).json({ success: false, error: { code, message } });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `${req.method} ${req.path} not found` } });
}
