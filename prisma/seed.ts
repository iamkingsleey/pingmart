/**
 * Seed script — creates two demo vendors with sample products.
 *
 *   Vendor 1: "Mama Tee's Kitchen" — PHYSICAL_GOODS (food)
 *   Vendor 2: "TechSkills Academy"  — DIGITAL_PRODUCTS (courses/ebooks)
 *
 * Usage:
 *   npm run seed
 *   (or: ts-node prisma/seed.ts)
 *
 * The raw API keys are printed to stdout ONCE. Save them — they are never
 * retrievable again (only the bcrypt hash is stored in the DB).
 */
import { config } from 'dotenv';
config(); // load .env before PrismaClient initialises

import { PrismaClient, VendorType, ProductType, DeliveryType } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateApiKey(): string {
  return `orb_${crypto.randomBytes(24).toString('hex')}`;
}

async function hashApiKey(raw: string): Promise<string> {
  return bcrypt.hash(raw, 10);
}

// ─── Physical goods vendor ────────────────────────────────────────────────────

async function seedPhysicalVendor() {
  const rawKey = generateApiKey();
  const apiKeyHash = await hashApiKey(rawKey);

  const vendor = await prisma.vendor.upsert({
    where: { whatsappNumber: '+2348011111111' },
    update: {
      workingHoursStart:    '08:00',
      workingHoursEnd:      '21:00',
      workingDays:          '1,2,3,4,5,6',
      timezone:             'Africa/Lagos',
      acceptOffHoursOrders: false,
    },
    create: {
      businessName:         "Mama Tee's Kitchen",
      whatsappNumber:       '+2348011111111',
      phoneNumber:          '+2348011111111',
      vendorType:           VendorType.PHYSICAL_GOODS,
      apiKeyHash,
      isActive:             true,
      isVerified:           true,
      workingHoursStart:    '08:00',
      workingHoursEnd:      '21:00',
      workingDays:          '1,2,3,4,5,6',
      timezone:             'Africa/Lagos',
      acceptOffHoursOrders: false,
    },
  });

  // Only create products if this is a fresh insert (upsert created, not found)
  const existingCount = await prisma.product.count({ where: { vendorId: vendor.id } });
  if (existingCount === 0) {
    await prisma.product.createMany({
      data: [
        {
          vendorId: vendor.id,
          name: 'Jollof Rice (Large)',
          description: 'Nigerian party jollof cooked with tomato base and smoky firewood flavour',
          price: 150_000, // ₦1,500 in kobo
          category: 'Rice Dishes',
          productType: ProductType.PHYSICAL,
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'Egusi Soup + Swallow',
          description: 'Fresh egusi with assorted meat, served with your choice of pounded yam or eba',
          price: 200_000, // ₦2,000
          category: 'Soups',
          productType: ProductType.PHYSICAL,
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'Grilled Chicken (Half)',
          description: 'Spiced and grilled to perfection, served with coleslaw',
          price: 350_000, // ₦3,500
          category: 'Protein',
          productType: ProductType.PHYSICAL,
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'Fried Plantain (Dodo)',
          description: 'Sweet ripe plantain, golden fried',
          price: 50_000, // ₦500
          category: 'Sides',
          productType: ProductType.PHYSICAL,
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'Chapman (Large)',
          description: 'Classic Nigerian Chapman cocktail with fruit garnish',
          price: 80_000, // ₦800
          category: 'Drinks',
          productType: ProductType.PHYSICAL,
          isAvailable: true,
        },
      ],
    });
  }

  return { vendor, rawKey };
}

// ─── Digital products vendor ──────────────────────────────────────────────────

async function seedDigitalVendor() {
  const rawKey = generateApiKey();
  const apiKeyHash = await hashApiKey(rawKey);

  const vendor = await prisma.vendor.upsert({
    where: { whatsappNumber: '+2348022222222' },
    update: {
      workingHoursStart:    '08:00',
      workingHoursEnd:      '21:00',
      workingDays:          '1,2,3,4,5,6',
      timezone:             'Africa/Lagos',
      acceptOffHoursOrders: false,
    },
    create: {
      businessName:         'TechSkills Academy',
      whatsappNumber:       '+2348022222222',
      phoneNumber:          '+2348022222222',
      vendorType:           VendorType.DIGITAL_PRODUCTS,
      apiKeyHash,
      isActive:             true,
      isVerified:           true,
      workingHoursStart:    '08:00',
      workingHoursEnd:      '21:00',
      workingDays:          '1,2,3,4,5,6',
      timezone:             'Africa/Lagos',
      acceptOffHoursOrders: false,
    },
  });

  const existingCount = await prisma.product.count({ where: { vendorId: vendor.id } });
  if (existingCount === 0) {
    await prisma.product.createMany({
      data: [
        {
          vendorId: vendor.id,
          name: 'Complete React Developer Course',
          description: 'From zero to production — hooks, context, React Query, TypeScript, testing',
          price: 1_500_000, // ₦15,000
          category: 'Frontend',
          productType: ProductType.DIGITAL,
          deliveryType: DeliveryType.LINK,
          // In production this would be a real course platform link
          deliveryContent: 'https://academy.techskills.ng/courses/react-complete',
          deliveryMessage: '🎉 Welcome to the React course! Your lifetime access link is above. Join our student Telegram: https://t.me/techskillsstudents',
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'Node.js Backend Masterclass',
          description: 'Build production-grade REST APIs with Express, PostgreSQL, Redis, and Docker',
          price: 1_200_000, // ₦12,000
          category: 'Backend',
          productType: ProductType.DIGITAL,
          deliveryType: DeliveryType.LINK,
          deliveryContent: 'https://academy.techskills.ng/courses/nodejs-masterclass',
          deliveryMessage: '🚀 Access your Node.js course here. All source code is on GitHub — link inside the course portal.',
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'Freelancing in Nigeria — Starter Guide',
          description: '47-page PDF: finding clients, setting rates, contracts, and getting paid in USD',
          price: 300_000, // ₦3,000
          category: 'Business',
          productType: ProductType.DIGITAL,
          deliveryType: DeliveryType.LINK,
          // In production this would be a Cloudinary URL after file upload
          deliveryContent: 'https://drive.google.com/file/d/sample-freelancing-guide-id/view',
          deliveryMessage: '📄 Your freelancing guide PDF is ready! Tap to download. Any questions? Reply to this chat.',
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: 'UI/UX Figma Templates Pack',
          description: '25 premium Figma templates — dashboards, landing pages, mobile apps',
          price: 500_000, // ₦5,000
          category: 'Design',
          productType: ProductType.DIGITAL,
          deliveryType: DeliveryType.LINK,
          deliveryContent: 'https://www.figma.com/community/file/sample-templates-pack',
          deliveryMessage: '🎨 Your Figma templates pack! Duplicate the file to your own Figma workspace. Tag us @techskillsng when you ship something!',
          isAvailable: true,
        },
        {
          vendorId: vendor.id,
          name: '1-on-1 Career Coaching Session (60 min)',
          description: 'Book a private coaching call — CV review, interview prep, tech career roadmap',
          price: 2_000_000, // ₦20,000
          category: 'Coaching',
          productType: ProductType.DIGITAL,
          deliveryType: DeliveryType.LINK,
          deliveryContent: 'https://calendly.com/techskills-coach/60min',
          deliveryMessage: "✅ Your coaching session is booked! Use the link above to schedule at a time that works for you. Can't wait to speak with you!",
          isAvailable: true,
        },
      ],
    });
  }

  return { vendor, rawKey };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding database...\n');

  const [physical, digital] = await Promise.all([
    seedPhysicalVendor(),
    seedDigitalVendor(),
  ]);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log("✅ Mama Tee's Kitchen (PHYSICAL_GOODS)");
  console.log(`   Vendor ID : ${physical.vendor.id}`);
  console.log(`   WhatsApp  : ${physical.vendor.whatsappNumber}`);
  console.log(`   API Key   : ${physical.rawKey}  ← SAVE THIS`);
  console.log('');
  console.log('✅ TechSkills Academy (DIGITAL_PRODUCTS)');
  console.log(`   Vendor ID : ${digital.vendor.id}`);
  console.log(`   WhatsApp  : ${digital.vendor.whatsappNumber}`);
  console.log(`   API Key   : ${digital.rawKey}  ← SAVE THIS`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n⚠️  API keys are shown only once and cannot be recovered.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
