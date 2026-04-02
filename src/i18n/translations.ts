/**
 * Multi-language translations for the Pingmart WhatsApp bot.
 * Supported languages: English, Nigerian Pidgin, Igbo, Yorùbá, Hausa.
 *
 * Rules:
 *   - All string values may contain {placeholders} replaced at runtime by t().
 *   - Command keywords (MENU, CANCEL, BUY, DONE, YES, NO, CLEAR) stay in English
 *     across all languages so they always work regardless of language choice.
 *   - Vendor-facing messages (order alerts) remain in English — vendors have no
 *     language preference stored yet.
 */

export type Language = 'en' | 'pid' | 'ig' | 'yo' | 'ha';

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  pid: 'Pidgin',
  ig: 'Igbo',
  yo: 'Yorùbá',
  ha: 'Hausa',
};

/**
 * Maps customer reply to a Language code.
 * Accepts numeric replies ("1"–"5") from legacy text prompts,
 * and direct language codes ("en", "pid", etc.) from list-message taps.
 */
export const LANGUAGE_CODES: Record<string, Language> = {
  // Numeric (legacy text prompt)
  '1': 'en',
  '2': 'pid',
  '3': 'ig',
  '4': 'yo',
  '5': 'ha',
  // Direct code (list-message row id)
  'en': 'en',
  'pid': 'pid',
  'ig': 'ig',
  'yo': 'yo',
  'ha': 'ha',
};

export const translations: Record<Language, Record<string, string>> = {
  // ══════════════════════════════════════════════════════════════════════════
  // ENGLISH
  // ══════════════════════════════════════════════════════════════════════════
  en: {
    // ── Language selection ────────────────────────────────────────────────
    // Shown to ALL new customers (unknown language) — keep it multi-lingual
    lang_select_prompt:
      '👋 Welcome to *{vendorName}*!\n\n' +
      'Please choose your language:\n\n' +
      '1. English\n' +
      '2. Pidgin\n' +
      '3. Igbo\n' +
      '4. Yorùbá\n' +
      '5. Hausa\n\n' +
      'Reply with a number (1–5).',
    lang_selected: "✅ Great! We'll chat in English from now on. 🇳🇬",
    invalid_lang_choice: 'Please reply with a number between 1 and 5 to choose your language.',

    // ── General ───────────────────────────────────────────────────────────
    fallback:
      "Hmm, I didn't quite get that. 😅\n\n" +
      'Type *MENU* to see our catalog and start ordering, or *CANCEL* to start over.\n\n' +
      'Need help? Contact us directly.',
    session_expired:
      'Your session expired due to inactivity — no worries! 😊\n\n' +
      'Type *MENU* or send any message to start a fresh order.',
    error_generic: "Oops! Something went wrong on our end. 😔 Please try again in a moment.",
    no_items_available: 'Sorry, *{vendorName}* has no items available right now. Please check back later.',
    order_cancelled_msg:
      '❌ Order *{orderId}* has been cancelled.\n\n' +
      'If payment was made, a refund will be processed. Contact us if you have questions.',

    // ── Welcome / catalog ─────────────────────────────────────────────────
    welcome_header: "Welcome to *{vendorName}*! 👋",
    welcome_subtitle: "Here's what we have for you today:",
    welcome_hybrid_subtitle: 'We sell both physical items and digital products. All listed below:',
    welcome_footer:
      "Reply with a *number* to order, or type *0* to see this list again.\n" +
      'Type *CANCEL* to start over.',

    // ── Browsing ──────────────────────────────────────────────────────────
    browsing_invalid:
      "Please reply with the *number* of the item you'd like (1–{max}), or type *MENU* to see the list again.",
    browsing_invalid_item: "That item doesn't exist. Reply with a number between 1 and {max}.",
    cancel_confirm: 'Order cancelled. Type MENU to start again! 👋',
    cancel_confirm_ordering: 'Order cancelled. Type MENU to browse again! 👋',
    price_info: '💰 *{name}* costs *{price}*.\n\nReply with its number to add it to your cart, or type *MENU* to see everything.',
    product_not_found: "Sorry, we don't currently carry that item. Type *MENU* to see what's available today.",

    // ── Physical – ordering ───────────────────────────────────────────────
    ask_quantity:
      'You selected: *{name}* — {price}\n\nHow many would you like? (Reply with a number, e.g. *2*)',
    invalid_quantity: 'Please enter a valid quantity (e.g. *1*, *2*, *3*).',
    max_cart_exceeded: 'Sorry, max {max} items per order. Type *DONE* to checkout.',
    item_added:
      '✅ Added *{qty}x {name}* to your cart!\n\n' +
      '*Your cart:*\n{cartLines}\n\n' +
      'Subtotal: *{subtotal}*\n\n' +
      'Reply with another item number to add more.\n' +
      'Type *DONE* to checkout, or *CLEAR* to start your cart over.',
    cart_empty_checkout: 'Your cart is empty! Select at least one item first.',
    cart_cleared: 'Cart cleared! Reply with a number to start adding items again.',
    cart_status_items:
      'You have {count} item(s) in your cart.\n\n' +
      'Reply with a number to add more, *DONE* to checkout, or *CLEAR* to start over.',
    cart_status_empty: 'Reply with a number to add an item, or type *MENU* to see the catalog.',

    // ── Physical – address ────────────────────────────────────────────────
    ask_address:
      'Almost there! 🚀\n\n*Your cart:*\n{cartSummary}\n\n' +
      'Now, please send your *delivery address* so we know where to bring your order. 🏠',
    address_too_short:
      'Please send your *full delivery address*.\n\n' +
      'Example: "12 Adeola Odeku Street, Victoria Island, Lagos"',
    confirm_address:
      '📍 *Delivery address:* {address}\n\n{cartSummary}\n\n' +
      'Is everything correct? Reply *YES* to proceed to payment, or *NO* to change your address.',
    address_confirm_prompt: 'Reply *YES* to confirm your order, or *NO* to change your address.',
    address_change_prompt: 'No problem! Please send your correct delivery address:',
    cancel_address: 'Order cancelled. Type MENU to start again.',

    // ── Physical – payment & confirmation ─────────────────────────────────
    physical_payment_link:
      '💳 *Time to pay!*\n\n' +
      'Order: *{orderId}*\nAmount: *{amount}*\n\n' +
      '👉 Complete your payment here:\n{paymentUrl}\n\n' +
      'Your order will be confirmed as soon as we receive your payment. ⏰\n' +
      'This link expires in 30 minutes.',
    order_confirmed_customer:
      '🎉 *Payment received! Your order is confirmed.*\n\n' +
      'Order ID: *{orderId}*\nFrom: {vendorName}\n\n' +
      '*What you ordered:*\n{cartSummary}\n\n' +
      "We'll keep you updated as your order progresses. Thank you! 🙏",
    awaiting_payment:
      "We're waiting for your payment confirmation. 💳\n\n" +
      "Once received, your order will be processed immediately!\n\n" +
      "If you haven't paid yet, please use the payment link we sent.\n" +
      'Type *CANCEL* to start over.',
    cancel_awaiting_payment: 'Order cancelled. Type MENU to start a new order.',

    // ── Digital – catalog ─────────────────────────────────────────────────
    digital_welcome_header: 'Welcome to *{vendorName}*! 📚',
    digital_welcome_subtitle: "Here's what we offer:",
    digital_welcome_footer:
      'Reply with a *number* to learn more or purchase.\nType *CANCEL* to exit.',
    digital_product_detail:
      '📌 *{name}*\n\n{description}\n\n💰 Price: *{price}*\n\n' +
      'Reply *BUY* to purchase, or *MENU* to go back to the catalog.',
    digital_buy_prompt:
      'Reply *BUY* to purchase, *MENU* to go back to the catalog, or *CANCEL* to exit.',

    // ── Digital – payment & delivery ──────────────────────────────────────
    digital_payment_link:
      '💳 *Complete your purchase*\n\n' +
      'Product: *{productName}*\nOrder: *{orderId}*\nAmount: *{amount}*\n\n' +
      '👉 Pay here:\n{paymentUrl}\n\n' +
      "You'll receive *instant access* as soon as your payment is confirmed. 🎉",
    digital_delivery:
      '🎉 *Payment confirmed! Here\'s your purchase.*\n\n' +
      '*{productName}*\nOrder: *{orderId}*\n\n' +
      '{deliveryMessage}\n\n' +
      '🔗 *Access link:*\n{deliveryContent}\n\n' +
      "Questions? Reply to this message and we'll be happy to help! 🙏",
    digital_delivery_failed:
      "We've confirmed your payment for order *{orderId}*, but we ran into a technical issue sending your product automatically.\n\n" +
      'Our team has been alerted and will send your product to you manually within a few minutes.\n\n' +
      "We're very sorry for the inconvenience! 🙏",

    // ── Inline / contextual messages ─────────────────────────────────────
    store_closed:
      '🕐 We\'re currently closed. We open at *{opensAt}* (Lagos time).\n\n' +
      'But feel free to browse and place your order — *{vendorName}* will attend to it as soon as we\'re back open! 😊',
    confusion_loop:
      'Hmm, I\'m having a bit of trouble understanding — my apologies! 😅\n\n' +
      'Let me get a real person to help you out.\n\n' +
      'Notifying the *{vendorName}* team now...',
    price_found:
      '✅ Yes, we have *{name}* — {price}!\n\n' +
      'Would you like to add it to your cart? Reply *YES* to add it or type *MENU* to see everything.',
    no_orders_yet:
      'You haven\'t placed any orders with *{vendorName}* yet.\n\nType *MENU* to start browsing. 😊',
    order_status_found:
      '{emoji} *Order {orderId}*\nStatus: *{statusLabel}*\n\n' +
      'Your order has been confirmed and is being handled by *{vendorName}*. ' +
      'The vendor will reach out to you directly on WhatsApp to arrange delivery.\n\n' +
      'If you haven\'t heard back within 24 hours, reply *HELP* and we\'ll flag it for you. 🙏',
    speak_to_vendor_msg:
      '🙋 *Need to speak with {vendorName}?*\n\n' +
      'The team at *{vendorName}* will be notified and will reach out to you shortly.\n\n' +
      'You can also:\n' +
      '• Type *ORDER STATUS* to check your latest order\n' +
      '• Type *HELP* for all available commands\n' +
      '• Type *MENU* to continue shopping',
    reorder_loaded:
      'Perfect! I\'ve loaded your last order: 🛒\n\n{cartLines}\n\nTotal: *{total}*\n\nReply *DONE* to checkout or *CLEAR* to start fresh.',
    multi_cart_header: '🛒 Added to your cart:',
    multi_cart_not_found_nums: '❌ Item(s) *{nums}* not found in the catalogue — skipped.',
    multi_cart_footer_total: '💰 Cart total: *{total}*\n\nKeep adding items or type *DONE* to checkout.',
    multi_order_not_found: '❌ Sorry, we don\'t have: {names}',
    multi_order_footer: 'Reply *DONE* to checkout, keep adding items, or *CART* to review.',
    welcome_back_reorder:
      '👋 Welcome back, {name}! Great to see you again at *{vendorName}* 🛍️\n\n' +
      'Your last order: {itemSummary} ({total})\n\n' +
      'Want the same again? Reply *YES* to reorder instantly\n' +
      'or *MENU* to browse everything 😊',
    vendor_dashboard_welcome: '👋 Welcome back, *{businessName}*!\n\nWhat would you like to do?',
    cmd_orders_none: 'You haven\'t placed any orders yet.\n\nType *MENU* to start browsing. 😊',
    cmd_orders_list: '📦 *Your Last {count} Orders*\n\n{lines}\n\nType *MENU* to continue shopping.',
    help_unknown:
      '📋 *Pingmart Commands*\n\n' +
      '🌐 *Always works:*\n' +
      '• *MENU* or *HOME* — Get started\n' +
      '• *LANGUAGE* — Change your language\n' +
      '• *HELP* or *ASSIST* — This list\n' +
      '• *CANCEL* or *COMOT* — Cancel current action\n' +
      '• *RESET* — Wipe everything and start fresh',
    help_customer:
      '📋 *Pingmart Commands*\n\n' +
      '🌐 *Always works:*\n' +
      '• *MENU* or *HOME* — Main screen\n' +
      '• *LANGUAGE* — Change your language\n' +
      '• *HELP* or *ASSIST* — This list\n' +
      '• *CANCEL* or *COMOT* — Cancel current step\n' +
      '• *SKIP* — Skip optional step\n' +
      '• *RESET* — Start completely fresh\n\n' +
      '🛒 *Shopping:*\n' +
      '• *CART* or *MY CART* — View your cart\n' +
      '• *DONE* or *I DON FINISH* — Checkout\n' +
      '• *CLEAR* — Empty your cart\n' +
      '• *ORDERS* — Your last 5 orders',
    help_vendor:
      '📋 *Pingmart Commands*\n\n' +
      '🌐 *Always works:*\n' +
      '• *MENU* or *HOME* — Dashboard\n' +
      '• *LANGUAGE* — Change your language\n' +
      '• *HELP* or *ASSIST* — This list\n' +
      '• *CANCEL* or *COMOT* — Cancel current step\n' +
      '• *RESET* — Start completely fresh\n\n' +
      '🏪 *Store Management:*\n' +
      '• *DASHBOARD* — Jump to your dashboard\n' +
      '• *ADD* — Add a product\n' +
      '• *CATALOGUE* — View your products\n' +
      '• *HOURS* — Update working hours\n' +
      '• *PAUSE* or *CLOSE SHOP* — Pause your store\n' +
      '• *RESUME* or *OPEN SHOP* — Reactivate store\n' +
      '• *EDITED* — Signal sheet was updated\n' +
      '• *HANDLED* — Resolve a customer issue',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NIGERIAN PIDGIN
  // ══════════════════════════════════════════════════════════════════════════
  pid: {
    lang_select_prompt:
      '👋 Welcome to *{vendorName}*!\n\n' +
      'Please choose your language:\n\n' +
      '1. English\n' +
      '2. Pidgin\n' +
      '3. Igbo\n' +
      '4. Yorùbá\n' +
      '5. Hausa\n\n' +
      'Reply with a number (1–5).',
    lang_selected: '✅ Oya! We go yarn for Pidgin from now. 🇳🇬',
    invalid_lang_choice: 'Abeg reply with number 1 to 5 to choose your language.',

    fallback:
      'Hmm, I no understand wetin you talk. 😅\n\n' +
      'Type *MENU* to see our goods and start order, or *CANCEL* to start over.\n\n' +
      'You need help? Contact us directly.',
    session_expired:
      'Your session don expire — no wahala! 😊\n\n' +
      'Type *MENU* or send any message to start fresh order.',
    error_generic: 'Wahala! Something go wrong for our side. 😔 Abeg try again small time.',
    no_items_available:
      'Sorry, *{vendorName}* no get anything available now. Come back later.',
    order_cancelled_msg:
      '❌ Order *{orderId}* don cancel.\n\n' +
      'If you don pay, refund go come. Contact us if you get question.',

    welcome_header: 'Welcome to *{vendorName}*! 👋',
    welcome_subtitle: 'See wetin we get for you today:',
    welcome_hybrid_subtitle:
      'We sell both physical things and digital products. See all below:',
    welcome_footer:
      'Reply with *number* to order, or type *0* to see list again.\n' +
      'Type *CANCEL* to start over.',

    browsing_invalid:
      'Abeg reply with the *number* of the item wey you want (1–{max}), or type *MENU* to see list again.',
    browsing_invalid_item: 'That item no dey. Reply with number between 1 and {max}.',
    cancel_confirm: 'Order cancel. Type MENU to start again! 👋',
    cancel_confirm_ordering: 'Order cancel. Type MENU to browse again! 👋',
    price_info: '💰 *{name}* cost *{price}*.\n\nSend im number to add am for cart, or type *MENU* to see everything.',
    product_not_found: "Sorry, we no get that one. Type *MENU* to see wetin dey available today.",

    ask_quantity:
      'You choose: *{name}* — {price}\n\nHow many you want? (Reply with number, e.g. *2*)',
    invalid_quantity: 'Abeg enter valid quantity (e.g. *1*, *2*, *3*).',
    max_cart_exceeded: 'Sorry, max {max} items per order. Type *DONE* to checkout.',
    item_added:
      '✅ *{qty}x {name}* don enter your cart!\n\n' +
      '*Your cart:*\n{cartLines}\n\n' +
      'Subtotal: *{subtotal}*\n\n' +
      'Reply with another number to add more.\n' +
      'Type *DONE* to checkout, or *CLEAR* to start over.',
    cart_empty_checkout: 'Your cart empty! Select at least one thing first.',
    cart_cleared: 'Cart don clear! Reply with number to start add things again.',
    cart_status_items:
      'You get {count} item(s) for your cart.\n\n' +
      'Reply with number to add more, *DONE* to checkout, or *CLEAR* to start over.',
    cart_status_empty: 'Reply with number to add item, or type *MENU* to see catalog.',

    ask_address:
      'E don near! 🚀\n\n*Your cart:*\n{cartSummary}\n\n' +
      'Now, abeg send your *delivery address* so we know where to bring your order. 🏠',
    address_too_short:
      'Abeg send your *full delivery address*.\n\n' +
      'Example: "12 Adeola Odeku Street, Victoria Island, Lagos"',
    confirm_address:
      '📍 *Delivery address:* {address}\n\n{cartSummary}\n\n' +
      'Everything correct? Reply *YES* to go pay, or *NO* to change your address.',
    address_confirm_prompt: 'Reply *YES* to confirm your order, or *NO* to change your address.',
    address_change_prompt: 'No wahala! Abeg send your correct delivery address:',
    cancel_address: 'Order cancel. Type MENU to start again.',

    physical_payment_link:
      '💳 *Time to pay!*\n\n' +
      'Order: *{orderId}*\nAmount: *{amount}*\n\n' +
      '👉 Pay here:\n{paymentUrl}\n\n' +
      'We go confirm your order as soon as payment reach us. ⏰\n' +
      'This link go expire for 30 minutes.',
    order_confirmed_customer:
      '🎉 *Payment don reach! Your order don confirm.*\n\n' +
      'Order ID: *{orderId}*\nFrom: {vendorName}\n\n' +
      '*Wetin you order:*\n{cartSummary}\n\n' +
      'We go update you as order dey progress. Thank you! 🙏',
    awaiting_payment:
      'We dey wait for your payment confirmation. 💳\n\n' +
      'Once payment land, we go process your order sharp sharp!\n\n' +
      'If you never pay, abeg use the payment link we send.\n' +
      'Type *CANCEL* to start over.',
    cancel_awaiting_payment: 'Order cancel. Type MENU to start new order.',

    digital_welcome_header: 'Welcome to *{vendorName}*! 📚',
    digital_welcome_subtitle: 'See wetin we dey offer:',
    digital_welcome_footer:
      'Reply with *number* to learn more or buy.\nType *CANCEL* to comot.',
    digital_product_detail:
      '📌 *{name}*\n\n{description}\n\n💰 Price: *{price}*\n\n' +
      'Reply *BUY* to purchase, or *MENU* to go back.',
    digital_buy_prompt:
      'Reply *BUY* to buy, *MENU* to go back to catalog, or *CANCEL* to comot.',

    digital_payment_link:
      '💳 *Complete your purchase*\n\n' +
      'Product: *{productName}*\nOrder: *{orderId}*\nAmount: *{amount}*\n\n' +
      '👉 Pay here:\n{paymentUrl}\n\n' +
      'You go receive *instant access* as soon as payment confirm. 🎉',
    digital_delivery:
      "🎉 *Payment confirm! Your purchase dey here.*\n\n" +
      '*{productName}*\nOrder: *{orderId}*\n\n' +
      '{deliveryMessage}\n\n' +
      '🔗 *Access link:*\n{deliveryContent}\n\n' +
      'Question? Reply this message and we go help you! 🙏',
    digital_delivery_failed:
      'We don confirm your payment for order *{orderId}*, but wahala happen and we no fit send your product automatic.\n\n' +
      'Our team don get alert and dem go send your product manually for few minutes.\n\n' +
      'Sorry for the inconvenience! 🙏',

    // ── Inline / contextual messages ─────────────────────────────────────
    store_closed:
      '🕐 Shop don close for now. We go open by *{opensAt}* (Lagos time).\n\n' +
      'But you fit browse and place order — *{vendorName}* go attend to am when we open! 😊',
    confusion_loop:
      'Hmm, I dey find am hard to understand — sorry! 😅\n\n' +
      'Make I call real person to help you.\n\n' +
      'I dey inform *{vendorName}* team now...',
    price_found:
      '✅ Yes, we get *{name}* — {price}!\n\n' +
      'You wan add am for cart? Reply *YES* to add or type *MENU* to see everything.',
    no_orders_yet:
      'You never place any order with *{vendorName}* yet.\n\nType *MENU* to start browse. 😊',
    order_status_found:
      '{emoji} *Order {orderId}*\nStatus: *{statusLabel}*\n\n' +
      'Your order don confirm and *{vendorName}* dey handle am. ' +
      'The vendor go reach you for WhatsApp to arrange delivery.\n\n' +
      'If you never hear back for 24 hours, reply *HELP* and we go flag am for you. 🙏',
    speak_to_vendor_msg:
      '🙋 *You wan talk to {vendorName}?*\n\n' +
      '*{vendorName}* team go get alert and dem go reach you shortly.\n\n' +
      'You fit also:\n' +
      '• Type *ORDER STATUS* to check your latest order\n' +
      '• Type *HELP* for all commands\n' +
      '• Type *MENU* to continue shop',
    reorder_loaded:
      'Perfect! I don load your last order: 🛒\n\n{cartLines}\n\nTotal: *{total}*\n\nReply *DONE* to checkout or *CLEAR* to start fresh.',
    multi_cart_header: '🛒 See wetin we add for your cart:',
    multi_cart_not_found_nums: '❌ Item(s) *{nums}* no dey for catalogue — we skip am.',
    multi_cart_footer_total: '💰 Cart total: *{total}*\n\nYou fit add more or type *DONE* to checkout.',
    multi_order_not_found: '❌ Sorry, we no get: {names}',
    multi_order_footer: 'Reply *DONE* to checkout, add more items, or *CART* to review.',
    welcome_back_reorder:
      '👋 Welcome back, {name}! Na glad make we see you again for *{vendorName}* 🛍️\n\n' +
      'Your last order: {itemSummary} ({total})\n\n' +
      'You wan do same thing again? Reply *YES* to reorder sharp sharp\n' +
      'or *MENU* to see everything 😊',
    vendor_dashboard_welcome: '👋 Welcome back, *{businessName}*!\n\nWetin you want do?',
    cmd_orders_none: 'You never place any order yet.\n\nType *MENU* to start browse. 😊',
    cmd_orders_list: '📦 *Your Last {count} Orders*\n\n{lines}\n\nType *MENU* to continue shop.',
    help_unknown:
      '📋 *Pingmart Commands*\n\n' +
      '🌐 *E dey work anytime:*\n' +
      '• *MENU* or *HOME* — Make we start\n' +
      '• *LANGUAGE* — Change your language\n' +
      '• *HELP* or *ASSIST* — See this list\n' +
      '• *CANCEL* or *COMOT* — Cancel wetin you dey do\n' +
      '• *RESET* — Wipe everything, start again',
    help_customer:
      '📋 *Pingmart Commands*\n\n' +
      '🌐 *E dey work anytime:*\n' +
      '• *MENU* or *HOME* — Main screen\n' +
      '• *LANGUAGE* — Change your language\n' +
      '• *HELP* or *ASSIST* — See this list\n' +
      '• *CANCEL* or *COMOT* — Cancel current step\n' +
      '• *SKIP* — Skip optional step\n' +
      '• *RESET* — Start fresh from beginning\n\n' +
      '🛒 *Shopping:*\n' +
      '• *CART* or *MY CART* — See your cart\n' +
      '• *DONE* or *I DON FINISH* — Checkout\n' +
      '• *CLEAR* — Empty your cart\n' +
      '• *ORDERS* — Your last 5 orders',
    help_vendor:
      '📋 *Pingmart Commands*\n\n' +
      '🌐 *E dey work anytime:*\n' +
      '• *MENU* or *HOME* — Dashboard\n' +
      '• *LANGUAGE* — Change your language\n' +
      '• *HELP* or *ASSIST* — See this list\n' +
      '• *CANCEL* or *COMOT* — Cancel current step\n' +
      '• *RESET* — Start fresh\n\n' +
      '🏪 *Store:*\n' +
      '• *DASHBOARD* — Jump to your dashboard\n' +
      '• *ADD* — Add product\n' +
      '• *CATALOGUE* — See your products\n' +
      '• *HOURS* — Update your working hours\n' +
      '• *PAUSE* or *CLOSE SHOP* — Pause your store\n' +
      '• *RESUME* or *OPEN SHOP* — Reopen your store\n' +
      '• *EDITED* — Tell bot you\'ve updated your sheet\n' +
      '• *HANDLED* — Mark customer issue as resolved',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // IGBO
  // ══════════════════════════════════════════════════════════════════════════
  ig: {
    lang_select_prompt:
      '👋 Welcome to *{vendorName}*!\n\n' +
      'Please choose your language:\n\n' +
      '1. English\n' +
      '2. Pidgin\n' +
      '3. Igbo\n' +
      '4. Yorùbá\n' +
      '5. Hausa\n\n' +
      'Reply with a number (1–5).',
    lang_selected: '✅ Ọ dị mma! Anyị ga-asụ Igbo site ugbu a. 🇳🇬',
    invalid_lang_choice:
      'Biko zaghachi ọnụọgụ dị n\'etiti 1 na 5 ịhọrọ asụsụ gị.',

    fallback:
      'Hmm, anaghị m aghọta ihe i kwuo. 😅\n\n' +
      'Tinye *MENU* ịhụ ihe anyị nwere ma bido iwu, ma ọ bụ *CANCEL* ịmalite ọzọ.\n\n' +
      'Chọrọ enyemaka? Kpọtụrụ anyị ozugbo.',
    session_expired:
      'Oge ikpe gị agwụla n\'ihi ịgharaghara — enweghị nsogbu! 😊\n\n' +
      'Tinye *MENU* ma ọ bụ zipu ozi ọ bụla ịmalite iwu ọhụrụ.',
    error_generic:
      'Oo! Ihe ọjọọ mere n\'akụkụ anyị. 😔 Biko nwaa ọzọ n\'oge obere.',
    no_items_available:
      'Ndo, *{vendorName}* enweghị ihe dị ugbu a. Biko laghachi oge ọzọ.',
    order_cancelled_msg:
      '❌ Iwu *{orderId}* emechara.\n\n' +
      'Ọ bụrụ na ị kwụọ ụgwọ, a na-atụghachi ụgwọ. Kpọtụrụ anyị ọ bụrụ na i nwere ajụjụ.',

    welcome_header: 'Nnọọ na *{vendorName}*! 👋',
    welcome_subtitle: 'Nke a bụ ihe anyị nwere maka gị taa:',
    welcome_hybrid_subtitle:
      'Anyị na-ere ngwa anụ ahụ na ngwaahịa dijitalụ. Hụ ha niile n\'okpuru:',
    welcome_footer:
      'Zaghachi *ọnụọgụ* iji iwu, ma ọ bụ tinye *0* ịhụ ndepụta ọzọ.\n' +
      'Tinye *CANCEL* ịmalite ọzọ.',

    browsing_invalid:
      'Biko zaghachi *ọnụọgụ* nke ihe ị chọrọ (1–{max}), ma ọ bụ tinye *MENU* ịhụ ndepụta ọzọ.',
    browsing_invalid_item: 'Ihe ahụ adịghị. Zaghachi ọnụọgụ dị n\'etiti 1 na {max}.',
    cancel_confirm: 'Emechara iwu. Tinye MENU ịmalite ọzọ! 👋',
    cancel_confirm_ordering: 'Emechara iwu. Tinye MENU ịgwa ọzọ! 👋',
    price_info: '💰 *{name}* dị ọnụ *{price}*.\n\nZiga nọmba ya iji tinye ya na cart, ma ọ bụ pịa *MENU* ịhụ ihe niile.',
    product_not_found: "Ndo, anyị enweghị ihe ahụ ugbu a. Pịa *MENU* ịhụ ihe dị n'ahịa taa.",

    ask_quantity:
      'Ị họọrọ: *{name}* — {price}\n\nOle ị chọrọ? (Zaghachi ọnụọgụ, dị ka *2*)',
    invalid_quantity: 'Biko tinye ọnụọgụ ziri ezi (dị ka *1*, *2*, *3*).',
    max_cart_exceeded: 'Ndo, ọnụọgụ kachasị maka iwu ọnụ bụ {max}. Tinye *DONE* ịchekwa.',
    item_added:
      '✅ Etinye *{qty}x {name}* n\'ụgbọala gị!\n\n' +
      '*Ụgbọala gị:*\n{cartLines}\n\n' +
      'Nsụnụ: *{subtotal}*\n\n' +
      'Zaghachi ọnụọgụ ọzọ iji tinye ihe ndị ọzọ.\n' +
      'Tinye *DONE* ịchekwa, ma ọ bụ *CLEAR* iji malite ụgbọala gị ọzọ.',
    cart_empty_checkout: 'Ụgbọala gị dị ọcha! Họrọ ihe ọ bụla nke mbụ.',
    cart_cleared: 'Emechara ụgbọala! Zaghachi ọnụọgụ ịmalite itinye ihe ọzọ.',
    cart_status_items:
      'I nwere ihe {count} n\'ụgbọala gị.\n\n' +
      'Zaghachi ọnụọgụ iji tinye ihe ndị ọzọ, *DONE* ịchekwa, ma ọ bụ *CLEAR* ịmalite ọzọ.',
    cart_status_empty:
      'Zaghachi ọnụọgụ iji tinye ihe, ma ọ bụ tinye *MENU* ịhụ ihe anyị nwere.',

    ask_address:
      'Ọ dịkwa nso! 🚀\n\n*Ụgbọala gị:*\n{cartSummary}\n\n' +
      'Ugbu a, biko ziga *adreesị nnyefe* gị ka anyị nwee ike ibiga gị iwu gị. 🏠',
    address_too_short:
      'Biko ziga *adreesị nnyefe* gị zuru oke.\n\n' +
      'Ihe atụ: "12 Adeola Odeku Street, Victoria Island, Lagos"',
    confirm_address:
      '📍 *Adreesị nnyefe:* {address}\n\n{cartSummary}\n\n' +
      'Ihe niile dị mma? Zaghachi *YES* iji gaa na ụgwọ, ma ọ bụ *NO* iji gbanwee adreesị gị.',
    address_confirm_prompt:
      'Zaghachi *YES* iji kwado iwu gị, ma ọ bụ *NO* iji gbanwee adreesị gị.',
    address_change_prompt: 'Ọ dị mma! Biko ziga adreesị nnyefe ziri ezi gị:',
    cancel_address: 'Emechara iwu. Tinye MENU ịmalite ọzọ.',

    physical_payment_link:
      '💳 *Oge ụgwọ kwụọ!*\n\n' +
      'Iwu: *{orderId}*\nOnu: *{amount}*\n\n' +
      '👉 Mechaa ụgwọ gị ebe a:\n{paymentUrl}\n\n' +
      'A ga-akwado iwu gị ozugbo anyị natara ụgwọ gị. ⏰\n' +
      'Nkọwa a ga-agwụ n\'ime nkeji 30.',
    order_confirmed_customer:
      '🎉 *Natara ụgwọ! Ekwadoro iwu gị.*\n\n' +
      'ID Iwu: *{orderId}*\nSi: {vendorName}\n\n' +
      '*Ihe ị tụrụ n\'iwu:*\n{cartSummary}\n\n' +
      'Anyị ga-amekwa gị ihe ọhụrụ ka iwu gị na-aga n\'ihu. Daalu! 🙏',
    awaiting_payment:
      'Anyị na-echere nnabata ụgwọ gị. 💳\n\n' +
      'Onye a natara ya, a ga-arụ ọrụ iwu gị ozugbo!\n\n' +
      'Ọ bụrụ na ikwụbeghị ụgwọ, biko jiri nkọwa ụgwọ anyị zitere.\n' +
      'Tinye *CANCEL* ịmalite ọzọ.',
    cancel_awaiting_payment: 'Emechara iwu. Tinye MENU ịmalite iwu ọhụrụ.',

    digital_welcome_header: 'Nnọọ na *{vendorName}*! 📚',
    digital_welcome_subtitle: 'Nke a bụ ihe anyị nwere:',
    digital_welcome_footer:
      'Zaghachi *ọnụọgụ* ịmụtakwuo ma ọ bụ zụọ.\nTinye *CANCEL* ịpụ.',
    digital_product_detail:
      '📌 *{name}*\n\n{description}\n\n💰 Ọnụ ahịa: *{price}*\n\n' +
      'Zaghachi *BUY* iji zụọ, ma ọ bụ *MENU* ịlaghachi na ndepụta.',
    digital_buy_prompt:
      'Zaghachi *BUY* iji zụọ, *MENU* ịlaghachi na ndepụta, ma ọ bụ *CANCEL* ịpụ.',

    digital_payment_link:
      '💳 *Mechaa nzụta gị*\n\n' +
      'Ngwaahịa: *{productName}*\nIwu: *{orderId}*\nOnu: *{amount}*\n\n' +
      '👉 Kwụọ ụgwọ ebe a:\n{paymentUrl}\n\n' +
      'Ị ga-enweta *ntinye liền* ozugbo ụgwọ gị kwadoro. 🎉',
    digital_delivery:
      "🎉 *Ekwadoro ụgwọ! Nke a bụ ihe ị zụrụ.*\n\n" +
      '*{productName}*\nIwu: *{orderId}*\n\n' +
      '{deliveryMessage}\n\n' +
      '🔗 *Nkọwa ntinye:*\n{deliveryContent}\n\n' +
      'Ajụjụ? Zaghachi ozi a anyị ga-enyere gị aka! 🙏',
    digital_delivery_failed:
      'Ekwadoro anyị ụgwọ gị maka iwu *{orderId}*, mana ihe nsogbu mere na anyị enweghị ike iziga ngwaahịa gị na-akpaghị aka.\n\n' +
      'Anyị ọcha ma ha ga-eziga ngwaahịa gị n\'aka n\'ime nkeji ole na ole.\n\n' +
      'Ndo maka ihe a! 🙏',

    // ── Inline / contextual messages ─────────────────────────────────────
    store_closed:
      '🕐 Ụlọ ahịa mechiri ugbu a. Anyị ga-emeghe na *{opensAt}* (oge Lagos).\n\n' +
      'Mana ị nwere ike ịgwa ahịa ma tinye iwu — *{vendorName}* ga-elekọta ya ozugbo anyị emegheghị! 😊',
    confusion_loop:
      'Hmm, ọ na-esi m ike ịghọta — ndo! 😅\n\n' +
      'Ka m kpọọ onye ọzọ ya iji nyere gị aka.\n\n' +
      'A na m ịkọ ndị *{vendorName}* ugbu a...',
    price_found:
      '✅ Ee, anyị nwere *{name}* — {price}!\n\n' +
      'Ị chọrọ itinye ya na cart? Zaghachi *YES* iji tinye ya ma ọ bụ tinye *MENU* ịhụ ihe niile.',
    no_orders_yet:
      'Ị adabeghị iwu ọ bụla na *{vendorName}* ka ugbu a.\n\nTinye *MENU* ịmalite igwa ahịa. 😊',
    order_status_found:
      '{emoji} *Iwu {orderId}*\nOdodo: *{statusLabel}*\n\n' +
      'Emeziri iwu gị ma *{vendorName}* na-elekọta ya. ' +
      'Onye ọrụ ahịa ga-akpọtụrụ gị ozugbo na WhatsApp iji haziri nnyefe.\n\n' +
      'Ọ bụrụ na ị anụchaghi azịza n\'ime awa 24, zaghachi *HELP* anyị ga-egosi ya maka gị. 🙏',
    speak_to_vendor_msg:
      '🙋 *Ị chọrọ ikwu okwu na {vendorName}?*\n\n' +
      'A ga-ịkọ ndị *{vendorName}* ma ha ga-akpọtụrụ gị n\'oge obere.\n\n' +
      'Ị nwekwara ike:\n' +
      '• Tinye *ORDER STATUS* ịlele iwu gị ikpeazụ\n' +
      '• Tinye *HELP* maka iwu niile dị n\'ike\n' +
      '• Tinye *MENU* ịgwa ahịa n\'ihu',
    reorder_loaded:
      'O dị mma! Ebutara m iwu gị ikpeazụ: 🛒\n\n{cartLines}\n\nNdị ọnụ: *{total}*\n\nZaghachi *DONE* ịchekwa ma ọ bụ *CLEAR* ịmalite ọzọ.',
    multi_cart_header: '🛒 Etinyere na cart gị:',
    multi_cart_not_found_nums: '❌ Ihe(s) *{nums}* adịghị na catalogue — a wefuo ya.',
    multi_cart_footer_total: '💰 Cart nchịkọta: *{total}*\n\nNọrọ itinye ihe ma ọ bụ tinye *DONE* ịchekwa.',
    multi_order_not_found: '❌ Ndo, anyị enweghị: {names}',
    multi_order_footer: 'Zaghachi *DONE* ịchekwa, tinye ihe ọzọ, ma ọ bụ *CART* ịlele.',
    welcome_back_reorder:
      '👋 Nabata ọzọ, {name}! Anyị na-ekwusi ike ịhụ gị na *{vendorName}* 🛍️\n\n' +
      'Iwu gị ikpeazụ: {itemSummary} ({total})\n\n' +
      'Ị chọrọ iweghachi ya? Zaghachi *YES* ịwere ya ozugbo\n' +
      'ma ọ bụ *MENU* ịhụ ihe niile 😊',
    vendor_dashboard_welcome: '👋 Nabata ọzọ, *{businessName}*!\n\nGịnị chọrọ ime?',
    cmd_orders_none: 'Ị adabeghị iwu ọ bụla ka ugbu a.\n\nTinye *MENU* ịmalite. 😊',
    cmd_orders_list: '📦 *Iwu Gị {count} Ikpeazụ*\n\n{lines}\n\nTinye *MENU* ịgwa ahịa n\'ihu.',
    help_unknown:
      '📋 *Iwu Pingmart*\n\n' +
      '🌐 *Ọ na-arụ ọrụ mgbe ọ bụla:*\n' +
      '• *MENU* ma ọ bụ *HOME* — Bido\n' +
      '• *LANGUAGE* — Gbanwee asụsụ gị\n' +
      '• *HELP* ma ọ bụ *ASSIST* — Hụ ndepụta a\n' +
      '• *CANCEL* ma ọ bụ *COMOT* — Kagbuo ihe ị na-eme ugbu a\n' +
      '• *RESET* — Hichapụ ihe niile, malite ọzọ',
    help_customer:
      '📋 *Iwu Pingmart*\n\n' +
      '🌐 *Ọ na-arụ ọrụ mgbe ọ bụla:*\n' +
      '• *MENU* ma ọ bụ *HOME* — Ihuenyo isi\n' +
      '• *LANGUAGE* — Gbanwee asụsụ gị\n' +
      '• *HELP* ma ọ bụ *ASSIST* — Ndepụta iwu\n' +
      '• *CANCEL* ma ọ bụ *COMOT* — Kagbuo nzọụkwụ ugbu a\n' +
      '• *SKIP* — Wụfee nzọụkwụ ọ bụghị nke dị mkpa\n' +
      '• *RESET* — Malite ọzọ n\'oge ọ bụla\n\n' +
      '🛒 *Ịzụ ahịa:*\n' +
      '• *CART* ma ọ bụ *MY CART* — Hụ cart gị\n' +
      '• *DONE* ma ọ bụ *I DON FINISH* — Gaa checkout\n' +
      '• *CLEAR* — Hichapụ cart gị\n' +
      '• *ORDERS* — Iwu gị ikpeazụ 5',
    help_vendor:
      '📋 *Iwu Pingmart*\n\n' +
      '🌐 *Ọ na-arụ ọrụ mgbe ọ bụla:*\n' +
      '• *MENU* ma ọ bụ *HOME* — Dashboard\n' +
      '• *LANGUAGE* — Gbanwee asụsụ gị\n' +
      '• *HELP* ma ọ bụ *ASSIST* — Ndepụta iwu\n' +
      '• *CANCEL* ma ọ bụ *COMOT* — Kagbuo nzọụkwụ ugbu a\n' +
      '• *RESET* — Malite ọzọ n\'oge ọ bụla\n\n' +
      '🏪 *Njikwa ụlọ ahịa:*\n' +
      '• *DASHBOARD* — Laa dashboard gị\n' +
      '• *ADD* — Tinye ngwaahịa ọhụrụ\n' +
      '• *CATALOGUE* — Hụ ihe niile ị na-ere\n' +
      '• *HOURS* — Melite oge ọrụ gị\n' +
      '• *PAUSE* ma ọ bụ *CLOSE SHOP* — Kwụsị ụlọ ahịa gị\n' +
      '• *RESUME* ma ọ bụ *OPEN SHOP* — Malitegharị ụlọ ahịa gị\n' +
      '• *EDITED* — Mee ka bot ghọta gbanwee sheet gị\n' +
      '• *HANDLED* — Gosi na i dozie nsogbu onye ọrịa',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // YORÙBÁ
  // ══════════════════════════════════════════════════════════════════════════
  yo: {
    lang_select_prompt:
      '👋 Welcome to *{vendorName}*!\n\n' +
      'Please choose your language:\n\n' +
      '1. English\n' +
      '2. Pidgin\n' +
      '3. Igbo\n' +
      '4. Yorùbá\n' +
      '5. Hausa\n\n' +
      'Reply with a number (1–5).',
    lang_selected: '✅ Dáadáa! A ó sọ Yorùbá lati isisiyi. 🇳🇬',
    invalid_lang_choice:
      'Jọwọ dáhùn pẹ̀lú nọ́mbà láàárín 1 àti 5 láti yan èdè rẹ.',

    fallback:
      'Hmm, mi ò gbọ́ ohun tí o sọ. 😅\n\n' +
      'Tẹ *MENU* láti rí àwọn ọjà wa, tàbí *CANCEL* láti bẹ̀rẹ̀ lẹ́ẹ̀kan si.\n\n' +
      'Nílò ìrànlọ́wọ́? Kàn sí wa ní tààràtà.',
    session_expired:
      'Àkókò rẹ ti parí nítorí àìṣiṣẹ́ — kò burú! 😊\n\n' +
      'Tẹ *MENU* tàbí fi ifiranṣẹ kankan ránṣẹ láti bẹ̀rẹ̀ àṣẹ tuntun.',
    error_generic:
      'Ìdààmú! Nǹkan kan ṣẹlẹ̀ ní ẹgbẹ́ wa. 😔 Jọwọ gbìyànjú lẹ́ẹ̀kan si ní ìṣẹ́jú díẹ̀.',
    no_items_available:
      'Ẹ jọwọ, *{vendorName}* kò ní ohun kankan tí ó wà báyìí. Jọwọ padà wá lẹ́yìn.',
    order_cancelled_msg:
      '❌ Àṣẹ *{orderId}* ti fagilé.\n\n' +
      'Tí o bá ti san owó, a ó dá owó padà. Kàn sí wa bí o bá ní ìbéèrè.',

    welcome_header: 'Ẹ káabọ sí *{vendorName}*! 👋',
    welcome_subtitle: 'Ìwọ̀nyí ni ohun tí a ní fún ọ lónìí:',
    welcome_hybrid_subtitle:
      'A ta àwọn ohun ara ati àwọn ọjà fọ̀nàmúlò. Wọ́n wà lókè:',
    welcome_footer:
      'Dáhùn pẹ̀lú *nọ́mbà* láti paṣẹ, tàbí tẹ *0* láti rí àkójọ mọ́.\n' +
      'Tẹ *CANCEL* láti bẹ̀rẹ̀ lẹ́ẹ̀kan si.',

    browsing_invalid:
      'Jọwọ dáhùn pẹ̀lú *nọ́mbà* nǹkan tí o fẹ́ (1–{max}), tàbí tẹ *MENU* láti rí àkójọ mọ́.',
    browsing_invalid_item:
      'Nǹkan yẹn kò sí. Dáhùn pẹ̀lú nọ́mbà láàárín 1 àti {max}.',
    cancel_confirm: 'Àṣẹ ti fagilé. Tẹ MENU láti bẹ̀rẹ̀ lẹ́ẹ̀kan si! 👋',
    cancel_confirm_ordering: 'Àṣẹ ti fagilé. Tẹ MENU láti yípadà lẹ́ẹ̀kan si! 👋',
    price_info: '💰 *{name}* jẹ *{price}*.\n\nTẹ nọ́mbà rẹ̀ láti fi sínu cart, tàbí tẹ *MENU* láti rí gbogbo ohun.',
    product_not_found: "Pẹ̀lẹ́, a kò ní ohun tí o béèrè. Tẹ *MENU* láti rí ohun tí a ní lónìí.",

    ask_quantity:
      'O ti yan: *{name}* — {price}\n\nMélòó ni o fẹ́? (Dáhùn pẹ̀lú nọ́mbà, fún àpẹẹrẹ *2*)',
    invalid_quantity: 'Jọwọ tẹ iye tó wà (fún àpẹẹrẹ *1*, *2*, *3*).',
    max_cart_exceeded: 'Ẹ jọwọ, iye pàtàkì fún àṣẹ jẹ́ {max}. Tẹ *DONE* láti sanwó.',
    item_added:
      '✅ Fi *{qty}x {name}* síbò rẹ!\n\n' +
      '*Bò rẹ:*\n{cartLines}\n\n' +
      'Àpéjọ apá: *{subtotal}*\n\n' +
      'Dáhùn pẹ̀lú nọ́mbà mìíràn láti fi ohun mẹ̀ẹ́jì.\n' +
      'Tẹ *DONE* láti sanwó, tàbí *CLEAR* láti bẹ̀rẹ̀ bò rẹ lẹ́ẹ̀kan si.',
    cart_empty_checkout: 'Bò rẹ ṣofo! Yan nǹkan kan ní àkọ́kọ́.',
    cart_cleared: 'A ti mọ́ bò! Dáhùn pẹ̀lú nọ́mbà láti bẹ̀rẹ̀ fífi ohun wọlé mọ́.',
    cart_status_items:
      'O ní ohun {count} nínú bò rẹ.\n\n' +
      'Dáhùn pẹ̀lú nọ́mbà láti fi ohun mọ́, *DONE* láti sanwó, tàbí *CLEAR* láti bẹ̀rẹ̀ lẹ́ẹ̀kan si.',
    cart_status_empty:
      'Dáhùn pẹ̀lú nọ́mbà láti fi ohun wọlé, tàbí tẹ *MENU* láti rí àkójọ.',

    ask_address:
      'Ó fẹ́rẹ̀ẹ́ tán! 🚀\n\n*Bò rẹ:*\n{cartSummary}\n\n' +
      'Jọwọ fi *àdírẹ́sì ifiránṣẹ* rẹ ránṣẹ kí a lè mọ ibi tí a máa mú àṣẹ rẹ. 🏠',
    address_too_short:
      'Jọwọ fi *àdírẹ́sì ifiránṣẹ* rẹ tó pé ránṣẹ.\n\n' +
      'Àpẹẹrẹ: "12 Adeola Odeku Street, Victoria Island, Lagos"',
    confirm_address:
      '📍 *Àdírẹ́sì ifiránṣẹ:* {address}\n\n{cartSummary}\n\n' +
      'Ọ̀pọ̀lọpọ̀ ohun dára? Dáhùn *YES* láti lọ sanwó, tàbí *NO* láti yí àdírẹ́sì rẹ padà.',
    address_confirm_prompt:
      'Dáhùn *YES* láti jẹ́rìísí àṣẹ rẹ, tàbí *NO* láti yí àdírẹ́sì rẹ padà.',
    address_change_prompt: 'Kò burú! Jọwọ fi àdírẹ́sì ifiránṣẹ tó tọ rẹ ránṣẹ:',
    cancel_address: 'Àṣẹ ti fagilé. Tẹ MENU láti bẹ̀rẹ̀ lẹ́ẹ̀kan si.',

    physical_payment_link:
      '💳 *Àkókò sísanwó!*\n\n' +
      'Àṣẹ: *{orderId}*\nOwó: *{amount}*\n\n' +
      '👉 Parí sísanwó rẹ níbí:\n{paymentUrl}\n\n' +
      'A ó jẹ́rìísí àṣẹ rẹ bí a ti gbà owó rẹ. ⏰\n' +
      'Àsopọ̀ yìí yóò parí ní ìṣẹ́jú 30.',
    order_confirmed_customer:
      '🎉 *A ti gbà owó! A ti jẹ́rìísí àṣẹ rẹ.*\n\n' +
      'ID Àṣẹ: *{orderId}*\nLọ́wọ́: {vendorName}\n\n' +
      '*Ohun tí o paṣẹ:*\n{cartSummary}\n\n' +
      'A ó jí ọ rẹ ìmọ̀ bí àṣẹ rẹ ṣe ń ṣègbékalẹ̀. E ṣeun! 🙏',
    awaiting_payment:
      'A ń dúró fún jẹ́rìísí sísanwó rẹ. 💳\n\n' +
      'Bí a ti gba rẹ, a ó ṣe àṣẹ rẹ lẹ́sẹ̀kẹsẹ̀!\n\n' +
      'Tí o bá ti san owó, jọwọ lo àsopọ̀ sísanwó tí a fi ránṣẹ.\n' +
      'Tẹ *CANCEL* láti bẹ̀rẹ̀ lẹ́ẹ̀kan si.',
    cancel_awaiting_payment: 'Àṣẹ ti fagilé. Tẹ MENU láti bẹ̀rẹ̀ àṣẹ tuntun.',

    digital_welcome_header: 'Ẹ káabọ sí *{vendorName}*! 📚',
    digital_welcome_subtitle: 'Ìwọ̀nyí ni ohun tí a ní fún ọ:',
    digital_welcome_footer:
      'Dáhùn pẹ̀lú *nọ́mbà* láti kọ̀ wá tàbí rà.\nTẹ *CANCEL* láti jáde.',
    digital_product_detail:
      '📌 *{name}*\n\n{description}\n\n💰 Iye: *{price}*\n\n' +
      'Dáhùn *BUY* láti rà, tàbí *MENU* láti padà sí àkójọ.',
    digital_buy_prompt:
      'Dáhùn *BUY* láti rà, *MENU* láti padà sí àkójọ, tàbí *CANCEL* láti jáde.',

    digital_payment_link:
      '💳 *Parí ìrà rẹ*\n\n' +
      'Ọjà: *{productName}*\nÀṣẹ: *{orderId}*\nOwó: *{amount}*\n\n' +
      '👉 Sanwó níbí:\n{paymentUrl}\n\n' +
      'O ó gba *àǹfàní lẹ́sẹ̀kẹsẹ̀* bí sísanwó rẹ bá ti jẹ́rìísí. 🎉',
    digital_delivery:
      "🎉 *Ó jẹ́rìísí sísanwó! Ìwọ̀nyí ni ìrà rẹ.*\n\n" +
      '*{productName}*\nÀṣẹ: *{orderId}*\n\n' +
      '{deliveryMessage}\n\n' +
      '🔗 *Àsopọ̀ àǹfàní:*\n{deliveryContent}\n\n' +
      'Ìbéèrè? Dáhùn ifiranṣẹ yìí a ó ran ọ lọwọ! 🙏',
    digital_delivery_failed:
      'A ti jẹ́rìísí sísanwó rẹ fún àṣẹ *{orderId}*, ṣùgbọ́n a ṣọngbẹ ìṣòro kan nígbà tí a fẹ́ fi ọjà rẹ ránṣẹ fúnrarẹ.\n\n' +
      'Àwọn ẹgbẹ́ wa ti gba ìfitónilétí yóò fi ọjà rẹ ránṣẹ fúnra wọn ní ìṣẹ́jú díẹ̀.\n\n' +
      'À ní ìdúróṣinṣin pẹ̀lú ọ! 🙏',

    // ── Inline / contextual messages ─────────────────────────────────────
    store_closed:
      '🕐 Ìdúró àjọ wa ní báyìí. A ó ṣí ní *{opensAt}* (àkókò Lagos).\n\n' +
      'Ṣùgbọ́n o ní àǹfàní láti yíká àti fi àṣẹ sí — *{vendorName}* ó wò ó bí a bá ṣí! 😊',
    confusion_loop:
      'Hmm, mo nira láti mọ ohun tí o sọ — àárọ̀! 😅\n\n' +
      'Jẹ́ kí n pè ènìyàn gidi láti ràn ọ lọwọ.\n\n' +
      'Mo ń ṣe ìwífún àwọn ẹgbẹ́ *{vendorName}* báyìí...',
    price_found:
      '✅ Bẹ́ẹ̀ni, a ní *{name}* — {price}!\n\n' +
      'Ṣé o fẹ́ fi í sínú bò rẹ? Dáhùn *YES* láti fi í sí tàbí tẹ *MENU* láti rí gbogbo ohun.',
    no_orders_yet:
      'O kò tí ì fi àṣẹ kankan pẹ̀lú *{vendorName}* rí.\n\nTẹ *MENU* láti bẹ̀rẹ̀ yíká. 😊',
    order_status_found:
      '{emoji} *Àṣẹ {orderId}*\nÌpò: *{statusLabel}*\n\n' +
      'A ti jẹ́rìísí àṣẹ rẹ àti *{vendorName}* ń ṣe é. ' +
      'Ọjà ó kàn sí ọ ní tààràtà lórí WhatsApp láti ṣètò ifiránṣẹ.\n\n' +
      'Tí o kò bá gbọ́ padà ní àárọ̀ 24, dáhùn *HELP* a ó fi àmì sí fún ọ. 🙏',
    speak_to_vendor_msg:
      '🙋 *Ṣé o fẹ́ sọ̀rọ̀ pẹ̀lú {vendorName}?*\n\n' +
      'Àwọn ẹgbẹ́ *{vendorName}* ó gba ìwífún tí wọn ó sì kàn sí ọ ní kíá.\n\n' +
      'O tún lè:\n' +
      '• Tẹ *ORDER STATUS* láti ṣàyẹ̀wò àṣẹ rẹ tó kọjá\n' +
      '• Tẹ *HELP* fún gbogbo àṣẹ tó wà\n' +
      '• Tẹ *MENU* láti tẹ̀síwájú ràkòkò',
    reorder_loaded:
      'O dára! Mo ti gbe àṣẹ rẹ tó kọjá wọlé: 🛒\n\n{cartLines}\n\nÀpapọ̀: *{total}*\n\nDáhùn *DONE* láti sanwó tàbí *CLEAR* láti bẹ̀rẹ̀ ìgbà tuntun.',
    multi_cart_header: '🛒 A fi wọn sínú bò rẹ:',
    multi_cart_not_found_nums: '❌ Ohun(s) *{nums}* kò sí nínú catalogue — a gbàdé rẹ̀.',
    multi_cart_footer_total: '💰 Àpapọ̀ bò: *{total}*\n\nTẹ̀síwájú fí ohun sínú tàbí tẹ *DONE* láti sanwó.',
    multi_order_not_found: '❌ Ẹ̀jọ́, a kò ní: {names}',
    multi_order_footer: 'Dáhùn *DONE* láti sanwó, fi ohun ṣàfikún, tàbí *CART* láti ṣàyẹ̀wò.',
    welcome_back_reorder:
      '👋 Káàbọ̀ padà, {name}! A dúpẹ́ láti rí ọ ní *{vendorName}* 🛍️\n\n' +
      'Àṣẹ rẹ tó kọjá: {itemSummary} ({total})\n\n' +
      'Ṣé o fẹ́ tún bẹ̀rẹ̀ bẹ́ẹ̀? Dáhùn *YES* láti tún bẹ̀sẹ̀ ní kíákíá\n' +
      'tàbí *MENU* láti rí gbogbo ohun 😊',
    vendor_dashboard_welcome: '👋 Káàbọ̀ padà, *{businessName}*!\n\nKíni o fẹ́ ṣe?',
    cmd_orders_none: 'O kò tí ì ṣe àṣẹ kankan rí.\n\nTẹ *MENU* láti bẹ̀rẹ̀ yíká. 😊',
    cmd_orders_list: '📦 *Àwọn Àṣẹ Rẹ {count} Tó Kọjá*\n\n{lines}\n\nTẹ *MENU* láti tẹ̀síwájú ràkòkò.',
    help_unknown:
      '📋 *Àwọn Àṣẹ Pingmart*\n\n' +
      '🌐 *Ń ṣiṣẹ́ ní àkókò kankan:*\n' +
      '• *MENU* tàbí *HOME* — Bẹ̀rẹ̀\n' +
      '• *LANGUAGE* — Yí èdè rẹ padà\n' +
      '• *HELP* tàbí *ASSIST* — Rí àtòjọ yìí\n' +
      '• *CANCEL* tàbí *COMOT* — Fagilé ohun tí o ń ṣe\n' +
      '• *RESET* — Pa gbogbo rẹ̀ nù, bẹ̀rẹ̀ ìgbà tuntun',
    help_customer:
      '📋 *Àwọn Àṣẹ Pingmart*\n\n' +
      '🌐 *Ń ṣiṣẹ́ ní àkókò kankan:*\n' +
      '• *MENU* tàbí *HOME* — Ojú ewé àkọ́kọ́\n' +
      '• *LANGUAGE* — Yí èdè rẹ padà\n' +
      '• *HELP* tàbí *ASSIST* — Àtòjọ àṣẹ\n' +
      '• *CANCEL* tàbí *COMOT* — Fagilé ìgbésẹ̀ lọwọ\n' +
      '• *SKIP* — Fò ìgbésẹ̀ àṣàyàn\n' +
      '• *RESET* — Bẹ̀rẹ̀ ìgbà tuntun pátápátá\n\n' +
      '🛒 *Ràkòkò:*\n' +
      '• *CART* tàbí *MY CART* — Rí bò rẹ\n' +
      '• *DONE* tàbí *I DON FINISH* — Sanwó\n' +
      '• *CLEAR* — Ṣofintoto bò rẹ\n' +
      '• *ORDERS* — Àwọn àṣẹ rẹ 5 tó kọjá',
    help_vendor:
      '📋 *Àwọn Àṣẹ Pingmart*\n\n' +
      '🌐 *Ń ṣiṣẹ́ ní àkókò kankan:*\n' +
      '• *MENU* tàbí *HOME* — Dashboard\n' +
      '• *LANGUAGE* — Yí èdè rẹ padà\n' +
      '• *HELP* tàbí *ASSIST* — Àtòjọ àṣẹ\n' +
      '• *CANCEL* tàbí *COMOT* — Fagilé ìgbésẹ̀ lọwọ\n' +
      '• *RESET* — Bẹ̀rẹ̀ ìgbà tuntun pátápátá\n\n' +
      '🏪 *Ìṣàkóso Ilé Ìtajà:*\n' +
      '• *DASHBOARD* — Lọ sí dashboard rẹ\n' +
      '• *ADD* — Ṣàfikún ọjà\n' +
      '• *CATALOGUE* — Wo àwọn ọjà rẹ\n' +
      '• *HOURS* — Ṣàtúnṣe àkókò iṣẹ́\n' +
      '• *PAUSE* tàbí *CLOSE SHOP* — Dáwọ̀ dúró ilé ìtajà rẹ\n' +
      '• *RESUME* tàbí *OPEN SHOP* — Tún ṣí ilé ìtajà rẹ\n' +
      '• *EDITED* — Sọ fún bot pé o ti ṣàtúnṣe sheet rẹ\n' +
      '• *HANDLED* — Samisi pé ọ̀rọ̀ alabara ti parí',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HAUSA
  // ══════════════════════════════════════════════════════════════════════════
  ha: {
    lang_select_prompt:
      '👋 Welcome to *{vendorName}*!\n\n' +
      'Please choose your language:\n\n' +
      '1. English\n' +
      '2. Pidgin\n' +
      '3. Igbo\n' +
      '4. Yorùbá\n' +
      '5. Hausa\n\n' +
      'Reply with a number (1–5).',
    lang_selected: '✅ Kyau! Za mu yi magana da Hausa daga yanzu. 🇳🇬',
    invalid_lang_choice:
      'Don Allah amsa da lamba tsakanin 1 da 5 don zaɓar harshenka.',

    fallback:
      'Hmm, ban fahimci abin da ka faɗa ba. 😅\n\n' +
      'Tẹ *MENU* don ganin kayayyakinmu da fara oda, ko *CANCEL* don fara daga farko.\n\n' +
      'Kana buƙatar taimako? Tuntuɓe mu kai tsaye.',
    session_expired:
      'Lokacinka ya ƙare saboda rashin aiki — babu damuwa! 😊\n\n' +
      'Tẹ *MENU* ko aika saƙo kowane abu don fara sabuwar oda.',
    error_generic:
      'Matsala! Wani abu ya faru a gefenmu. 😔 Don Allah gwada kuma bayan ɗan lokaci.',
    no_items_available:
      'Yi haƙuri, *{vendorName}* ba shi da kaya a yanzu. Don Allah dawo daga baya.',
    order_cancelled_msg:
      '❌ An soke oda *{orderId}*.\n\n' +
      'Idan ka biya, za a mayar da kuɗin. Tuntuɓe mu idan kana da tambaya.',

    welcome_header: 'Barka da zuwa *{vendorName}*! 👋',
    welcome_subtitle: 'Ga abin da muke da shi a yau:',
    welcome_hybrid_subtitle:
      'Muna sayar da kayan jiki da kayayyakin dijital. Duba su duka a ƙasa:',
    welcome_footer:
      'Amsa da *lamba* don oda, ko tẹ *0* don ganin jerin kayan kuma.\n' +
      'Tẹ *CANCEL* don fara daga farko.',

    browsing_invalid:
      'Don Allah amsa da *lamba* na kayan da kake so (1–{max}), ko tẹ *MENU* don ganin jerin kayan kuma.',
    browsing_invalid_item: 'Wannan kaya ba ya nan. Amsa da lamba tsakanin 1 da {max}.',
    cancel_confirm: 'An soke oda. Tẹ MENU don fara daga farko! 👋',
    cancel_confirm_ordering: 'An soke oda. Tẹ MENU don duba kayan kuma! 👋',
    price_info: '💰 *{name}* yana da farashi *{price}*.\n\nAika lambarsa don ƙara zuwa cart, ko danna *MENU* don ganin komai.',
    product_not_found: "Yi hakuri, ba mu da wannan a yanzu. Danna *MENU* don ganin abin da muke da shi yau.",

    ask_quantity:
      'Ka zaɓi: *{name}* — {price}\n\nNawa kake so? (Amsa da lamba, misali *2*)',
    invalid_quantity: 'Don Allah shigar da adadi mai inganci (misali *1*, *2*, *3*).',
    max_cart_exceeded: 'Yi haƙuri, mafi yawan adadi a oda shine {max}. Tẹ *DONE* don biya.',
    item_added:
      '✅ An ƙara *{qty}x {name}* zuwa kwandon ka!\n\n' +
      '*Kwandon ka:*\n{cartLines}\n\n' +
      'Jimla: *{subtotal}*\n\n' +
      'Amsa da lamba don ƙara ƙarin.\n' +
      'Tẹ *DONE* don biya, ko *CLEAR* don sake fara kwandon ka.',
    cart_empty_checkout: 'Kwandon ka yana fanko! Da farko zaɓi aƙalla abu ɗaya.',
    cart_cleared: 'An share kwandon! Amsa da lamba don sake fara ƙara kaya.',
    cart_status_items:
      'Kana da kaya {count} a kwandon ka.\n\n' +
      'Amsa da lamba don ƙara ƙarin, *DONE* don biya, ko *CLEAR* don fara daga farko.',
    cart_status_empty:
      'Amsa da lamba don ƙara kaya, ko tẹ *MENU* don ganin jerin kayan.',

    ask_address:
      'Kusa da ƙarewa! 🚀\n\n*Kwandon ka:*\n{cartSummary}\n\n' +
      'Yanzu, don Allah aika *adireshin isar da oda* don mu san inda za mu kawo oda ka. 🏠',
    address_too_short:
      'Don Allah aika *cikakken adireshi na isar* da kai.\n\n' +
      'Misali: "12 Adeola Odeku Street, Victoria Island, Lagos"',
    confirm_address:
      '📍 *Adireshi na isar:* {address}\n\n{cartSummary}\n\n' +
      'Komai ya dace? Amsa *YES* don ci gaba da biyan kuɗi, ko *NO* don canza adireshin ka.',
    address_confirm_prompt:
      'Amsa *YES* don tabbatar da oda ka, ko *NO* don canza adireshin ka.',
    address_change_prompt: 'Babu matsala! Don Allah aika ingantaccen adireshin isar da kai:',
    cancel_address: 'An soke oda. Tẹ MENU don fara daga farko.',

    physical_payment_link:
      '💳 *Lokacin biyan kuɗi!*\n\n' +
      'Oda: *{orderId}*\nAdadi: *{amount}*\n\n' +
      '👉 Kammala biyan kuɗin ka anan:\n{paymentUrl}\n\n' +
      'Za a tabbatar da oda ka da zarar mun karɓi biyan kuɗin ka. ⏰\n' +
      'Haɗin gwiwar zai ƙare a cikin mintuna 30.',
    order_confirmed_customer:
      '🎉 *An karɓi kuɗi! An tabbatar da oda ka.*\n\n' +
      'ID Oda: *{orderId}*\nDaga: {vendorName}\n\n' +
      '*Abin da ka oda:*\n{cartSummary}\n\n' +
      'Za mu ci gaba da sabunta ka yayin da oda ka ke ci gaba. Na gode! 🙏',
    awaiting_payment:
      'Muna jiran tabbatarwar biyan kuɗin ka. 💳\n\n' +
      'Da zarar an karɓe shi, za a sarrafa oda ka nan take!\n\n' +
      'Idan ba ka biya ba tukuna, don Allah yi amfani da haɗin biyan kuɗin da muka aika.\n' +
      'Tẹ *CANCEL* don fara daga farko.',
    cancel_awaiting_payment: 'An soke oda. Tẹ MENU don fara sabuwar oda.',

    digital_welcome_header: 'Barka da zuwa *{vendorName}*! 📚',
    digital_welcome_subtitle: 'Ga abin da muke bayarwa:',
    digital_welcome_footer:
      'Amsa da *lamba* don ƙarin bayani ko siye.\nTẹ *CANCEL* don fita.',
    digital_product_detail:
      '📌 *{name}*\n\n{description}\n\n💰 Farashi: *{price}*\n\n' +
      'Amsa *BUY* don siye, ko *MENU* don koma zuwa jerin kayan.',
    digital_buy_prompt:
      'Amsa *BUY* don siye, *MENU* don koma zuwa jerin kayan, ko *CANCEL* don fita.',

    digital_payment_link:
      '💳 *Kammala siyan ka*\n\n' +
      'Kaya: *{productName}*\nOda: *{orderId}*\nAdadi: *{amount}*\n\n' +
      '👉 Biya anan:\n{paymentUrl}\n\n' +
      'Za ka sami *damar shiga nan take* da zarar an tabbatar da biyan kuɗin ka. 🎉',
    digital_delivery:
      '🎉 *An tabbatar da biyan kuɗi! Ga siyan ka.*\n\n' +
      '*{productName}*\nOda: *{orderId}*\n\n' +
      '{deliveryMessage}\n\n' +
      '🔗 *Haɗin shiga:*\n{deliveryContent}\n\n' +
      'Tambaya? Amsa wannan saƙon za mu taimaka maka! 🙏',
    digital_delivery_failed:
      'Mun tabbatar da biyan kuɗin ka na oda *{orderId}*, amma mun sami matsalar fasaha yayin aika kayan ka kai tsaye.\n\n' +
      "An sanar da tawagar mu kuma za su aika kayan ka da hannun su a cikin 'yan mintuna.\n\n" +
      'Yin haƙuri da damuwa! 🙏',

    // ── Inline / contextual messages ─────────────────────────────────────
    store_closed:
      '🕐 Kantin ya rufe a yanzu. Za mu buɗe da *{opensAt}* (lokacin Lagos).\n\n' +
      'Amma zaka iya duba ka sanya oda — *{vendorName}* zai kulawa da shi da zarar mun buɗe! 😊',
    confusion_loop:
      'Hmm, ina da wuyan fahimtar abin da kake cewa — yi haƙuri! 😅\n\n' +
      'Bari in kira mutum na gaskiya don taimaka maka.\n\n' +
      'Ina sanar da tawagar *{vendorName}* yanzu...',
    price_found:
      '✅ Ee, muna da *{name}* — {price}!\n\n' +
      'Kuna so ku ƙara zuwa kwandon ku? Amsa *YES* don ƙara ko tẹ *MENU* don ganin komai.',
    no_orders_yet:
      'Ba ka iya oda kowane abu tare da *{vendorName}* har yanzu.\n\nTẹ *MENU* don fara duba. 😊',
    order_status_found:
      '{emoji} *Oda {orderId}*\nMatsayi: *{statusLabel}*\n\n' +
      'An tabbatar da oda ka kuma *{vendorName}* yana kulawa da shi. ' +
      'Mai siyarwa zai tuntuɓe ka kai tsaye a WhatsApp don shirya isar da kaya.\n\n' +
      'Idan ba ka ji komawa cikin awanni 24, amsa *HELP* mu nuna shi a gare ka. 🙏',
    speak_to_vendor_msg:
      '🙋 *Kuna so ku yi magana da {vendorName}?*\n\n' +
      'Tawagar *{vendorName}* za a sanar kuma za su tuntuɓe ku nan da nan.\n\n' +
      'Kuna kuma iya:\n' +
      '• Tẹ *ORDER STATUS* don duba oda ka na ƙarshe\n' +
      '• Tẹ *HELP* don duk umarni masu yiwuwa\n' +
      '• Tẹ *MENU* don ci gaba da siyayya',
    reorder_loaded:
      'Kyau! Na ɗauki oda ka na ƙarshe: 🛒\n\n{cartLines}\n\nJumla: *{total}*\n\nAmsa *DONE* don biya ko *CLEAR* don fara sabon.',
    multi_cart_header: '🛒 An ƙara zuwa kwandon ka:',
    multi_cart_not_found_nums: '❌ Kaya *{nums}* ba a samun su cikin catalogue — an tsallake su.',
    multi_cart_footer_total: '💰 Jimillar kwando: *{total}*\n\nKa ci gaba da ƙara kaya ko tẹ *DONE* don biya.',
    multi_order_not_found: '❌ Hakuri, ba mu da: {names}',
    multi_order_footer: 'Amsa *DONE* don biya, ƙara kaya, ko *CART* don duba.',
    welcome_back_reorder:
      '👋 Maraba da dawowa, {name}! Muna farin ciki mu gan ka a *{vendorName}* 🛍️\n\n' +
      'Oda ka na ƙarshe: {itemSummary} ({total})\n\n' +
      'Kuna so ku maimaita shi? Amsa *YES* don sake oda nan take\n' +
      'ko *MENU* don ganin komai 😊',
    vendor_dashboard_welcome: '👋 Maraba da dawowa, *{businessName}*!\n\nMene ne kake so yi?',
    cmd_orders_none: 'Ba ka yi oda kowane abu ba tukuna.\n\nTẹ *MENU* don fara duba. 😊',
    cmd_orders_list: '📦 *Oda Ka {count} Na Ƙarshe*\n\n{lines}\n\nTẹ *MENU* don ci gaba da siyayya.',
    help_unknown:
      '📋 *Umarni na Pingmart*\n\n' +
      '🌐 *Yana aiki koyaushe:*\n' +
      '• *MENU* ko *HOME* — Fara\n' +
      '• *LANGUAGE* — Canza yarenka\n' +
      '• *HELP* ko *ASSIST* — Duba wannan jerin\n' +
      '• *CANCEL* ko *COMOT* — Soke abin da kake yi\n' +
      '• *RESET* — Share komai, fara sabon',
    help_customer:
      '📋 *Umarni na Pingmart*\n\n' +
      '🌐 *Yana aiki koyaushe:*\n' +
      '• *MENU* ko *HOME* — Babban allon\n' +
      '• *LANGUAGE* — Canza yarenka\n' +
      '• *HELP* ko *ASSIST* — Jerin umarni\n' +
      '• *CANCEL* ko *COMOT* — Soke matakin yanzu\n' +
      '• *SKIP* — Tsallake matakin zaɓi\n' +
      '• *RESET* — Fara daga farko gaba ɗaya\n\n' +
      '🛒 *Siyayya:*\n' +
      '• *CART* ko *MY CART* — Duba kwandon ka\n' +
      '• *DONE* ko *I DON FINISH* — Je biya\n' +
      '• *CLEAR* — Wanke kwandon ka\n' +
      '• *ORDERS* — Oda ka na ƙarshe 5',
    help_vendor:
      '📋 *Umarni na Pingmart*\n\n' +
      '🌐 *Yana aiki koyaushe:*\n' +
      '• *MENU* ko *HOME* — Dashboard\n' +
      '• *LANGUAGE* — Canza yarenka\n' +
      '• *HELP* ko *ASSIST* — Jerin umarni\n' +
      '• *CANCEL* ko *COMOT* — Soke matakin yanzu\n' +
      '• *RESET* — Fara sabon\n\n' +
      '🏪 *Gudanar da Shago:*\n' +
      '• *DASHBOARD* — Je dashboard ɗinka\n' +
      '• *ADD* — Ƙara kaya\n' +
      '• *CATALOGUE* — Duba kayanka\n' +
      '• *HOURS* — Sabunta awannin aiki\n' +
      '• *PAUSE* ko *CLOSE SHOP* — Dakatar da shagonka\n' +
      '• *RESUME* ko *OPEN SHOP* — Sake buɗe shago\n' +
      '• *EDITED* — Sanar da bot cewa ka gyara sheet ɗinka\n' +
      '• *HANDLED* — Nuna cewa matsalar abokin ciniki ta ƙare',
  },
};
