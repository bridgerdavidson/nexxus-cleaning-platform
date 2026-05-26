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


