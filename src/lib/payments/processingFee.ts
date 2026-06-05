/**
 * Method-aware Stripe processing-fee math.
 *
 * The payer (homeowner, or org in self-pay) always covers the processing fee: the
 * charge is the service price GROSSED UP so that, after Stripe takes its real fee,
 * the platform nets at least the service price (which is what gets distributed to
 * cleaner + tenant). The tenant and platform never absorb the fee. This is also why
 * passing the fee through fixes the negative-balance bug: the split runs on the
 * service price, and the platform receives the service price.
 *
 * Pricing (US):
 *   - card:            2.9% + 30 cents, no cap
 *   - us_bank_account: 0.8%, no fixed fee, capped at $5 (ACH Direct Debit)
 *
 * All values are integer cents. Pure + dependency-free so it unit-tests in isolation
 * and drives both the charge paths and the booking-modal total summary.
 */

export type PaymentMethodKind = 'card' | 'us_bank_account';

export interface FeeSchedule {
  /** Percentage rate as a fraction (0.029 = 2.9%). */
  percent: number;
  /** Fixed per-transaction fee in cents. */
  fixedCents: number;
  /** Cap on the percentage portion in cents, or null for no cap. */
  capCents: number | null;
}

export const FEE_SCHEDULES: Record<PaymentMethodKind, FeeSchedule> = {
  card: { percent: 0.029, fixedCents: 30, capCents: null },
  us_bank_account: { percent: 0.008, fixedCents: 0, capCents: 500 },
};

function assertBase(baseCents: number): void {
  if (!Number.isInteger(baseCents) || baseCents < 0) {
    throw new Error('processingFee: amount must be a non-negative integer (cents)');
  }
}

/** Stripe's fee on a charge of `chargeCents` for the given method. */
export function stripeFeeCents(method: PaymentMethodKind, chargeCents: number): number {
  assertBase(chargeCents);
  if (chargeCents === 0) return 0;
  const { percent, fixedCents, capCents } = FEE_SCHEDULES[method];
  const pct = Math.round(chargeCents * percent);
  const cappedPct = capCents == null ? pct : Math.min(pct, capCents);
  return cappedPct + fixedCents;
}

/**
 * Smallest integer charge whose net (after the method's real fee) is >= `baseCents`.
 * Inverts net = charge − fee(charge). Ceil guarantees the platform is never short.
 */
export function grossUpForFee(method: PaymentMethodKind, baseCents: number): number {
  assertBase(baseCents);
  if (baseCents === 0) return 0;
  const { percent, fixedCents, capCents } = FEE_SCHEDULES[method];

  // Uncapped solution: net = charge − (charge·percent + fixed) ≥ base.
  const uncapped = Math.ceil((baseCents + fixedCents) / (1 - percent));
  if (capCents == null) return uncapped;

  // If the percentage portion at `uncapped` stays within the cap, it's exact.
  if (Math.round(uncapped * percent) <= capCents) return uncapped;

  // Otherwise the fee is flat (cap + fixed), so charge = base + cap + fixed.
  return baseCents + capCents + fixedCents;
}

export interface ChargeBreakdown {
  /** The service price — the amount distributed to cleaner + tenant. */
  baseCents: number;
  method: PaymentMethodKind;
  /** chargeCents − baseCents; the processing fee shown to the payer. */
  feeCents: number;
  /** What the payer is charged (service price grossed up for the fee). */
  chargeCents: number;
}

export function computeChargeBreakdown(method: PaymentMethodKind, baseCents: number): ChargeBreakdown {
  assertBase(baseCents);
  const chargeCents = grossUpForFee(method, baseCents);
  return { baseCents, method, feeCents: chargeCents - baseCents, chargeCents };
}
