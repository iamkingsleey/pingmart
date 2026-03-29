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
    lang_selected: "✅ Great! We'll chat in English. 🇳🇬\n\nType anything to see our catalog.",
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
    lang_selected: '✅ Oya! We go yarn for Pidgin. 🇳🇬\n\nType anything to see wetin we get.',
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
    lang_selected: '✅ Ọ dị mma! Anyị ga-asụ Igbo. 🇳🇬\n\nTinye ihe ọ bụla ịhụ ihe anyị nwere.',
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
    lang_selected: '✅ Dáadáa! A ó sọ Yorùbá. 🇳🇬\n\nTẹ ohunkohun láti rí ohun tí a ní.',
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
    lang_selected: '✅ Kyau! Za mu yi magana da Hausa. 🇳🇬\n\nTẹ kowane abu don ganin abin da muke da shi.',
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
  },
};
