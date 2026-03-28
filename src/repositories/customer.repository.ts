/**
 * Customer repository — identified primarily by WhatsApp number.
 */
import { Customer } from '@prisma/client';
import { prisma } from './prisma';
import { Language } from '../i18n';

export const customerRepository = {
  /**
   * Returns the existing customer, or creates a new one.
   * `isNew` is true only on the very first interaction — used to trigger
   * the language-selection flow.
   */
  async findOrCreate(
    whatsappNumber: string,
    name?: string,
  ): Promise<{ customer: Customer; isNew: boolean }> {
    const existing = await prisma.customer.findUnique({ where: { whatsappNumber } });
    if (existing) {
      if (name) await prisma.customer.update({ where: { whatsappNumber }, data: { name } });
      return { customer: existing, isNew: false };
    }
    const customer = await prisma.customer.create({
      data: { whatsappNumber, name: name ?? null },
    });
    return { customer, isNew: true };
  },

  async findByWhatsAppNumber(whatsappNumber: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { whatsappNumber } });
  },

  async findById(id: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { id } });
  },

  /** Persists the customer's chosen language preference and marks it as explicitly set. */
  async updateLanguage(whatsappNumber: string, language: Language): Promise<void> {
    await prisma.customer.update({ where: { whatsappNumber }, data: { language, languageSet: true } });
  },

  /** Opts a customer out of re-order reminder messages */
  async setReorderOptOut(whatsappNumber: string, optOut: boolean): Promise<void> {
    await prisma.customer.update({ where: { whatsappNumber }, data: { reorderOptOut: optOut } });
  },
};

export type { Customer };
