/**
 * Unit tests for webhook signature verification (no external calls).
 */
import crypto from 'crypto';
import { verifyWhatsAppSignature, verifyPaystackSignature, generatePaystackReference, hashApiKey, verifyApiKey } from '../../utils/crypto';

const payload = Buffer.from(JSON.stringify({ event: 'test', data: { id: 1 } }));

describe('WhatsApp signature verification', () => {
  const secret = 'test-app-secret';
  const makeSignature = (p: Buffer, s: string) =>
    `sha256=${crypto.createHmac('sha256', s).update(p).digest('hex')}`;

  test('valid signature passes', () => {
    expect(verifyWhatsAppSignature(payload, makeSignature(payload, secret), secret)).toBe(true);
  });
  test('tampered payload fails', () => {
    const tampered = Buffer.from('{"evil":true}');
    expect(verifyWhatsAppSignature(tampered, makeSignature(payload, secret), secret)).toBe(false);
  });
  test('wrong secret fails', () => {
    expect(verifyWhatsAppSignature(payload, makeSignature(payload, secret), 'wrong')).toBe(false);
  });
  test('missing sha256= prefix fails', () => {
    const raw = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyWhatsAppSignature(payload, raw, secret)).toBe(false);
  });
  test('empty signature fails', () => {
    expect(verifyWhatsAppSignature(payload, '', secret)).toBe(false);
  });
});

describe('Paystack signature verification', () => {
  const secret = 'paystack-secret';
  const makeSignature = (p: Buffer, s: string) =>
    crypto.createHmac('sha512', s).update(p).digest('hex');

  test('valid signature passes', () => {
    expect(verifyPaystackSignature(payload, makeSignature(payload, secret), secret)).toBe(true);
  });
  test('tampered payload fails', () => {
    expect(verifyPaystackSignature(Buffer.from('{}'), makeSignature(payload, secret), secret)).toBe(false);
  });
  test('wrong secret fails', () => {
    expect(verifyPaystackSignature(payload, makeSignature(payload, secret), 'wrong')).toBe(false);
  });
});

describe('API key hashing', () => {
  test('hashed key verifies correctly', async () => {
    const raw = 'orb_testkey1234567890';
    const hash = await hashApiKey(raw);
    expect(await verifyApiKey(raw, hash)).toBe(true);
  });
  test('wrong key fails', async () => {
    const hash = await hashApiKey('orb_correct');
    expect(await verifyApiKey('orb_wrong', hash)).toBe(false);
  });
});

describe('Paystack reference generation', () => {
  test('format is ORB-<timestamp>-<6 hex chars>', () => {
    expect(generatePaystackReference()).toMatch(/^ORB-\d+-[A-F0-9]{6}$/);
  });
  test('generates unique references', () => {
    const refs = new Set(Array.from({ length: 50 }, generatePaystackReference));
    expect(refs.size).toBe(50);
  });
});
