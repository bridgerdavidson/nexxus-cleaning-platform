/**
 * Request-mode auto-approve threshold (spec §5,
 * docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md).
 *
 *   autoApproveMaxCents = floor(price * (10000 - minMarginBps) / 10000)
 *
 * A cleaner's pay request auto-approves iff request <= max (inclusive):
 * `min_margin_bps` is the share of the job price the org keeps as a floor.
 * Over-price requests are LEGAL inputs and simply escalate - rejecting them at
 * submission would leak the hidden job price through the error message.
 * The platform fee is deliberately outside this check; it comes out of the
 * org's kept side at settlement exactly as in the percentage model.
 *
 * All values are integer cents / integer bps. Pure and dependency-free.
 */

export function autoApproveMaxCents(jobPriceCents: number, minMarginBps: number): number {
  if (!Number.isInteger(jobPriceCents) || jobPriceCents < 0) {
    throw new Error('autoApproveMaxCents: jobPriceCents must be a non-negative integer');
  }
  if (!Number.isInteger(minMarginBps) || minMarginBps < 0 || minMarginBps > 10000) {
    throw new Error('autoApproveMaxCents: minMarginBps must be an integer between 0 and 10000');
  }
  return Math.floor((jobPriceCents * (10000 - minMarginBps)) / 10000);
}

export function isAutoApproved(
  requestCents: number,
  jobPriceCents: number,
  minMarginBps: number,
): boolean {
  if (!Number.isInteger(requestCents) || requestCents < 0) {
    throw new Error('isAutoApproved: requestCents must be a non-negative integer');
  }
  return requestCents <= autoApproveMaxCents(jobPriceCents, minMarginBps);
}
