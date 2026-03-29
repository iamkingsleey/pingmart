/**
 * Phase 9 — Data Migration Script
 *
 * Migrates existing single-vendor data to the multi-tenant schema.
 * Safe to run multiple times — all steps are idempotent.
 *
 * What it does:
 *  1. If no vendors exist → create one from env vars (fresh-deploy seed)
 *  2. Backfill ownerPhone from whatsappNumber for v1 vendors missing it
 *  3. Generate storeCode for vendors that don't have one
 *  4. Assign any products / orders with a null vendorId to the primary vendor
 *  5. Create a primary VendorNotificationNumber for vendors that don't have one
 *
 * Run via: npm run migrate:data
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a business name to a clean uppercase store code (max 12 chars) */
function nameToStoreCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'STORE';
}

/** Ensures the generated code is unique — appends a numeric suffix if needed */
async function uniqueStoreCode(base: string, vendorId: string): Promise<string> {
  let candidate = base;
  let attempt = 0;
  while (true) {
    const conflict = await prisma.vendor.findFirst({
      where: { storeCode: candidate, id: { not: vendorId } },
    });
    if (!conflict) return candidate;
    attempt++;
    candidate = `${base.slice(0, 10)}${attempt}`;
  }
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function step1_seedVendorIfEmpty(): Promise<void> {
  const count = await prisma.vendor.count();
  if (count > 0) {
    console.log('  ↳ Vendors already exist — skipping seed.');
    return;
  }

  const businessName = process.env.VENDOR_NAME ?? "Mama Tee's Kitchen";
  const ownerPhone   = process.env.VENDOR_WHATSAPP_NUMBER ?? '';

  if (!ownerPhone) {
    console.warn('  ⚠️  VENDOR_WHATSAPP_NUMBER not set — vendor created without ownerPhone.');
  }

  const storeCodeBase = nameToStoreCode(businessName);
  const vendor = await prisma.vendor.create({
    data: {
      businessName,
      whatsappNumber: ownerPhone,
      phoneNumber:    ownerPhone,
      ownerPhone:     ownerPhone || null,
      storeCode:      storeCodeBase,
      businessType:   'general',
      isActive:       true,
      plan:           'growth',
      apiKeyHash:     '',
    },
  });

  console.log(`  ✅ Created vendor: "${businessName}" (${vendor.id})`);
}

async function step2_backfillOwnerPhone(): Promise<void> {
  const vendors = await prisma.vendor.findMany({
    where: { ownerPhone: null },
    select: { id: true, businessName: true, whatsappNumber: true },
  });

  if (vendors.length === 0) {
    console.log('  ↳ All vendors already have ownerPhone — nothing to backfill.');
    return;
  }

  for (const v of vendors) {
    if (!v.whatsappNumber) {
      console.warn(`  ⚠️  Vendor "${v.businessName}" (${v.id}) has no whatsappNumber to backfill from.`);
      continue;
    }
    await prisma.vendor.update({
      where: { id: v.id },
      data:  { ownerPhone: v.whatsappNumber },
    });
    console.log(`  ✅ Backfilled ownerPhone for "${v.businessName}": ${v.whatsappNumber}`);
  }
}

async function step3_generateStoreCodes(): Promise<void> {
  const vendors = await prisma.vendor.findMany({
    where: { storeCode: null },
    select: { id: true, businessName: true },
  });

  if (vendors.length === 0) {
    console.log('  ↳ All vendors already have a storeCode — nothing to generate.');
    return;
  }

  for (const v of vendors) {
    const base = nameToStoreCode(v.businessName);
    const code = await uniqueStoreCode(base, v.id);
    await prisma.vendor.update({
      where: { id: v.id },
      data:  { storeCode: code },
    });
    console.log(`  ✅ Generated storeCode "${code}" for "${v.businessName}"`);
  }
}

async function step4_assignOrphanedRecords(): Promise<void> {
  // Products and orders with a null vendorId — only possible on older schemas.
  // Current schema makes vendorId non-nullable, so this is a safety net.
  const primaryVendor = await prisma.vendor.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!primaryVendor) {
    console.log('  ↳ No vendors found — skipping orphan assignment.');
    return;
  }

  // Raw queries bypass Prisma's type safety so we can handle optional columns
  const orphanedProducts = await prisma.$executeRaw`
    UPDATE "Product" SET "vendorId" = ${primaryVendor.id}
    WHERE "vendorId" IS NULL
  `;
  const orphanedOrders = await prisma.$executeRaw`
    UPDATE "Order" SET "vendorId" = ${primaryVendor.id}
    WHERE "vendorId" IS NULL
  `;

  if (orphanedProducts > 0) console.log(`  ✅ Assigned ${orphanedProducts} orphaned product(s) to "${primaryVendor.businessName}"`);
  if (orphanedOrders > 0)  console.log(`  ✅ Assigned ${orphanedOrders} orphaned order(s) to "${primaryVendor.businessName}"`);
  if (orphanedProducts === 0 && orphanedOrders === 0) {
    console.log('  ↳ No orphaned records found — nothing to reassign.');
  }
}

async function step5_createPrimaryNotificationNumbers(): Promise<void> {
  const vendors = await prisma.vendor.findMany({
    select: { id: true, businessName: true, ownerPhone: true, whatsappNumber: true },
  });

  let created = 0;
  for (const v of vendors) {
    const phone = v.ownerPhone ?? v.whatsappNumber;
    if (!phone) {
      console.warn(`  ⚠️  Vendor "${v.businessName}" has no phone — skipping notification number.`);
      continue;
    }

    const existing = await prisma.vendorNotificationNumber.findFirst({
      where: { vendorId: v.id, isPrimary: true },
    });
    if (existing) continue;

    // Check if this phone is already registered to avoid unique-constraint violation
    const duplicate = await prisma.vendorNotificationNumber.findUnique({
      where: { vendorId_phone: { vendorId: v.id, phone } },
    });
    if (duplicate) {
      // Promote to primary if it exists but isn't primary
      if (!duplicate.isPrimary) {
        await prisma.vendorNotificationNumber.update({
          where: { id: duplicate.id },
          data:  { isPrimary: true },
        });
        console.log(`  ✅ Promoted existing number to primary for "${v.businessName}": ${phone}`);
        created++;
      }
      continue;
    }

    await prisma.vendorNotificationNumber.create({
      data: {
        vendorId:  v.id,
        phone,
        label:     'Main',
        isPrimary: true,
      },
    });
    console.log(`  ✅ Created primary notification number for "${v.businessName}": ${phone}`);
    created++;
  }

  if (created === 0) {
    console.log('  ↳ All vendors already have a primary notification number.');
  }
}

// ── Entry Point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🚀 Pingmart Phase 9 — Data Migration\n');

  console.log('Step 1: Seed vendor from env (if database is empty)');
  await step1_seedVendorIfEmpty();

  console.log('\nStep 2: Backfill ownerPhone from whatsappNumber (v1 → v2)');
  await step2_backfillOwnerPhone();

  console.log('\nStep 3: Generate storeCodes for vendors missing one');
  await step3_generateStoreCodes();

  console.log('\nStep 4: Assign orphaned products/orders to primary vendor');
  await step4_assignOrphanedRecords();

  console.log('\nStep 5: Create primary VendorNotificationNumber for each vendor');
  await step5_createPrimaryNotificationNumbers();

  console.log('\n✅ Migration complete.\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
