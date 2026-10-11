/**
 * The two Stripe Customer Portal configurations, as data (ruling R24).
 *
 * WHY TWO. Ruling R15 v4 says remediation is not purchase: an admin may fix a
 * failed card but may not change what is owed. Admins are therefore sent to the
 * Customer Portal. A single configuration with `subscription_cancel` enabled
 * would hand that admin a Cancel subscription button, which makes the owner-only
 * rule decorative: the one thing an admin definitively may not do is end the
 * agreement.
 *
 * Turning cancel off for everyone was rejected. Cancelling has to be no harder
 * than subscribing (ROSCA, and California's ARL), the portal is our only cancel
 * flow, and the owner is the person entitled to use it.
 *
 * So: owners get `default` (today's configuration, unchanged, cancel enabled),
 * admins get `remediation` (card and invoices only). The variant is derived from
 * the caller's SERVER-side org role in portalVariantForRole and never read from
 * a request, because a client-supplied variant would hand an admin the owner
 * portal for the asking.
 *
 * These payloads live here rather than inside scripts/stripe-billing-setup.ts so
 * they are under unit test: the script runs main() on import and has never been
 * run against a real Stripe account, so a wrong flag here is not observable
 * anywhere else until the day someone runs it in live mode.
 */
import type Stripe from 'stripe';

/** The value stamped on `metadata.nexxus_portal`, and the name of the variant. */
export type PortalVariant = 'default' | 'remediation';

export const PORTAL_VARIANTS: readonly PortalVariant[] = ['default', 'remediation'];

/**
 * Which portal a caller gets, from the org role the SERVER resolved.
 *
 * Fails closed: only an owner gets `default`. Every other role, including any
 * role added to this app later, gets the remediation portal, so a new role can
 * never acquire the cancel button by omission.
 */
export function portalVariantForRole(role: string | null | undefined): PortalVariant {
  return role === 'owner' ? 'default' : 'remediation';
}

/**
 * Shared by both configurations: the org's own billing contact details.
 *
 * A factory rather than a shared object, so the two payloads never alias one
 * mutable array that a Stripe SDK call could reorder underneath the other.
 */
function customerUpdate(): Stripe.BillingPortal.ConfigurationCreateParams.Features.CustomerUpdate {
  return { enabled: true, allowed_updates: ['email', 'address', 'name'] };
}

export const PORTAL_CONFIGURATIONS: Record<
  PortalVariant,
  Stripe.BillingPortal.ConfigurationCreateParams
> = {
  /**
   * The OWNER portal. Unchanged from the single configuration this replaced.
   *
   * Plan and seat changes stay off here on purpose: they run through the app,
   * which enforces the seat bounds and the seats-in-use floor that Stripe knows
   * nothing about. Cancellation stays ON, and must: see the header.
   */
  default: {
    business_profile: {
      headline: 'Manage your Nexxus subscription',
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: customerUpdate(),
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
  },

  /**
   * The ADMIN portal. Everything needed to rescue a failing subscription, and
   * nothing that changes what is owed.
   *
   * Both subscription features are OFF: `subscription_cancel` because ending the
   * agreement is the owner's decision, `subscription_update` for the same reason
   * it is off above.
   */
  remediation: {
    business_profile: {
      headline: 'Your Nexxus payment method and invoices',
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: customerUpdate(),
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { nexxus_portal: 'remediation', source: 'nexxus-cleaning-platform' },
  },
};
