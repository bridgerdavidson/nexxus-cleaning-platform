/**
 * Payment split math (locked decisions #11 + money-math rules).
 *
 * For a captured homeowner charge of `grossCents`:
 *   - platform fee = round(gross * platformFeeBps / 10000)        → platform balance
 *   - cleaner payout = floor(gross * payoutPercent / 100)         → % of GROSS, not net
 *   - tenant remainder = gross - platformFee - cleaner            → stays with tenant
 *
 * Cleaner share is floored so the three parts never exceed the captured amount;
 * leftover rounding cents accrue to the tenant. The invariant
 * `platformFee + cleaner + tenantRemainder === gross` always holds.
 *
 * `payoutPercent` is 0 for hourly_external cleaners (no Stripe payout — the tenant
 * pays them outside the app), which makes cleanerCents 0 and the tenant keep
 * everything after the platform fee.
 *
 * All values are integer cents. Pure + dependency-free so it can be unit-tested
 * and reused by both the authorize (fee snapshot) and capture (transfer) paths.
 */

export interface PaymentSplit {
  grossCents: number;
  platformFeeCents: number;
  cleanerCents: number;
  tenantRemainderCents: number;
}

export interface PaymentSplitParams {
  grossCents: number;
  /** Cleaner's percentage of GROSS, 0..100. Use 0 for hourly_external cleaners. */
  payoutPercent: number;
  /** Platform fee in basis points, 0..10000 (100 = 1%). Default 0 today. */
  platformFeeBps: number;
}

export function computePaymentSplit({
  grossCents,
  payoutPercent,
  platformFeeBps,
}: PaymentSplitParams): PaymentSplit {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('computePaymentSplit: grossCents must be a non-negative integer');
  }
  if (!Number.isFinite(payoutPercent) || payoutPercent < 0 || payoutPercent > 100) {
    throw new Error('computePaymentSplit: payoutPercent must be between 0 and 100');
  }
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
    throw new Error('computePaymentSplit: platformFeeBps must be an integer between 0 and 10000');
  }

  const platformFeeCents = Math.round((grossCents * platformFeeBps) / 10000);
  const cleanerCents = Math.floor((grossCents * payoutPercent) / 100);
  const tenantRemainderCents = grossCents - platformFeeCents - cleanerCents;

  if (tenantRemainderCents < 0) {
    // Guard the impossible-with-valid-inputs case (e.g. fee + payout > 100% of gross).
    throw new Error(
      `computePaymentSplit: split underflow (gross=${grossCents}, fee=${platformFeeCents}, cleaner=${cleanerCents})`,
    );
  }

  return { grossCents, platformFeeCents, cleanerCents, tenantRemainderCents };
}
