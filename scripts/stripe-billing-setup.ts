/**
 * One-time Stripe account setup for SaaS subscription billing (spec §10.1).
 *
 * Run once per Stripe account, test mode first and live mode later:
 *
 *   STRIPE_ENABLED=true STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-billing-setup.ts
 *   STRIPE_ENABLED=true STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-billing-setup.ts --confirm-live
 *
 * What it creates:
 *   - FOUR Products: one per tier, plus one for the extra cleaner seat. One Product
 *     per tier is Stripe's own guidance: Checkout and invoices print the Product
 *     name on each line, so tiers sharing a Product would be indistinguishable on
 *     a customer's invoice.
 *   - EIGHT Prices, keyed by the lookup keys in src/lib/billing/plans.ts. Nothing
 *     in the app stores a price id, so test and live differ only in which account
 *     the key points at. Annual Prices are ONE upfront charge per year, so their
 *     unit_amount is twelve times the per-month display figure.
 *   - ONE Customer Portal configuration tagged metadata.nexxus_portal = 'default',
 *     which resolvePortalConfiguration() looks up by that tag.
 *
 * Idempotent and never destructive. It looks Products up by metadata.nexxus_plan,
 * Prices by lookup key, and the portal configuration by its metadata tag, creates
 * only what is missing, and never deletes, archives, or edits anything that is
 * already there. Running it twice reports thirteen objects found and creates none.
 *
 * TO CHANGE A PRICE LATER: Stripe Prices are immutable, so a new amount means a
 * NEW Price. Two rules, and the second is the one that bites:
 *
 *   1. Do NOT archive or deactivate the old Price. Every existing subscriber is
 *      still billed on it, which is what keeps the pricing doc's 60 day notice
 *      promise cheap: nobody is repriced without being told.
 *   2. Create the new Price with `transfer_lookup_key: true` AND with
 *      `metadata.nexxus_lookup_key` set to the same key, exactly as ensurePrice()
 *      below does. A lookup key belongs to one active Price at a time, so the
 *      transfer is the only way the new Price can answer to `growth_monthly` and
 *      have resolvePrices() find it. The transfer STRIPS the key from the old
 *      Price, and the app identifies a subscription's plan line from
 *      `price.lookup_key` first but falls back to `price.metadata.nexxus_lookup_key`
 *      (src/lib/billing/readCurrentItems.ts), which a transfer cannot move. Skip
 *      the metadata and those subscribers become unclassifiable: they can never
 *      change tier or seats again, and the webhook silently stops mirroring what
 *      they bought.
 *
 * Every Price this script creates already carries that metadata. A Price added by
 * hand in the Dashboard does not, so add it there too.
 *
 * This script holds its own Stripe SDK calls rather than routing them through
 * src/lib/stripe/billing.ts. That rule exists so app code can be mocked in
 * integration tests; nothing here is imported by the app, and exporting Product
 * and Price CREATORS from a module the routes import would be a footgun. Every
 * call still goes through getStripe(), so the STRIPE_ENABLED flag is respected.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import {
  EXTRA_SEAT_ANNUAL_CENTS,
  EXTRA_SEAT_MONTHLY_CENTS,
  LOOKUP_KEYS,
  PLANS,
  PLAN_TIERS,
  lookupKeyFor,
  seatLookupKeyFor,
  type BillingPeriod,
  type LookupKey,
  type PlanTier,
} from '@/lib/billing/plans';

/** The metadata value that identifies the extra-seat Product. Tiers use their own key. */
const SEAT_PLAN_KEY = 'extra_seat';

const CURRENCY = 'usd';

type Outcome = 'created' | 'found';

interface ReportRow {
  kind: 'Product' | 'Price' | 'Portal config';
  label: string;
  id: string;
  outcome: Outcome;
}

const report: ReportRow[] = [];
const warnings: string[] = [];

function record(kind: ReportRow['kind'], label: string, id: string, outcome: Outcome): void {
  report.push({ kind, label, id, outcome });
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * The Product carrying `metadata.nexxus_plan = planKey`, or null.
 *
 * Lists rather than searches: the Search API's index can lag a fresh write by up
 * to a minute, which is exactly long enough for two runs in a row to create two
 * Products. Archived Products are included so a re-run never resurrects a name
 * the operator deliberately retired.
 */
async function findProductByPlanKey(stripe: Stripe, planKey: string): Promise<Stripe.Product | null> {
  for await (const product of stripe.products.list({ limit: 100 })) {
    if (product.metadata?.nexxus_plan === planKey) return product;
  }
  return null;
}

async function ensureProduct(
  stripe: Stripe,
  planKey: string,
  name: string,
  description: string,
): Promise<string> {
  const existing = await findProductByPlanKey(stripe, planKey);
  if (existing) {
    if (!existing.active) {
      warnings.push(
        `Product ${existing.id} (${planKey}) is ARCHIVED. Nothing was changed, but new Prices ` +
          'cannot be created on it. Reactivate it in the Dashboard before running this again.',
      );
    }
    record('Product', name, existing.id, 'found');
    return existing.id;
  }

  const created = await stripe.products.create({
    name,
    description,
    metadata: { nexxus_plan: planKey, source: 'nexxus-cleaning-platform' },
  });
  record('Product', name, created.id, 'created');
  return created.id;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * The active Price carrying this lookup key, or null. A lookup key is unique
 * among ACTIVE Prices, which is what makes it a safe idempotency key here and the
 * reason resolvePrices() filters the same way.
 */
async function findPriceByLookupKey(stripe: Stripe, lookupKey: LookupKey): Promise<Stripe.Price | null> {
  const result = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return result.data[0] ?? null;
}

async function ensurePrice(
  stripe: Stripe,
  lookupKey: LookupKey,
  productId: string,
  unitAmount: number,
  period: BillingPeriod,
  nickname: string,
): Promise<void> {
  const label = `${lookupKey} (${money(unitAmount)} / ${period === 'annual' ? 'year' : 'month'})`;
  const existing = await findPriceByLookupKey(stripe, lookupKey);

  if (existing) {
    // Never repriced in place: Stripe Prices are immutable, and silently creating
    // a second one would break the lookup-key uniqueness this all rests on.
    if (existing.unit_amount !== unitAmount) {
      warnings.push(
        `Price ${existing.id} (${lookupKey}) charges ${money(existing.unit_amount ?? 0)} but ` +
          `src/lib/billing/plans.ts says ${money(unitAmount)}. Nothing was changed. To reprice, ` +
          'create a new Price carrying BOTH transfer_lookup_key: true and ' +
          `metadata.nexxus_lookup_key = '${lookupKey}' (see the header of this script).`,
      );
    }
    if (existing.tax_behavior !== 'exclusive') {
      warnings.push(
        `Price ${existing.id} (${lookupKey}) has tax_behavior '${existing.tax_behavior}', not ` +
          "'exclusive'. Nothing was changed; tax_behavior is immutable once set.",
      );
    }
    record('Price', label, existing.id, 'found');
    return;
  }

  const created = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: unitAmount,
    recurring: { interval: period === 'annual' ? 'year' : 'month' },
    // Prices are quoted before tax everywhere in the app and on the pricing page.
    tax_behavior: 'exclusive',
    lookup_key: lookupKey,
    nickname,
    metadata: { nexxus_lookup_key: lookupKey, source: 'nexxus-cleaning-platform' },
  });
  record('Price', label, created.id, 'created');
}

// ---------------------------------------------------------------------------
// Customer Portal configuration
// ---------------------------------------------------------------------------

/**
 * The portal is for invoices, the card on file, and cancelling. Plan and seat
 * changes are deliberately NOT in it: those run through the app, which enforces
 * the seat bounds and the seats-in-use floor that Stripe knows nothing about.
 *
 * Tax ID collection stays off until Stripe Tax is switched on.
 */
async function ensurePortalConfiguration(stripe: Stripe): Promise<void> {
  for await (const config of stripe.billingPortal.configurations.list({ limit: 100 })) {
    if (config.metadata?.nexxus_portal === 'default') {
      record('Portal config', 'nexxus_portal=default', config.id, 'found');
      return;
    }
  }

  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: 'Manage your Nexxus subscription',
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: [
            'too_expensive',
            'missing_features',
            'switched_service',
            'unused',
            'customer_service',
            'too_complex',
            'low_quality',
            'other',
          ],
        },
      },
      // Plan changes happen in the app, not here.
      subscription_update: { enabled: false },
    },
    metadata: { nexxus_portal: 'default', source: 'nexxus-cleaning-platform' },
  });
  record('Portal config', 'nexxus_portal=default', created.id, 'created');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** What Stripe charges per cycle for a tier: the sticker price monthly, twelve times it annually. */
function baseUnitAmount(tier: PlanTier, period: BillingPeriod): number {
  const plan = PLANS[tier];
  return period === 'annual' ? plan.annualMonthlyCents * 12 : plan.monthlyCents;
}

function printReport(): void {
  const widths = {
    kind: Math.max(...report.map((r) => r.kind.length), 'KIND'.length),
    label: Math.max(...report.map((r) => r.label.length), 'WHAT'.length),
    id: Math.max(...report.map((r) => r.id.length), 'STRIPE ID'.length),
  };
  const line = (kind: string, label: string, id: string, outcome: string) =>
    `  ${kind.padEnd(widths.kind)}  ${label.padEnd(widths.label)}  ${id.padEnd(widths.id)}  ${outcome}`;

  console.log('');
  console.log(line('KIND', 'WHAT', 'STRIPE ID', 'RESULT'));
  console.log(`  ${'-'.repeat(widths.kind)}  ${'-'.repeat(widths.label)}  ${'-'.repeat(widths.id)}  ------`);
  for (const row of report) console.log(line(row.kind, row.label, row.id, row.outcome));

  const created = report.filter((r) => r.outcome === 'created').length;
  const found = report.length - created;
  console.log('');
  console.log(`  ${created} created, ${found} already present, ${report.length} total.`);
}

async function main(): Promise<void> {
  if (process.env.STRIPE_ENABLED !== 'true') {
    throw new Error('Set STRIPE_ENABLED=true to run this script. getStripe() refuses otherwise.');
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');

  const isLive = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  if (isLive && !process.argv.includes('--confirm-live')) {
    throw new Error(
      'That is a LIVE key. Objects created in live mode cannot be deleted. Re-run with ' +
        '--confirm-live if you really mean to set up the live account.',
    );
  }
  console.log(`Stripe billing setup, ${isLive ? 'LIVE MODE' : 'TEST MODE'}.`);

  const stripe = getStripe();

  // Products first: every Price needs one.
  const productIds = {} as Record<PlanTier, string>;
  for (const tier of PLAN_TIERS) {
    const plan = PLANS[tier];
    productIds[tier] = await ensureProduct(
      stripe,
      tier,
      plan.name,
      `Nexxus ${plan.name}. Includes ${plan.includedSeats} cleaner seats.`,
    );
  }
  const seatProductId = await ensureProduct(
    stripe,
    SEAT_PLAN_KEY,
    'Extra cleaner seat',
    'One additional cleaner seat beyond the seats included in the plan.',
  );

  // Eight Prices: a base Price per tier per period, plus a seat Price per period.
  const ensured: LookupKey[] = [];
  for (const tier of PLAN_TIERS) {
    for (const period of ['monthly', 'annual'] as BillingPeriod[]) {
      const lookupKey = lookupKeyFor(tier, period);
      await ensurePrice(
        stripe,
        lookupKey,
        productIds[tier],
        baseUnitAmount(tier, period),
        period,
        `${PLANS[tier].name} ${period}`,
      );
      ensured.push(lookupKey);
    }
  }
  for (const period of ['monthly', 'annual'] as BillingPeriod[]) {
    const lookupKey = seatLookupKeyFor(period);
    await ensurePrice(
      stripe,
      lookupKey,
      seatProductId,
      period === 'annual' ? EXTRA_SEAT_ANNUAL_CENTS : EXTRA_SEAT_MONTHLY_CENTS,
      period,
      `Extra cleaner seat ${period}`,
    );
    ensured.push(lookupKey);
  }

  // A key in plans.ts that this script never creates would fail resolvePrices()
  // at the first checkout instead of here, where someone is watching.
  const missing = LOOKUP_KEYS.filter((k) => !ensured.includes(k));
  if (missing.length > 0) {
    throw new Error(`This script did not set up every lookup key in plans.ts: ${missing.join(', ')}`);
  }

  await ensurePortalConfiguration(stripe);

  printReport();

  if (warnings.length > 0) {
    console.log('');
    console.log('  Warnings (nothing was changed for any of these):');
    for (const warning of warnings) console.log(`   !  ${warning}`);
  }

  console.log('');
  console.log('  To change a price later: create a NEW Price carrying BOTH');
  console.log("  transfer_lookup_key: true AND metadata.nexxus_lookup_key = the same key.");
  console.log('  Leave the old Price ACTIVE: existing subscribers stay on the one they');
  console.log('  bought, and the metadata is what keeps them classifiable after the');
  console.log('  transfer strips their lookup key. Never archive a Price with subscribers.');
  console.log('');
}

main().catch((error: unknown) => {
  console.error('');
  console.error('Stripe billing setup failed:', error instanceof Error ? error.message : error);
  // Partial runs are safe to repeat: every step looks before it creates.
  console.error('Nothing was deleted. Fix the cause and run it again.');
  process.exitCode = 1;
});
