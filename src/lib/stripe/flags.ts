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

