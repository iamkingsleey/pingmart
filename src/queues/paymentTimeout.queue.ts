import Bull from 'bull';
import { env } from '../config/env';

export interface PaymentTimeoutJobData {
  orderId: string;
  customerPhone: string;
  vendorId: string;
  /** Language for the expired message */
  language: string;
}

export const paymentTimeoutQueue = new Bull<PaymentTimeoutJobData>('payment-timeout', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false,
  },
});
