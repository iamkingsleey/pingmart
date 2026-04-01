/**
 * Vendor Onboarding Service — Phase 3
 *
 * An LLM-powered conversational flow that guides a new vendor through setting up
 * their Pingmart store entirely over WhatsApp. No forms, no rigid menus — just
 * natural conversation.
 *
 * State machine (stored in VendorSetupSession.step):
 *   COLLECTING_INFO  — LLM extracts: business name, store code, type, hours, payment method
 *   ADDING_PRODUCTS  — LLM extracts product list from conversational messages
 *   PAYMENT_SETUP    — Collect bank details or Paystack key
 *   CONFIRMATION     — Show full summary, wait for "GO LIVE"
 *   COMPLETE         — vendor.isActive = true, store is live
 *
 * Conversation history is stored in VendorSetupSession.collectedData.history so the
 * LLM agent has full context across WhatsApp sessions (no in-memory state required).
 */
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import { Vendor, VendorSetupSession, Prisma } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { messageQueue } from '../queues/message.queue';
import { InteractiveButton } from '../types';
import { encryptBankAccount } from '../utils/crypto';
import { uploadProductImageBuffer } from '../utils/cloudinary';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';
import { detectLanguageSwitchRequest } from './llm.service';
import { redis } from '../utils/redis';
import { Language } from '../i18n';

type PrismaJson = Prisma.InputJsonValue;

// ─── LLM Client ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ProductInput {
  name: string;
  price: number;
  category?: string;
  description?: string;
  imageUrl?: string; // Cloudinary URL — set when product was added via photo
}

interface CollectedData {
  // Core vendor info
  businessName?: string;
  storeCode?: string;
  businessType?: string;
  description?: string;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  workingDays?: string;
  paymentMethod?: string; // paystack | bank | both

  // Payment details (collected in PAYMENT_SETUP)
  bankName?: string;
  bankAccountNumber?: string;  // plaintext during collection; encrypted before DB save
  bankAccountName?: string;
  paystackKeyProvided?: boolean;

  // Internal signals
  storeCodeConflict?: string; // set when LLM-proposed code is already taken

  // Products added during ADDING_PRODUCTS
  products?: ProductInput[];

  // Pending products extracted but not yet confirmed by the vendor
  pendingProducts?: ProductInput[];
  pendingIsDone?: boolean; // true if vendor said DONE in the same message

  // How the vendor chose to add products (set once when they tap an option button)
  productInputMode?: 'text' | 'sheet' | 'photos';

  // Full LLM conversation history (last 20 exchanges max)
  history: LLMMessage[];
}

// ─── Required info fields — all must be present before advancing ──────────────

const REQUIRED_INFO_FIELDS: (keyof CollectedData)[] = [
  'businessName', 'storeCode', 'businessType', 'description',
  'workingHoursStart', 'workingHoursEnd', 'workingDays', 'paymentMethod',
];

// ─── Onboarding Language Helpers ─────────────────────────────────────────────

const ONBOARDING_LANG_TTL = 30 * 24 * 60 * 60; // 30 days
const onboardingLangKey = (phone: string) => `vendor:lang:${phone}`;

async function setOnboardingLanguage(phone: string, lang: Language): Promise<void> {
  await redis.setex(onboardingLangKey(phone), ONBOARDING_LANG_TTL, lang);
}

/** Confirmation messages for a language switch during vendor onboarding. */
const ONBOARDING_LANG_CONFIRM: Record<Language, string> = {
  en:  `Sure! I'll continue in English. Let's keep going with your store setup. 😊`,
  pid: `No problem! I go yarn you for Pidgin. Make we continue your store setup. 😊`,
  ig:  `Ọ dị mma! A ga m asị gị n'Igbo. Ka anyị gaa n'ihu na-etolite ụlọ ahịa gị. 😊`,
  yo:  `Ko problem! Emi yoo ba ẹ sọrọ ní Yorùbá. Jẹ ká tẹsiwaju pẹlu iṣeto itaja rẹ. 😊`,
  ha:  `To! Zan yi magana da kai da Hausa. Mu ci gaba da saita kantin ku. 😊`,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Called when an unknown sender replies "2" to the shop/sell screen.
 * Creates the Vendor + VendorSetupSession records and sends the welcome message.
 */
export async function startVendorOnboarding(phone: string): Promise<void> {
  // Idempotent: if already in onboarding, just show the current state
  let vendor = await prisma.vendor.findUnique({ where: { ownerPhone: phone } });

  if (!vendor) {
    // Check if this phone is a v1 vendor (whatsappNumber field) — upgrade to v2
    const v1Vendor = await prisma.vendor.findUnique({ where: { whatsappNumber: phone } });

    if (v1Vendor) {
      vendor = await prisma.vendor.update({
        where: { id: v1Vendor.id },
        data: { ownerPhone: phone },
      });
    } else {
      // Brand-new vendor — create placeholder record
      // whatsappNumber is set to ownerPhone temporarily; Phase 9 migration separates them
      vendor = await prisma.vendor.create({
        data: {
          businessName: 'Setting up...',
          whatsappNumber: phone,
          phoneNumber: phone,
          ownerPhone: phone,
          apiKeyHash: 'pending',    // replaced during CONFIRMATION step
          vendorType: 'PHYSICAL_GOODS',
          isActive: false,
        },
      });
    }

    await prisma.vendorSetupSession.create({
      data: {
        vendorId: vendor.id,
        step: 'COLLECTING_INFO',
        collectedData: { history: [] } as unknown as PrismaJson,
      },
    });
  }

  // If already onboarded, show summary instead of restarting
  const session = await prisma.vendorSetupSession.findUnique({ where: { vendorId: vendor.id } });
  if (session?.completedAt) {
    await messageQueue.add({
      to: phone,
      message: `👋 Your store *${vendor.businessName}* is already live on Pingmart!\n\nType *MY LINK* to get your store link, or *HELP* to see what you can do.`,
    });
    return;
  }

  await messageQueue.add({
    to: phone,
    message:
      `🎉 Welcome to *Pingmart for Vendors*!\n\n` +
      `I'm going to help you set up your WhatsApp store in just a few minutes.\n` +
      `No technical knowledge needed — just answer my questions and you'll be live before you know it.\n\n` +
      `Ready? Tell me a bit about your business — what do you sell and what's your business called? 😊`,
  });

  // Send business category selector immediately so vendor can tap their type
  // without waiting for the LLM to ask. They can also just type their response.
  await messageQueue.add({
    to: phone,
    message: `Or pick your business category to get started faster:`,
    listSections: [
      {
        title: '🏷️ Business Categories',
        rows: [
          { id: 'CATEGORY:food',    title: '🍔 Food & Drinks',       description: 'Restaurants, cloud kitchens, snacks, beverages' },
          { id: 'CATEGORY:fashion', title: '👗 Fashion & Clothing',  description: 'Clothing, shoes, bags, accessories' },
          { id: 'CATEGORY:beauty',  title: '💄 Beauty & Cosmetics',  description: 'Skincare, haircare, makeup, wellness' },
          { id: 'CATEGORY:digital', title: '💻 Digital Products',    description: 'Ebooks, courses, software, templates' },
          { id: 'CATEGORY:general', title: '🛒 General / Other',     description: 'Everything else — groceries, electronics, services' },
        ],
      },
    ],
    listButtonText: 'Choose Category',
  });
}

/**
 * Called by the router when a vendor (isActive=false, setup incomplete) sends a message.
 * Routes to the correct onboarding step handler.
 */
export async function handleVendorOnboarding(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
): Promise<void> {
  // ── Language instruction check — must be FIRST ────────────────────────────
  // Vendors can say "Tell me in Pidgin" or "Speak Yoruba" at any point during
  // onboarding. We store the preference and confirm in that language, then
  // continue with the current onboarding step so they don't lose progress.
  const switchLang = detectLanguageSwitchRequest(message);
  if (switchLang) {
    await setOnboardingLanguage(phone, switchLang);
    await messageQueue.add({ to: phone, message: ONBOARDING_LANG_CONFIRM[switchLang] });
    return; // don't treat this as a step answer — wait for their next message
  }

  const data = (session.collectedData as unknown as CollectedData) ?? { history: [] };

  // ── Category list tap — inject businessType without an LLM call ──────────────
  // When the vendor taps a category from the list sent at the start of onboarding,
  // the message arrives as "CATEGORY:food" etc. Handle it directly without the LLM.
  if (message.startsWith('CATEGORY:')) {
    const categoryKey = message.slice(9).toLowerCase().trim();
    const VALID_CATEGORIES: Record<string, string> = {
      food: 'food', fashion: 'fashion', beauty: 'beauty', digital: 'digital', general: 'general',
    };
    const resolved = VALID_CATEGORIES[categoryKey];
    if (resolved) {
      const CATEGORY_LABELS: Record<string, string> = {
        food: '🍔 Food & Drinks', fashion: '👗 Fashion & Clothing',
        beauty: '💄 Beauty & Cosmetics', digital: '💻 Digital Products', general: '🛒 General / Other',
      };
      const newData: CollectedData = { ...data, businessType: resolved };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as Prisma.InputJsonValue },
      });
      await messageQueue.add({
        to: phone,
        message:
          `✅ *${CATEGORY_LABELS[resolved]}* — great choice!\n\n` +
          `Now, what's your business called and what do you sell? Give me a short description. 😊`,
      });
      return;
    }
  }

  switch (session.step) {
    case 'COLLECTING_INFO':
      await handleCollectingInfo(phone, message, vendor, session, data);
      break;
    case 'ADDING_PRODUCTS':
      await handleAddingProducts(phone, message, vendor, session, data);
      break;
    case 'PAYMENT_SETUP':
      await handlePaymentSetup(phone, message, vendor, session, data);
      break;
    case 'CONFIRMATION':
      await handleConfirmation(phone, message, vendor, session, data);
      break;
    default:
      // Shouldn't happen — re-show welcome to unstick
      await messageQueue.add({
        to: phone,
        message: `Let's continue setting up your store! Tell me about your business — what do you sell? 😊`,
      });
  }
}

// ─── Step: COLLECTING_INFO ────────────────────────────────────────────────────

async function handleCollectingInfo(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  // Add vendor message to history
  const history: LLMMessage[] = [...(data.history ?? []), { role: 'user', content: message }];

  // Build context strings for the prompt
  const alreadyCollected = Object.entries({
    businessName: data.businessName,
    storeCode: data.storeCode,
    businessType: data.businessType,
    description: data.description,
    workingHours: data.workingHoursStart ? `${data.workingHoursStart}–${data.workingHoursEnd}` : undefined,
    workingDays: data.workingDays,
    paymentMethod: data.paymentMethod,
  })
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(', ') || 'nothing yet';

  const stillNeeded = REQUIRED_INFO_FIELDS
    .filter(f => {
      if (f === 'workingHoursStart' || f === 'workingHoursEnd') return !data.workingHoursStart;
      if (f === 'workingDays') return !data.workingDays;
      return data[f] == null;
    })
    .map(f => f.replace('workingHoursStart', 'workingHours').replace('workingHoursEnd', ''))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    .join(', ') || 'nothing — all done!';

  const conflictNote = data.storeCodeConflict
    ? `\n\nIMPORTANT: The store code "${data.storeCodeConflict}" is already taken by another vendor. Suggest alternatives naturally.`
    : '';

  const systemPrompt = buildCollectingInfoPrompt(alreadyCollected, stillNeeded, conflictNote);

  // Keep history to last 20 exchanges (40 messages) to stay within token limits
  const trimmedHistory = history.slice(-40);

  let llmResponse: string;
  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: trimmedHistory,
    });
    llmResponse = result.content[0].type === 'text' ? result.content[0].text : '';
  } catch (err) {
    logger.error('Onboarding LLM error (COLLECTING_INFO)', { err, phone: maskPhone(phone) });
    await messageQueue.add({
      to: phone,
      message: `Oops, something went sideways on my end. Let's try that again — what were you saying? 😅`,
    });
    return;
  }

  // Parse <extracted> block
  const extractedMatch = llmResponse.match(/<extracted>([\s\S]*?)<\/extracted>/);
  const visibleResponse = llmResponse
    .replace(/<extracted>[\s\S]*?<\/extracted>/g, '')
    .replace(/<ready_for_products\/>/g, '')
    .trim();

  let newData = { ...data };

  if (extractedMatch) {
    try {
      const extracted = JSON.parse(extractedMatch[1].trim());
      newData = mergeExtracted(newData, extracted);

      // Validate store code uniqueness if one was extracted
      if (extracted.storeCode) {
        const code = (extracted.storeCode as string).toUpperCase().replace(/\s+/g, '');
        const existing = await prisma.vendor.findFirst({
          where: { storeCode: code, id: { not: vendor.id } },
        });
        if (existing) {
          newData.storeCode = undefined; // reject the taken code
          newData.storeCodeConflict = code;
        } else {
          newData.storeCode = code;
          newData.storeCodeConflict = undefined;
        }
      }
    } catch (parseErr) {
      logger.warn('Failed to parse <extracted> block', { parseErr });
    }
  }

  // Add assistant response to history
  newData.history = [...trimmedHistory, { role: 'assistant', content: visibleResponse }];

  // Check if LLM signalled all info collected
  const readyForProducts = llmResponse.includes('<ready_for_products/>');
  const allFieldsPresent = REQUIRED_INFO_FIELDS.every(f => {
    if (f === 'workingHoursStart' || f === 'workingHoursEnd') return !!newData.workingHoursStart;
    if (f === 'workingDays') return !!newData.workingDays;
    return newData[f] != null;
  });

  if (readyForProducts && allFieldsPresent) {
    // Persist collected info onto the Vendor record
    await applyCollectedInfoToVendor(vendor.id, newData);

    // Advance to ADDING_PRODUCTS
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: {
        step: 'ADDING_PRODUCTS',
        collectedData: { ...newData, history: [] } as unknown as PrismaJson,
      },
    });

    const catWord  = catalogueWord(newData.businessType);
    const catEmoji = productSectionEmoji(newData.businessType);
    await messageQueue.add({
      to: phone,
      message:
        `${visibleResponse}\n\n` +
        `${catEmoji} *Now let's build your ${catWord}!*\n\n` +
        `How would you like to add your products?`,
      buttons: [
        { id: 'ADD_PRODUCTS_TEXT',   title: '✍️ Type my products' },
        { id: 'ADD_PRODUCTS_SHEET',  title: '📊 Google Sheet'     },
        { id: 'ADD_PRODUCTS_PHOTOS', title: '📸 Send photos'      },
      ] as InteractiveButton[],
    });
  } else {
    // Continue collecting
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await messageQueue.add({ to: phone, message: visibleResponse });
  }
}

// ─── Step: ADDING_PRODUCTS ────────────────────────────────────────────────────

/**
 * Deterministic pipe-separated product line parser.
 *
 * Handles all price formats a Nigerian vendor might send:
 *   ₦21,500   →  21500
 *   21,500    →  21500
 *   ₦21500    →  21500
 *   21500     →  21500
 *   2.5k      →  2500
 *
 * Returns null if ANY line in the input cannot be parsed, so the caller can
 * fall back to LLM extraction for natural-language messages.
 */
function tryParsePipeLines(message: string): ProductInput[] | null {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'));

  if (lines.length === 0) return null;

  const results: ProductInput[] = [];

  for (const line of lines) {
    const parts = line.split('|').map((s) => s.trim());
    const [name, rawPrice, category, description] = parts;

    if (!name || !rawPrice) return null;

    // Strip ₦ symbol, commas, and any stray whitespace, then handle "k" suffix
    let priceStr = rawPrice.replace(/[₦,\s]/g, '');
    if (/^\d+(\.\d+)?k$/i.test(priceStr)) {
      priceStr = String(parseFloat(priceStr) * 1000);
    }

    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return null;

    results.push({
      name,
      price,
      ...(category ? { category } : {}),
      ...(description ? { description } : {}),
    });
  }

  return results.length > 0 ? results : null;
}

async function handleAddingProducts(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const trimmed = message.trim();
  const upper   = trimmed.toUpperCase();
  const products = data.products ?? [];
  const catWord  = catalogueWord(data.businessType);

  // ── 1. Pending confirmation gate ───────────────────────────────────────────
  // When pendingProducts is set, we're waiting for YES or NO before saving.
  if (data.pendingProducts?.length) {
    if (upper === 'CONFIRM_PRODUCTS') {
      const newProducts = [...products, ...data.pendingProducts];
      const isDone = data.pendingIsDone ?? false;
      const newData: CollectedData = {
        ...data,
        products: newProducts,
        pendingProducts: undefined,
        pendingIsDone: undefined,
      };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as PrismaJson },
      });
      const names = data.pendingProducts.map((p) => `*${p.name}*`).join(', ');
      await messageQueue.add({
        to: phone,
        message:
          `✅ ${names} added to your ${catWord}!\n\n` +
          `You now have *${newProducts.length}* item${newProducts.length !== 1 ? 's' : ''} 😊` +
          (!isDone ? `\n\nSend another product or type *DONE* when you're finished.` : ''),
      });
      if (isDone) {
        await advanceToPaymentSetup(phone, vendor, session, newData);
      }
      return;
    }

    if (upper === 'CANCEL_PRODUCTS') {
      const newData: CollectedData = { ...data, pendingProducts: undefined, pendingIsDone: undefined };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as PrismaJson },
      });
      await messageQueue.add({
        to: phone,
        message:
          `No problem! Let's try again.\n\n` +
          `*Product name | Price | Category*\n\n` +
          `Example: ${exampleProductLine(data.businessType)} 😊`,
      });
      return;
    }

    // Anything else — re-show the confirmation so the vendor can tap Yes or No
    await showPendingConfirmation(phone, data.pendingProducts, data.businessType);
    return;
  }

  // ── 2. DONE command ────────────────────────────────────────────────────────
  if (upper === 'DONE' || upper === 'FINISH' || upper === "THAT'S ALL") {
    if (products.length === 0) {
      await messageQueue.add({
        to: phone,
        message: `You haven't added anything to your ${catWord} yet! Send your first product to continue. 😊`,
      });
      return;
    }
    await advanceToPaymentSetup(phone, vendor, session, data);
    return;
  }

  // ── 3. Input-mode selection buttons ───────────────────────────────────────
  if (upper === 'ADD_PRODUCTS_TEXT') {
    const newData: CollectedData = { ...data, productInputMode: 'text' };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await messageQueue.add({
      to: phone,
      message:
        `Great! Send each item like this:\n` +
        `*Product name | Price | Category*\n\n` +
        `Example: ${exampleProductLine(data.businessType)}\n\n` +
        `Or just describe them naturally — I'll extract the details. Type *DONE* when finished 😊`,
    });
    return;
  }

  if (upper === 'ADD_PRODUCTS_SHEET') {
    const newData: CollectedData = { ...data, productInputMode: 'sheet' };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await messageQueue.add({
      to: phone,
      message:
        `📊 *Google Sheets Import*\n\n` +
        `1. Open your sheet\n` +
        `2. Click *Share → Anyone with the link → Viewer*\n` +
        `3. Copy the link and paste it here\n\n` +
        `Your sheet should have columns for *Name, Price, Category* ` +
        `(column order doesn't matter — I'll figure it out). 😊`,
    });
    return;
  }

  if (upper === 'ADD_PRODUCTS_PHOTOS') {
    const newData: CollectedData = { ...data, productInputMode: 'photos' };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await messageQueue.add({
      to: phone,
      message:
        `📸 *Product Photo Upload*\n\n` +
        `Send each product photo one at a time. Add a caption with the *name and price*:\n\n` +
        `_"Ankara Midi Dress - ₦18,000"_\n` +
        `_"Wireless Earbuds - 35000"_\n\n` +
        `I'll read the details and ask you to confirm before saving. ` +
        `Type *DONE* when you've sent everything 😊`,
    });
    return;
  }

  // ── 4. Route by input mode ─────────────────────────────────────────────────
  if (data.productInputMode === 'sheet') {
    await handleSheetImport(phone, trimmed, vendor, session, data);
    return;
  }

  if (data.productInputMode === 'photos') {
    // Vendor is in photo mode but sent text — likely a command or accidental
    await messageQueue.add({
      to: phone,
      message: `📸 Send product photos with a caption. Type *DONE* when finished, or switch to typing:`,
      buttons: [
        { id: 'ADD_PRODUCTS_TEXT', title: '✍️ Switch to Typing' },
        { id: 'DONE',              title: '✅ Done — All Added'  },
      ] as InteractiveButton[],
    });
    return;
  }

  // ── 5. Text mode (default when vendor just starts typing) ─────────────────
  // Set the mode implicitly if no option was selected yet
  if (!data.productInputMode) {
    const newData: CollectedData = { ...data, productInputMode: 'text' };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    data = newData;
  }

  // Try deterministic pipe parser first — no LLM call needed for structured input
  const pipeProducts = tryParsePipeLines(message);
  let extractedProducts: ProductInput[];
  let isDone = false;

  if (pipeProducts !== null) {
    extractedProducts = pipeProducts;
  } else {
    // Natural language — use LLM extraction
    try {
      const result = await anthropic.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 512,
        system: buildProductExtractionPrompt(data.businessType ?? 'general'),
        messages: [{ role: 'user', content: message }],
      });
      const rawText = result.content[0].type === 'text' ? result.content[0].text : '{}';
      const jsonText = rawText.startsWith('```')
        ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
        : rawText.trim();
      const llmResult = JSON.parse(jsonText) as { products: ProductInput[]; isDone: boolean };
      extractedProducts = llmResult.products ?? [];
      isDone = llmResult.isDone ?? false;
    } catch (err) {
      logger.error('Onboarding LLM error (ADDING_PRODUCTS)', { err, phone: maskPhone(phone) });
      await messageQueue.add({
        to: phone,
        message:
          `Hmm, I couldn't read that. Try:\n` +
          `*Product Name | Price | Category*\n\n` +
          `Example: ${exampleProductLine(data.businessType)} 😊`,
      });
      return;
    }
  }

  // Handle partial extraction — ask only for the specific missing piece
  if (extractedProducts.length === 1) {
    const [p] = extractedProducts;
    const missingName  = !p.name  || p.name.trim() === '';
    const missingPrice = !p.price || p.price <= 0;

    if (missingName && !missingPrice) {
      await messageQueue.add({
        to: phone,
        message: `Got a price of *₦${p.price.toLocaleString()}* — what's this product called? 😊`,
      });
      return;
    }
    if (!missingName && missingPrice) {
      await messageQueue.add({
        to: phone,
        message: `Got *${p.name}* — how much does it sell for? 😊`,
      });
      return;
    }
  }

  const validProducts = extractedProducts.filter((p) => p.name?.trim() && p.price > 0);
  if (validProducts.length === 0) {
    await messageQueue.add({
      to: phone,
      message:
        `I couldn't find any products in that message. Try:\n` +
        `*Product Name | Price | Category*\n\n` +
        `Example: ${exampleProductLine(data.businessType)} 😊`,
    });
    return;
  }

  // Store as pending and show confirmation before saving
  const newData: CollectedData = {
    ...data,
    pendingProducts: validProducts,
    pendingIsDone:   isDone || undefined,
  };
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });
  await showPendingConfirmation(phone, validProducts, data.businessType);
}

// ─── Sheet Import ─────────────────────────────────────────────────────────────

async function handleSheetImport(
  phone: string,
  message: string,
  _vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const catWord = catalogueWord(data.businessType);

  // Extract Google Sheets document ID from any valid Sheets URL
  const sheetIdMatch = message.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!sheetIdMatch) {
    await messageQueue.add({
      to: phone,
      message:
        `That doesn't look like a Google Sheets link. It should look like:\n` +
        `_https://docs.google.com/spreadsheets/d/..._\n\n` +
        `Make sure the sheet is set to *"Anyone with the link can view"* first 😊`,
    });
    return;
  }

  const sheetId = sheetIdMatch[1];
  const csvUrl  = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  let csvText: string;
  try {
    const res = await fetch(csvUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csvText = await res.text();
    // Private sheets redirect to a Google accounts page
    if (csvText.includes('accounts.google.com') || csvText.includes('Sign in')) {
      throw new Error('private');
    }
  } catch (err) {
    const isPrivate = (err as Error).message === 'private';
    await messageQueue.add({
      to: phone,
      message: isPrivate
        ? `I couldn't open that sheet — it's set to private.\n\n` +
          `Please go to *Share → Anyone with the link → Viewer*, then paste the link again. 😊`
        : `I couldn't fetch that sheet. Check that the link is correct and the sheet is viewable, then try again. 😊`,
    });
    return;
  }

  const products = parseCsvToProducts(csvText, data.businessType);
  if (products.length === 0) {
    await messageQueue.add({
      to: phone,
      message:
        `I couldn't find any products in that sheet. Make sure it has columns for ` +
        `*Name, Price, and Category*.\n\n` +
        `Column headers can be anything containing those words (e.g. "Product Name", "Selling Price"). 😊`,
    });
    return;
  }

  const newData: CollectedData = { ...data, pendingProducts: products };
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });

  logger.info('Sheet import: extracted products', {
    phone: maskPhone(phone),
    count: products.length,
    catWord,
  });
  await showPendingConfirmation(phone, products, data.businessType);
}

/** Parses a Google Sheets CSV export into ProductInput records. */
function parseCsvToProducts(csv: string, businessType?: string): ProductInput[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headers  = rows[0].map((h) => h.toLowerCase().trim());
  const nameIdx  = headers.findIndex((h) => /name|product|item|title/.test(h));
  const priceIdx = headers.findIndex((h) => /price|cost|amount|rate/.test(h));
  const catIdx   = headers.findIndex((h) => /category|type|kind|dept/.test(h));
  const descIdx  = headers.findIndex((h) => /desc|detail|note|about/.test(h));

  if (nameIdx === -1 || priceIdx === -1) return [];

  const products: ProductInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row      = rows[i];
    const name     = row[nameIdx]?.trim();
    const rawPrice = (row[priceIdx] ?? '').replace(/[₦,\s]/g, '');
    let   price    = parseFloat(rawPrice);
    if (/^\d+(\.\d+)?k$/i.test(rawPrice)) price = parseFloat(rawPrice) * 1000;

    if (!name || isNaN(price) || price <= 0) continue;

    products.push({
      name,
      price,
      category: catIdx !== -1 && row[catIdx]?.trim()
        ? row[catIdx].trim()
        : (businessType ?? 'general'),
      ...(descIdx !== -1 && row[descIdx]?.trim() ? { description: row[descIdx].trim() } : {}),
    });
  }
  return products;
}

/** Minimal RFC-4180 CSV parser — handles quoted fields with embedded commas/newlines. */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let   current: string[] = [];
  let   field    = '';
  let   inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') { field += '"'; i++; }  // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      current.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;  // CRLF
      current.push(field); field = '';
      if (current.some((c) => c.trim())) rows.push(current);
      current = [];
    } else {
      field += ch;
    }
  }
  // flush last row
  if (field || current.length) {
    current.push(field);
    if (current.some((c) => c.trim())) rows.push(current);
  }
  return rows;
}

// ─── Photo Product Handler (called from router for image messages) ─────────────

/**
 * Downloads a product photo from WhatsApp, uploads it to Cloudinary, uses
 * Claude Vision to extract product details from the image + caption, then
 * shows a confirmation preview before saving.
 *
 * Exported so the router can call it when a vendor sends an image in
 * ADDING_PRODUCTS step with productInputMode === 'photos'.
 */
export async function handleVendorProductPhoto(
  phone: string,
  imageMediaId: string,
  caption: string,
  vendor: Vendor,
  session: VendorSetupSession,
): Promise<void> {
  const data = (session.collectedData as unknown as CollectedData) ?? { history: [] };

  // Download from WhatsApp CDN
  let imageBuffer: Buffer;
  try {
    const mediaRes  = await fetch(`https://graph.facebook.com/v19.0/${imageMediaId}`, {
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    });
    if (!mediaRes.ok) throw new Error(`Media URL fetch ${mediaRes.status}`);
    const { url }   = await mediaRes.json() as { url: string };
    const imgRes    = await fetch(url, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
    if (!imgRes.ok) throw new Error(`Image download ${imgRes.status}`);
    imageBuffer = Buffer.from(await imgRes.arrayBuffer());
  } catch (err) {
    logger.error('Failed to download product photo', { err, phone: maskPhone(phone) });
    await messageQueue.add({ to: phone, message: `😅 I couldn't download that photo. Please try sending it again.` });
    return;
  }

  // Upload to Cloudinary
  let imageUrl: string;
  try {
    imageUrl = await uploadProductImageBuffer(imageBuffer, `${vendor.id}-${Date.now()}`);
  } catch (err) {
    logger.error('Failed to upload product photo to Cloudinary', { err, phone: maskPhone(phone) });
    await messageQueue.add({ to: phone, message: `😅 Photo upload failed. Please try sending it again.` });
    return;
  }

  // Claude Vision — extract product details from image + caption
  const imageBase64 = imageBuffer.toString('base64');
  let extracted: { name?: string | null; price?: number | null; category?: string | null } = {};
  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text:
              `This vendor sells ${data.businessType ?? 'products'}. ` +
              `Extract product details from this image.` +
              (caption ? ` The vendor's caption is: "${caption}". Use it as the primary source for name and price.` : '') +
              ` Return ONLY JSON: {"name": "...", "price": 0, "category": "..."}. ` +
              `Price must be a plain number (strip ₦, commas, spaces, the word "naira"). ` +
              `Set a field to null if you cannot confidently extract it.`,
          },
        ],
      }],
    });
    const rawText  = result.content[0].type === 'text' ? result.content[0].text : '{}';
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText.trim();
    extracted = JSON.parse(jsonText);
  } catch (err) {
    logger.error('Claude Vision extraction failed', { err, phone: maskPhone(phone) });
  }

  const name     = typeof extracted.name     === 'string' && extracted.name.trim()  ? extracted.name.trim()  : undefined;
  const price    = typeof extracted.price    === 'number' && extracted.price > 0    ? extracted.price        : undefined;
  const category = typeof extracted.category === 'string' && extracted.category.trim()
    ? extracted.category.trim()
    : (data.businessType ?? 'general');

  // Ask only for the specific missing piece
  if (!name && !price) {
    await messageQueue.add({
      to: phone,
      message:
        `📸 Got the photo! But I couldn't read the details from it.\n\n` +
        `Please add a caption with the product name and price:\n` +
        `_"Ankara Dress - ₦18,000"_`,
    });
    return;
  }
  if (!name) {
    await messageQueue.add({
      to: phone,
      message: `Got a price of *₦${price!.toLocaleString()}* from that photo — what's this product called? 😊`,
    });
    return;
  }
  if (!price) {
    await messageQueue.add({
      to: phone,
      message: `Got *${name}* — how much does it sell for? 😊`,
    });
    return;
  }

  const product: ProductInput = { name, price, category, imageUrl };
  const newData: CollectedData = { ...data, pendingProducts: [product] };
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });
  await showPendingConfirmation(phone, [product], data.businessType);
}

async function advanceToPaymentSetup(
  phone: string,
  _vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: {
      step: 'PAYMENT_SETUP',
      // Clear any paymentMethod already set — we re-ask via buttons
      collectedData: { ...data, paymentMethod: undefined } as unknown as PrismaJson,
    },
  });

  // Always present the two options as Reply Buttons regardless of what was
  // collected during COLLECTING_INFO — this keeps payment setup explicit.
  await messageQueue.add({
    to: phone,
    message:
      `Almost done! 🎉 Let's set up how your customers will pay.\n\n` +
      `*⚡ Paystack Transfer* — Customers transfer to a dedicated virtual account. ` +
      `Payment is confirmed automatically.\n\n` +
      `*🏦 Bank Transfer* — Customers transfer to your regular bank account and ` +
      `you manually confirm receipt.\n\n` +
      `Which would you prefer?`,
    buttons: [
      { id: 'PAYMENT_METHOD:paystack_transfer', title: '⚡ Paystack Transfer' },
      { id: 'PAYMENT_METHOD:bank_transfer',     title: '🏦 Bank Transfer' },
    ] as InteractiveButton[],
  });
}

// ─── Step: PAYMENT_SETUP ──────────────────────────────────────────────────────

/** Classifies vendor intent when we're waiting for a Paystack key. */
async function classifyPaystackIntent(
  message: string,
): Promise<'PROVIDING_KEY' | 'SKIP_PAYSTACK' | 'ASKING_HELP' | 'OTHER'> {
  // Fast paths — no LLM needed
  if (message.startsWith('sk_live_') || message.startsWith('sk_test_')) return 'PROVIDING_KEY';
  if (message.toUpperCase() === 'SKIP PAYSTACK') return 'SKIP_PAYSTACK';
  try {
    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content:
            `A vendor is setting up their WhatsApp store and was asked for their Paystack secret key.\n` +
            `They replied: "${message}"\n\n` +
            `Classify their intent. Reply with exactly one word:\n` +
            `- PROVIDING_KEY   → they are actually giving a Paystack key\n` +
            `- SKIP_PAYSTACK   → they want to skip Paystack and use bank transfer instead\n` +
            `- ASKING_HELP     → they're confused and asking what this is or where to find it\n` +
            `- OTHER           → something else entirely\n\n` +
            `Reply with only the one word, nothing else.`,
        },
      ],
    });
    const raw = (response.content[0] as { type: string; text: string }).text.trim().toUpperCase();
    if (raw === 'PROVIDING_KEY' || raw === 'SKIP_PAYSTACK' || raw === 'ASKING_HELP' || raw === 'OTHER') {
      return raw;
    }
    return 'OTHER';
  } catch {
    // On error, assume they're trying to provide a key — let the format check handle it
    return 'PROVIDING_KEY';
  }
}

async function handlePaymentSetup(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const trimmed = message.trim();

  // ── Step 1: vendor chooses payment method via Reply Button ────────────────
  if (!data.paymentMethod) {
    if (trimmed === 'PAYMENT_METHOD:paystack_transfer') {
      const updatedData: CollectedData = { ...data, paymentMethod: 'paystack' };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: updatedData as unknown as PrismaJson },
      });
      await messageQueue.add({
        to: phone,
        message:
          `Great choice! ⚡\n\n` +
          `Please send your *Paystack Secret Key*.\n\n` +
          `Find it in *Paystack Dashboard → Settings → API Keys*.\n` +
          `It starts with *sk_live_* or *sk_test_*`,
        buttons: [
          { id: 'SKIP PAYSTACK', title: '🏦 Use Bank Only' },
        ] as InteractiveButton[],
      });
      return;
    }
    if (trimmed === 'PAYMENT_METHOD:bank_transfer') {
      const updatedData: CollectedData = { ...data, paymentMethod: 'bank' };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: updatedData as unknown as PrismaJson },
      });
      await messageQueue.add({
        to: phone,
        message:
          `Perfect! 🏦 Send your bank details in this format:\n` +
          `*Bank Name | Account Number | Account Name*\n\n` +
          `Example: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
      });
      return;
    }
    // No choice yet — re-send the buttons
    await messageQueue.add({
      to: phone,
      message: `Please choose your payment method:`,
      buttons: [
        { id: 'PAYMENT_METHOD:paystack_transfer', title: '⚡ Paystack Transfer' },
        { id: 'PAYMENT_METHOD:bank_transfer',     title: '🏦 Bank Transfer' },
      ] as InteractiveButton[],
    });
    return;
  }

  const paymentMethod = data.paymentMethod ?? 'bank';

  // Paystack key
  if (paymentMethod === 'paystack' || paymentMethod === 'both') {
    if (!data.paystackKeyProvided) {
      // ── Intent check BEFORE format validation ────────────────────────────────
      const intent = await classifyPaystackIntent(trimmed);

      if (intent === 'SKIP_PAYSTACK') {
        // Vendor wants bank transfer only — update payment method and ask for bank details
        const updatedData: CollectedData = { ...data, paymentMethod: 'bank', paystackKeyProvided: false };
        await prisma.vendorSetupSession.update({
          where: { id: session.id },
          data: { collectedData: updatedData as unknown as PrismaJson },
        });
        await messageQueue.add({
          to: phone,
          message:
            `No problem! We'll use bank transfer only. ` +
            `Your customers will see your bank details at checkout. ✅\n\n` +
            `Please send your bank details:\n` +
            `*Bank Name | Account Number | Account Name*\n\n` +
            `Example: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
        });
        return;
      }

      if (intent === 'ASKING_HELP') {
        await messageQueue.add({
          to: phone,
          message:
            `Your Paystack Secret Key lets your store accept card payments. 💳\n\n` +
            `*Where to find it:*\n` +
            `Paystack Dashboard → Settings → API Keys\n\n` +
            `It looks like: _sk_live_xxxx..._ or _sk_test_xxxx..._\n\n` +
            `If you don't use Paystack, just reply *"bank transfer only"* and we'll skip this step.`,
        });
        return;
      }

      // PROVIDING_KEY or OTHER — run format validation
      if (!trimmed.startsWith('sk_live_') && !trimmed.startsWith('sk_test_')) {
        await messageQueue.add({
          to: phone,
          message: `That doesn't look like a Paystack key. It should start with *sk_live_* or *sk_test_*. Please try again.`,
        });
        return;
      }

      // Save encrypted Paystack key
      const encryptedKey = encryptBankAccount(trimmed, env.ENCRYPTION_KEY);
      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { paystackSecretKey: encryptedKey },
      });

      const newData = { ...data, paystackKeyProvided: true };

      if (paymentMethod === 'both') {
        // Also collect bank details
        await prisma.vendorSetupSession.update({
          where: { id: session.id },
          data: { collectedData: newData as unknown as PrismaJson },
        });
        await messageQueue.add({
          to: phone,
          message:
            `✅ Paystack key saved!\n\n` +
            `Now send your bank details:\n` +
            `*Bank Name | Account Number | Account Name*`,
        });
        return;
      }

      // paystack-only — advance to confirmation
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { step: 'CONFIRMATION', collectedData: newData as unknown as PrismaJson },
      });
      await showConfirmation(phone, vendor.id, newData);
      return;
    }
  }

  // Bank details — accept | or / as separator, fall back to smart space-split
  let parts: string[] = [];
  if (trimmed.includes('|')) {
    parts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
  } else if (trimmed.includes('/')) {
    parts = trimmed.split('/').map(s => s.trim()).filter(Boolean);
  } else {
    // No separator — try to extract: first word(s) = bank, 10-digit number = account, rest = name
    const acctMatch = trimmed.match(/(\d{10})/);
    if (acctMatch) {
      const acctIdx = trimmed.indexOf(acctMatch[1]);
      const bankPart = trimmed.slice(0, acctIdx).trim();
      const namePart = trimmed.slice(acctIdx + 10).trim();
      if (bankPart && namePart) parts = [bankPart, acctMatch[1], namePart];
    }
  }

  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    await messageQueue.add({
      to: phone,
      message:
        `Please send your bank details in this format:\n` +
        `*Bank Name | Account Number | Account Name*\n\n` +
        `Example: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
    });
    return;
  }

  const [bankName, accountNumber, accountName] = parts as [string, string, string];

  if (!/^\d{10}$/.test(accountNumber)) {
    await messageQueue.add({
      to: phone,
      message: `The account number should be 10 digits. Please check and resend. 😊`,
    });
    return;
  }

  // Confirm before saving
  const newData = { ...data, bankName, bankAccountNumber: accountNumber, bankAccountName: accountName };
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { step: 'CONFIRMATION', collectedData: newData as unknown as PrismaJson },
  });

  await messageQueue.add({
    to: phone,
    message:
      `Got it! Let me confirm:\n` +
      `🏦 *${bankName}*\n` +
      `💳 ${accountNumber}\n` +
      `👤 ${accountName}\n\n` +
      `Is this correct?`,
    buttons: [
      { id: 'YES', title: '✅ Yes, Correct' },
      { id: 'NO',  title: '✏️ Re-enter Details' },
    ] as InteractiveButton[],
  });
}

// ─── Step: CONFIRMATION ───────────────────────────────────────────────────────

async function handleConfirmation(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const upper = message.trim().toUpperCase();

  // "YES" during bank confirmation — show full summary
  if (upper === 'YES' && data.bankAccountNumber && !data.bankName?.startsWith('confirmed:')) {
    const newData = { ...data, bankName: `confirmed:${data.bankName}` };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await showConfirmation(phone, vendor.id, newData);
    return;
  }

  // "GO LIVE" — activate the store
  if (upper === 'GO LIVE') {
    await activateStore(phone, vendor, session, data);
    return;
  }

  // "CHANGE" button — re-show summary and ask what to change
  if (upper === 'CHANGE') {
    await showConfirmation(phone, vendor.id, data);
    await messageQueue.add({
      to: phone,
      message: `What would you like to change? Just tell me and I'll update it. 😊`,
    });
    return;
  }

  // Any other free-text — treat as a change request, re-show summary
  await showConfirmation(phone, vendor.id, data);
  await messageQueue.add({
    to: phone,
    message: `Tell me what you'd like to change and I'll update it for you. 😊`,
  });
}

async function showConfirmation(phone: string, vendorId: string, data: CollectedData): Promise<void> {
  const updatedVendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  const products = data.products ?? [];
  const storeCode = data.storeCode ?? updatedVendor?.storeCode ?? 'YOURCODE';
  const bankDisplay = data.bankName?.replace('confirmed:', '') ?? '—';

  const summary =
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 *${data.businessName ?? updatedVendor?.businessName}*\n` +
    `🔑 Store Code: *${storeCode}*\n` +
    `${businessTypeEmoji(data.businessType)} Type: ${capitalise(data.businessType ?? 'general')}\n` +
    `📦 Products: ${products.length} item${products.length !== 1 ? 's' : ''}\n` +
    `💳 Payment: ${capitalise(data.paymentMethod ?? 'bank')}${data.bankName ? ` (${bankDisplay})` : ''}\n` +
    `🕐 Hours: ${formatHours(data)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Everything look good? Tap *Go Live* to launch your store!`;

  await messageQueue.add({
    to: phone,
    message: summary,
    buttons: [
      { id: 'GO LIVE', title: '🚀 Go Live!'       },
      { id: 'CHANGE',  title: '✏️ Make Changes'   },
    ] as InteractiveButton[],
  });
}

// ─── Activation ───────────────────────────────────────────────────────────────

async function activateStore(
  phone: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  const storeCode = data.storeCode ?? '';

  // Save all collected info in a transaction
  await prisma.$transaction(async (tx) => {
    // 1. Save bank details (encrypted)
    const bankAccountNumber = data.bankAccountNumber
      ? encryptBankAccount(data.bankAccountNumber.replace('confirmed:', ''), env.ENCRYPTION_KEY)
      : null;

    await tx.vendor.update({
      where: { id: vendor.id },
      data: {
        businessName: data.businessName ?? vendor.businessName,
        storeCode: storeCode.toUpperCase(),
        businessType: data.businessType ?? 'general',
        description: data.description,
        workingHoursStart: data.workingHoursStart ?? '08:00',
        workingHoursEnd: data.workingHoursEnd ?? '21:00',
        workingDays: data.workingDays ?? '1,2,3,4,5,6',
        acceptedPayments: data.paymentMethod ?? 'bank',
        bankName: data.bankName?.replace('confirmed:', '') ?? null,
        bankAccountNumber,
        bankAccountName: data.bankAccountName ?? null,
        isActive: true,
        isPaused: false,
      },
    });

    // 2. Create products
    if ((data.products ?? []).length > 0) {
      await tx.product.createMany({
        data: (data.products ?? []).map((p, i) => ({
          vendorId: vendor.id,
          name: p.name,
          price: Math.round(p.price * 100), // to kobo
          category: p.category ?? capitalise(data.businessType ?? 'General'),
          description: p.description ?? null,
          sortOrder: i,
          isAvailable: true,
        })),
      });
    }

    // 3. Create primary notification number
    await tx.vendorNotificationNumber.upsert({
      where: { vendorId_phone: { vendorId: vendor.id, phone } },
      create: { vendorId: vendor.id, phone, label: 'Main', isPrimary: true, isActive: true },
      update: { isPrimary: true, isActive: true },
    });

    // 4. Mark setup session complete
    await tx.vendorSetupSession.update({
      where: { id: session.id },
      data: {
        step: 'COMPLETE',
        completedAt: new Date(),
        collectedData: data as unknown as PrismaJson,
      },
    });
  });

  logger.info('Vendor store activated', { vendorId: vendor.id, storeCode, phone: maskPhone(phone) });

  // Message 1 — celebration + store link
  await messageQueue.add({
    to: phone,
    message:
      `🚀 *${data.businessName} is now LIVE on Pingmart!*\n\n` +
      `🔗 *Your Store Link*\n` +
      `wa.me/${pingmartPhone}?text=${storeCode}\n\n` +
      `_Tap the link to preview your store as a customer_\n\n` +
      `📣 *Share your link on:*\n` +
      `📱 WhatsApp Status\n` +
      `📸 Instagram Bio\n` +
      `🖨️ Business flyers\n` +
      `💬 Customer groups\n\n` +
      `_You can manage your store anytime by messaging this number._`,
  });

  // Message 2 — dashboard list so vendor can act immediately
  await messageQueue.add({
    to: phone,
    message: `What would you like to do first?`,
    listSections: [
      {
        title: '🏪 Manage Your Store',
        rows: [
          { id: 'ADD PRODUCT',    title: '📦 Add Product',     description: `Add a new item to your ${catalogueWord(data.businessType)}` },
          { id: 'REMOVE PRODUCT', title: '🗑️ Remove Product',  description: `Remove an item from your ${catalogueWord(data.businessType)}` },
          { id: 'UPDATE PRICE',   title: '💲 Update Price',    description: 'Change a product\'s price' },
          { id: 'MY ORDERS',      title: '📋 My Orders',       description: 'View and manage recent orders' },
          { id: 'MY LINK',        title: '🔗 My Link',         description: 'Get your shareable store link' },
          { id: 'PAUSE STORE',    title: '⏸️ Pause Store',     description: 'Temporarily stop taking orders' },
          { id: 'NOTIFICATIONS',  title: '🔔 Notifications',   description: 'Manage order alert numbers' },
          { id: 'TEACH BOT',      title: '🧠 Teach Bot',       description: 'Train the bot with your business info' },
          { id: 'SETTINGS',       title: '⚙️ Settings',        description: 'Update hours, payment, bank details' },
        ],
      },
    ],
    listButtonText: '📋 Dashboard',
  });
}

// ─── LLM Prompts ─────────────────────────────────────────────────────────────

function buildCollectingInfoPrompt(
  alreadyCollected: string,
  stillNeeded: string,
  conflictNote: string,
): string {
  return `You are a friendly and warm Pingmart onboarding assistant helping a Nigerian vendor set up their WhatsApp store.

Your personality:
- Warm, encouraging, and conversational
- Use occasional Nigerian expressions naturally (e.g. "oya", "well done", "e go be") but don't overdo it
- Celebrate milestones ("Amazing! Your store is almost ready 🎉")
- Be patient with corrections and changes
- Keep responses SHORT — vendors are on mobile. Max 5 lines per response.

Your job:
Collect the following information through natural conversation. Extract what you can from each response and only ask for what's still missing.

Required information:
1. businessName — the name of their store
2. storeCode — a short unique code (4-10 alphanumeric chars, no spaces) for their store link
3. businessType — one of: food, fashion, beauty, digital, general
4. description — 1-2 sentence description of their business (for customer welcome screen)
5. workingHours — when they're open (start time, end time, which days)
6. paymentMethod — paystack, bank, or both

Already collected: ${alreadyCollected}
Still needed: ${stillNeeded}${conflictNote}

After each vendor message, respond naturally AND include a JSON block at the very end (NOT shown to vendor) with any new data you extracted:

<extracted>
{
  "businessName": "...",
  "storeCode": "...",
  "businessType": "...",
  "description": "...",
  "workingHoursStart": "09:00",
  "workingHoursEnd": "21:00",
  "workingDays": "1,2,3,4,5,6",
  "paymentMethod": "bank"
}
</extracted>

Only include fields you are confident about. Omit fields you're unsure about.

Important rules:
- NEVER make up information the vendor didn't provide
- Always confirm critical details like store code and payment method before moving on
- If vendor wants to change something already collected, update it naturally
- Store codes must be 4-10 alphanumeric characters, no spaces
- If a response is ambiguous, ask a warm follow-up question
- Once ALL required fields are collected AND confirmed, end your response with <ready_for_products/> AFTER the <extracted> block`;
}

function buildProductExtractionPrompt(businessType: string): string {
  // Category-appropriate example so the LLM understands what kind of product to expect
  const examples: Record<string, { name: string; price: number; category: string; description?: string }> = {
    food:    { name: 'Chicken Shawarma',             price: 2500,  category: 'Shawarma',       description: 'Crispy grilled chicken wrap' },
    fashion: { name: 'Ankara Midi Dress',            price: 18000, category: "Women's Clothing"                                           },
    beauty:  { name: 'CeraVe Foaming Cleanser',      price: 21500, category: 'Skincare'                                                   },
    digital: { name: 'Instagram Growth Masterclass', price: 12000, category: 'Digital Course'                                             },
    general: { name: 'Wireless Earbuds',             price: 35000, category: 'Electronics'                                                },
  };
  const ex     = examples[businessType] ?? examples.general;
  const exJson = JSON.stringify(ex, null, 4);

  // Category-specific defaults to help the LLM infer missing categories
  const categoryHints: Record<string, string> = {
    food:    'Main, Drinks, Sides, Desserts, Snacks',
    fashion: 'Tops, Bottoms, Dresses, Accessories, Shoes, Bags',
    beauty:  'Skincare, Makeup, Haircare, Body, Fragrance',
    digital: 'Design, Development, Templates, Courses, Coaching',
    general: 'Electronics, Groceries, Furniture, Services, Other',
  };
  const catHint = categoryHints[businessType] ?? 'General';

  return `You are helping a vendor add products to their Pingmart store (business type: ${businessType}).

Extract product information from the vendor's message. Handle ALL input formats:
- Pipe-separated:  "Name | Price | Category"
- Natural English: "I have a dress called Ankara Midi for 18,000 naira, it's for women"
- Multiple items:  "I sell X for 5000 and Y for 3000, both are business books"
- Pidgin:          "I get one book wey dey go for 9000, na business book"
- Mixed order:     "18,000 for the Ankara Midi Dress, women's clothing category"

Return ONLY valid JSON in this exact format (no other text):
{
  "products": [
    ${exJson}
  ],
  "isDone": false
}

Rules:
- Set isDone: true if vendor says DONE, FINISH, THAT'S ALL, or similar
- Price must always be a plain number. Strip ₦ symbol, commas, spaces, and the word "naira"
- If price has "k" suffix (e.g. "2.5k"), convert to number (2500)
- Typical categories for ${businessType} stores: ${catHint}. Use these when no category is given
- If no description given, omit the field entirely (do not set it to null)
- Extract ALL products mentioned, even if in one message
- If you can extract a name but not a price, include the product with price: 0 so the caller can ask for just the missing price
- If you can extract a price but not a name, include price and set name: "" so the caller can ask for just the name
- Never invent information the vendor did not provide
- If nothing can be extracted, return {"products": [], "isDone": false}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeExtracted(data: CollectedData, extracted: Record<string, unknown>): CollectedData {
  const merged = { ...data };
  const fields: (keyof CollectedData)[] = [
    'businessName', 'storeCode', 'businessType', 'description',
    'workingHoursStart', 'workingHoursEnd', 'workingDays', 'paymentMethod',
  ];
  for (const f of fields) {
    if (extracted[f] != null && extracted[f] !== '') {
      (merged as Record<string, unknown>)[f] = extracted[f];
    }
  }
  return merged;
}

async function applyCollectedInfoToVendor(vendorId: string, data: CollectedData): Promise<void> {
  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      businessName: data.businessName,
      storeCode: data.storeCode?.toUpperCase(),
      businessType: data.businessType ?? 'general',
      description: data.description,
      workingHoursStart: data.workingHoursStart ?? '08:00',
      workingHoursEnd: data.workingHoursEnd ?? '21:00',
      workingDays: data.workingDays ?? '1,2,3,4,5,6',
      acceptedPayments: data.paymentMethod ?? 'both',
    },
  });
}

function formatHours(data: CollectedData): string {
  if (!data.workingHoursStart) return 'Not set';
  const days = parseDays(data.workingDays);
  return `${data.workingHoursStart} – ${data.workingHoursEnd} (${days})`;
}

function parseDays(workingDays?: string): string {
  if (!workingDays) return 'daily';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const nums = workingDays.split(',').map(Number).filter(n => n >= 0 && n <= 6);
  if (nums.length === 7) return 'daily';
  if (nums.length === 5 && !nums.includes(0) && !nums.includes(6)) return 'Mon–Fri';
  if (nums.length === 6 && !nums.includes(0)) return 'Mon–Sat';
  return nums.map(n => names[n]).join(', ');
}

function businessTypeEmoji(type?: string): string {
  const map: Record<string, string> = {
    food: '🍽️', fashion: '👗', beauty: '💄', digital: '💻', general: '🏪',
  };
  return map[type ?? 'general'] ?? '🏪';
}

/**
 * Returns the correct vocabulary word for a vendor's product list based on
 * their business category. Used throughout all onboarding messages so the
 * language always matches the business (menu for food, library for digital,
 * catalogue for everything else).
 */
function catalogueWord(businessType?: string): string {
  switch (businessType) {
    case 'food':    return 'menu';
    case 'digital': return 'library';
    default:        return 'catalogue';
  }
}

/**
 * Returns a realistic, category-appropriate pipe-separated example product
 * line for use in onboarding prompt messages.
 */
function exampleProductLine(businessType?: string): string {
  switch (businessType) {
    case 'food':    return '_Chicken Shawarma | 2,500 | Shawarma | Crispy grilled chicken wrap_';
    case 'fashion': return '_Ankara Midi Dress | 18,000 | Dresses | Vibrant handmade fabric_';
    case 'beauty':  return '_CeraVe Foaming Cleanser | 21,500 | Skincare | Gentle daily face wash_';
    case 'digital': return '_Instagram Growth Masterclass | 12,000 | Digital Course_';
    default:        return '_Wireless Earbuds | 35,000 | Electronics_';
  }
}

/**
 * Returns a contextual emoji for the catalogue-building section header.
 */
function productSectionEmoji(businessType?: string): string {
  const map: Record<string, string> = {
    food: '🍽️', fashion: '👗', beauty: '💄', digital: '💻',
  };
  return map[businessType ?? ''] ?? '🛍️';
}

/**
 * Returns a per-product emoji shown in the confirmation preview.
 */
function productItemEmoji(businessType?: string): string {
  const map: Record<string, string> = {
    food: '🍔', fashion: '👗', beauty: '💄', digital: '📚',
  };
  return map[businessType ?? ''] ?? '📦';
}

/**
 * Sends a confirmation preview of pending extracted products with Yes/No
 * interactive buttons so the vendor can approve before anything is saved.
 */
async function showPendingConfirmation(
  phone: string,
  products: ProductInput[],
  businessType?: string,
): Promise<void> {
  const icon = productItemEmoji(businessType);
  const lines = products.map((p) =>
    [
      `${icon} *${p.name}*`,
      `💰 ₦${p.price.toLocaleString()}`,
      ...(p.category    ? [`📂 ${p.category}`]    : []),
      ...(p.description ? [`📝 ${p.description}`] : []),
    ].join('\n'),
  );

  const body =
    products.length === 1
      ? `Got it! Here's what I'm adding:\n\n${lines[0]}`
      : `Got it! Here's what I'm adding:\n\n` +
        products.map((_, i) => `*${i + 1}.* ${lines[i]}`).join('\n\n');

  await messageQueue.add({
    to: phone,
    message: `${body}\n\nIs this correct?`,
    buttons: [
      { id: 'CONFIRM_PRODUCTS', title: '✅ Yes, Add It'   },
      { id: 'CANCEL_PRODUCTS',  title: '✏️ Fix Details'  },
    ] as InteractiveButton[],
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
