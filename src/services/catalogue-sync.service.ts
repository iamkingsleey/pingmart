/**
 * WhatsApp Commerce Catalogue Sync Service
 *
 * Syncs vendor products to the WhatsApp Commerce Catalogue via the Meta Cloud API.
 * Every function in this file is gated behind WHATSAPP_COMMERCE_ENABLED — nothing
 * talks to Meta unless that flag is true.
 *
 * ⚠️  DO NOT ACTIVATE until Meta Commerce permissions are approved.
 *     Flip WHATSAPP_COMMERCE_ENABLED=true in the environment to enable.
 */

import fetch from 'node-fetch';
import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const GRAPH_API = 'https://graph.facebook.com/v19.0';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatalogueSyncStatus {
  vendorId:      string;
  totalProducts: number;
  syncedCount:   number;
  failedCount:   number;
  pendingCount:  number;
  lastSyncedAt:  Date | null;
}

interface MetaProductPayload {
  retailer_id:  string;
  name:         string;
  price:        number;   // in kobo (smallest currency unit for NGN)
  currency:     'NGN';
  image_url:    string;
  description:  string;
  availability: 'in stock' | 'out of stock';
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * POSTs a single product to the Meta Commerce Catalogue.
 * Returns the whatsappProductId assigned by Meta.
 */
async function uploadToMeta(catalogId: string, payload: MetaProductPayload): Promise<string> {
  const res = await fetch(`${GRAPH_API}/${catalogId}/products`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${res.status}: ${body}`);
  }

  const data = await res.json() as { id: string };
  return data.id;
}

/**
 * Upserts a CatalogueSyncLog record for a given vendor + product.
 */
async function writeSyncLog(
  vendorId:         string,
  productId:        string,
  syncStatus:       'SYNCED' | 'FAILED' | 'PENDING',
  whatsappProductId?: string,
  errorMessage?:    string,
): Promise<void> {
  await prisma.catalogueSyncLog.upsert({
    where:  { vendorId_productId: { vendorId, productId } },
    update: {
      syncStatus,
      lastSyncedAt:     new Date(),
      whatsappProductId: whatsappProductId ?? undefined,
      errorMessage:     errorMessage ?? null,
    },
    create: {
      vendorId,
      productId,
      syncStatus,
      lastSyncedAt:     new Date(),
      whatsappProductId: whatsappProductId ?? undefined,
      errorMessage:     errorMessage ?? null,
    },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload or update a single product in the vendor's WhatsApp Commerce Catalogue.
 *
 * No-op when WHATSAPP_COMMERCE_ENABLED is false.
 */
export async function syncProduct(vendorId: string, productId: string): Promise<void> {
  if (!env.WHATSAPP_COMMERCE_ENABLED) return;

  const vendor = await prisma.vendor.findUnique({
    where:  { id: vendorId },
    select: { whatsappCatalogueId: true },
  });

  if (!vendor?.whatsappCatalogueId) {
    throw new Error(`Vendor ${vendorId} has no whatsappCatalogueId — set it via Meta Commerce Manager`);
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error(`Product ${productId} not found`);

  const payload: MetaProductPayload = {
    retailer_id:  product.id,
    name:         product.name,
    price:        product.price,           // already in kobo
    currency:     'NGN',
    image_url:    product.imageUrl ?? '',
    description:  product.description ?? '',
    availability: product.isAvailable ? 'in stock' : 'out of stock',
  };

  try {
    const whatsappProductId = await uploadToMeta(vendor.whatsappCatalogueId, payload);
    await writeSyncLog(vendorId, productId, 'SYNCED', whatsappProductId);
    logger.info('catalogue-sync: product synced', { vendorId, productId, whatsappProductId });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await writeSyncLog(vendorId, productId, 'FAILED', undefined, errorMessage);
    logger.warn('catalogue-sync: product sync failed', { vendorId, productId, errorMessage });
    throw err;
  }
}

/**
 * Sync all products for a vendor in bulk.
 *
 * Processes sequentially to avoid hammering the Meta rate limit.
 * Returns how many succeeded and how many failed.
 *
 * No-op when WHATSAPP_COMMERCE_ENABLED is false.
 */
export async function syncVendorCatalogue(
  vendorId: string,
): Promise<{ synced: number; failed: number }> {
  if (!env.WHATSAPP_COMMERCE_ENABLED) return { synced: 0, failed: 0 };

  const products = await prisma.product.findMany({ where: { vendorId } });

  let synced = 0;
  let failed = 0;

  for (const product of products) {
    try {
      await syncProduct(vendorId, product.id);
      synced++;
    } catch {
      failed++;
    }
  }

  logger.info('catalogue-sync: bulk sync complete', { vendorId, synced, failed, total: products.length });
  return { synced, failed };
}

/**
 * Delete a product from the vendor's WhatsApp Commerce Catalogue.
 *
 * Silently skips if the product was never synced (no log record).
 * No-op when WHATSAPP_COMMERCE_ENABLED is false.
 */
export async function deleteProduct(vendorId: string, productId: string): Promise<void> {
  if (!env.WHATSAPP_COMMERCE_ENABLED) return;

  const [log, vendor] = await Promise.all([
    prisma.catalogueSyncLog.findUnique({
      where: { vendorId_productId: { vendorId, productId } },
    }),
    prisma.vendor.findUnique({
      where:  { id: vendorId },
      select: { whatsappCatalogueId: true },
    }),
  ]);

  if (!log?.whatsappProductId || !vendor?.whatsappCatalogueId) return;

  const res = await fetch(
    `${GRAPH_API}/${vendor.whatsappCatalogueId}/products/${log.whatsappProductId}`,
    {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    },
  );

  if (!res.ok) {
    logger.warn('catalogue-sync: failed to delete from Meta', {
      vendorId,
      productId,
      status: res.status,
    });
  } else {
    logger.info('catalogue-sync: product deleted from Meta', { vendorId, productId });
  }

  // Always remove the local log record so future syncs treat this as a fresh upload
  await prisma.catalogueSyncLog
    .delete({ where: { vendorId_productId: { vendorId, productId } } })
    .catch(() => {});
}

/**
 * Returns the current sync status for a vendor's catalogue.
 */
export async function getCatalogueStatus(vendorId: string): Promise<CatalogueSyncStatus> {
  const [logs, totalProducts] = await Promise.all([
    prisma.catalogueSyncLog.findMany({ where: { vendorId } }),
    prisma.product.count({ where: { vendorId } }),
  ]);

  const syncedCount  = logs.filter((l) => l.syncStatus === 'SYNCED').length;
  const failedCount  = logs.filter((l) => l.syncStatus === 'FAILED').length;
  const pendingCount = totalProducts - syncedCount - failedCount;

  const lastSyncedAt = logs.reduce<Date | null>((latest, l) => {
    if (!l.lastSyncedAt) return latest;
    return !latest || l.lastSyncedAt > latest ? l.lastSyncedAt : latest;
  }, null);

  return { vendorId, totalProducts, syncedCount, failedCount, pendingCount, lastSyncedAt };
}
