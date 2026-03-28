/**
 * Translation helper.
 *
 * Usage:
 *   t('welcome_header', 'pid', { vendorName: 'Mama Kitchen' })
 *   // → "Welcome to *Mama Kitchen*! 👋"  (Pidgin)
 *
 * Falls back to English if a key is missing in the requested language,
 * then falls back to the raw key string so nothing crashes at runtime.
 */
import { translations, Language } from './translations';

export { Language, LANGUAGE_NAMES, LANGUAGE_CODES } from './translations';

export function t(
  key: string,
  language: Language = 'en',
  variables?: Record<string, string>,
): string {
  let message =
    translations[language]?.[key] ??
    translations['en']?.[key] ??
    key;

  if (variables) {
    for (const [k, v] of Object.entries(variables)) {
      message = message.split(`{${k}}`).join(v);
    }
  }

  return message;
}
