import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

export function validate<T>(schema: ZodSchema<T>, part: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      const msgs = Object.entries(fieldErrors)
        .map(([f, m]) => `${f}: ${(m ?? []).join(', ')}`)
        .join('; ');
      next(new ValidationError(`Validation failed — ${msgs}`));
      return;
    }
    (req[part] as unknown) = result.data;
    next();
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const nigerianPhone = z.string().regex(/^\+234\d{10}$/, 'Must be +234XXXXXXXXXX');

export const createVendorSchema = z.object({
  businessName: z.string().min(2).max(100),
  whatsappNumber: nigerianPhone,
  phoneNumber: nigerianPhone,
  vendorType: z.enum(['PHYSICAL_GOODS', 'DIGITAL_PRODUCTS', 'HYBRID']),
});

export const updateVendorSchema = z.object({
  businessName: z.string().min(2).max(100).optional(),
  phoneNumber: nigerianPhone.optional(),
  isActive: z.boolean().optional(),
  /** Plain-text bank account number — service layer encrypts before persisting */
  bankAccountNumber: z.string().min(6).max(20).regex(/^\d+$/, 'Must be numeric digits only').optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  price: z.number().int().positive('Price must be a positive integer in kobo'),
  category: z.string().max(50).optional(),
  productType: z.enum(['PHYSICAL', 'DIGITAL']),
  imageUrl: z.string().url().optional(),
  // Physical fields
  stockCount: z.number().int().nonnegative().optional(),
  // Digital fields
  deliveryType: z.enum(['LINK', 'FILE']).optional(),
  deliveryContent: z.string().optional(),
  deliveryMessage: z.string().max(2000).optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  price: z.number().int().positive().optional(),
  category: z.string().max(50).optional(),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().optional(),
  stockCount: z.number().int().nonnegative().optional(),
  deliveryType: z.enum(['LINK', 'FILE']).optional(),
  deliveryContent: z.string().optional(),
  deliveryMessage: z.string().max(2000).optional(),
});

export const orderFilterSchema = z.object({
  status: z.enum(['PENDING_PAYMENT','PAYMENT_CONFIRMED','CONFIRMED','PREPARING','READY','DELIVERED','DIGITAL_SENT','CANCELLED']).optional(),
  orderType: z.enum(['PHYSICAL', 'DIGITAL']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
