/**
 * Customer repository — identified primarily by WhatsApp number.
 */
import { Customer } from '@prisma/client';
import { prisma } from './prisma';

export const customerRepository = {
  async findOrCreate(whatsappNumber: string, name?: string): Promise<Customer> {
    return prisma.customer.upsert({
      where: { whatsappNumber },
      update: name ? { name } : {},
      create: { whatsappNumber, name: name ?? null },
    });
  },

  async findByWhatsAppNumber(whatsappNumber: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { whatsappNumber } });
  },

  async findById(id: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { id } });
  },
};

export type { Customer };
