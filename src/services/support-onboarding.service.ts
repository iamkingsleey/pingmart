/**
 * Support Mode Onboarding — service-based vendors (laundry, salon, repair, etc.)
 *
 * Steps (VendorSetupSession.step values):
 *   SUPPORT_ADDING_SERVICES — vendor lists their services with pricing
 *   SUPPORT_ADDING_FAQS     — vendor adds FAQ pairs (skippable)
 *   PAYMENT_SETUP           — shared with product store flow (bank / Paystack)
 *   SUPPORT_CONFIRMATION    — shows full summary, waits for GO LIVE
 *
 * Exported functions called from vendor-onboarding.service.ts (for routing) and
 * called directly by the router for support onboarding steps.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Vendor, VendorSetupSession, Prisma } from '@prisma/client';
import { prisma } from '../repositories/prisma';
import { messageQueue } from '../queues/message.queue';
import { InteractiveButton } from '../types';
import { encryptBankAccount } from '../utils/crypto';
import { logger, maskPhone } from '../utils/logger';
import { env } from '../config/env';
import { Language } from '../i18n';
import { getVendorLang } from '../utils/vendor-lang';
import { classifyOffScriptMessage } from './llm.service';
import { OFFSCRIPT_CONFIDENCE_THRESHOLD } from '../config/constants';

type PrismaJson = Prisma.InputJsonValue;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceItemInput {
  name: string;
  price: number; // naira (converted to kobo on save)
  unit?: string; // pricing description exactly as vendor stated; absent = inferred default
  turnaroundHours?: number;
  description?: string;
}

export interface SupportCollectedData {
  // Core info (set during COLLECTING_INFO — shared)
  businessName?: string;
  storeCode?: string;
  businessType?: string;
  description?: string;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  workingDays?: string;
  paymentMethod?: string;

  // Payment details
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  paystackKeyProvided?: boolean;

  // Support-specific
  vendorMode: 'support';
  serviceLocationType?: 'fixed' | 'pickup' | 'both'; // where services are delivered
  services?: ServiceItemInput[];
  pendingServices?: ServiceItemInput[]; // awaiting confirmation gate
  faqs?: Array<{ question: string; answer: string }>;

  // Shared signals
  storeCodeConflict?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;

  // Notification numbers (collected in NOTIFICATION_SETUP, before confirmation)
  notificationNumbers?: string[];
}

// ─── LLM Client ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─── Service type vocabulary ──────────────────────────────────────────────────

const SERVICE_TYPE_LABELS: Record<string, string> = {
  laundry:    'Laundry & Dry Cleaning',
  salon:      'Salon & Spa',
  cleaning:   'Cleaning Services',
  repair:     'Repairs & Maintenance',
  tailoring:  'Tailoring & Fashion',
  logistics:  'Logistics & Delivery',
  consulting: 'Consulting & Training',
  events:     'Events & Hospitality',
};

function serviceTypeLabel(businessType?: string): string {
  return SERVICE_TYPE_LABELS[businessType ?? ''] ?? 'Services';
}

function serviceTypeEmoji(businessType?: string): string {
  const map: Record<string, string> = {
    laundry: '👔', salon: '💇', cleaning: '🧹', repair: '🔧',
    tailoring: '🧵', logistics: '🚚', consulting: '💼', events: '🎉',
  };
  return map[businessType ?? ''] ?? '🛠️';
}

function capitalise(str?: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Support Mode Translations ────────────────────────────────────────────────

type LangMap = Record<Language, string>;
type LangFn<T extends unknown[]> = Record<Language, (...args: T) => string>;

/** Quick accessor — returns the value for the given language, falling back to 'en'. */
function sl(map: LangMap, lang: Language): string {
  return map[lang] ?? map.en;
}
function sf<T extends unknown[]>(map: LangFn<T>, lang: Language, ...args: T): string {
  return (map[lang] ?? map.en)(...args);
}

const SUPPORT_T = {
  // ── startSupportServicesStep ───────────────────────────────────────────────
  svcMenuTitle: {
    en:  (emoji: string, label: string) => `${emoji} *Let's set up your ${label} menu!*\n\nFirst — where do your customers receive your services?`,
    pid: (emoji: string, label: string) => `${emoji} *Make we set up your ${label} menu!*\n\nFirst — where your customers dey collect your service?`,
    ig:  (emoji: string, label: string) => `${emoji} *Ka anyị hazie menu ${label} gị!*\n\nNke mbụ — ebee ndị ahịa gị na-enweta ọrụ gị?`,
    yo:  (emoji: string, label: string) => `${emoji} *Jẹ ká ṣètò àtòjọ ${label} rẹ!*\n\nNí àkọ́kọ́ — níbo ni àwọn onígbọ̀wọ́ rẹ ti ń gbà ìpèsè rẹ?`,
    ha:  (emoji: string, label: string) => `${emoji} *Bari mu saita menu ${label} ku!*\n\nNa farko — ina abokan ciniki ku ke karɓar sabis ku?`,
  } as LangFn<[string, string]>,

  // ── Location type confirmed + list prompt ──────────────────────────────────
  svcLocConfirm: {
    en:  (locLabel: string, serviceLabel: string) =>
      `✅ Got it — ${locLabel}\n\nNow list your ${serviceLabel.toLowerCase()}! You can write them however makes sense for your business:\n\n_Shirt — ₦800_\n_Senator wear — ₦1,500_\n_Regular wash — ₦500 per kg_\n_Ironing only — ₦500 flat_\n_Pick up and delivery — ₦1,000_\n\nList as many as you like, then type *DONE* when finished.`,
    pid: (locLabel: string, serviceLabel: string) =>
      `✅ I don hear — ${locLabel}\n\nNow list your ${serviceLabel.toLowerCase()}! You fit write them however e make sense for your business:\n\n_Shirt — ₦800_\n_Senator wear — ₦1,500_\n_Regular wash — ₦500 per kg_\n_Ironing only — ₦500 flat_\n_Pick up and delivery — ₦1,000_\n\nList as many as you want, then type *DONE* when you finish.`,
    ig:  (locLabel: string, serviceLabel: string) =>
      `✅ Enwetara m — ${locLabel}\n\nKa ị depụta ${serviceLabel.toLowerCase()} gị ugbu a! I nwere ike ide ha ka ọ bụla dị mma maka azụmaahịa gị:\n\n_Kọọtụ — ₦800_\n_Ịkwụ ụgwọ kwa uro — ₦500_\n\nDepụta ole i chọrọ, wee pịa *DONE* mgbe i mechara.`,
    yo:  (locLabel: string, serviceLabel: string) =>
      `✅ Mo gbọ́ — ${locLabel}\n\nNísisìyí ṣe àkójọ ${serviceLabel.toLowerCase()} rẹ! O lè kọ wọn bíi o ti fẹ́ fún iṣòwò rẹ:\n\n_Aṣọ — ₦800_\n_Wíwẹ gbogbo ara — ₦500_\n\nṢe àkójọ bí o ti fẹ́, lẹ́hìn náà tẹ *DONE* nígbàtí o parí.`,
    ha:  (locLabel: string, serviceLabel: string) =>
      `✅ Na ji — ${locLabel}\n\nYanzun lissafin ${serviceLabel.toLowerCase()} ku! Zaka iya rubuta su yadda ya dace da kasuwancin ku:\n\n_Rigar — ₦800_\n_Wanka kowace rana — ₦500_\n\nRubuta duk wanda kuke so, sannan buga *DONE* idan kun kammala.`,
  } as LangFn<[string, string]>,

  // ── Pending gate: CONFIRM_SERVICES ────────────────────────────────────────
  svcConfirmed: {
    en:  (names: string, total: number) => `✅ ${names} added!\n\nYou have *${total}* service${total !== 1 ? 's' : ''} so far.\n\nSend more services or type *DONE* to continue. 😊`,
    pid: (names: string, total: number) => `✅ ${names} don enter!\n\nYou get *${total}* service${total !== 1 ? 's' : ''} so far.\n\nSend more service or type *DONE* to continue. 😊`,
    ig:  (names: string, total: number) => `✅ Etinye ${names}!\n\nI nwere *${total}* ọrụ${total !== 1 ? '' : ''} ugbu a.\n\nZiga ọrụ ndị ọzọ ma ọ bụ pịa *DONE* ka i gaa n'ihu. 😊`,
    yo:  (names: string, total: number) => `✅ ${names} ti fíẹ kún!\n\nO ní *${total}* ìpèsè tí a bọ́ mọ́ tẹ́lẹ̀.\n\nFi àwọn ìpèsè mìíràn kún tàbí pọn *DONE* láti bá a lọ. 😊`,
    ha:  (names: string, total: number) => `✅ ${names} an ƙara!\n\nKuna da *${total}* sabis har yanzu.\n\nAika ƙarin sabis ko buga *DONE* don ci gaba. 😊`,
  } as LangFn<[string, number]>,

  // ── Pending gate: CANCEL_SERVICES ─────────────────────────────────────────
  svcCancelled: {
    en:  `No problem! Send your services again — any format works. 😊`,
    pid: `No wahala! Send your services again — any format dey work. 😊`,
    ig:  `Ọ dịghị nsogbu! Ziputakwa ọrụ gị ọzọ — ụdị ọ bụla na-arụ ọrụ. 😊`,
    yo:  `Kò sí ìṣòro! Fi àwọn ìpèsè rẹ ránṣẹ́ lẹ́ẹ̀kan sí i — ìdánwò eyíkeyi ṣiṣẹ́. 😊`,
    ha:  `Babu matsala! Aika sabis ɗin ku sake — kowanne tsari yana aiki. 😊`,
  } as LangMap,

  // ── DONE with no services ──────────────────────────────────────────────────
  svcNoneYet: {
    en:  `You haven't added any services yet! Send your first service to continue. 😊`,
    pid: `You never add any service yet! Send your first service to continue. 😊`,
    ig:  `Ị adịghị etinye ọrụ ọ bụla ka! Zipụ ọrụ mbụ gị ka i gaa n'ihu. 😊`,
    yo:  `O kò tíì fi ìpèsè kankan kún! Fi ìpèsè àkọ́kọ́ rẹ ránṣẹ́ láti bá a lọ. 😊`,
    ha:  `Ba ku ƙara wani sabis ba tukuna! Aika sabis ɗin farko ku don ci gaba. 😊`,
  } as LangMap,

  // ── Parse error ────────────────────────────────────────────────────────────
  svcParseError: {
    en:
      `I couldn't quite catch that. Try something like:\n\n` +
      `_Shirt — ₦800_\n_Regular wash — ₦500 per kg_\n_Pick up and delivery — ₦1,000_\n\n` +
      `Or list several at once: _"Shirt 800, trousers 1000, suit 3500"_ 😊`,
    pid:
      `I no understand wetin you write. Try am like this:\n\n` +
      `_Shirt — ₦800_\n_Regular wash — ₦500 per kg_\n_Pick up and delivery — ₦1,000_\n\n` +
      `Or list many at once: _"Shirt 800, trousers 1000, suit 3500"_ 😊`,
    ig:
      `Enweghị m ike ịghọta ya. Nwalee ihe dị otú a:\n\n` +
      `_Kọọtụ — ₦800_\n_Ịsa ọcha oge niile — ₦500 kwa kg_\n_Ịkwọ na ibu — ₦1,000_\n\n` +
      `Ma ọ bụ depụta ọtụtụ n'otu oge: _"Kọọtụ 800, trowza 1000, sutu 3500"_ 😊`,
    yo:
      `Mi ò lè mọ ohun tí o kọ. Gbìyànjú irú rẹ:\n\n` +
      `_Aṣọ — ₦800_\n_Wíwẹ déédéé — ₦500 fún kg_\n_Gbígba àti gbígbé lọ — ₦1,000_\n\n` +
      `Tàbí ṣe àkójọ àwọn ọ̀pọ̀lọpọ̀ lọ́kan sì: _"Aṣọ 800, trouser 1000, suit 3500"_ 😊`,
    ha:
      `Ban fahimci abin da kuka rubuta ba. Gwada kamar haka:\n\n` +
      `_Riga — ₦800_\n_Wanki na yau da kullum — ₦500 a kowanne kg_\n_Ɗaukar kaya — ₦1,000_\n\n` +
      `Ko lissafin da yawa a lokaci ɗaya: _"Riga 800, wandon 1000, suit 3500"_ 😊`,
  } as LangMap,

  // ── showPendingServicesConfirmation ────────────────────────────────────────
  svcGotItSingle: {
    en:  (emoji: string, name: string, price: string) => `Got it! Here's what I'm adding:\n\n${emoji} *${name}*\n💰 ${price}\n\nIs this correct?`,
    pid: (emoji: string, name: string, price: string) => `I don see am! This na wetin I wan add:\n\n${emoji} *${name}*\n💰 ${price}\n\nE correct?`,
    ig:  (emoji: string, name: string, price: string) => `Nwetara m! Nke a bụ ihe m na-etinye:\n\n${emoji} *${name}*\n💰 ${price}\n\nO dị mma?`,
    yo:  (emoji: string, name: string, price: string) => `Mo gbọ́! Ìyí ni mo ń fi kún:\n\n${emoji} *${name}*\n💰 ${price}\n\nṢé o tọ̀?`,
    ha:  (emoji: string, name: string, price: string) => `Na sami! Wannan ne zan ƙara:\n\n${emoji} *${name}*\n💰 ${price}\n\nYa dace?`,
  } as LangFn<[string, string, string]>,

  svcGotItMulti: {
    en:  (lines: string, count: number) => `Got it! Here's what I'm adding:\n\n${lines}\n\nSave all ${count} services?`,
    pid: (lines: string, count: number) => `I don see them! This na wetin I wan add:\n\n${lines}\n\nSave all ${count} service?`,
    ig:  (lines: string, count: number) => `Nwetara m! Ndị a bụ ihe m na-etinye:\n\n${lines}\n\nChekwaa ọrụ ${count} niile?`,
    yo:  (lines: string, count: number) => `Mo gbọ́! Ìwọnyí ni mo ń fi kún:\n\n${lines}\n\nFipamọ́ gbogbo ìpèsè ${count}?`,
    ha:  (lines: string, count: number) => `Na sami! Waɗannan ne zan ƙara:\n\n${lines}\n\nAdana duk sabis ${count}?`,
  } as LangFn<[string, number]>,

  // ── advanceToFaqStep ───────────────────────────────────────────────────────
  faqTeach: {
    en:
      `🧠 *Teach your bot!*\n\n` +
      `Add common customer questions and answers so I can handle enquiries automatically.\n\n` +
      `Format each FAQ like this:\n` +
      `*Q: Your question here?*\n*A: Your answer here.*\n\n` +
      `Example:\n*Q: Do you offer same-day service?*\n*A: Yes! Same-day is available for ₦500 extra within Lagos.*\n\n` +
      `You can add multiple FAQs at once. Type *SKIP* to set up payment first and add FAQs later.`,
    pid:
      `🧠 *Teach your bot!*\n\n` +
      `Add common customer question and answer so I fit handle enquiry automatically.\n\n` +
      `Format each FAQ like this:\n` +
      `*Q: Your question here?*\n*A: Your answer here.*\n\n` +
      `Example:\n*Q: You dey do same day service?*\n*A: Yes! Same day dey available for ₦500 extra inside Lagos.*\n\n` +
      `You fit add plenty FAQ at once. Type *SKIP* to set up payment first and add FAQ later.`,
    ig:
      `🧠 *Kụziere bot gị!*\n\n` +
      `Tinye ajụjụ ndị ahịa na aza ha ka m nwee ike ikwado ajụjụ na-akpaaka.\n\n` +
      `Hazie FAQ nke ọ bụla dị otú a:\n` +
      `*Q: Ajụjụ gị ebe a?*\n*A: Aza gị ebe a.*\n\n` +
      `Ihe atụ:\n*Q: Ị na-eme ọrụ otu ụbọchị?*\n*A: Ee! Ọ dị n'ọnọdụ maka ₦500 ọzọ n'ime Lagos.*\n\n` +
      `I nwere ike itinye ọtụtụ FAQ n'otu oge. Pịa *SKIP* ka i hazie ọkwụ ụgwọ gaa n'ihu.`,
    yo:
      `🧠 *Kọ́ bọọtì rẹ!*\n\n` +
      `Fi àwọn ìbéèrè àti àwọn ìdáhùn àwọn onígbọ̀wọ́ tó wọ́pọ̀ kún kí n lè ṣàkóso àwọn ìbéèrè fúnra rẹ̀ àtọwọ́dọwọ́.\n\n` +
      `Formatì FAQ kọ̀ọ̀kan bíi èyí:\n` +
      `*Q: Ìbéèrè rẹ níbí?*\n*A: Ìdáhùn rẹ níbí.*\n\n` +
      `Àpẹẹrẹ:\n*Q: Ṣé ẹ ń fúnni ní ìpèsè ọjọ́ kan náà?*\n*A: Bẹẹni! Ọjọ́ kan náà wà fún ₦500 àfikún ní Lágọ̀s.*\n\n` +
      `O lè fi ọ̀pọ̀lọpọ̀ FAQ kun lọ́kan sì. Pọn *SKIP* láti ṣètò owó ìsanwó àkọ́kọ́.`,
    ha:
      `🧠 *Koyar da bot ɗin ku!*\n\n` +
      `Ƙara tambayoyin abokan ciniki da amsoshi domin in iya sarrafa tambayoyi ta atomatik.\n\n` +
      `Formatance kowace FAQ haka:\n` +
      `*Q: Tambayar ku anan?*\n*A: Amsar ku anan.*\n\n` +
      `Misali:\n*Q: Kuna yi sabis ɗin rana guda?*\n*A: Eh! Ana samun ranar guda akan ₦500 ƙari a cikin Lagos.*\n\n` +
      `Za ku iya ƙara FAQs da yawa a lokaci ɗaya. Buga *SKIP* don saita biyan kuɗi da farko.`,
  } as LangMap,

  // ── handleSupportAddingFaqs parse error ────────────────────────────────────
  faqParseError: {
    en:
      `I couldn't extract a Q&A pair from that. Please use this format:\n\n` +
      `*Q: Do you offer home service?*\n*A: Yes! We pick up and deliver same day.*\n\n` +
      `Or type *SKIP* to continue without FAQs. 😊`,
    pid:
      `I no fit extract Q&A pair from that. Please use this format:\n\n` +
      `*Q: You dey do home service?*\n*A: Yes! We dey pick up and deliver same day.*\n\n` +
      `Or type *SKIP* to continue without FAQ. 😊`,
    ig:
      `Enweghị m ike ịwepụta ụzo Q&A sitere n'ya. Jiri ụdị a:\n\n` +
      `*Q: Ị na-enye ọrụ ụlọ?*\n*A: Ee! Anyị na-agwọta ma nnyefe n'otu ụbọchị.*\n\n` +
      `Ma ọ bụ pịa *SKIP* ka i gaa n'ihu na-enweghị FAQ. 😊`,
    yo:
      `Mi ò lè yọ ọ̀wọ̀n Q&A jáde. Jọ̀wọ́ lo ìdánwò yìí:\n\n` +
      `*Q: Ṣé ẹ ń fúnni ní ìpèsè ilé?*\n*A: Bẹẹni! A máa ń gbà àti jiṣẹ́ ní ọjọ́ kan náà.*\n\n` +
      `Tàbí pọn *SKIP* láti bá a lọ láìsí FAQs. 😊`,
    ha:
      `Ba zan iya fitar da ɗan Q&A ba. Don Allah yi amfani da wannan format:\n\n` +
      `*Q: Kuna yi sabis ɗin gida?*\n*A: Eh! Muna ɗaukar kaya kuma muna kai a rana guda.*\n\n` +
      `Ko buga *SKIP* don ci gaba ba tare da FAQs ba. 😊`,
  } as LangMap,

  // ── handleSupportAddingFaqs saved ──────────────────────────────────────────
  faqSaved: {
    en:  (count: number, total: number, lines: string) => `✅ FAQ${count > 1 ? 's' : ''} saved!\n\n${lines}\n\nYou now have *${total}* FAQ${total !== 1 ? 's' : ''}. Add more or type *DONE* to continue with payment setup.`,
    pid: (count: number, total: number, lines: string) => `✅ FAQ${count > 1 ? 's' : ''} don save!\n\n${lines}\n\nYou don get *${total}* FAQ${total !== 1 ? 's' : ''} now. Add more or type *DONE* to continue with payment setup.`,
    ig:  (count: number, total: number, lines: string) => `✅ Zachara FAQ${count > 1 ? '' : ''}!\n\n${lines}\n\nI nwere ugbu a *${total}* FAQ${total !== 1 ? '' : ''}. Tinye ndị ọzọ ma ọ bụ pịa *DONE* ka i gaa n'ihu.`,
    yo:  (count: number, total: number, lines: string) => `✅ FAQ${count > 1 ? 's' : ''} ti fipamọ́!\n\n${lines}\n\nO ní *${total}* FAQ${total !== 1 ? 's' : ''} nísisìyí. Fi àwọn mìíràn kún tàbí pọn *DONE* láti bá a lọ.`,
    ha:  (count: number, total: number, lines: string) => `✅ FAQ${count > 1 ? 's' : ''} an adana!\n\n${lines}\n\nKuna da *${total}* FAQ${total !== 1 ? 's' : ''} yanzu. Ƙara ƙari ko buga *DONE* don ci gaba.`,
  } as LangFn<[number, number, string]>,

  // ── advanceToPaymentSetup ──────────────────────────────────────────────────
  paymentSetup: {
    en:
      `Almost done! 🎉 Let's set up how your customers will pay.\n\n` +
      `*⚡ Paystack Transfer* — Customers transfer to a dedicated virtual account. Payment is confirmed automatically.\n\n` +
      `*🏦 Bank Transfer* — Customers transfer to your regular bank account and you manually confirm receipt.\n\n` +
      `Which would you prefer?`,
    pid:
      `Almost done! 🎉 Make we set up how your customers go pay.\n\n` +
      `*⚡ Paystack Transfer* — Customers go transfer to dedicated virtual account. Payment go confirm automatically.\n\n` +
      `*🏦 Bank Transfer* — Customers go transfer to your regular bank account and you go confirm am yourself.\n\n` +
      `Which one you prefer?`,
    ig:
      `Eruo na njedebe! 🎉 Ka anyị hazie otu ndị ahịa gị ga-akwụ ụgwọ.\n\n` +
      `*⚡ Paystack Transfer* — Ndị ahịa na-ebugafe na akaụntụ vachi pụrụ iche. A na-akwado ịkwụ ụgwọ na-akpaaka.\n\n` +
      `*🏦 Bank Transfer* — Ndị ahịa na-ebugafe na akaụntụ ụlọ akụ nke gị ma i kwado na aka.\n\n` +
      `Kedu nke ịchọrọ?`,
    yo:
      `Ó fẹ́rẹ̀ parí! 🎉 Jẹ ká ṣètò bí àwọn onígbọ̀wọ́ rẹ yóò sanwó.\n\n` +
      `*⚡ Paystack Transfer* — Àwọn onígbọ̀wọ́ máa ń gbà sí akaùntì àpẹẹrẹ tó yàtọ̀. A ó fọwọ́ sí ìsanwó lọ́tọ̀-ọtọ̀.\n\n` +
      `*🏦 Bank Transfer* — Àwọn onígbọ̀wọ́ máa ń gbà sí akaùntì bánkì rẹ dáadáa kí o sì fọwọ́ sí fúnra rẹ.\n\n` +
      `Etí wo ni o fẹ́?`,
    ha:
      `Kusan kammala! 🎉 Bari mu saita yadda abokan ciniki ku za su biya.\n\n` +
      `*⚡ Paystack Transfer* — Abokan ciniki suna canja zuwa asusu na musamman. Ana tabbatar da biyan kuɗi ta atomatik.\n\n` +
      `*🏦 Bank Transfer* — Abokan ciniki suna canja zuwa asusun bankin ku na yau da kullum kuma ku tabbatar da karɓar da hannun ku.\n\n` +
      `Wanne kuke son?`,
  } as LangMap,

  // ── handleSupportConfirmation bank re-enter ────────────────────────────────
  bankReEnter: {
    en:  `No problem! Please re-enter your bank details:\n*Bank Name | Account Number | Account Name*\n\nExample: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
    pid: `No wahala! Please type your bank details again:\n*Bank Name | Account Number | Account Name*\n\nExample: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
    ig:  `Ọ dịghị nsogbu! Biko tinye nkọwa ụlọ akụ gị ọzọ:\n*Bank Name | Account Number | Account Name*\n\nIhe atụ: _GTBank | 0123456789 | Chukwuemeka Obi_`,
    yo:  `Kò sí ìṣòro! Jọ̀wọ́ tún fi àwọn àlàyé bánkì rẹ kún:\n*Bank Name | Account Number | Account Name*\n\nÀpẹẹrẹ: _GTBank | 0123456789 | Àdùnọlá Akínwálé_`,
    ha:  `Babu matsala! Don Allah shigar da bayanan bankin ku sake:\n*Bank Name | Account Number | Account Name*\n\nMisali: _GTBank | 0123456789 | Mallam Ahmed Suya_`,
  } as LangMap,

  // ── CHANGE prompt ──────────────────────────────────────────────────────────
  changePrompt: {
    en:  `What would you like to change? Just tell me and I'll update it. 😊`,
    pid: `Wetin you wan change? Just tell me and I go update am. 😊`,
    ig:  `Gịnị ka ị chọrọ ịgbanwe? Naanị gwa m ma m ga-emelite ya. 😊`,
    yo:  `Kí ni o fẹ́ yí padà? Sọ fún mi nìkan kí n mú u ṣe àtúnṣe. 😊`,
    ha:  `Mene ne kuke son canzawa? Kawai gaya mani kuma zan sabunta shi. 😊`,
  } as LangMap,

  // ── showSupportConfirmation footer ────────────────────────────────────────
  summaryGoLive: {
    en:  `Everything look good? Tap *Go Live* to launch your support page!`,
    pid: `Everything look correct? Tap *Go Live* to launch your support page!`,
    ig:  `Ihe niile dị mma? Pịa *Go Live* ka i malite ibe nkwado gị!`,
    yo:  `Gbogbo ohun wo dára? Tẹ *Go Live* láti ṣí ojú-ewé ìtìlẹ́yìn rẹ!`,
    ha:  `Komai yayi kyau? Danna *Go Live* don ƙaddamar da shafin tallafi ku!`,
  } as LangMap,

  // ── activateSupportStore message 1 ────────────────────────────────────────
  activated: {
    en:  (name: string, link: string) =>
      `🚀 *${name} is now LIVE on Pingmart!*\n\n` +
      `🔗 *Your Store Link*\n${link}\n\n` +
      `_Share this link with customers and they can:_\n` +
      `📋 View your services\n📅 Book appointments\n💬 Ask questions — answered by your bot 24/7\n\n` +
      `📣 *Share your link on:*\n📱 WhatsApp Status · 📸 Instagram Bio · 💬 Customer groups`,
    pid: (name: string, link: string) =>
      `🚀 *${name} don go LIVE on Pingmart!*\n\n` +
      `🔗 *Your Store Link*\n${link}\n\n` +
      `_Share this link with your customers make dem:_\n` +
      `📋 See your services\n📅 Book appointment\n💬 Ask question — your bot go answer 24/7\n\n` +
      `📣 *Share your link for:*\n📱 WhatsApp Status · 📸 Instagram Bio · 💬 Customer groups`,
    ig:  (name: string, link: string) =>
      `🚀 *${name} adị ugbu a LIVE na Pingmart!*\n\n` +
      `🔗 *Link Ụlọ Ahịa Gị*\n${link}\n\n` +
      `_Kesaa link a nye ndị ahịa gị ka ha nwee ike:_\n` +
      `📋 Lelee ọrụ gị\n📅 Mee nkwa\n💬 Ajụọ ajụjụ — bot gị ga-aza 24/7\n\n` +
      `📣 *Kesaa link gị na:*\n📱 WhatsApp Status · 📸 Instagram Bio · 💬 Otu ndị ahịa`,
    yo:  (name: string, link: string) =>
      `🚀 *${name} ti wà ní LIVE lórí Pingmart!*\n\n` +
      `🔗 *Atọ Ilé Ìtajà Rẹ*\n${link}\n\n` +
      `_Pin atọ yìí fún àwọn onígbọ̀wọ́ rẹ kí wọ́n lè:_\n` +
      `📋 Wo àwọn ìpèsè rẹ\n📅 Ṣe àkọsílẹ̀ àpẹjọ\n💬 Béèrè àwọn ìbéèrè — bọọtì rẹ máa ń dáhùn 24/7\n\n` +
      `📣 *Pín atọ rẹ lórí:*\n📱 WhatsApp Status · 📸 Instagram Bio · 💬 Àwọn ẹgbẹ́ onígbọ̀wọ́`,
    ha:  (name: string, link: string) =>
      `🚀 *${name} yanzu yana LIVE a Pingmart!*\n\n` +
      `🔗 *Haɗin Kantin ku*\n${link}\n\n` +
      `_Raba wannan haɗin da abokan ciniki ku domin su iya:_\n` +
      `📋 Kalli sabis ɗin ku\n📅 Yi randevú\n💬 Yi tambayoyi — bot ɗin ku zai amsa 24/7\n\n` +
      `📣 *Raba haɗin ku a:*\n📱 WhatsApp Status · 📸 Instagram Bio · 💬 Ƙungiyoyin abokan ciniki`,
  } as LangFn<[string, string]>,

  // ── activateSupportStore dashboard prompt ─────────────────────────────────
  dashboardPrompt: {
    en:  `What would you like to do first?`,
    pid: `Wetin you wan do first?`,
    ig:  `Gịnị ka ị chọrọ ime izizi?`,
    yo:  `Kí ni o fẹ́ ṣe àkọ́kọ́?`,
    ha:  `Me kuke son yi da farko?`,
  } as LangMap,
};

function formatHours(data: SupportCollectedData): string {
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

function locationTypeLabel(locationType?: string): string {
  switch (locationType) {
    case 'fixed':  return '🏠 Fixed location (customers come to you)';
    case 'pickup': return '🚚 Mobile (you go to customers)';
    case 'both':   return '🔄 Both (fixed + mobile)';
    default:       return 'Not specified';
  }
}

// ─── Entry Point: Start Services Collection ───────────────────────────────────

/**
 * Called by vendor-onboarding.service.ts immediately after COLLECTING_INFO completes
 * for a service-based vendor. Shows the location type selection screen.
 */
export async function startSupportServicesStep(
  phone: string,
  data: SupportCollectedData,
): Promise<void> {
  const emoji = serviceTypeEmoji(data.businessType);
  const label = serviceTypeLabel(data.businessType);
  const lang  = await getVendorLang(phone);

  await messageQueue.add({
    to: phone,
    message: sf(SUPPORT_T.svcMenuTitle, lang, emoji, label),
    buttons: [
      { id: 'SVC_LOC:fixed',  title: '🏠 Fixed Location' },
      { id: 'SVC_LOC:pickup', title: '🚚 We Come to Them' },
      { id: 'SVC_LOC:both',   title: '🔄 Both' },
    ] as InteractiveButton[],
  });
}

// ─── Step: SUPPORT_ADDING_SERVICES ────────────────────────────────────────────

export async function handleSupportAddingServices(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const trimmed  = message.trim();
  const upper    = trimmed.toUpperCase();
  const services = data.services ?? [];
  const lang     = await getVendorLang(phone);

  // ── 1. Location type selection buttons ───────────────────────────────────
  if (trimmed.startsWith('SVC_LOC:')) {
    const loc = trimmed.slice(8).toLowerCase() as 'fixed' | 'pickup' | 'both';
    if (!['fixed', 'pickup', 'both'].includes(loc)) {
      await startSupportServicesStep(phone, data);
      return;
    }
    const newData: SupportCollectedData = { ...data, serviceLocationType: loc };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });

    const label = serviceTypeLabel(data.businessType);
    await messageQueue.add({
      to: phone,
      message: sf(SUPPORT_T.svcLocConfirm, lang, locationTypeLabel(loc), label),
    });
    return;
  }

  // ── 2. No location type yet ───────────────────────────────────────────────
  if (!data.serviceLocationType) {
    await startSupportServicesStep(phone, data);
    return;
  }

  // ── 3. Pending confirmation gate ──────────────────────────────────────────
  if (data.pendingServices?.length) {
    if (upper === 'CONFIRM_SERVICES') {
      const newServices = [...services, ...data.pendingServices];
      const newData: SupportCollectedData = {
        ...data,
        services: newServices,
        pendingServices: undefined,
      };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as PrismaJson },
      });
      const names = data.pendingServices.map((s) => `*${s.name}*`).join(', ');
      await messageQueue.add({
        to: phone,
        message: sf(SUPPORT_T.svcConfirmed, lang, names, newServices.length),
      });
      return;
    }

    if (upper === 'CANCEL_SERVICES') {
      const newData: SupportCollectedData = { ...data, pendingServices: undefined };
      await prisma.vendorSetupSession.update({
        where: { id: session.id },
        data: { collectedData: newData as unknown as PrismaJson },
      });
      await messageQueue.add({
        to: phone,
        message: sl(SUPPORT_T.svcCancelled, lang),
      });
      return;
    }

    // Anything else — re-show the confirmation
    await showPendingServicesConfirmation(phone, data.pendingServices, data.businessType, lang);
    return;
  }

  // ── 4. DONE command ───────────────────────────────────────────────────────
  if (upper === 'DONE' || upper === 'FINISH') {
    if (services.length === 0) {
      await messageQueue.add({
        to: phone,
        message: sl(SUPPORT_T.svcNoneYet, lang),
      });
      return;
    }
    await advanceToFaqStep(phone, vendor, session, data);
    return;
  }

  // ── 5. Try pipe-parsing first, then LLM ──────────────────────────────────
  const pipeParsed = tryParsePipeServices(trimmed);
  let extracted: ServiceItemInput[] | null = pipeParsed;

  if (!extracted) {
    extracted = await extractServicesWithLLM(trimmed, data.businessType);
  }

  if (!extracted || extracted.length === 0) {
    // Before sending the format-guide error, check if the message is off-script
    // (pause, confusion, question) and respond contextually in the vendor's language.
    const offScript = await classifyOffScriptMessage(
      trimmed,
      'service listing step — expecting service names and prices',
      lang,
    );
    if (
      offScript.category !== 'IN_FLOW' &&
      offScript.confidence >= OFFSCRIPT_CONFIDENCE_THRESHOLD &&
      offScript.reply
    ) {
      await messageQueue.add({ to: phone, message: offScript.reply });
      return;
    }

    await messageQueue.add({
      to: phone,
      message: sl(SUPPORT_T.svcParseError, lang),
    });
    return;
  }

  // Show confirmation before saving
  const newData: SupportCollectedData = { ...data, pendingServices: extracted };
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });
  await showPendingServicesConfirmation(phone, extracted, data.businessType);
}

function formatPricing(price: number, unit?: string): string {
  const naira = `₦${price.toLocaleString()}`;
  return unit ? `${naira} ${unit}` : naira;
}

async function showPendingServicesConfirmation(
  phone: string,
  services: ServiceItemInput[],
  businessType?: string,
  lang: Language = 'en',
): Promise<void> {
  const emoji = serviceTypeEmoji(businessType);

  let body: string;
  if (services.length === 1) {
    const s = services[0]!;
    body = sf(SUPPORT_T.svcGotItSingle, lang, emoji, s.name, formatPricing(s.price, s.unit));
  } else {
    const lines = services.map((s) => `• *${s.name}* — ${formatPricing(s.price, s.unit)}`).join('\n');
    body = sf(SUPPORT_T.svcGotItMulti, lang, lines, services.length);
  }

  await messageQueue.add({
    to: phone,
    message: body,
    buttons: [
      { id: 'CONFIRM_SERVICES', title: '✅ Yes, Save'  },
      { id: 'CANCEL_SERVICES',  title: '✏️ Try Again' },
    ] as InteractiveButton[],
  });
}

/**
 * Fast parser for pipe-separated lines: "Name | Price" or "Name | Price | unit description"
 * Unit is optional — if absent the LLM or display layer supplies a default.
 * Falls back to null if the message has no pipe characters (LLM path handles it).
 */
function tryParsePipeServices(message: string): ServiceItemInput[] | null {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'));

  if (lines.length === 0) return null;

  const results: ServiceItemInput[] = [];
  for (const line of lines) {
    const parts = line.split('|').map((s) => s.trim());
    const [name, rawPrice, unit] = parts;

    if (!name || !rawPrice) return null;

    let priceStr = rawPrice.replace(/[₦,\s]/g, '');
    if (/^\d+(\.\d+)?k$/i.test(priceStr)) priceStr = String(parseFloat(priceStr) * 1000);
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return null;

    results.push({
      name,
      price,
      ...(unit ? { unit } : {}),
    });
  }
  return results.length > 0 ? results : null;
}

async function extractServicesWithLLM(
  message: string,
  businessType?: string,
): Promise<ServiceItemInput[] | null> {
  const prompt =
    `You are helping a ${businessType ?? 'service'} business vendor list their services for a WhatsApp store.\n\n` +
    `Extract ALL service items from this message: "${message}"\n\n` +
    `Required fields: name (string), price (number).\n` +
    `Optional field: unit — the pricing description EXACTLY as the vendor stated it.\n\n` +
    `Unit inference rules (only when vendor didn't state one):\n` +
    `- Clothing items (shirt, suit, trousers, dress, etc.) → "per item"\n` +
    `- Weight-based services → "per kg"\n` +
    `- One-time flat services (delivery, pickup, visit) → "flat fee"\n` +
    `- Session-based services (massage, haircut, etc.) → "per session"\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"services": [{"name": "...", "price": 0, "unit": "..."}], "isDone": false}\n\n` +
    `- price: plain naira number (strip ₦, commas, spaces, "naira", "k" = ×1000)\n` +
    `- Extract ALL services mentioned, even from comma-separated lists or Pidgin\n` +
    `- isDone: true if vendor says DONE/FINISH/THAT'S ALL\n` +
    `- If nothing can be extracted, return {"services": [], "isDone": false}`;

  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = result.content[0].type === 'text' ? result.content[0].text : '{}';
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText.trim();
    const parsed = JSON.parse(jsonText) as { services: ServiceItemInput[]; isDone: boolean };
    return parsed.services?.length > 0 ? parsed.services : null;
  } catch (err) {
    logger.error('Service extraction LLM error', { err });
    return null;
  }
}

async function advanceToFaqStep(
  phone: string,
  _vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { step: 'SUPPORT_ADDING_FAQS', collectedData: data as unknown as PrismaJson },
  });

  const lang = await getVendorLang(phone);
  await messageQueue.add({
    to: phone,
    message: sl(SUPPORT_T.faqTeach, lang),
    buttons: [
      { id: 'SKIP_FAQS', title: '⏭️ Skip for Now' },
    ] as InteractiveButton[],
  });
}

// ─── Step: SUPPORT_ADDING_FAQS ────────────────────────────────────────────────

export async function handleSupportAddingFaqs(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const upper = message.trim().toUpperCase();
  const lang  = await getVendorLang(phone);

  // Skip → go to payment setup
  if (upper === 'SKIP_FAQS' || upper === 'SKIP' || upper === 'DONE') {
    await advanceToPaymentSetup(phone, vendor, session, data);
    return;
  }

  // Extract FAQ pair(s) from vendor message using LLM
  const extracted = await extractFaqsWithLLM(message);

  if (!extracted || extracted.length === 0) {
    // Before sending the format-guide error, check if the message is off-script.
    const offScript = await classifyOffScriptMessage(
      message.trim(),
      'FAQ setup step — expecting Q: question / A: answer pairs',
      lang,
    );
    if (
      offScript.category !== 'IN_FLOW' &&
      offScript.confidence >= OFFSCRIPT_CONFIDENCE_THRESHOLD &&
      offScript.reply
    ) {
      await messageQueue.add({ to: phone, message: offScript.reply });
      return;
    }

    await messageQueue.add({
      to: phone,
      message: sl(SUPPORT_T.faqParseError, lang),
    });
    return;
  }

  const currentFaqs = data.faqs ?? [];
  const newFaqs = [...currentFaqs, ...extracted];
  const newData: SupportCollectedData = { ...data, faqs: newFaqs };

  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: { collectedData: newData as unknown as PrismaJson },
  });

  const faqLines = extracted
    .map((f) => `*Q: ${f.question}*\n_A: ${f.answer}_`)
    .join('\n\n');

  await messageQueue.add({
    to: phone,
    message: sf(SUPPORT_T.faqSaved, lang, extracted.length, newFaqs.length, faqLines),
    buttons: [
      { id: 'SKIP_FAQS', title: '✅ Done with FAQs' },
    ] as InteractiveButton[],
  });
}

async function extractFaqsWithLLM(
  message: string,
): Promise<Array<{ question: string; answer: string }> | null> {
  const prompt =
    `Extract FAQ pairs from this vendor message: "${message}"\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"faqs": [{"question": "...", "answer": "..."}]}\n\n` +
    `Rules:\n` +
    `- A FAQ pair has a question and an answer\n` +
    `- Look for Q:/A: prefixes, or infer from context\n` +
    `- If no FAQ pair can be extracted, return {"faqs": []}\n` +
    `- Never invent information`;

  try {
    const result = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = result.content[0].type === 'text' ? result.content[0].text : '{}';
    const jsonText = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText.trim();
    const parsed = JSON.parse(jsonText) as { faqs: Array<{ question: string; answer: string }> };
    return parsed.faqs?.length > 0 ? parsed.faqs : null;
  } catch (err) {
    logger.error('FAQ extraction LLM error', { err });
    return null;
  }
}

async function advanceToPaymentSetup(
  phone: string,
  _vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  await prisma.vendorSetupSession.update({
    where: { id: session.id },
    data: {
      step: 'PAYMENT_SETUP',
      collectedData: { ...data, paymentMethod: undefined } as unknown as PrismaJson,
    },
  });

  const lang = await getVendorLang(phone);
  await messageQueue.add({
    to: phone,
    message: sl(SUPPORT_T.paymentSetup, lang),
    buttons: [
      { id: 'PAYMENT_METHOD:paystack_transfer', title: '⚡ Paystack Transfer' },
      { id: 'PAYMENT_METHOD:bank_transfer',     title: '🏦 Bank Transfer' },
    ] as InteractiveButton[],
  });
}

// ─── Step: SUPPORT_CONFIRMATION ───────────────────────────────────────────────

export async function handleSupportConfirmation(
  phone: string,
  message: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const upper = message.trim().toUpperCase();
  const lang  = await getVendorLang(phone);

  // Bank details confirmation gate (YES = confirmed, NO = re-enter)
  if (upper === 'YES' && data.bankAccountNumber && !data.bankName?.startsWith('confirmed:')) {
    const newData: SupportCollectedData = { ...data, bankName: `confirmed:${data.bankName}` };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { collectedData: newData as unknown as PrismaJson },
    });
    await showSupportConfirmation(phone, vendor, newData);
    return;
  }

  if (upper === 'NO' && data.bankAccountNumber && !data.bankName?.startsWith('confirmed:')) {
    // Re-enter bank details — go back to PAYMENT_SETUP with paymentMethod=bank
    const newData: SupportCollectedData = {
      ...data,
      bankName: undefined,
      bankAccountNumber: undefined,
      bankAccountName: undefined,
    };
    await prisma.vendorSetupSession.update({
      where: { id: session.id },
      data: { step: 'PAYMENT_SETUP', collectedData: newData as unknown as PrismaJson },
    });
    await messageQueue.add({
      to: phone,
      message: sl(SUPPORT_T.bankReEnter, lang),
    });
    return;
  }

  if (upper === 'GO LIVE' || upper === 'GO_LIVE') {
    await activateSupportStore(phone, vendor, session, data);
    return;
  }

  if (upper === 'CHANGE') {
    await showSupportConfirmation(phone, vendor, data);
    await messageQueue.add({
      to: phone,
      message: sl(SUPPORT_T.changePrompt, lang),
    });
    return;
  }

  // Any other message — re-show summary
  await showSupportConfirmation(phone, vendor, data);
}

export async function showSupportConfirmation(
  phone: string,
  vendor: Vendor,
  data: SupportCollectedData,
): Promise<void> {
  const services    = data.services ?? [];
  const faqs        = data.faqs ?? [];
  const storeCode   = data.storeCode ?? vendor.storeCode ?? 'YOURCODE';
  const bankDisplay = data.bankName?.replace('confirmed:', '') ?? '—';
  const emoji       = serviceTypeEmoji(data.businessType);
  const lang        = await getVendorLang(phone);

  const topServices = services.slice(0, 5).map((s) =>
    `  • ${s.name} — ₦${s.price.toLocaleString()} ${s.unit}`
  ).join('\n');
  const moreServices = services.length > 5 ? `\n  _...and ${services.length - 5} more_` : '';

  const summary =
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${emoji} *${data.businessName ?? vendor.businessName}*\n` +
    `🔑 Store Code: *${storeCode}*\n` +
    `🏷️ Type: ${serviceTypeLabel(data.businessType)}\n` +
    `📍 Location: ${locationTypeLabel(data.serviceLocationType)}\n` +
    `🛠️ Services: ${services.length} item${services.length !== 1 ? 's' : ''}\n` +
    (topServices ? `${topServices}${moreServices}\n` : '') +
    `🧠 FAQs: ${faqs.length} question${faqs.length !== 1 ? 's' : ''}\n` +
    `💳 Payment: ${capitalise(data.paymentMethod ?? 'bank')}${data.bankName ? ` (${bankDisplay})` : ''}\n` +
    `🕐 Hours: ${formatHours(data)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    sl(SUPPORT_T.summaryGoLive, lang);

  await messageQueue.add({
    to: phone,
    message: summary,
    buttons: [
      { id: 'GO LIVE', title: '🚀 Go Live!' },
      { id: 'CHANGE',  title: '✏️ Make Changes' },
    ] as InteractiveButton[],
  });
}

// ─── Activation ───────────────────────────────────────────────────────────────

async function activateSupportStore(
  phone: string,
  vendor: Vendor,
  session: VendorSetupSession,
  data: SupportCollectedData,
): Promise<void> {
  const pingmartPhone = env.PINGMART_PHONE_NUMBER ?? '234XXXXXXXXXX';
  const storeCode     = data.storeCode ?? '';

  await prisma.$transaction(async (tx) => {
    // 1. Save bank details (encrypted)
    const bankAccountNumber = data.bankAccountNumber
      ? encryptBankAccount(data.bankAccountNumber.replace('confirmed:', ''), env.ENCRYPTION_KEY)
      : null;

    await tx.vendor.update({
      where: { id: vendor.id },
      data: {
        businessName: data.businessName ?? vendor.businessName,
        storeCode:    storeCode.toUpperCase(),
        businessType: data.businessType ?? 'general',
        description:  data.description,
        workingHoursStart: data.workingHoursStart ?? '08:00',
        workingHoursEnd:   data.workingHoursEnd   ?? '21:00',
        workingDays:       data.workingDays        ?? '1,2,3,4,5,6',
        acceptedPayments:  data.paymentMethod ?? 'bank',
        bankName:          data.bankName?.replace('confirmed:', '') ?? null,
        bankAccountNumber,
        bankAccountName:   data.bankAccountName ?? null,
        isActive:  true,
        isPaused:  false,
        mode:      'SUPPORT',
      },
    });

    // 2. Create ServiceItem records
    if (data.services && data.services.length > 0) {
      await tx.serviceItem.createMany({
        data: data.services.map((s) => ({
          vendorId:       vendor.id,
          name:           s.name,
          price:          Math.round(s.price * 100), // naira → kobo
          unit:           s.unit ?? 'per item',
          turnaroundHours: s.turnaroundHours ?? null,
          description:    s.description ?? null,
          isAvailable:    true,
        })),
      });
    }

    // 3. Create SupportKnowledge records for FAQs
    if (data.faqs && data.faqs.length > 0) {
      await tx.supportKnowledge.createMany({
        data: data.faqs.map((f) => ({
          vendorId: vendor.id,
          question: f.question,
          answer:   f.answer,
        })),
      });
    }

    // 4. Save all notification numbers (owner first, then any extras from NOTIFICATION_SETUP)
    const allNotifNumbers = Array.from(new Set([phone, ...(data.notificationNumbers ?? [])]));
    for (const [idx, notifPhone] of allNotifNumbers.entries()) {
      await tx.vendorNotificationNumber.upsert({
        where:  { vendorId_phone: { vendorId: vendor.id, phone: notifPhone } },
        create: {
          vendorId:  vendor.id,
          phone:     notifPhone,
          label:     idx === 0 ? 'Main' : `Staff ${idx}`,
          isPrimary: idx === 0,
          isActive:  true,
        },
        update: { isPrimary: idx === 0, isActive: true },
      });
    }

    // 5. Mark setup session complete
    await tx.vendorSetupSession.update({
      where: { id: session.id },
      data: {
        step:        'COMPLETE',
        completedAt: new Date(),
        collectedData: data as unknown as PrismaJson,
      },
    });
  });

  logger.info('Support vendor activated', { vendorId: vendor.id, storeCode, phone: maskPhone(phone) });

  const lang = await getVendorLang(phone);
  const storeLink = `wa.me/${pingmartPhone}?text=${storeCode}`;

  // Message 1 — celebration + store link
  await messageQueue.add({
    to: phone,
    message: sf(SUPPORT_T.activated, lang, data.businessName ?? 'Your store', storeLink),
  });

  // Message 2 — vendor dashboard
  await messageQueue.add({
    to: phone,
    message: sl(SUPPORT_T.dashboardPrompt, lang),
    listSections: [
      {
        title: '🛠️ Manage Your Support Page',
        rows: [
          { id: 'MY BOOKINGS',  title: '📅 My Bookings',   description: 'View and manage booking requests' },
          { id: 'MY SERVICES',  title: '🛠️ My Services',   description: 'View, add, or remove your services' },
          { id: 'ADD FAQ',      title: '🧠 Add FAQ',        description: 'Teach the bot new Q&A pairs' },
          { id: 'MY LINK',      title: '🔗 My Link',        description: 'Get your shareable store link' },
          { id: 'PAUSE STORE',  title: '⏸️ Pause Store',    description: 'Temporarily stop taking bookings' },
          { id: 'SETTINGS',     title: '⚙️ Settings',       description: 'Update hours, payment, description' },
        ],
      },
    ],
    listButtonText: '📋 Dashboard',
  });
}
