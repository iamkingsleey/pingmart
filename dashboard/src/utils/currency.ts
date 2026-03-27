/**
 * @file utils/currency.ts
 * @description Kobo <-> Naira conversion and display helpers.
 * All monetary values from the API are in kobo (integer).
 * N1 = 100 kobo. Never use floats for money storage.
 */

/** Convert kobo integer to Naira display string. 150000 -> "N1,500.00" */
export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
  })
    .format(naira)
    .replace('NGN', '₦')
    .trim();
}

/** Convert Naira (user input, possibly decimal) to kobo integer. 1500 -> 150000 */
export function nairaToKobo(naira: number | string): number {
  const n = typeof naira === 'string' ? parseFloat(naira) : naira;
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Convert kobo to Naira number (for input field display). 150000 -> 1500 */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** Short format for dashboard stats. 1500000 -> "N15,000" */
export function formatNairaShort(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(1)}M`;
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(0)}K`;
  return `₦${naira.toFixed(0)}`;
}
