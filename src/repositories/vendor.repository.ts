/**
 * Vendor repository — the only place that queries the vendors table.
 * Hot-path reads (findById, findByWhatsAppNumber) are Redis-cached for 10 minutes.
 * Cache is invalidated on any update to keep data fresh.
 */
import { Vendor } from '@prisma/client';
import { prisma } from './prisma';
import { redis } from '../utils/redis';
import { UpdateVendorDto } from '../types';

const VENDOR_CACHE_TTL = 600; // 10 minutes
const vKey  = (id: string)    => `vendor:id:${id}`;
const vwKey = (phone: string) => `vendor:wa:${phone}`;

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
    const cached = await redis.get(vKey(id));
    if (cached) return JSON.parse(cached) as Vendor;
    const vendor = await prisma.vendor.findUnique({ where: { id } });
    if (vendor) await redis.setex(vKey(id), VENDOR_CACHE_TTL, JSON.stringify(vendor));
    return vendor;
  },

  async findByWhatsAppNumber(whatsappNumber: string): Promise<Vendor | null> {
    const cached = await redis.get(vwKey(whatsappNumber));
    if (cached) return JSON.parse(cached) as Vendor;
    const vendor = await prisma.vendor.findUnique({ where: { whatsappNumber } });
    if (vendor) await redis.setex(vwKey(whatsappNumber), VENDOR_CACHE_TTL, JSON.stringify(vendor));
    return vendor;
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
    const vendor = await prisma.vendor.update({ where: { id }, data });
    // Invalidate all cache keys for this vendor
    const keys = [vKey(id), vwKey(vendor.whatsappNumber)];
    if (vendor.ownerPhone) keys.push(vwKey(vendor.ownerPhone));
    await redis.del(...keys);
    return vendor;
  },

  async existsByWhatsAppNumber(whatsappNumber: string): Promise<boolean> {
    return (await prisma.vendor.count({ where: { whatsappNumber } })) > 0;
  },

  async findAllActive(): Promise<Vendor[]> {
    return prisma.vendor.findMany({ where: { isActive: true } });
  },
};

export type { Vendor };
