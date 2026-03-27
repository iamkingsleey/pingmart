/**
 * Integration tests for vendor registration, product creation, and webhook handling.
 * All external services (DB, Redis, WhatsApp, Paystack, Cloudinary) are mocked.
 */
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../../app';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../repositories/prisma', () => ({
  prisma: {
    vendor: { create: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
    product: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    order: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    orderItem: { createMany: jest.fn() },
    customer: { upsert: jest.fn(), findUnique: jest.fn() },
    conversationSession: { findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
    $on: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

jest.mock('../../queues/message.queue', () => ({ messageQueue: { add: jest.fn().mockResolvedValue({}), on: jest.fn() } }));
jest.mock('../../queues/payment.queue', () => ({ paymentQueue: { add: jest.fn().mockResolvedValue({}), on: jest.fn() } }));
jest.mock('../../queues/incomingMessage.queue', () => ({ incomingMessageQueue: { add: jest.fn().mockResolvedValue({}), on: jest.fn() } }));
jest.mock('../../queues/digitalDelivery.queue', () => ({ digitalDeliveryQueue: { add: jest.fn().mockResolvedValue({}), on: jest.fn() } }));
jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('$2b$10$hashed'), compare: jest.fn().mockResolvedValue(true) }));
jest.mock('../../utils/cloudinary', () => ({
  uploadDigitalProduct: jest.fn().mockResolvedValue('https://cloudinary.com/file.pdf'),
  uploadCoverImage: jest.fn().mockResolvedValue('https://cloudinary.com/cover.jpg'),
  deleteCloudinaryFile: jest.fn(),
}));

import { prisma } from '../../repositories/prisma';
const mock = prisma as jest.Mocked<typeof prisma>;

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockVendor = {
  id: 'v-1', businessName: "Mama Tee's Kitchen", whatsappNumber: '+2348001111111',
  phoneNumber: '+2348001111111', vendorType: 'PHYSICAL_GOODS', apiKeyHash: '$2b$10$hashed',
  isActive: true, isVerified: false, createdAt: new Date(), updatedAt: new Date(),
};

const mockDigitalVendor = {
  ...mockVendor, id: 'v-2', businessName: 'TechSkills', vendorType: 'DIGITAL_PRODUCTS',
  whatsappNumber: '+2348002222222',
};

const mockPhysicalProduct = {
  id: 'p-1', vendorId: 'v-1', name: 'Jollof Rice', description: null,
  price: 150000, category: 'Rice Dishes', productType: 'PHYSICAL', imageUrl: null,
  isAvailable: true, stockCount: null, deliveryType: null, deliveryContent: null,
  deliveryMessage: null, createdAt: new Date(), updatedAt: new Date(),
};

// ─── Vendor Registration ──────────────────────────────────────────────────────

describe('POST /api/vendors — Registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mock.vendor.count as jest.Mock).mockResolvedValue(0);
    (mock.vendor.create as jest.Mock).mockResolvedValue(mockVendor);
  });

  test('registers physical vendor with valid data', async () => {
    const res = await request(app).post('/api/vendors').send({
      businessName: "Mama Tee's Kitchen",
      whatsappNumber: '+2348001111111',
      phoneNumber: '+2348001111111',
      vendorType: 'PHYSICAL_GOODS',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.apiKey).toMatch(/^orb_/);
    expect(res.body.data.vendor.apiKeyHash).toBeUndefined(); // Never expose
  });

  test('registers digital vendor', async () => {
    (mock.vendor.create as jest.Mock).mockResolvedValue(mockDigitalVendor);
    const res = await request(app).post('/api/vendors').send({
      businessName: 'TechSkills',
      whatsappNumber: '+2348002222222',
      phoneNumber: '+2348002222222',
      vendorType: 'DIGITAL_PRODUCTS',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.vendor.vendorType).toBe('DIGITAL_PRODUCTS');
  });

  test('rejects invalid phone format', async () => {
    const res = await request(app).post('/api/vendors').send({
      businessName: 'Test', whatsappNumber: '08012345678', // Local format
      phoneNumber: '+2348001111111', vendorType: 'PHYSICAL_GOODS',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects missing vendorType', async () => {
    const res = await request(app).post('/api/vendors').send({
      businessName: 'Test', whatsappNumber: '+2348001111111', phoneNumber: '+2348001111111',
    });
    expect(res.status).toBe(400);
  });

  test('rejects duplicate WhatsApp number (409 Conflict)', async () => {
    (mock.vendor.count as jest.Mock).mockResolvedValue(1);
    const res = await request(app).post('/api/vendors').send({
      businessName: 'Test', whatsappNumber: '+2348001111111',
      phoneNumber: '+2348001111111', vendorType: 'PHYSICAL_GOODS',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

// ─── Product Management ───────────────────────────────────────────────────────

describe('POST /api/vendors/:vendorId/products', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mock.vendor.findUnique as jest.Mock).mockResolvedValue(mockVendor);
    (mock.product.create as jest.Mock).mockResolvedValue(mockPhysicalProduct);
  });

  test('creates physical product with valid auth', async () => {
    const res = await request(app)
      .post(`/api/vendors/${mockVendor.id}/products`)
      .set('Authorization', 'Bearer orb_validkey12345')
      .send({ name: 'Jollof Rice', price: 150000, productType: 'PHYSICAL', category: 'Rice Dishes' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Jollof Rice');
  });

  test('rejects digital product without deliveryType', async () => {
    const res = await request(app)
      .post(`/api/vendors/${mockVendor.id}/products`)
      .set('Authorization', 'Bearer orb_validkey12345')
      .send({ name: 'Course', price: 1500000, productType: 'DIGITAL' });
    expect(res.status).toBe(400);
  });

  test('rejects zero price', async () => {
    const res = await request(app)
      .post(`/api/vendors/${mockVendor.id}/products`)
      .set('Authorization', 'Bearer orb_validkey12345')
      .send({ name: 'Test', price: 0, productType: 'PHYSICAL' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects without auth', async () => {
    const res = await request(app)
      .post(`/api/vendors/${mockVendor.id}/products`)
      .send({ name: 'Test', price: 100000, productType: 'PHYSICAL' });
    expect(res.status).toBe(401);
  });
});

// ─── Paystack Webhook ─────────────────────────────────────────────────────────

describe('POST /webhooks/paystack', () => {
  const secret = process.env['PAYSTACK_WEBHOOK_SECRET']!;
  const payload = {
    event: 'charge.success',
    data: {
      reference: 'ORB-1234567890-ABC123', amount: 150000, status: 'success',
      id: 1, domain: 'test', message: null, gateway_response: 'Successful',
      paid_at: new Date().toISOString(), created_at: new Date().toISOString(),
      channel: 'card', currency: 'NGN',
      customer: { id: 1, email: 'test@test.com', phone: null, first_name: null, last_name: null },
    },
  };

  test('accepts webhook with valid signature', async () => {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha512', secret).update(body).digest('hex');
    const res = await request(app)
      .post('/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sig)
      .send(payload);
    expect(res.status).toBe(200);
  });

  test('rejects missing signature (401)', async () => {
    const res = await request(app).post('/webhooks/paystack').send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing signature');
  });

  test('rejects invalid signature (401)', async () => {
    const res = await request(app)
      .post('/webhooks/paystack')
      .set('x-paystack-signature', 'invalid-sig')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  test('rejects signature computed with wrong secret', async () => {
    const sig = crypto.createHmac('sha512', 'wrong-secret').update(JSON.stringify(payload)).digest('hex');
    const res = await request(app)
      .post('/webhooks/paystack')
      .set('x-paystack-signature', sig)
      .send(payload);
    expect(res.status).toBe(401);
  });
});

// ─── Health + 404 ─────────────────────────────────────────────────────────────

describe('Health check + 404', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('unknown route returns JSON 404', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
