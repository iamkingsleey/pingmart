/**
 * Vendor language helper — shared between vendor-onboarding.service.ts and
 * support-onboarding.service.ts to avoid circular imports.
 *
 * Language preference is stored in Redis under `vendor:lang:{phone}` with a
 * 30-day TTL. On cache miss we fall back to the customer DB record (set during
 * the language-selection screen before onboarding starts) and warm the cache.
 */
import { redis } from './redis';
import { Language } from '../i18n';
import { customerRepository } from '../repositories/customer.repository';

const VENDOR_LANG_TTL = 30 * 24 * 60 * 60; // 30 days

export const vendorLangKey = (phone: string) => `vendor:lang:${phone}`;

/**
 * Returns the vendor's preferred language.
 * Lookup order: Redis → Customer DB → 'en' fallback.
 */
export async function getVendorLang(phone: string): Promise<Language> {
  const cached = await redis.get(vendorLangKey(phone));
  if (cached) return cached as Language;

  // Warm the cache from the customer record (set during language selection)
  const customer = await customerRepository.findByWhatsAppNumber(phone);
  const lang = (customer?.language ?? 'en') as Language;
  if (lang !== 'en') {
    await redis.setex(vendorLangKey(phone), VENDOR_LANG_TTL, lang);
  }
  return lang;
}

/** Persists vendor language preference in Redis for 30 days. */
export async function setVendorLang(phone: string, lang: Language): Promise<void> {
  await redis.setex(vendorLangKey(phone), VENDOR_LANG_TTL, lang);
}
