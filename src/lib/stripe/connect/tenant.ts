/**
 * Tenant (organization) Stripe Connect helpers.
 *
 * The tenant cleaning company is the MERCHANT OF RECORD: homeowner charges are
 * destination charges created on the platform with `on_behalf_of` + `transfer_data.destination`
 * pointing at the tenant's Express connected account. The tenant therefore needs both
 * `card_payments` (to be the settlement merchant) and `transfers` (to settle, and to pay
 * percentage-contractor cleaners onward). This is distinct from cleaner accounts, which
 * only need `transfers`.
 *
 * Onboarding is EMBEDDED: we create an Account Session and the client mounts Stripe's
 * `account-onboarding` Connect component inline, so the tenant never leaves our app.
 *
 * New code lives under src/lib/stripe/connect/ (the target structure); existing flat
 * helpers in src/lib/stripe.ts are reused via the `@/lib/stripe` alias until the full
 * split happens in a later phase.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export interface TenantConnectStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
}

/**
 * Create an Express connected account for a tenant organization.
 *
 * `business_type` is intentionally omitted so the cleaning company can choose
 * company vs. sole-proprietor/individual during onboarding. Capabilities cover
 * the full merchant-of-record + onward-transfer role.
 *
 * Pass `idempotencyKey` (typically `tenant-connect-${org_id}-${env}`) so
 * concurrent or retried `/start` calls within Stripe's 24h dedup window resolve
 * to the same account instead of creating an orphan stub. The DB-side
 * claim/commit slot is the primary guard; the Stripe key is a backstop.
 */
export async function createTenantConnectAccount(
  organizationId: string,
  email: string,
  orgName: string,
  options?: { idempotencyKey?: string },
): Promise<Stripe.Account> {
  const stripe = getStripe();

  return stripe.accounts.create(
    {
      type: 'express',
      email: email || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        name: orgName || undefined,
      },
      metadata: {
        organization_id: organizationId,
        account_role: 'tenant',
        source: 'nexxus-cleaning-platform',
      },
    },
    options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  );
}

/**
 * Create an Account Session for embedded onboarding (and post-onboarding account
 * management) of a tenant's connected account. Returns the client secret the
 * frontend passes to `loadConnectAndInitialize`.
 */
export async function createTenantAccountSession(
  accountId: string,
): Promise<Stripe.AccountSession> {
  const stripe = getStripe();

  return stripe.accountSessions.create({
    account: accountId,
    components: {
      account_onboarding: { enabled: true },
      account_management: { enabled: true },
      balances: { enabled: true },
      payouts: { enabled: true },
      notification_banner: { enabled: true },
    },
  });
}

/**
 * Retrieve the current state of a tenant's connected account for mirroring into
 * `organizations`. `requirementsDue` surfaces what Stripe still needs so the UI
 * can prompt the tenant to finish.
 */
export async function getTenantConnectStatus(
  accountId: string,
): Promise<TenantConnectStatus> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);

  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    requirementsDue: account.requirements?.currently_due ?? [],
  };
}
