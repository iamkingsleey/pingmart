/**
 * PickupLocation repository — CRUD for vendor pickup branches.
 */
import { PickupLocation } from '@prisma/client';
import { prisma } from './prisma';

export const pickupLocationRepository = {
  /** All active pickup locations for a vendor */
  async findActiveByVendor(vendorId: string): Promise<PickupLocation[]> {
    return prisma.pickupLocation.findMany({
      where: { vendorId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  /** All pickup locations for a vendor (including inactive) */
  async findAllByVendor(vendorId: string): Promise<PickupLocation[]> {
    return prisma.pickupLocation.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'asc' },
    });
  },

  async findById(id: string): Promise<PickupLocation | null> {
    return prisma.pickupLocation.findUnique({ where: { id } });
  },

  async countActive(vendorId: string): Promise<number> {
    return prisma.pickupLocation.count({ where: { vendorId, isActive: true } });
  },

  async create(data: {
    vendorId: string;
    name: string;
    address: string;
    landmark?: string;
    city: string;
    state: string;
    hoursStart?: string;
    hoursEnd?: string;
  }): Promise<PickupLocation> {
    return prisma.pickupLocation.create({ data });
  },

  async update(
    id: string,
    data: Partial<{
      name: string;
      address: string;
      landmark: string | null;
      city: string;
      state: string;
      hoursStart: string | null;
      hoursEnd: string | null;
      isActive: boolean;
    }>,
  ): Promise<PickupLocation> {
    return prisma.pickupLocation.update({ where: { id }, data });
  },

  async deactivate(id: string): Promise<PickupLocation> {
    return prisma.pickupLocation.update({ where: { id }, data: { isActive: false } });
  },
};
