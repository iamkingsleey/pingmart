/**
 * Vendor service — registration and profile management.
 */
import { Vendor } from '@prisma/client';
import { vendorRepository } from '../../repositories/vendor.repository';
import { generateApiKey, hashApiKey, encryptBankAccount, decryptBankAccount } from '../../utils/crypto';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { logger, maskPhone } from '../../utils/logger';
import { CreateVendorDto, UpdateVendorDto } from '../../types';
import { env } from '../../config/env';

export interface VendorRegistrationResult {
  vendor: Vendor;
  /** Raw API key — shown ONCE at registration, never retrievable again */
  rawApiKey: string;
}

export const vendorService = {
  async register(data: CreateVendorDto): Promise<VendorRegistrationResult> {
    const exists = await vendorRepository.existsByWhatsAppNumber(data.whatsappNumber);
    if (exists) throw new ConflictError(`A vendor with that WhatsApp number already exists`);

    const rawApiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(rawApiKey);

    const vendor = await vendorRepository.create({
      businessName: data.businessName,
      whatsappNumber: data.whatsappNumber,
      phoneNumber: data.phoneNumber,
      vendorType: data.vendorType,
      apiKeyHash,
    });

    logger.info('Vendor registered', { vendorId: vendor.id, phone: maskPhone(vendor.whatsappNumber), type: vendor.vendorType });
    return { vendor, rawApiKey };
  },

  async getById(id: string): Promise<Vendor> {
    const vendor = await vendorRepository.findById(id);
    if (!vendor) throw new NotFoundError('Vendor');
    return decryptVendorBankAccount(vendor);
  },

  async update(id: string, data: UpdateVendorDto): Promise<Vendor> {
    if (!(await vendorRepository.findById(id))) throw new NotFoundError('Vendor');
    const payload = { ...data };
    if (payload.bankAccountNumber) {
      payload.bankAccountNumber = encryptBankAccount(payload.bankAccountNumber, env.ENCRYPTION_KEY);
    }
    const updated = await vendorRepository.update(id, payload);
    return decryptVendorBankAccount(updated);
  },
};

/**
 * Decrypts the bankAccountNumber field on a Vendor if it is present and non-null.
 * Returns the vendor object unchanged if the field is absent.
 */
function decryptVendorBankAccount(vendor: Vendor): Vendor {
  const raw = (vendor as unknown as Record<string, unknown>)['bankAccountNumber'];
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return { ...vendor, bankAccountNumber: decryptBankAccount(raw, env.ENCRYPTION_KEY) } as unknown as Vendor;
    } catch (err) {
      // Log but do not surface decryption errors to the caller — return field as-is
      // so a key-rotation scenario doesn't hard-crash reads of old records.
      logger.error('Failed to decrypt bankAccountNumber', { vendorId: vendor.id, err });
    }
  }
  return vendor;
}
