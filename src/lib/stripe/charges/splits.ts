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
 * The platform fee is CAPPED at what the tenant has left after the cleaner's share
 * (the fee comes out of the tenant remainder, never the cleaner's cut): a 100%-payout
 * cleaner leaves nothing, so the fee caps to 0 rather than underflowing. Self-pay does
 * NOT use this cap — there the org is the payer and the fee rides on top (see
 * `selfPayMath.computeSelfPayAmounts`), sharing `platformFeeCentsFor` as the one
 * fee-on-gross formula.
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

/**
 * The platform's fee on `grossCents` at `platformFeeBps`, UNCAPPED: round(gross · bps / 10000).
 * The single fee-on-gross formula shared by the homeowner split (below, where it is then capped
 * at the tenant remainder) and the self-pay charge (`selfPayMath`, where it rides on top).
 */
export function platformFeeCentsFor(grossCents: number, platformFeeBps: number): number {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('platformFeeCentsFor: grossCents must be a non-negative integer');
  }
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
    throw new Error('platformFeeCentsFor: platformFeeBps must be an integer between 0 and 10000');
  }
  return Math.round((grossCents * platformFeeBps) / 10000);
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

  // Cleaner first (their % of gross is locked), then the fee is capped at what the tenant has
  // left. Without the cap, payout% + fee > 100% of gross (e.g. a 100%-payout cleaner with any
  // fee) would underflow and crash settlement.
  const cleanerCents = Math.floor((grossCents * payoutPercent) / 100);
  const platformFeeCents = Math.min(platformFeeCentsFor(grossCents, platformFeeBps), grossCents - cleanerCents);
  const tenantRemainderCents = grossCents - platformFeeCents - cleanerCents;

  return { grossCents, platformFeeCents, cleanerCents, tenantRemainderCents };
}

export interface PaymentSplitFromCentsParams {
  grossCents: number;
  /** The cleaner's already-resolved share in cents (flat rate or approved pay request), <= grossCents. */
  cleanerCents: number;
  /** Platform fee in basis points, 0..10000 (100 = 1%). */
  platformFeeBps: number;
}

/**
 * The cents-based sibling of computePaymentSplit for pay modes whose cleaner
 * share is an absolute amount (flat / request) rather than a percent. Same
 * invariants: fee = min(fee-on-gross, gross - cleaner) so the tenant remainder
 * never goes negative, and the three parts always sum to gross. Callers
 * resolve the cleaner share first (resolveCleanerShareCents caps it at gross).
 */
export function computePaymentSplitFromCents({
  grossCents,
  cleanerCents,
  platformFeeBps,
}: PaymentSplitFromCentsParams): PaymentSplit {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('computePaymentSplitFromCents: grossCents must be a non-negative integer');
  }
  if (!Number.isInteger(cleanerCents) || cleanerCents < 0) {
    throw new Error('computePaymentSplitFromCents: cleanerCents must be a non-negative integer');
  }
  if (cleanerCents > grossCents) {
    throw new Error('computePaymentSplitFromCents: cleanerCents must not exceed grossCents');
  }
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
    throw new Error('computePaymentSplitFromCents: platformFeeBps must be an integer between 0 and 10000');
  }

  const platformFeeCents = Math.min(platformFeeCentsFor(grossCents, platformFeeBps), grossCents - cleanerCents);
  const tenantRemainderCents = grossCents - platformFeeCents - cleanerCents;

  return { grossCents, platformFeeCents, cleanerCents, tenantRemainderCents };
}
