/**
 * Product repository — all database operations for the unified Product model.
 * Replaces the old MenuItem model; supports both PHYSICAL and DIGITAL products.
 *
 * findAvailableByVendor is Redis-cached (5 min TTL) because it's called on every
 * customer catalogue view. Cache is invalidated on create, update, and delete.
 */
import { Product, ProductType } from '@prisma/client';
import { prisma } from './prisma';
import { redis } from '../utils/redis';
import { CreateProductDto, UpdateProductDto } from '../types';

const PRODUCT_CACHE_TTL = 300; // 5 minutes
const pcKey = (vendorId: string) => `products:available:${vendorId}`;

export const productRepository = {
  async create(vendorId: string, data: CreateProductDto): Promise<Product> {
    const product = await prisma.product.create({
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
    await redis.del(pcKey(vendorId));
    return product;
  },

  /** All available products for a vendor — cached in Redis for 5 minutes */
  async findAvailableByVendor(vendorId: string): Promise<Product[]> {
    const cached = await redis.get(pcKey(vendorId));
    if (cached) return JSON.parse(cached) as Product[];
    const products = await prisma.product.findMany({
      where: { vendorId, isAvailable: true },
      orderBy: [{ productType: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });
    await redis.setex(pcKey(vendorId), PRODUCT_CACHE_TTL, JSON.stringify(products));
    return products;
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
    // Fetch vendorId first so we can invalidate the correct cache key
    const existing = await prisma.product.findUnique({ where: { id: productId }, select: { vendorId: true } });
    const product = await prisma.product.update({ where: { id: productId }, data });
    if (existing) await redis.del(pcKey(existing.vendorId));
    return product;
  },

  async delete(productId: string): Promise<void> {
    const existing = await prisma.product.findUnique({ where: { id: productId }, select: { vendorId: true } });
    await prisma.product.delete({ where: { id: productId } });
    if (existing) await redis.del(pcKey(existing.vendorId));
  },

  /** Finds the most ordered available product for a vendor (by total quantity sold) */
  async findMostPopular(vendorId: string): Promise<Product | null> {
    const result = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          vendorId,
          status: { notIn: ['CANCELLED', 'PENDING_PAYMENT'] },
        },
        product: { vendorId, isAvailable: true },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 1,
    });
    if (!result.length) return null;
    return prisma.product.findUnique({ where: { id: result[0].productId } });
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
