/**
 * Vendor repository — the only place that queries the vendors table.
 */
import { Vendor } from '@prisma/client';
import { prisma } from './prisma';
import { UpdateVendorDto } from '../types';

export const vendorRepository = {
  async create(data: {
    businessName: string;
    whatsappNumber: string;
    phoneNumber: string;
    vendorType: string;
    apiKeyHash: string;
  }): Promise<Vendor> {
    return prisma.vendor.create({ data: data as Parameters<typeof prisma.vendor.create>[0]['data'] });
  },

  async findById(id: string): Promise<Vendor | null> {
    return prisma.vendor.findUnique({ where: { id } });
  },

  async findByWhatsAppNumber(whatsappNumber: string): Promise<Vendor | null> {
    return prisma.vendor.findUnique({ where: { whatsappNumber } });
  },

  async findByOwnerPhone(ownerPhone: string): Promise<Vendor | null> {
    return prisma.vendor.findUnique({ where: { ownerPhone } });
  },

  async findByStoreCode(storeCode: string): Promise<Vendor | null> {
    return prisma.vendor.findFirst({
      where: { storeCode: storeCode.toUpperCase(), isActive: true, isPaused: false },
    });
  },

  async update(id: string, data: UpdateVendorDto): Promise<Vendor> {
    return prisma.vendor.update({ where: { id }, data });
  },

  async existsByWhatsAppNumber(whatsappNumber: string): Promise<boolean> {
    return (await prisma.vendor.count({ where: { whatsappNumber } })) > 0;
  },

  async findAllActive(): Promise<Vendor[]> {
    return prisma.vendor.findMany({ where: { isActive: true } });
  },
};

export type { Vendor };
