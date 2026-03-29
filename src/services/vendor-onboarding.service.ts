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
import { Vendor, VendorSetupSession, Prisma } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { messageQueue } from '../queues/message.queue';
import { encryptBankAccount } from '../utils/crypto';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';

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

  // Full LLM conversation history (last 20 exchanges max)
  history: LLMMessage[];
}

// ─── Required info fields — all must be present before advancing ──────────────

const REQUIRED_INFO_FIELDS: (keyof CollectedData)[] = [
  'businessName', 'storeCode', 'businessType', 'description',
  'workingHoursStart', 'workingHoursEnd', 'workingDays', 'paymentMethod',
];

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
  const data = (session.collectedData as unknown as CollectedData) ?? { history: [] };

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

    await messageQueue.add({ to: phone, message: visibleResponse });
    await messageQueue.add({
      to: phone,
      message:
        `Now let's build your menu! 🛍️\n\n` +
        `Send your products one by one like this:\n` +
        `*Product name | Price | Category*\n\n` +
        `You can also add a short description:\n` +
        `_Chicken Shawarma | 2500 | Shawarma | Crispy grilled chicken wrap_\n\n` +
        `Or list multiple in one message:\n` +
        `_"I have chicken shawarma for 2500 and beef for 2000"_\n\n` +
        `Type *DONE* when you've added everything 😊`,
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

async function handleAddingProducts(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const trimmed = message.trim().toUpperCase();
  const products = data.products ?? [];

  // DONE command — advance to payment setup
  if (trimmed === 'DONE' || trimmed === 'FINISH' || trimmed === "THAT'S ALL") {
    if (products.length === 0) {
      await messageQueue.add({
        to: phone,
        message: `You haven't added any products yet! Send your first product to continue. 😊`,
      });
      return;
    }
    await advanceToPaymentSetup(phone, vendor, session, data);
    return;
  }

  // Use LLM to extract products from this message
  let extracted: { products: ProductInput[]; isDone: boolean };
  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 512,
      system: buildProductExtractionPrompt(data.businessType ?? 'general'),
      messages: [{ role: 'user', content: message }],
    });
    const text = result.content[0].type === 'text' ? result.content[0].text : '{}';
    extracted = JSON.parse(text.trim());
  } catch (err) {
    logger.error('Onboarding LLM error (ADDING_PRODUCTS)', { err, phone: maskPhone(phone) });
    await messageQueue.add({
      to: phone,
      message: `Hmm, I couldn't read that product format. Try: *Product Name | Price | Category* 😊`,
    });
    return;
  }

  const newProducts = [...products, ...(extracted.products ?? [])];

  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: { ...data, products: newProducts } as unknown as PrismaJson },
  });

  const names = (extracted.products ?? []).map(p => `*${p.name}* — ₦${p.price.toLocaleString()}`).join('\n');
  await messageQueue.add({
    to: phone,
    message:
      `✅ Added:\n${names}\n\n` +
      `You have *${newProducts.length}* product${newProducts.length !== 1 ? 's' : ''} so far.\n\n` +
      `Send another product or type *DONE* when you're finished. 😊`,
  });

  if (extracted.isDone) {
    await advanceToPaymentSetup(phone, vendor, session, { ...data, products: newProducts });
  }
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
      collectedData: data as unknown as PrismaJson,
    },
  });

  const paymentMethod = data.paymentMethod ?? 'bank';

  if (paymentMethod === 'paystack' || paymentMethod === 'both') {
    await messageQueue.add({
      to: phone,
      message:
        `Almost done! Let's set up payments. 💳\n\n` +
        `Please send your *Paystack Secret Key*.\n\n` +
        `You'll find it in *Paystack Dashboard → Settings → API Keys*.\n` +
        `It starts with *sk_live_* or *sk_test_*`,
    });
  } else {
    await messageQueue.add({
      to: phone,
      message:
        `Almost done! Let's set up your bank details. 🏦\n\n` +
        `Send them like this:\n` +
        `*Bank Name | Account Number | Account Name*\n\n` +
        `Example:\n` +
        `_GTBank | 0123456789 | Mallam Ahmed Suya_`,
    });
  }
}

// ─── Step: PAYMENT_SETUP ──────────────────────────────────────────────────────

async function handlePaymentSetup(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: CollectedData,
): Promise<void> {
  const paymentMethod = data.paymentMethod ?? 'bank';
  const trimmed = message.trim();

  // Paystack key
  if (paymentMethod === 'paystack' || paymentMethod === 'both') {
    if (!data.paystackKeyProvided) {
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

  // Bank details — expect "Bank | Account | Name" format
  const parts = trimmed.split('|').map(s => s.trim());
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
      `Is this correct? Reply *YES* to continue or send the correct details.`,
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

  // Vendor wants to change something — re-show summary with instruction
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
    `Reply *GO LIVE* to activate your store\n` +
    `or tell me anything you'd like to change.`;

  await messageQueue.add({ to: phone, message: summary });
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

  await messageQueue.add({
    to: phone,
    message:
      `🚀 *${data.businessName}* is now *LIVE* on Pingmart!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Your Store Link:*\n` +
      `wa.me/${pingmartPhone}?text=${storeCode}\n\n` +
      `Share this link on:\n` +
      `📱 WhatsApp Status\n` +
      `📸 Instagram Bio\n` +
      `🖨️ Business flyers\n` +
      `💬 Customer groups\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Manage your store anytime:*\n` +
      `📦 ADD PRODUCT\n` +
      `🗑️ REMOVE PRODUCT\n` +
      `💰 UPDATE PRICE\n` +
      `📋 MY ORDERS\n` +
      `⏸️ PAUSE STORE\n` +
      `🔗 MY LINK\n` +
      `⚙️ SETTINGS`,
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
  return `You are helping a vendor add products to their Pingmart store (business type: ${businessType}).

Extract product information from the vendor's message. Handle flexible formats.

Return ONLY valid JSON in this exact format (no other text):
{
  "products": [
    {
      "name": "Chicken Shawarma",
      "price": 2500,
      "category": "Shawarma",
      "description": "Crispy grilled chicken wrap"
    }
  ],
  "isDone": false
}

Rules:
- Set isDone: true if vendor says DONE, FINISH, THAT'S ALL, or similar
- If price has "k" suffix (e.g. "2.5k"), convert to number (2500)
- If no category given, use the business type as default
- If no description given, omit the field (do not include it as null)
- Extract multiple products if mentioned in one message
- Never invent information not provided by the vendor
- If no products can be extracted (e.g. vendor just said something unrelated), return {"products": [], "isDone": false}`;
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

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
