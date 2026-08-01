/**
 * One place that turns a cleaner's pay mode into cents-of-gross (spec §4/§6,
 * docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md).
 *
 * - percentage (default branch; covers the legacy 'percentage_contractor'
 *   spelling residue by design - never branch on 'percentage' itself):
 *   floor(gross * percent / 100), identical to computePaymentSplit.
 * - flat: min(flat_rate_cents, gross). `capped` flags when the rate exceeded
 *   the job's gross so settlement can record a payout_flat_capped event.
 * - request: min(approved_amount_cents, gross). Approvals are capped at the
 *   job price upstream, but refunds can shrink the split base below the
 *   approved amount; `capped` flags that so settlement can record it.
 *   Throws when no approved amount is supplied - settlement must gate on the
 *   thread's approval BEFORE resolving the share.
 * - hourly_external: 0 (paid outside the app).
 *
 * Pure + dependency-free.
 */

export interface ResolveCleanerShareArgs {
  payoutModel: string | null | undefined;
  payoutPercent: number | string | null | undefined;
  flatRateCents: number | null | undefined;
  approvedRequestCents: number | null | undefined;
  grossCents: number;
}

export interface ResolvedCleanerShare {
  cents: number;
  capped: boolean;
  basis: 'percent' | 'flat' | 'request' | 'none';
}

export function resolveCleanerShareCents(args: ResolveCleanerShareArgs): ResolvedCleanerShare {
  const { payoutModel, grossCents } = args;
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('resolveCleanerShareCents: grossCents must be a non-negative integer');
  }

  if (payoutModel === 'hourly_external') {
    return { cents: 0, capped: false, basis: 'none' };
  }

  if (payoutModel === 'request') {
    const approved = args.approvedRequestCents;
    if (approved == null || !Number.isInteger(approved) || approved < 0) {
      throw new Error('resolveCleanerShareCents: request mode requires an approved amount');
    }
    return { cents: Math.min(approved, grossCents), capped: approved > grossCents, basis: 'request' };
  }

  if (payoutModel === 'flat') {
    const flat = args.flatRateCents;
    if (flat == null || !Number.isInteger(flat) || flat < 0) {
      throw new Error('resolveCleanerShareCents: flat mode requires flat_rate_cents');
    }
    return { cents: Math.min(flat, grossCents), capped: flat > grossCents, basis: 'flat' };
  }

  // Default branch: percentage (incl. legacy 'percentage_contractor' residue).
  const pct = Number(args.payoutPercent ?? 0);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error('resolveCleanerShareCents: payoutPercent must be between 0 and 100');
  }
  return { cents: Math.floor((grossCents * pct) / 100), capped: false, basis: 'percent' };
}
