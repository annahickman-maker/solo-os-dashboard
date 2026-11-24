/**
 * Offer document: the owner's offer suite, stored as the solo document key
 * `offer` (see src/lib/solo/documents.ts).
 *
 * The shape follows the old Solo OS offer data (pricing rungs, avatars,
 * results, emails) so content can be moved across. Anything that writes this
 * document (the owner in the browser, or the brand strategist through
 * PUT /api/solo/docs/offer) should keep this shape. Every load runs through
 * normalizeOfferDoc, so missing or unknown fields are tolerated.
 *
 * No imports, so `node --test` can load it.
 */

export const OFFER_DOC_KEY = 'offer';

export const OFFER_STAGES = ['idea', 'validated', 'iterating', 'signature', 'scaling'] as const;
export type OfferStage = (typeof OFFER_STAGES)[number];
export const OFFER_TIERS = ['low', 'mid', 'high', 'custom'] as const;
export type OfferTier = (typeof OFFER_TIERS)[number];
export const QUIZ_SECTIONS = ['avatar', 'pricing', 'proof', 'validation', 'content'] as const;
export type QuizSection = (typeof QUIZ_SECTIONS)[number];

/** Five self-rates per section, 0 = unrated, 1-5 = score. Questions: OFFER_QUIZ. */
export type OfferScores = Record<QuizSection, number[]>;

/** One offer in the suite (a "pricing rung" in the old data). */
export interface OfferPricingRung {
  id: string;
  /** Short name, e.g. "Starter course". */
  name: string;
  /** What you charge today, e.g. "$47/mo". */
  price_label: string;
  /** What the offer is, one paragraph. (Old field name kept for migration.) */
  proof_required: string | null;
  /** One sentence: the specific outcome and timeframe. */
  promise: string;
  status: OfferStage;
  tier: OfferTier;
  sort_order: number;
  /** OfferAvatar.id, or null. */
  avatar_id: string | null;
  /** At most one offer is the focus. */
  featured: boolean;
  goal_price_label: string;
  target_revenue_per_month_usd: number | null;
  target_customers_per_month: number | null;
  /** The plan to raise the price: what triggers each step up. */
  pricing_plan: string;
  sales_page_url: string;
  /**
   * Slug of the Sales product this offer sells as. Orders of it count as the offer's sales.
   * Normally the offer's own product (offer-<id>, made automatically, src/lib/money/offer-product.ts);
   * another slug is the owner's "sells as" choice. null until the first sync: the own product is meant.
   */
  product_slug: string | null;
  sales_page_visitors_30d: number | null;
  sales_page_buyers_30d: number | null;
  /** Video sales letter link and its numbers, typed by the owner. */
  vsl_url: string;
  vsl_views_30d: number | null;
  vsl_link_clicks_30d: number | null;
  scores: OfferScores;
  /** Ids of the VALIDATION_PHASES checks that are done for this offer. */
  validation_checks: string[];
  /** Ids of OfferPricingResult or reputation wins pinned as proof for the promise. */
  pinned_proof_ids: string[];
}

export interface OfferAvatar {
  id: string;
  name: string | null;
  /** Who they are, one or two sentences. */
  one_line: string | null;
  price_point: string | null;
  before_state: string | null;
  after_state: string | null;
  demographics: string | null;
  /** In their own words. */
  struggles: string[];
  /** In their own words. */
  outcomes: string[];
}

/** A result that justifies the price: yours (own) or a customer's. */
export interface OfferPricingResult {
  id: string;
  title: string;
  body: string | null;
  kind: 'own' | 'customer';
  metric: string | null;
  status: 'candidate' | 'confirmed' | 'rejected';
}

export const OFFER_EMAIL_KINDS = ['one_time', 'launch', 'automated'] as const;
export type OfferEmailKind = (typeof OFFER_EMAIL_KINDS)[number];

/** An email that sends traffic to one offer's sales page. */
export interface OfferEmail {
  id: string;
  rung_id: string;
  subject: string;
  kind: OfferEmailKind;
  /** Percent, e.g. 2.5 = 2.5%, from the owner's email platform. */
  conversion_rate_pct: number | null;
  created_at: number;
  updated_at: number;
}

export interface OfferDoc {
  version: 1;
  rungs: OfferPricingRung[];
  avatars: OfferAvatar[];
  results: OfferPricingResult[];
  emails: OfferEmail[];
  updated_at?: string;
}

export const DEFAULT_OFFER_DOC: OfferDoc = { version: 1, rungs: [], avatars: [], results: [], emails: [] };

export const STAGE_META: Record<OfferStage, { label: string; description: string }> = {
  idea: { label: 'Idea', description: 'Drafted but never sold. No paid customers yet.' },
  validated: { label: 'Validated', description: 'First 1-5 paid customers from a real launch.' },
  iterating: { label: 'Iterating', description: 'Launch cycles every 6-8 weeks. Price rising.' },
  signature: { label: 'Signature', description: 'Named, streamlined, premium-priced.' },
  scaling: { label: 'Scaling', description: 'Suite, email systems and inbound flow.' },
};

export const TIER_META: Record<OfferTier, { label: string; sub: string }> = {
  low: { label: 'Low ticket', sub: 'entry point. easy yes.' },
  mid: { label: 'Mid ticket', sub: 'the next step up. more support.' },
  high: { label: 'High ticket', sub: 'premium tier. deep transformation.' },
  custom: { label: 'More offers', sub: 'anything outside the standard three tiers.' },
};

export const EMAIL_KIND_LABEL: Record<OfferEmailKind, string> = { one_time: 'one-time', launch: 'launch', automated: 'automated' };

// ─── the 25-question self-rate ────────────────────────────────────────────

export const QUIZ_LABEL: Record<QuizSection, string> = {
  avatar: 'Avatar', pricing: 'Pricing', proof: 'Proof', validation: 'Validation', content: 'Content',
};

export const OFFER_QUIZ: Record<QuizSection, string[]> = {
  avatar: [
    'Could I describe their before state in vivid emotional detail?',
    'Could I describe their dream outcomes in vivid emotional detail?',
    'Are their pain points captured specifically?',
    'Would my avatar feel the sales page was written just for them?',
    'My dream customer immediately recognises this offer is for them',
  ],
  pricing: [
    'Is this price calibrated to the results (10x value, in money or in clarity and confidence)?',
    'Is the offer priced as a no-brainer tradeoff?',
    'Have I defined a price ladder with criteria to raise each step?',
    'Have I set revenue and customer targets for this offer?',
    "Does the current price match the offer's stage (idea to scaling)?",
  ],
  proof: [
    'I have achieved this result for myself or someone else',
    'I have case studies, testimonials or data showing real results',
    'My proof is specific to my target avatar',
    'I have examples of customers getting results quickly',
    'Proof shows up across all my content (social, sales page, emails)',
  ],
  validation: [
    'Have I had 1:1 conversations with at least 10 ideal customers?',
    'At least 1 real customer has paid for this offer',
    'At least 1 customer has actually achieved the promised result',
    'The offer has been launched publicly at least once',
    'I have customer-reported satisfaction (testimonial, review or repurchase)',
  ],
  content: [
    'Have I recorded a video sales letter?',
    'Have I created a sales page?',
    'Are common objections addressed inside the sales page?',
    'Does the content remove roadblocks (clarity, tech, overwhelm)?',
    'Would a friend understand this offer from the sales page in 10 seconds?',
  ],
};

// Score grows with the offer's maturity rather than demanding everything at once.
const STAGE_WEIGHTS: Record<OfferStage, Record<QuizSection, number>> = {
  idea:      { avatar: 0.30, content: 0.20, proof: 0.20, validation: 0.15, pricing: 0.15 },
  validated: { avatar: 0.25, content: 0.25, proof: 0.20, validation: 0.15, pricing: 0.15 },
  iterating: { avatar: 0.20, content: 0.20, proof: 0.20, validation: 0.20, pricing: 0.20 },
  signature: { avatar: 0.15, content: 0.25, proof: 0.20, validation: 0.20, pricing: 0.20 },
  scaling:   { avatar: 0.15, content: 0.30, proof: 0.15, validation: 0.15, pricing: 0.25 },
};

/** Average of the rated answers, 0-1 (unrated answers are left out). */
export function sectionScore(scores: number[]): number {
  const rated = scores.filter((n) => n > 0);
  return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length / 5 : 0;
}

/** Stage-weighted overall score, 0-1, plus each section's score. */
export function offerScore(rung: OfferPricingRung): { value: number; perSection: Record<QuizSection, number> } {
  const w = STAGE_WEIGHTS[rung.status];
  const perSection = Object.fromEntries(QUIZ_SECTIONS.map((s) => [s, sectionScore(rung.scores[s])])) as Record<QuizSection, number>;
  return { value: QUIZ_SECTIONS.reduce((acc, s) => acc + perSection[s] * w[s], 0), perSection };
}

// ─── validation stages ────────────────────────────────────────────────────

export interface ValidationPhase {
  id: 'idea' | 'validating' | 'iterating' | 'signature' | 'scaling';
  label: string;
  description: string;
  checks: { id: string; label: string; hint: string }[];
}

export const VALIDATION_PHASES: ValidationPhase[] = [
  {
    id: 'idea', label: 'Idea', description: 'Is there demand? Have you proven people want this before you build it?',
    checks: [
      { id: 'five_1on1_conversations', label: "I've had 1:1 conversations with at least 5 people who told me they want this", hint: 'real conversations, not surveys. five different people, each said yes unprompted.' },
      { id: 'five_audience_quotes', label: "I've collected at least 5 verbatim quotes from the audience describing this problem", hint: 'their actual words, not your paraphrase. from comments, DMs, transcripts, calls.' },
      { id: 'waitlist_page_conversion', label: 'I have a waitlist page converting at least 10% (visitors to sign-ups)', hint: 'a real page, real traffic and a sign-up rate above 10%. proves the pitch lands.' },
      { id: 'comparable_offer_succeeding', label: "I've seen at least 1 other person sell something similar successfully", hint: 'real numbers ideally (members, revenue, testimonials). proves the market buys.' },
      { id: 'content_engagement_above_avg', label: "I've posted content on this subject and it got above-average engagement", hint: 'better than your usual baseline. one piece is enough to count.' },
    ],
  },
  {
    id: 'validating', label: 'Validating', description: 'MVP launched, sales page converting, first buyers paying. The offer can sell.',
    checks: [
      { id: 'mvp_launched', label: "I've launched a minimum viable product (MVP)", hint: 'a thin, buyable version is live and people can pay for it today.' },
      { id: 'sales_page_traffic_1000', label: 'I have at least 1,000 visits to my sales page', hint: 'enough real traffic that the conversion rate means something.' },
      { id: 'sales_page_converting', label: 'My sales page for this offer is converting at least 2%', hint: 'visitor to buyer rate is at least 2% on real traffic.' },
      { id: 'five_positive_results_or_reviews', label: 'I have at least 5 positive results, testimonials or reviews from MVP buyers', hint: 'five different buyers, each with a documented positive outcome.' },
      { id: 'buyers_would_buy_again', label: 'Buyers have told me they would buy this again or recommend it', hint: 'a direct statement, documented somewhere.' },
    ],
  },
  {
    id: 'iterating', label: 'Iterating', description: 'Buyers are starting to get the results the offer promises. The product works.',
    checks: [
      { id: 'buyers_getting_promised_results', label: 'Buyers are getting the results the offer promises', hint: 'not "they liked it": they got the outcome you said they would. measurable, repeatable.' },
      { id: 'three_testimonials_with_results', label: 'I have 3+ documented testimonials describing those results', hint: 'with specifics (what they did, what they got) and permission to publish.' },
      { id: 'price_raised_conversion_held', label: "I've raised the price at least once and conversion stayed above 2%", hint: 'demand held at the new level.' },
      { id: 'repeatable_acquisition_predictable_conversion', label: 'I have a predictable acquisition channel with stable conversion rates', hint: 'same channel, same kind of buyer, conversion holds month over month.' },
      { id: 'predictable_consistent_revenue', label: "I'm making predictable and consistent revenue from this offer", hint: 'steady or growing month over month, not boom and bust.' },
    ],
  },
  {
    id: 'signature', label: 'Signature Offer', description: 'Consistent results, referrals, premium pricing. The offer has crystallised.',
    checks: [
      { id: 'consistent_outcome', label: 'I consistently deliver the same promised outcome', hint: 'most buyers get what the offer promises.' },
      { id: 'consistent_referrals', label: "I'm consistently getting referrals", hint: 'word of mouth is producing sales without you asking.' },
      { id: 'conversion_above_signature_threshold', label: 'My sales page conversion is consistently above 3%', hint: 'holds month over month, not a one-off spike.' },
      { id: 'premium_priced_still_selling', label: 'The offer is priced at a premium and people still buy', hint: 'meaningfully above the validating-stage price.' },
      { id: 'clear_name_and_framework', label: 'The offer has a clear name and a named signature framework', hint: 'a real name and a teachable method.' },
    ],
  },
  {
    id: 'scaling', label: 'Scaling', description: 'Funnels, suite, inbound, systemised delivery, growth.',
    checks: [
      { id: 'built_automated_email_funnel', label: "I've built an automated email funnel converting cold traffic", hint: 'opt-in, nurture, sale. set up once, running without manual touches.' },
      { id: 'expanded_into_offer_suite', label: "I've expanded into a multi-tier offer suite (entry, core, premium)", hint: 'at least two other offers so buyers can climb.' },
      { id: 'made_inbound_dominant', label: "I've made inbound from content the dominant lead source", hint: 'most new buyers find you through content.' },
      { id: 'systemised_delivery', label: "I've systemised delivery so it runs without me touching every customer", hint: 'onboarding, support, fulfilment templated or delegated.' },
      { id: 'revenue_predictable_mom', label: 'Revenue from this offer is predictable month over month', hint: 'at scaled volume, the monthly number is forecastable.' },
    ],
  },
];

/** The first phase that is not fully ticked (or the last one when all are). */
export function currentPhase(rung: OfferPricingRung): ValidationPhase['id'] {
  const done = new Set(rung.validation_checks);
  const open = VALIDATION_PHASES.find((p) => p.checks.some((c) => !done.has(c.id)));
  return (open ?? VALIDATION_PHASES[VALIDATION_PHASES.length - 1]).id;
}

export function validationCompletion(rung: OfferPricingRung): number {
  const all = VALIDATION_PHASES.flatMap((p) => p.checks.map((c) => c.id));
  const done = new Set(rung.validation_checks);
  return all.filter((c) => done.has(c)).length / all.length;
}

/** Promise written, at least one proof pinned, at least three pinned. 0-1. */
export function proofCompletion(rung: OfferPricingRung): number {
  return [!!rung.promise.trim(), rung.pinned_proof_ids.length >= 1, rung.pinned_proof_ids.length >= 3].filter(Boolean).length / 3;
}

/** First number in a price label: "$1,497 once" -> 1497. */
export function parsePriceLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Target revenue divided by the goal price (or the current price). */
export function derivedCustomers(rung: Pick<OfferPricingRung, 'goal_price_label' | 'price_label' | 'target_revenue_per_month_usd'>): number | null {
  const price = parsePriceLabel(rung.goal_price_label) ?? parsePriceLabel(rung.price_label);
  const revenue = rung.target_revenue_per_month_usd;
  return price && revenue ? Math.ceil(revenue / price) : null;
}

export function rate(numerator: number | null, denominator: number | null): number | null {
  return numerator !== null && denominator ? (numerator / denominator) * 100 : null;
}

// ─── normalising ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);
const req = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  (options as readonly unknown[]).includes(v) ? (v as T) : fallback;
let seq = 0;
const id = (v: unknown, prefix: string): string => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`);
const list = <T>(v: unknown, fn: (o: Obj, i: number) => T | null): T[] =>
  Array.isArray(v) ? v.filter(isObj).map(fn).filter((x): x is T => x !== null) : [];

function scores(v: unknown): OfferScores {
  const o = isObj(v) ? v : {};
  const out = {} as OfferScores;
  for (const s of QUIZ_SECTIONS) {
    const arr = Array.isArray(o[s]) ? (o[s] as unknown[]) : [];
    out[s] = Array.from({ length: 5 }, (_, i) => {
      const n = num(arr[i]);
      return n !== null && n >= 1 && n <= 5 ? Math.round(n) : 0;
    });
  }
  return out;
}

export function emptyRung(partial: Partial<OfferPricingRung> = {}): OfferPricingRung {
  return normalizeRung(partial as Obj, 0);
}

function normalizeRung(r: Obj, i: number): OfferPricingRung {
  return {
    id: id(r.id, 'offer'),
    name: req(r.name),
    price_label: req(r.price_label),
    proof_required: text(r.proof_required),
    promise: req(r.promise),
    status: oneOf(r.status, OFFER_STAGES, 'idea'),
    tier: oneOf(r.tier, OFFER_TIERS, 'custom'),
    sort_order: num(r.sort_order) ?? i + 1,
    avatar_id: text(r.avatar_id),
    featured: r.featured === true,
    goal_price_label: req(r.goal_price_label),
    target_revenue_per_month_usd: num(r.target_revenue_per_month_usd),
    target_customers_per_month: num(r.target_customers_per_month),
    pricing_plan: req(r.pricing_plan),
    sales_page_url: req(r.sales_page_url),
    product_slug: text(r.product_slug)?.trim() ?? null,
    sales_page_visitors_30d: num(r.sales_page_visitors_30d),
    sales_page_buyers_30d: num(r.sales_page_buyers_30d),
    vsl_url: req(r.vsl_url),
    vsl_views_30d: num(r.vsl_views_30d),
    vsl_link_clicks_30d: num(r.vsl_link_clicks_30d),
    scores: scores(r.scores),
    validation_checks: strings(r.validation_checks),
    pinned_proof_ids: strings(r.pinned_proof_ids),
  };
}

/** Coerces anything read from storage into a valid OfferDoc. Keeps at most one featured offer. */
export function normalizeOfferDoc(raw: unknown): OfferDoc {
  const o = isObj(raw) ? raw : {};
  let featuredSeen = false;
  const rungs = list(o.rungs, normalizeRung).map((r) => {
    if (!r.featured) return r;
    if (featuredSeen) return { ...r, featured: false };
    featuredSeen = true;
    return r;
  });
  return {
    version: 1,
    rungs,
    avatars: list(o.avatars, (a) => ({
      id: id(a.id, 'avatar'), name: text(a.name), one_line: text(a.one_line), price_point: text(a.price_point),
      before_state: text(a.before_state), after_state: text(a.after_state), demographics: text(a.demographics),
      struggles: strings(a.struggles), outcomes: strings(a.outcomes),
    })),
    results: list(o.results, (x) => {
      const title = req(x.title);
      if (!title.trim()) return null;
      return {
        id: id(x.id, 'result'), title, body: text(x.body), kind: x.kind === 'customer' ? 'customer' : 'own',
        metric: text(x.metric), status: oneOf(x.status, ['candidate', 'confirmed', 'rejected'] as const, 'confirmed'),
      };
    }),
    emails: list(o.emails, (e) => {
      const rungId = text(e.rung_id);
      if (!rungId) return null;
      const now = Date.now();
      return {
        id: id(e.id, 'email'), rung_id: rungId, subject: req(e.subject), kind: oneOf(e.kind, OFFER_EMAIL_KINDS, 'one_time'),
        conversion_rate_pct: num(e.conversion_rate_pct), created_at: num(e.created_at) ?? now, updated_at: num(e.updated_at) ?? now,
      };
    }),
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : undefined,
  };
}

export function isOfferEmpty(doc: OfferDoc): boolean {
  return doc.rungs.length + doc.avatars.length + doc.results.length === 0;
}
