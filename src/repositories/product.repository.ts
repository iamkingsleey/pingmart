/**
 * Product repository — all database operations for the unified Product model.
 * Replaces the old MenuItem model; supports both PHYSICAL and DIGITAL products.
 */
import { Product, ProductType } from '@prisma/client';
import { prisma } from './prisma';
import { CreateProductDto, UpdateProductDto } from '../types';

export const productRepository = {
  async create(vendorId: string, data: CreateProductDto): Promise<Product> {
    return prisma.product.create({
      data: {
        vendorId,
        name: data.name,
        description: data.description,
        price: data.price,
        category: data.category ?? 'General',
        productType: data.productType,
        imageUrl: data.imageUrl,
        isAvailable: true,
        stockCount: data.stockCount ?? null,
        deliveryType: data.deliveryType ?? null,
        deliveryContent: data.deliveryContent ?? null,
        deliveryMessage: data.deliveryMessage ?? null,
      },
    });
  },

  /** All available products for a vendor — used in customer-facing catalog */
  async findAvailableByVendor(vendorId: string): Promise<Product[]> {
    return prisma.product.findMany({
      where: { vendorId, isAvailable: true },
      orderBy: [{ productType: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
  },

  /** Available products filtered by type — for single-type vendor flows */
  async findAvailableByVendorAndType(vendorId: string, type: ProductType): Promise<Product[]> {
    return prisma.product.findMany({
      where: { vendorId, isAvailable: true, productType: type },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  /** All products (including unavailable) — vendor admin view */
  async findAllByVendor(vendorId: string): Promise<Product[]> {
    return prisma.product.findMany({
      where: { vendorId },
      orderBy: [{ productType: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
  },

  async findByIdAndVendor(productId: string, vendorId: string): Promise<Product | null> {
    return prisma.product.findFirst({ where: { id: productId, vendorId } });
  },

  async findById(productId: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id: productId } });
  },

  async update(productId: string, data: UpdateProductDto): Promise<Product> {
    return prisma.product.update({ where: { id: productId }, data });
  },

  async delete(productId: string): Promise<void> {
    await prisma.product.delete({ where: { id: productId } });
  },
};

export type { Product };
/** Grouped by category for catalog display */
export function groupByCategory(products: Product[]): Map<string, Product[]> {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const list = map.get(p.category) ?? [];
    list.push(p);
    map.set(p.category, list);
  }
  return map;
}
