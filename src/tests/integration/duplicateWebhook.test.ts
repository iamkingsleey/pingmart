/**
 * Integration test: idempotent Paystack webhook processing.
 *
 * Verifies that a duplicate charge.success webhook for the same reference
 * is safely ignored — the order is processed exactly once, no matter how
 * many times Paystack delivers the event.
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
import { paymentQueue } from '../../queues/payment.queue';
const mock = prisma as jest.Mocked<typeof prisma>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYSTACK_SECRET = process.env['PAYSTACK_WEBHOOK_SECRET']!;

function sign(body: string): string {
  return crypto.createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
}

async function postWebhook(payload: object) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', sign(body))
    .send(payload);
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const REF = 'ORB-1234567890-DUPE01';

const successPayload = {
  event: 'charge.success',
  data: {
    reference: REF,
    amount: 150000,
    status: 'success',
    id: 42,
    domain: 'test',
    message: null,
    gateway_response: 'Successful',
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    channel: 'card',
    currency: 'NGN',
    customer: { id: 1, email: 'buyer@test.com', phone: null, first_name: null, last_name: null },
  },
};

const mockPhysicalOrder = {
  id: 'ord-phys-1',
  vendorId: 'v-1',
  customerId: 'cust-1',
  orderType: 'PHYSICAL',
  status: 'PENDING_PAYMENT',
  totalAmount: 150000,
  deliveryAddress: '12 Lagos Street, Ikeja',
  paystackReference: REF,
  paymentProcessed: false,
  digitalDelivered: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDigitalOrder = {
  ...mockPhysicalOrder,
  id: 'ord-dig-1',
  orderType: 'DIGITAL',
  deliveryAddress: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/paystack — idempotent duplicate processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Physical order: first webhook', () => {
    test('processes successfully — queues payment job and returns 200', async () => {
      // First call: order exists and has NOT been processed yet
      (mock.order.findUnique as jest.Mock).mockResolvedValue(mockPhysicalOrder);
      // updateMany returns count=1 (exactly one row matched WHERE paymentProcessed=false)
      (mock.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const res = await postWebhook(successPayload);

      expect(res.status).toBe(200);
      expect(mock.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { paystackReference: REF } }),
      );
      expect(mock.order.updateMany).toHaveBeenCalledTimes(1);
      expect(paymentQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('Physical order: duplicate webhook (already processed)', () => {
    test('returns 200 silently — does NOT queue a second payment job', async () => {
      // Simulate the DB state AFTER first webhook was processed
      const alreadyProcessed = { ...mockPhysicalOrder, paymentProcessed: true, status: 'PAYMENT_CONFIRMED' };
      (mock.order.findUnique as jest.Mock).mockResolvedValue(alreadyProcessed);
      // updateMany returns count=0 — no row matched WHERE paymentProcessed=false
      (mock.order.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const res = await postWebhook(successPayload);

      expect(res.status).toBe(200);
      // The conditional update was attempted but matched nothing
      expect(mock.order.updateMany).toHaveBeenCalledTimes(1);
      // Payment job must NOT be enqueued a second time
      expect(paymentQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('Digital order: first webhook', () => {
    test('processes successfully — queues payment job and returns 200', async () => {
      (mock.order.findUnique as jest.Mock).mockResolvedValue(mockDigitalOrder);
      (mock.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const res = await postWebhook(successPayload);

      expect(res.status).toBe(200);
      expect(paymentQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('Digital order: duplicate webhook', () => {
    test('returns 200 silently — does NOT queue a second payment job', async () => {
      const alreadyProcessed = { ...mockDigitalOrder, paymentProcessed: true, digitalDelivered: true, status: 'DIGITAL_SENT' };
      (mock.order.findUnique as jest.Mock).mockResolvedValue(alreadyProcessed);
      (mock.order.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const res = await postWebhook(successPayload);

      expect(res.status).toBe(200);
      expect(paymentQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('Order not found for reference', () => {
    test('returns 200 — unknown references are silently ignored', async () => {
      // No order in DB matching this reference
      (mock.order.findUnique as jest.Mock).mockResolvedValue(null);

      const unknownRef = { ...successPayload, data: { ...successPayload.data, reference: 'ORB-UNKNOWN-000' } };
      const res = await postWebhook(unknownRef);

      expect(res.status).toBe(200);
      expect(mock.order.updateMany).not.toHaveBeenCalled();
      expect(paymentQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('Non-charge.success events', () => {
    test('transfer.success is acknowledged but not processed (200)', async () => {
      const transferPayload = { event: 'transfer.success', data: { ...successPayload.data } };
      const res = await postWebhook(transferPayload);
      expect(res.status).toBe(200);
      expect(paymentQueue.add).not.toHaveBeenCalled();
    });

    test('charge.failed is acknowledged (200)', async () => {
      const failedPayload = {
        event: 'charge.failed',
        data: { ...successPayload.data, status: 'failed' },
      };
      const res = await postWebhook(failedPayload);
      expect(res.status).toBe(200);
    });
  });

  describe('Race condition simulation', () => {
    test('two simultaneous webhooks: updateMany ensures exactly one processes', async () => {
      // Both requests find the order in PENDING_PAYMENT state
      (mock.order.findUnique as jest.Mock).mockResolvedValue(mockPhysicalOrder);

      // Simulate race: first caller wins the conditional update (count=1),
      // second caller gets count=0 because the row was already flipped.
      (mock.order.updateMany as jest.Mock)
        .mockResolvedValueOnce({ count: 1 }) // first request wins
        .mockResolvedValueOnce({ count: 0 }); // second request loses

      const [res1, res2] = await Promise.all([
        postWebhook(successPayload),
        postWebhook(successPayload),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      // Only ONE payment job should have been queued
      expect(paymentQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
