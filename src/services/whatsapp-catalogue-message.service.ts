/**
 * WhatsApp Native Catalogue Message Service
 *
 * Sends a WhatsApp interactive `product_list` message, which displays vendor
 * products with images natively inside WhatsApp (no external link required).
 *
 * ⚠️  DO NOT ACTIVATE until Meta Commerce permissions are approved.
 *     Gated behind WHATSAPP_COMMERCE_ENABLED — the function is a no-op when false.
 */

import fetch from 'node-fetch';
import { prisma } from '../repositories/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const GRAPH_API = 'https://graph.facebook.com/v19.0';

/**
 * Sends a native WhatsApp Multi-Product Message (product_list) to a customer.
 *
 * The message renders as a scrollable list of product cards with images, prices,
 * and "Add to cart" buttons — all rendered natively inside WhatsApp.
 *
 * Prerequisites (all checked at runtime):
 *  - WHATSAPP_COMMERCE_ENABLED must be true
 *  - vendor.whatsappCatalogueId must be set
 *  - At least one CatalogueSyncLog with syncStatus=SYNCED must exist for the vendor
 *
 * @param customerPhone  E.164 phone number of the recipient
 * @param vendorId       Internal vendor ID
 * @param sectionTitle   Title shown above the product list (e.g. "Our Menu")
 */
export async function sendCatalogueMessage(
  customerPhone: string,
  vendorId:      string,
  sectionTitle:  string,
): Promise<void> {
  if (!env.WHATSAPP_COMMERCE_ENABLED) {
    logger.debug('sendCatalogueMessage: skipped — WHATSAPP_COMMERCE_ENABLED is false');
    return;
  }

  // Fetch vendor catalogue ID and display name
  const vendor = await prisma.vendor.findUnique({
    where:  { id: vendorId },
    select: { whatsappCatalogueId: true, businessName: true },
  });

  if (!vendor?.whatsappCatalogueId) {
    logger.warn('sendCatalogueMessage: no whatsappCatalogueId — skipped', { vendorId });
    return;
  }

  // Only include products that have been successfully synced to Meta
  const syncedLogs = await prisma.catalogueSyncLog.findMany({
    where: { vendorId, syncStatus: 'SYNCED' },
    take:  30, // WhatsApp product_list max is 30 items per section
  });

  if (!syncedLogs.length) {
    logger.warn('sendCatalogueMessage: no synced products — skipped', { vendorId });
    return;
  }

  // WhatsApp interactive product_list message body
  // Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-product-messages
  const messageBody = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                customerPhone,
    type:              'interactive',
    interactive: {
      type:   'product_list',
      header: {
        type: 'text',
        text: vendor.businessName,
      },
      body: {
        text: 'Browse our products and tap any item to order.',
      },
      action: {
        catalog_id: vendor.whatsappCatalogueId,
        sections:   [
          {
            title:         sectionTitle,
            product_items: syncedLogs.map((log) => ({
              product_retailer_id: log.productId,
            })),
          },
        ],
      },
    },
  };

  const res = await fetch(`${GRAPH_API}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(messageBody),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error('sendCatalogueMessage: Meta API error', {
      vendorId,
      status:   res.status,
      response: errBody,
    });
    throw new Error(`Meta API ${res.status}: ${errBody}`);
  }

  logger.info('sendCatalogueMessage: sent', {
    vendorId,
    products: syncedLogs.length,
    section:  sectionTitle,
  });
}
