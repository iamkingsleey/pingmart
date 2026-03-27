/**
 * Order repository — all database operations for orders and order items.
 */
import { Order, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { CartItem, OrderStatus, OrderType, OrderFilterDto } from '../types';

export type OrderWithDetails = Prisma.OrderGetPayload<{
  include: {
    customer: true;
    orderItems: { include: { product: true } };
  };
}>;

export const orderRepository = {
  /**
   * Creates an order + all order items in a single DB transaction.
   * Atomic: either both succeed or nothing is written.
   */
  async create(data: {
    vendorId: string;
    customerId: string;
    orderType: OrderType;
    cart: CartItem[];
    totalAmount: number;
    deliveryAddress?: string;
    notes?: string;
    paystackReference: string;
  }): Promise<Order> {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          vendorId: data.vendorId,
          customerId: data.customerId,
          orderType: data.orderType,
          status: 'PENDING_PAYMENT',
          totalAmount: data.totalAmount,
          deliveryAddress: data.deliveryAddress ?? null,
          notes: data.notes ?? null,
          paystackReference: data.paystackReference,
          paymentProcessed: false,
          digitalDelivered: false,
        },
      });

      await tx.orderItem.createMany({
        data: data.cart.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice, // Snapshot at order time
        })),
      });

      return order;
    });
  },

  async findByIdWithDetails(orderId: string): Promise<OrderWithDetails | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        orderItems: { include: { product: true } },
      },
    });
  },

  async findByPaystackReference(ref: string): Promise<Order | null> {
    return prisma.order.findUnique({ where: { paystackReference: ref } });
  },

  async updateStatus(orderId: string, status: OrderStatus): Promise<Order> {
    return prisma.order.update({ where: { id: orderId }, data: { status } });
  },

  /**
   * Atomically marks order as payment-processed. Returns true if this is the
   * first time (i.e. not a duplicate). Uses DB-level conditional update.
   */
  async markPaymentProcessed(orderId: string): Promise<boolean> {
    const result = await prisma.order.updateMany({
      where: { id: orderId, paymentProcessed: false },
      data: { paymentProcessed: true, status: 'PAYMENT_CONFIRMED' },
    });
    return result.count > 0;
  },

  /** Marks digital delivery as complete */
  async markDigitalDelivered(orderId: string): Promise<Order> {
    return prisma.order.update({
      where: { id: orderId },
      data: { digitalDelivered: true, status: 'DIGITAL_SENT' },
    });
  },

  async findByVendor(
    vendorId: string,
    filters: OrderFilterDto = {},
  ): Promise<{ orders: OrderWithDetails[]; total: number }> {
    const { status, orderType, dateFrom, dateTo, page = 1, limit = 20 } = filters;

    const where: Prisma.OrderWhereInput = {
      vendorId,
      ...(status ? { status } : {}),
      ...(orderType ? { orderType } : {}),
      ...((dateFrom || dateTo) ? {
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        },
      } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { customer: true, orderItems: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return { orders, total };
  },
};

export type { Order };
