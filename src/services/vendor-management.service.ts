/**
 * Vendor Management Service — Phase 5 + 7
 *
 * Handles all vendor dashboard commands once onboarding is complete.
 * Active vendor command state is tracked in Redis with a 30-min TTL.
 *
 * Entry point: handleVendorDashboard(phone, message, vendor)
 *
 * Commands:
 *   ADD PRODUCT      — add a new product to the menu
 *   REMOVE PRODUCT   — remove an existing product
 *   UPDATE PRICE     — change a product's price
 *   MY ORDERS        — view recent orders; reply with short ID for details
 *   MY LINK          — show shareable store deep-link
 *   PAUSE STORE      — pause the store (customers see "not taking orders")
 *   RESUME STORE     — un-pause the store
 *   NOTIFICATIONS    — manage order alert numbers (ADD NUMBER / REMOVE NUMBER)
 *   SETTINGS         — update business name, description, hours, payment, bank, store code
 *   TEACH BOT        — train the bot with business context, FAQs, special instructions
 *
 * Order status commands (CONFIRM/PREPARING/READY/DELIVERED/CANCEL ORD-XXXXX)
 * always bypass the state machine and delegate to physicalDelivery.service.
 */
import { Vendor } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { redis } from '../utils/redis';
import { productRepository } from '../repositories/product.repository';
import { orderRepository } from '../repositories/order.repository';
import { messageQueue } from '../queues/message.queue';
import { handleVendorStatusCommand } from './delivery/physicalDelivery.service';
import {
  formatNaira,
  nairaToKobo,
  formatOrderId,
  normalisePhone,
  formatTimestamp,
} from '../utils/formatters';
import { encryptBankAccount } from '../utils/crypto';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';
import { ProductType, OrderStatus, InteractiveButton, InteractiveListSection } from '../types';
import { extractBusinessFacts, classifyVendorDashboardIntent } from './llm.service';
import { resolveEscalation } from './escalation.service';

// ─── Plan Limits ──────────────────────────────────────────────────────────────

const PLAN_LIMITS: Record<string, { notificationNumbers: number; products: number }> = {
  free:    { notificationNumbers: 1,   products: 5   },
  starter: { notificationNumbers: 3,   products: 20  },
  growth:  { notificationNumbers: 10,  products: 999 },
  pro:     { notificationNumbers: 999, products: 999 },
};

function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['free']!;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<string, string> = {
  PENDING_PAYMENT:   '⏳',
  PAYMENT_CONFIRMED: '💳',
  CONFIRMED:         '✅',
  PREPARING:         '👨‍🍳',
  READY:             '🚀',
  OUT_FOR_DELIVERY:  '🚚',
  DELIVERED:         '✅',
  DIGITAL_SENT:      '📦',
  CANCELLED:         '❌',
};

/** Order-status update commands always bypass the dashboard state machine */
const STATUS_CMDS = new Set(['CONFIRM', 'PREPARING', 'READY', 'DELIVERED', 'CANCEL', 'REJECT', 'CONTACT']);
function isStatusCommand(norm: string): boolean {
  const [cmd] = norm.split(' ');
  return !!cmd && STATUS_CMDS.has(cmd) && norm.includes(' ');
}

async function send(phone: string, message: string): Promise<void> {
  await messageQueue.add({ to: phone, message });
}

async function sendButtons(phone: string, message: string, buttons: InteractiveButton[]): Promise<void> {
  await messageQueue.add({ to: phone, message, buttons });
}

async function sendList(
  phone: string,
  message: string,
  sections: InteractiveListSection[],
  buttonText: string,
  header?: string,
): Promise<void> {
  await messageQueue.add({ to: phone, message, listSections: sections, listButtonText: buttonText, listHeader: header });
}

// ─── Redis State ──────────────────────────────────────────────────────────────

const STATE_TTL_SECS = 30 * 60;
const stateKey = (phone: string) => `vendor:cmd:${phone}`;

interface VendorCmdState {
  step: string;
  productId?: string;
  productName?: string;
  productPrice?: number; // kobo
}

async function getVendorState(phone: string): Promise<VendorCmdState | null> {
  const raw = await redis.get(stateKey(phone));
  return raw ? (JSON.parse(raw) as VendorCmdState) : null;
}

async function setVendorState(phone: string, state: VendorCmdState): Promise<void> {
  await redis.setex(stateKey(phone), STATE_TTL_SECS, JSON.stringify(state));
}

async function clearVendorState(phone: string): Promise<void> {
  await redis.del(stateKey(phone));
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function handleVendorDashboard(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const norm = message.trim().toUpperCase().replace(/\s+/g, ' ');

  // Order status updates (CONFIRM ORD-..., PREPARING ORD-..., etc.) always win
  if (isStatusCommand(norm)) {
    await clearVendorState(phone);
    await handleVendorStatusCommand(phone, message);
    return;
  }

  const state = await getVendorState(phone);
  if (state) {
    await handleStateReply(phone, message, norm, vendor, state);
    return;
  }

  await handleTopLevelCommand(phone, message, norm, vendor);
}

// ─── Top-Level Command Dispatch ───────────────────────────────────────────────

async function handleTopLevelCommand(
  phone: string,
  rawMessage: string,
  norm: string,
  vendor: Vendor,
): Promise<void> {
  switch (norm) {
    case 'HANDLED':
      await resolveEscalation(phone, vendor);
      return;
    case 'ADD PRODUCT':
      return startAddProduct(phone, vendor);
    case 'REMOVE PRODUCT':
      return startRemoveProduct(phone, vendor);
    case 'UPDATE PRICE':
      return startUpdatePrice(phone, vendor);
    case 'MY ORDERS':
      return showMyOrders(phone, vendor);
    case 'MY LINK':
      return showMyLink(phone, vendor);
    case 'PAUSE STORE':
      return pauseStore(phone, vendor);
    case 'RESUME STORE':
      return resumeStore(phone, vendor);
    case 'NOTIFICATIONS':
      return startNotifications(phone, vendor);
    case 'SETTINGS':
      return startSettings(phone, vendor);
    case 'TEACH BOT':
      return startTeachBot(phone, vendor);
    default: {
      // Try to understand natural language before falling back to dashboard
      const intent = await classifyVendorDashboardIntent(rawMessage);
      const INTENT_MAP: Record<string, string> = {
        ADD_PRODUCT:    'ADD PRODUCT',
        REMOVE_PRODUCT: 'REMOVE PRODUCT',
        UPDATE_PRICE:   'UPDATE PRICE',
        MY_ORDERS:      'MY ORDERS',
        MY_LINK:        'MY LINK',
        PAUSE_STORE:    vendor.isPaused ? 'RESUME STORE' : 'PAUSE STORE',
        RESUME_STORE:   'RESUME STORE',
        NOTIFICATIONS:  'NOTIFICATIONS',
        SETTINGS:       'SETTINGS',
        TEACH_BOT:      'TEACH BOT',
      };
      const mapped = INTENT_MAP[intent];
      if (mapped) {
        return handleTopLevelCommand(phone, rawMessage, mapped, vendor);
      }
      return showDashboard(phone, vendor);
    }
  }
}

// ─── In-State Reply Dispatch ──────────────────────────────────────────────────

async function handleStateReply(
  phone: string,
  message: string,
  norm: string,
  vendor: Vendor,
  state: VendorCmdState,
): Promise<void> {
  // Universal escape: CANCEL / BACK / DASHBOARD always return to the dashboard
  if (norm === 'CANCEL' || norm === 'BACK' || norm === 'DASHBOARD') {
    await clearVendorState(phone);
    await showDashboard(phone, vendor);
    return;
  }

  switch (state.step) {
    case 'ADD_PRODUCT':
      return completeAddProduct(phone, message, vendor);
    case 'REMOVE_PRODUCT_LIST':
      return selectRemoveProduct(phone, norm, vendor);
    case 'REMOVE_PRODUCT_CONFIRM':
      return confirmRemoveProduct(phone, norm, vendor, state);
    case 'UPDATE_PRICE_LIST':
      return selectUpdatePrice(phone, norm, vendor);
    case 'UPDATE_PRICE_ENTER':
      return completeUpdatePrice(phone, norm, vendor, state);
    case 'MY_ORDERS':
      return replyToMyOrders(phone, norm, vendor);
    case 'NOTIFICATIONS':
      return handleNotificationsCommand(phone, message, vendor);
    case 'SETTINGS_MENU':
      return handleSettingsChoice(phone, norm, vendor);
    case 'SETTINGS_NAME':
      return completeSettingsName(phone, message, vendor);
    case 'SETTINGS_DESCRIPTION':
      return completeSettingsDescription(phone, message, vendor);
    case 'SETTINGS_HOURS':
      return completeSettingsHours(phone, message, vendor);
    case 'SETTINGS_PAYMENT':
      return completeSettingsPayment(phone, norm, vendor);
    case 'SETTINGS_BANK':
      return completeSettingsBank(phone, message, vendor);
    case 'SETTINGS_CODE':
      return completeSettingsCode(phone, message, vendor);
    case 'TEACH_BOT':
      return handleTeachBotReply(phone, message, norm, vendor);
    default:
      await clearVendorState(phone);
      return showDashboard(phone, vendor);
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function showDashboard(phone: string, vendor: Vendor): Promise<void> {
  const storeToggleId    = vendor.isPaused ? 'RESUME STORE' : 'PAUSE STORE';
  const storeToggleTitle = vendor.isPaused ? '▶️ Resume Store' : '⏸️ Pause Store';

  await messageQueue.add({
    to: phone,
    message: `👋 Welcome back, *${vendor.businessName}*!\n\nWhat would you like to do?`,
    listSections: [
      {
        title: '📦 Products & Orders',
        rows: [
          { id: 'ADD PRODUCT',    title: '📦 Add Product',    description: 'Add a new item to your menu'         },
          { id: 'REMOVE PRODUCT', title: '🗑️ Remove Product',  description: 'Remove an item from your menu'       },
          { id: 'UPDATE PRICE',   title: '💰 Update Price',   description: 'Change the price of an item'         },
          { id: 'MY ORDERS',      title: '📋 My Orders',      description: 'View and manage recent orders'       },
          { id: 'MY LINK',        title: '🔗 My Store Link',  description: 'Get your shareable store link'       },
        ],
      },
      {
        title: '⚙️ Store Settings',
        rows: [
          { id: storeToggleId,   title: storeToggleTitle,       description: vendor.isPaused ? 'Reopen your store' : 'Temporarily pause orders' },
          { id: 'NOTIFICATIONS', title: '🔔 Notifications',     description: 'Manage order alert numbers'          },
          { id: 'SETTINGS',      title: '⚙️ Settings',          description: 'Update store info and payment'       },
          { id: 'TEACH BOT',     title: '🧠 Teach Bot',         description: 'Add FAQs and business context'       },
        ],
      },
    ],
    listButtonText: 'Open Menu',
    listHeader: `🛍️ ${vendor.businessName} Dashboard`,
  });
}

// ─── ADD PRODUCT ──────────────────────────────────────────────────────────────

async function startAddProduct(phone: string, vendor: Vendor): Promise<void> {
  const limit = getPlanLimits(vendor.plan);
  const count = await prisma.product.count({ where: { vendorId: vendor.id, isAvailable: true } });
  if (count >= limit.products) {
    await send(
      phone,
      `⚠️ You've reached the *${limit.products}-product* limit on your *${vendor.plan}* plan.\n\n` +
      `Upgrade your plan to add more products.\n\nType *DASHBOARD* to go back.`,
    );
    return;
  }

  await setVendorState(phone, { step: 'ADD_PRODUCT' });
  await send(
    phone,
    `📦 *Add a Product*\n\n` +
    `Send your product details in this format:\n` +
    `*Name | Price (₦) | Category | Description (optional)*\n\n` +
    `Example:\n` +
    `Turkey Shawarma | 3500 | Shawarma | Crispy grilled chicken shawarma\n\n` +
    `Type *CANCEL* to go back.`,
  );
}

async function completeAddProduct(phone: string, message: string, vendor: Vendor): Promise<void> {
  const parts = message.split('|').map((p) => p.trim());
  const [name, priceStr, category, description] = parts;

  if (!name || !priceStr) {
    await send(
      phone,
      `❌ Please use the format: *Name | Price | Category | Description*\n\n` +
      `Example: Chicken Suya | 2000 | Grill\n\nTry again or type *CANCEL*.`,
    );
    return;
  }

  const priceNaira = parseInt(priceStr, 10);
  if (isNaN(priceNaira) || priceNaira <= 0) {
    await send(
      phone,
      `❌ Invalid price "*${priceStr}*". Please enter a number (e.g. 2500).\n\nTry again or type *CANCEL*.`,
    );
    return;
  }

  const product = await productRepository.create(vendor.id, {
    name,
    price: nairaToKobo(priceNaira),
    category: category || 'General',
    description: description || undefined,
    productType: ProductType.PHYSICAL,
  });

  await clearVendorState(phone);
  const totalCount = await prisma.product.count({ where: { vendorId: vendor.id, isAvailable: true } });
  logger.info('Vendor added product', { vendorId: vendor.id, productId: product.id });
  await send(
    phone,
    `✅ Added *${product.name}* — ${formatNaira(product.price)} to your menu!\n` +
    `Your store now has ${totalCount} product${totalCount === 1 ? '' : 's'}.`,
  );
}

// ─── REMOVE PRODUCT ───────────────────────────────────────────────────────────

async function startRemoveProduct(phone: string, vendor: Vendor): Promise<void> {
  const products = await productRepository.findAllByVendor(vendor.id);
  if (!products.length) {
    await send(phone, `You don't have any products yet.\n\nType *ADD PRODUCT* to add your first one.`);
    return;
  }

  await setVendorState(phone, { step: 'REMOVE_PRODUCT_LIST' });
  await sendList(
    phone,
    `🗑️ *Remove a Product*\n\nWhich product would you like to remove?`,
    [{
      title: 'Your Products',
      rows: products.map((p) => ({
        id: p.id,
        title: p.name.slice(0, 24),
        description: `${formatNaira(p.price)}${p.isAvailable ? '' : ' · hidden'}`,
      })),
    }],
    'Select Product',
    '🗑️ Remove Product',
  );
}

async function selectRemoveProduct(phone: string, norm: string, vendor: Vendor): Promise<void> {
  const products = await productRepository.findAllByVendor(vendor.id);

  // First try direct product-ID match (list-message tap); fall back to legacy numeric index
  let product = products.find((p) => p.id === norm);
  if (!product) {
    const idx = parseInt(norm, 10);
    product = products[idx - 1];
  }

  if (!product) {
    await send(phone, `❌ Invalid selection. Please choose from the list or type *CANCEL*.`);
    return;
  }

  await setVendorState(phone, {
    step: 'REMOVE_PRODUCT_CONFIRM',
    productId: product.id,
    productName: product.name,
    productPrice: product.price,
  });
  await sendButtons(
    phone,
    `Remove *${product.name}* — ${formatNaira(product.price)} from your menu?`,
    [
      { id: 'YES', title: '🗑️ Yes, Remove' },
      { id: 'NO', title: '↩️ Keep It' },
    ],
  );
}

async function confirmRemoveProduct(
  phone: string,
  norm: string,
  vendor: Vendor,
  state: VendorCmdState,
): Promise<void> {
  if (norm === 'YES' && state.productId) {
    await productRepository.delete(state.productId);
    await clearVendorState(phone);
    logger.info('Vendor removed product', { vendorId: vendor.id, productId: state.productId });
    await send(phone, `✅ *${state.productName}* has been removed from your menu.`);
    return;
  }
  await clearVendorState(phone);
  await send(phone, `Cancelled. *${state.productName}* is still on your menu.`);
}

// ─── UPDATE PRICE ─────────────────────────────────────────────────────────────

async function startUpdatePrice(phone: string, vendor: Vendor): Promise<void> {
  const products = await productRepository.findAllByVendor(vendor.id);
  if (!products.length) {
    await send(phone, `You don't have any products yet. Type *ADD PRODUCT* to add one.`);
    return;
  }

  await setVendorState(phone, { step: 'UPDATE_PRICE_LIST' });
  await sendList(
    phone,
    `💰 *Update a Price*\n\nWhich product's price would you like to change?`,
    [{
      title: 'Your Products',
      rows: products.map((p) => ({
        id: p.id,
        title: p.name.slice(0, 24),
        description: `Current price: ${formatNaira(p.price)}`,
      })),
    }],
    'Select Product',
    '💰 Update Price',
  );
}

async function selectUpdatePrice(phone: string, norm: string, vendor: Vendor): Promise<void> {
  const products = await productRepository.findAllByVendor(vendor.id);

  // First try direct product-ID match (list-message tap); fall back to legacy numeric index
  let product = products.find((p) => p.id === norm);
  if (!product) {
    const idx = parseInt(norm, 10);
    product = products[idx - 1];
  }

  if (!product) {
    await send(phone, `❌ Invalid selection. Please choose from the list or type *CANCEL*.`);
    return;
  }

  await setVendorState(phone, {
    step: 'UPDATE_PRICE_ENTER',
    productId: product.id,
    productName: product.name,
    productPrice: product.price,
  });
  await send(
    phone,
    `*${product.name}* is currently ${formatNaira(product.price)}.\n` +
    `What's the new price? (in ₦, e.g. 3000)\n\nType *CANCEL* to go back.`,
  );
}

async function completeUpdatePrice(
  phone: string,
  norm: string,
  vendor: Vendor,
  state: VendorCmdState,
): Promise<void> {
  const priceNaira = parseInt(norm, 10);
  if (isNaN(priceNaira) || priceNaira <= 0) {
    await send(phone, `❌ Invalid price. Enter a number in ₦ (e.g. 3000). Try again or type *CANCEL*.`);
    return;
  }

  const newPrice = nairaToKobo(priceNaira);
  const oldPrice = state.productPrice ?? 0;

  await productRepository.update(state.productId!, { price: newPrice });
  await clearVendorState(phone);
  logger.info('Vendor updated product price', { vendorId: vendor.id, productId: state.productId });
  await send(
    phone,
    `✅ *${state.productName}* price updated from ${formatNaira(oldPrice)} to ${formatNaira(newPrice)}.`,
  );
}

// ─── MY ORDERS ────────────────────────────────────────────────────────────────

async function showMyOrders(phone: string, vendor: Vendor, filter?: 'PENDING'): Promise<void> {
  const queryFilter = filter === 'PENDING' ? { status: OrderStatus.PAYMENT_CONFIRMED } : {};
  const { orders } = await orderRepository.findByVendor(vendor.id, { ...queryFilter, limit: 10 });

  await setVendorState(phone, { step: 'MY_ORDERS' });

  if (!orders.length) {
    const hint = filter === 'PENDING'
      ? `No pending orders right now. Type *MY ORDERS* for all orders.`
      : `No orders yet. Share your store link to start receiving orders!\n\nType *MY LINK* to get it.`;
    await send(phone, `📋 *${vendor.businessName}* — No orders found.\n\n${hint}`);
    return;
  }

  const lines = orders.map((o) => {
    const emoji = STATUS_EMOJI[o.status] ?? '📦';
    const name = o.customer.name ?? 'Customer';
    return `${formatOrderId(o.id)} — ${name} — ${formatNaira(o.totalAmount)} — ${emoji} ${o.status.replace(/_/g, ' ')}`;
  });

  await send(
    phone,
    `📋 *Recent Orders — ${vendor.businessName}*\n\n` +
    lines.join('\n') +
    `\n\nReply with an order ID (e.g. *A3F9B2*) for full details.\n` +
    `Type *PENDING* to see only orders awaiting confirmation.`,
  );
}

async function replyToMyOrders(phone: string, norm: string, vendor: Vendor): Promise<void> {
  if (norm === 'PENDING') {
    await showMyOrders(phone, vendor, 'PENDING');
    return;
  }

  // Match 6-char alphanumeric short ID (may be prefixed with ORD- or #)
  const shortId = norm.replace(/^(ORD-|#)/, '').trim();
  if (/^[A-Z0-9]{6}$/.test(shortId)) {
    const { orders } = await orderRepository.findByVendor(vendor.id, { limit: 100 });
    const order = orders.find((o) => o.id.slice(-6).toUpperCase() === shortId);

    if (order) {
      const itemLines = order.orderItems
        .map((oi) => `• ${oi.quantity}x ${oi.product.name} — ${formatNaira(oi.unitPrice * oi.quantity)}`)
        .join('\n');
      const customerName = order.customer.name ?? 'Customer';
      const maskedPhone = order.customer.whatsappNumber.replace(/(\+\d{3})\d+(\d{4})/, '$1***$2');
      const addr = (order as any).deliveryAddress ?? 'Not provided';
      const emoji = STATUS_EMOJI[order.status] ?? '📦';

      const ordShortId = formatOrderId(order.id);
      const actionButtons: InteractiveButton[] = (() => {
        switch (order.status) {
          case 'PAYMENT_CONFIRMED':
            return [
              { id: `CONFIRM ${ordShortId}`,   title: '✅ Confirm'   },
              { id: `REJECT ${ordShortId}`,    title: '❌ Reject'    },
              { id: `CONTACT ${ordShortId}`,   title: '📞 Contact'   },
            ];
          case 'CONFIRMED':
            return [{ id: `PREPARING ${ordShortId}`, title: '👨‍🍳 Mark Preparing' }];
          case 'PREPARING':
            return [{ id: `READY ${ordShortId}`, title: '🚀 Mark Ready' }];
          case 'READY':
            return [{ id: `DELIVERED ${ordShortId}`, title: '✅ Mark Delivered' }];
          default:
            return [];
        }
      })();

      const detailMsg =
        `📋 *Order ${ordShortId}*\n\n` +
        `Customer: ${customerName} (${maskedPhone})\n` +
        `Items:\n${itemLines}\n\n` +
        `Total: *${formatNaira(order.totalAmount)}*\n` +
        `Address: ${addr}\n` +
        `Status: ${emoji} *${order.status.replace(/_/g, ' ')}*\n` +
        `Time: ${formatTimestamp(order.createdAt)}`;

      if (actionButtons.length) {
        await sendButtons(phone, detailMsg, actionButtons);
      } else {
        await send(phone, detailMsg);
      }
      return;
    }
  }

  // Unrecognised reply — fall back to dashboard
  await clearVendorState(phone);
  await showDashboard(phone, vendor);
}

// ─── MY LINK ──────────────────────────────────────────────────────────────────

async function showMyLink(phone: string, vendor: Vendor): Promise<void> {
  if (!vendor.storeCode) {
    await send(phone, `⚠️ Your store doesn't have a code yet. Set one via *SETTINGS* → 6.`);
    return;
  }

  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  await send(
    phone,
    `🔗 *Your Pingmart Store Link:*\n\n` +
    `wa.me/${pingmartPhone}?text=${vendor.storeCode}\n\n` +
    `Share this everywhere — customers tap it and land directly in your store on WhatsApp! 🛍️`,
  );
}

// ─── PAUSE / RESUME STORE ─────────────────────────────────────────────────────

async function pauseStore(phone: string, vendor: Vendor): Promise<void> {
  if (vendor.isPaused) {
    await send(phone, `⏸️ *${vendor.businessName}* is already paused.\n\nType *RESUME STORE* to go live again.`);
    return;
  }
  await prisma.vendor.update({ where: { id: vendor.id }, data: { isPaused: true } });
  logger.info('Vendor paused store', { vendorId: vendor.id });
  await send(
    phone,
    `⏸️ *${vendor.businessName}* is now PAUSED.\n\n` +
    `Customers will see a "not taking orders" message.\n` +
    `Type *RESUME STORE* to go live again.`,
  );
}

async function resumeStore(phone: string, vendor: Vendor): Promise<void> {
  if (!vendor.isPaused) {
    await send(phone, `▶️ *${vendor.businessName}* is already live! Customers can order now. 🎉`);
    return;
  }
  await prisma.vendor.update({ where: { id: vendor.id }, data: { isPaused: false } });
  logger.info('Vendor resumed store', { vendorId: vendor.id });
  await send(
    phone,
    `▶️ *${vendor.businessName}* is now LIVE! 🎉\n\nCustomers can start ordering again.`,
  );
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

async function startNotifications(phone: string, vendor: Vendor): Promise<void> {
  await setVendorState(phone, { step: 'NOTIFICATIONS' });
  await showNotifications(phone, vendor);
}

async function showNotifications(phone: string, vendor: Vendor): Promise<void> {
  const numbers = await prisma.vendorNotificationNumber.findMany({
    where: { vendorId: vendor.id, isActive: true },
    orderBy: { isPrimary: 'desc' },
  });

  const limit = getPlanLimits(vendor.plan);
  const numLines = numbers.length
    ? numbers
        .map((n, i) => `${i + 1}. ${n.phone}${n.label ? ` — ${n.label}` : ''}${n.isPrimary ? ' (primary) ✅' : ''}`)
        .join('\n')
    : 'No notification numbers set up yet.';

  await send(
    phone,
    `🔔 *Notification Numbers — ${vendor.businessName}*\n\n` +
    `Numbers that receive order alerts:\n${numLines}\n\n` +
    `Plan: ${vendor.plan} (${numbers.length}/${limit.notificationNumbers} numbers used)\n\n` +
    `*ADD NUMBER | +234XXXXXXXXX | Label* — add a number\n` +
    `*REMOVE NUMBER | +234XXXXXXXXX* — remove a number\n\n` +
    `Type *BACK* to return to the dashboard.`,
  );
}

async function handleNotificationsCommand(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const norm = message.trim().toUpperCase().replace(/\s+/g, ' ');

  // ── ADD NUMBER ──────────────────────────────────────────────────────────────
  if (norm.startsWith('ADD NUMBER')) {
    const parts = message.trim().split('|').map((p) => p.trim());
    // "ADD NUMBER | +234... | Label" — the first part contains "ADD NUMBER"
    const rawPhone = parts[1];
    const label = parts[2] ?? null;

    if (!rawPhone) {
      await send(
        phone,
        `❌ Please use the format:\n*ADD NUMBER | +234XXXXXXXXX | Label*\n\nTry again or type *BACK*.`,
      );
      return;
    }

    const normPhone = normalisePhone(rawPhone);
    if (!/^\+\d{10,15}$/.test(normPhone)) {
      await send(
        phone,
        `❌ Invalid phone number "*${rawPhone}*". Use international format (e.g. +2348012345678).\n\nTry again or type *BACK*.`,
      );
      return;
    }

    const limit = getPlanLimits(vendor.plan);
    const activeCount = await prisma.vendorNotificationNumber.count({
      where: { vendorId: vendor.id, isActive: true },
    });
    if (activeCount >= limit.notificationNumbers) {
      await send(
        phone,
        `⚠️ You've reached the *${limit.notificationNumbers}-number* limit on your *${vendor.plan}* plan.\n\n` +
        `Upgrade your plan to add more notification numbers.\n\nType *BACK* to return.`,
      );
      return;
    }

    await prisma.vendorNotificationNumber.upsert({
      where: { vendorId_phone: { vendorId: vendor.id, phone: normPhone } },
      create: { vendorId: vendor.id, phone: normPhone, label, isActive: true, isPrimary: false },
      update: { isActive: true, label },
    });

    logger.info('Vendor added notification number', { vendorId: vendor.id, phone: maskPhone(normPhone) });
    await showNotifications(phone, vendor);
    return;
  }

  // ── REMOVE NUMBER ───────────────────────────────────────────────────────────
  if (norm.startsWith('REMOVE NUMBER')) {
    const parts = message.trim().split('|').map((p) => p.trim());
    // "REMOVE NUMBER | +234..." or "REMOVE NUMBER +234..."
    const rawPhone = parts[1] ?? message.trim().replace(/^REMOVE\s+NUMBER\s*/i, '');

    if (!rawPhone) {
      await send(
        phone,
        `❌ Please use the format:\n*REMOVE NUMBER | +234XXXXXXXXX*\n\nTry again or type *BACK*.`,
      );
      return;
    }

    const normPhone = normalisePhone(rawPhone);
    const record = await prisma.vendorNotificationNumber.findUnique({
      where: { vendorId_phone: { vendorId: vendor.id, phone: normPhone } },
    });

    if (!record) {
      await send(phone, `❌ *${normPhone}* is not in your notification list.`);
      return;
    }

    if (record.isPrimary) {
      await send(
        phone,
        `❌ You can't remove your primary notification number.\n\nContact support to change your primary number.`,
      );
      return;
    }

    await prisma.vendorNotificationNumber.update({
      where: { vendorId_phone: { vendorId: vendor.id, phone: normPhone } },
      data: { isActive: false },
    });

    logger.info('Vendor removed notification number', { vendorId: vendor.id, phone: maskPhone(normPhone) });
    await showNotifications(phone, vendor);
    return;
  }

  await send(
    phone,
    `❓ Unknown command.\n\nUse:\n` +
    `*ADD NUMBER | +234... | Label*\n` +
    `*REMOVE NUMBER | +234...*\n\n` +
    `Type *BACK* to return.`,
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

async function startSettings(phone: string, vendor: Vendor): Promise<void> {
  await setVendorState(phone, { step: 'SETTINGS_MENU' });
  await sendList(
    phone,
    `⚙️ *Store Settings — ${vendor.businessName}*\n\nWhat would you like to update?`,
    [{
      title: 'Settings Options',
      rows: [
        { id: '1', title: '🏪 Business Name',    description: `Current: ${vendor.businessName.slice(0, 40)}`                    },
        { id: '2', title: '📝 Description',       description: 'Your store welcome message'                                      },
        { id: '3', title: '🕐 Working Hours',     description: `Current: ${vendor.workingHoursStart ?? '08:00'}–${vendor.workingHoursEnd ?? '21:00'}` },
        { id: '4', title: '💳 Payment Method',    description: `Current: ${vendor.acceptedPayments ?? 'bank'}`                   },
        { id: '5', title: '🏦 Bank Details',      description: 'Account number and name'                                         },
        { id: '6', title: '🔑 Store Code',        description: `Current: ${vendor.storeCode ?? 'not set'}`                       },
      ],
    }],
    'Choose Setting',
    '⚙️ Settings',
  );
}

async function handleSettingsChoice(phone: string, norm: string, vendor: Vendor): Promise<void> {
  switch (norm) {
    case '1':
      await setVendorState(phone, { step: 'SETTINGS_NAME' });
      await send(
        phone,
        `What should your new business name be?\n\n` +
        `(Current: *${vendor.businessName}*)\n\nType *CANCEL* to go back.`,
      );
      break;

    case '2':
      await setVendorState(phone, { step: 'SETTINGS_DESCRIPTION' });
      await send(
        phone,
        `Enter your new store description.\n\n` +
        `This is shown to customers when they first visit your store.\n\n` +
        `(Current: ${vendor.description ?? '_none_'})\n\nType *CANCEL* to go back.`,
      );
      break;

    case '3':
      await setVendorState(phone, { step: 'SETTINGS_HOURS' });
      await send(
        phone,
        `Enter your working hours:\n*HH:MM-HH:MM* (e.g. 09:00-22:00)\n\n` +
        `(Current: ${vendor.workingHoursStart ?? '08:00'}–${vendor.workingHoursEnd ?? '21:00'})\n\n` +
        `Type *CANCEL* to go back.`,
      );
      break;

    case '4':
      await setVendorState(phone, { step: 'SETTINGS_PAYMENT' });
      await sendButtons(
        phone,
        `💳 *Payment Method*\n\nHow would you like to accept payments?\n\n(Current: *${vendor.acceptedPayments ?? 'bank'}*)`,
        [
          { id: '1', title: '💳 Paystack Only' },
          { id: '2', title: '🏦 Bank Transfer' },
          { id: '3', title: '🔀 Both' },
        ],
      );
      break;

    case '5':
      await setVendorState(phone, { step: 'SETTINGS_BANK' });
      await send(
        phone,
        `Enter your bank details:\n*Bank | Account Number | Account Name*\n\n` +
        `Example: Opay | 8012345678 | Mallam Yusuf\n\nType *CANCEL* to go back.`,
      );
      break;

    case '6':
      await setVendorState(phone, { step: 'SETTINGS_CODE' });
      await send(
        phone,
        `Enter a new store code.\n\n` +
        `Must be 4–20 letters or numbers, no spaces.\n\n` +
        `(Current: *${vendor.storeCode ?? 'none'}*)\n\nType *CANCEL* to go back.`,
      );
      break;

    default:
      await send(phone, `❌ Please reply with a number 1–6 or *CANCEL*.`);
  }
}

async function completeSettingsName(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const name = message.trim();
  if (name.length < 2 || name.length > 100) {
    await send(phone, `❌ Name must be 2–100 characters. Try again or type *CANCEL*.`);
    return;
  }
  await prisma.vendor.update({ where: { id: vendor.id }, data: { businessName: name } });
  await clearVendorState(phone);
  logger.info('Vendor updated business name', { vendorId: vendor.id });
  await send(phone, `✅ Business name updated to *${name}*.`);
}

async function completeSettingsDescription(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const desc = message.trim();
  await prisma.vendor.update({ where: { id: vendor.id }, data: { description: desc } });
  await clearVendorState(phone);
  await send(phone, `✅ Description updated!\n\n_"${desc}"_`);
}

async function completeSettingsHours(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const match = message.trim().match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
  if (!match || !match[1] || !match[2]) {
    await send(
      phone,
      `❌ Invalid format. Use *HH:MM-HH:MM* (e.g. 09:00-22:00). Try again or type *CANCEL*.`,
    );
    return;
  }
  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { workingHoursStart: match[1], workingHoursEnd: match[2] },
  });
  await clearVendorState(phone);
  await send(phone, `✅ Working hours updated to *${match[1]}–${match[2]}*.`);
}

async function completeSettingsPayment(
  phone: string,
  norm: string,
  vendor: Vendor,
): Promise<void> {
  const choiceMap: Record<string, string> = { '1': 'paystack', '2': 'bank', '3': 'both' };
  const choice = choiceMap[norm];
  if (!choice) {
    await send(phone, `❌ Please reply with 1, 2, or 3. Type *CANCEL* to go back.`);
    return;
  }
  await prisma.vendor.update({ where: { id: vendor.id }, data: { acceptedPayments: choice } });
  await clearVendorState(phone);
  await send(phone, `✅ Payment method set to *${choice}*.`);
}

async function completeSettingsBank(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const parts = message.split('|').map((p) => p.trim());
  const [bankName, accountNumber, accountName] = parts;

  if (!bankName || !accountNumber || !accountName) {
    await send(
      phone,
      `❌ Please use: *Bank | Account Number | Account Name*\n\n` +
      `Example: Opay | 8012345678 | Ada Obi\n\nTry again or type *CANCEL*.`,
    );
    return;
  }

  if (!/^\d{10}$/.test(accountNumber)) {
    await send(
      phone,
      `❌ Account number must be exactly 10 digits. Got: *${accountNumber}*. Try again or type *CANCEL*.`,
    );
    return;
  }

  const encryptedAccount = encryptBankAccount(accountNumber, env.ENCRYPTION_KEY);
  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { bankName, bankAccountNumber: encryptedAccount, bankAccountName: accountName },
  });
  await clearVendorState(phone);
  logger.info('Vendor updated bank details', { vendorId: vendor.id });
  await send(
    phone,
    `✅ Bank details updated!\n\n*${bankName}* | ****${accountNumber.slice(-4)} | ${accountName}`,
  );
}

async function completeSettingsCode(
  phone: string,
  message: string,
  vendor: Vendor,
): Promise<void> {
  const code = message.trim().toUpperCase().replace(/\s+/g, '');

  if (!/^[A-Z0-9]{4,20}$/.test(code)) {
    await send(
      phone,
      `❌ Store code must be 4–20 letters/numbers with no spaces. Got: *${code}*. Try again or type *CANCEL*.`,
    );
    return;
  }

  const existing = await prisma.vendor.findUnique({ where: { storeCode: code } });
  if (existing && existing.id !== vendor.id) {
    await send(phone, `❌ *${code}* is already taken. Try a different code.`);
    return;
  }

  await prisma.vendor.update({ where: { id: vendor.id }, data: { storeCode: code } });
  await clearVendorState(phone);

  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  logger.info('Vendor updated store code', { vendorId: vendor.id, storeCode: code });
  await send(
    phone,
    `✅ Store code updated to *${code}*!\n\nYour new link:\nwa.me/${pingmartPhone}?text=${code}`,
  );
}

// ─── TEACH BOT ────────────────────────────────────────────────────────────────

async function startTeachBot(phone: string, _vendor: Vendor): Promise<void> {
  await setVendorState(phone, { step: 'TEACH_BOT' });
  await send(
    phone,
    `🧠 *Teach Me About Your Business*\n\n` +
    `The more you tell me, the better I can answer\nyour customers' questions automatically.\n\n` +
    `You can share:\n` +
    `• Common customer questions and answers\n` +
    `• Things customers should know (e.g. no delivery after 9pm)\n` +
    `• Special services you offer\n` +
    `• Ingredients or allergen information\n` +
    `• Anything else about your business\n\n` +
    `Just type it naturally — I'll learn from it!\n` +
    `Or type *VIEW* to see what I already know.\n\n` +
    `Type *DONE* when you're finished.`,
  );
}

async function handleTeachBotReply(
  phone: string,
  message: string,
  norm: string,
  vendor: Vendor,
): Promise<void> {
  if (norm === 'VIEW') {
    const fresh = await prisma.vendor.findUnique({
      where: { id: vendor.id },
      select: { businessContext: true },
    });
    const ctx = fresh?.businessContext?.trim();
    if (!ctx) {
      await send(phone, `📭 I don't have any business context yet.\n\nJust type what you'd like me to know about *${vendor.businessName}*.`);
    } else {
      await send(phone, `📖 *What I know about ${vendor.businessName}:*\n\n${ctx}\n\nKeep adding more, or type *DONE* to finish.`);
    }
    return;
  }

  if (norm === 'DONE') {
    await clearVendorState(phone);
    await showDashboard(phone, vendor);
    return;
  }

  // Extract structured facts from the vendor's free-text input
  const facts = await extractBusinessFacts(message.trim());

  // Fetch the most recent businessContext directly from the DB (not from the cached vendor object)
  const fresh = await prisma.vendor.findUnique({
    where: { id: vendor.id },
    select: { businessContext: true },
  });
  const existing = fresh?.businessContext?.trim() ?? '';
  const updated = existing ? `${existing}\n${facts}` : facts;

  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { businessContext: updated },
  });

  logger.info('Vendor updated business context', { vendorId: vendor.id });

  await send(
    phone,
    `✅ Got it! I've learned the following about your business:\n\n${facts}\n\n` +
    `I'll use this to answer customer questions accurately.\n` +
    `Keep adding more anytime — just type it out!\n\n` +
    `Type *DONE* when you're finished, or *VIEW* to see everything I know.`,
  );
}
