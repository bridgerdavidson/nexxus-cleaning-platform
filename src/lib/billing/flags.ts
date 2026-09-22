/**
 * SaaS subscription billing rollout flags (default OFF until ops flips them).
 *
 * BILLING_ENFORCEMENT_ENABLED — gates the server-side paywall. While off, the
 *   402 guard on every write route returns success without reading a row, so
 *   PRs D through G ship dark.
 * BILLING_TAX_ENABLED — gates `automatic_tax` on Checkout Sessions and
 *   subscriptions. Stays off until Stripe Tax has an active registration,
 *   because without one Stripe silently collects nothing and returns no error.
 *
 * Each server flag has a NEXT_PUBLIC_* mirror so client components can hide the
 * billing UI while the server flag is still off (same pattern as
 * STRIPE_ENABLED / NEXT_PUBLIC_STRIPE_ENABLED).
 */

/** Server: the write-route paywall is live. */
export function billingEnforcementEnabled(): boolean {
  return process.env.BILLING_ENFORCEMENT_ENABLED === 'true';
}

/** Client: show the billing pill, banner, and paywall. */
export function billingEnforcementUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED === 'true';
}

/** Server: pass `automatic_tax` to Stripe. Requires an active Stripe Tax registration. */
export function billingTaxEnabled(): boolean {
  return process.env.BILLING_TAX_ENABLED === 'true';
}
