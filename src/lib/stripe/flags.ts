/**
 * Feature flags for Stripe integration
 * 
 * Server-side flag: STRIPE_ENABLED
 * Client-side flag: NEXT_PUBLIC_STRIPE_ENABLED
 */

/**
 * Check if Stripe is enabled on the server side
 * @returns true if STRIPE_ENABLED === "true"
 */
export function stripeEnabled(): boolean {
  return process.env.STRIPE_ENABLED === "true";
}

/**
 * Check if Stripe UI is enabled on the client side
 * @returns true if NEXT_PUBLIC_STRIPE_ENABLED === "true"
 */
export function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";
}

/**
 * Stripe restructure rollout flags (default OFF until each phase ships).
 *
 * STRIPE_TENANT_CONNECT_ENABLED   — gates per-org Stripe Express onboarding +
 *                                   destination-charge routing through tenant
 *                                   connected accounts (Phase 1+).
 * STRIPE_NEW_CHARGE_FLOW_ENABLED  — gates the new save-card / just-in-time
 *                                   authorize / capture-on-completion flow that
 *                                   replaces the legacy platform-only charge
 *                                   (Phase 2+).
 *
 * Each has a NEXT_PUBLIC_* mirror so client components can hide the new UI while
 * the server flag is still off (same pattern as STRIPE_ENABLED / NEXT_PUBLIC_STRIPE_ENABLED).
 */

/** Server: tenant Connect onboarding + tenant-routed charges enabled. */
export function stripeTenantConnectEnabled(): boolean {
  return process.env.STRIPE_TENANT_CONNECT_ENABLED === "true";
}

/** Client: show tenant Connect onboarding UI. */
export function stripeTenantConnectUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_TENANT_CONNECT_ENABLED === "true";
}

/** Server: new save-card / authorize / capture charge flow enabled. */
export function stripeNewChargeFlowEnabled(): boolean {
  return process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED === "true";
}

/** Client: show new charge-flow UI (saved-card picker, send-link, self-request). */
export function stripeNewChargeFlowUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_NEW_CHARGE_FLOW_ENABLED === "true";
}

/**
 * Organization self-pay (default OFF).
 *
 * STRIPE_SELF_PAY_ENABLED — gates the ability for an org to own homeowner-less
 *   properties and pay for a cleaning on its own company card (charging the
 *   cleaner's cut grossed-up for Stripe fees and settling 100% to the cleaner).
 *
 * DEPENDENCY: self-pay reuses the new-charge-flow authorize / capture / refund
 * routes, which no-op unless stripeNewChargeFlowEnabled() is also true. Treat
 * STRIPE_SELF_PAY_ENABLED as implying STRIPE_NEW_CHARGE_FLOW_ENABLED — enabling
 * self-pay without the new charge flow has no effect.
 */

/** Server: org self-pay (company-card-funded cleanings) enabled. */
export function stripeSelfPayEnabled(): boolean {
  return process.env.STRIPE_SELF_PAY_ENABLED === "true";
}

/** Client: show org self-pay UI (bill-to choice, company card section, owned-by-us). */
export function stripeSelfPayUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_SELF_PAY_ENABLED === "true";
}

