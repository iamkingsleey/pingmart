import { formatNaira, nairaToKobo, calculateCartTotal, normalisePhone, formatOrderId, productTypeLabel } from '../../utils/formatters';
import { CartItem, ProductType } from '../../types';

describe('formatNaira', () => {
  test('converts kobo to ₦', () => {
    expect(formatNaira(150000)).toBe('₦1,500.00');
    expect(formatNaira(1500000)).toBe('₦15,000.00');
    expect(formatNaira(0)).toBe('₦0.00');
  });
  test('handles large amounts', () => {
    expect(formatNaira(100_000_000)).toBe('₦1,000,000.00');
  });
});

describe('nairaToKobo', () => {
  test('converts correctly', () => {
    expect(nairaToKobo(1500)).toBe(150000);
    expect(nairaToKobo(15000)).toBe(1500000);
  });
  test('rounds floating-point', () => {
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });
});

describe('calculateCartTotal', () => {
  const cart: CartItem[] = [
    { productId: '1', name: 'A', quantity: 2, unitPrice: 150000, productType: ProductType.PHYSICAL },
    { productId: '2', name: 'B', quantity: 3, unitPrice: 30000, productType: ProductType.PHYSICAL },
  ];
  test('sums correctly', () => expect(calculateCartTotal(cart)).toBe(390000));
  test('empty cart = 0', () => expect(calculateCartTotal([])).toBe(0));
});

describe('normalisePhone', () => {
  test('+234 stays unchanged', () => expect(normalisePhone('+2348012345678')).toBe('+2348012345678'));
  test('0 prefix converts', () => expect(normalisePhone('08012345678')).toBe('+2348012345678'));
  test('234 prefix adds +', () => expect(normalisePhone('2348012345678')).toBe('+2348012345678'));
});

describe('productTypeLabel', () => {
  test('DIGITAL gets 📲 label', () => expect(productTypeLabel(ProductType.DIGITAL)).toContain('[DIGITAL]'));
  test('PHYSICAL gets 📦 label', () => expect(productTypeLabel(ProductType.PHYSICAL)).toContain('[PHYSICAL]'));
});

describe('formatOrderId', () => {
  test('uses last 6 chars of UUID', () => {
    expect(formatOrderId('550e8400-e29b-41d4-a716-446655440000')).toBe('ORD-440000');
  });
});
