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
 * Who the Account Session is for:
 *  - `owner`  — the org owner: full setup (onboarding + account management +
 *               notification banner + balances + payouts + payments).
 *  - `viewer` — a non-owner admin / manager-with-can_manage_payments: read-only
 *               financial visibility (balances + payouts + payments) with every
 *               management feature disabled and NO setup surfaces. Only the owner
 *               connects the business and edits the bank account.
 */
export type TenantAccountSessionScope = 'owner' | 'viewer';

/**
 * Create an Account Session for a tenant's connected account, scoped by role.
 * Returns the client secret the frontend passes to `loadConnectAndInitialize`.
 *
 * Viewers see the org's balance / payouts / payments without their own Stripe
 * login: the AccountSession authorizes those read components, which don't require
 * the account holder to authenticate. (`disable_stripe_user_authentication` is
 * deliberately NOT set — Stripe only allows it for Custom accounts, and these
 * tenants are Express, so passing it 500s.) Onboarding / account-management /
 * external-account collection are owner-only.
 */
export async function createTenantAccountSession(
  accountId: string,
  scope: TenantAccountSessionScope = 'owner',
): Promise<Stripe.AccountSession> {
  const stripe = getStripe();

  if (scope === 'owner') {
    return stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        account_management: { enabled: true },
        notification_banner: { enabled: true },
        balances: { enabled: true },
        payouts: { enabled: true },
        payments: { enabled: true },
      },
    });
  }

  return stripe.accountSessions.create({
    account: accountId,
    components: {
      balances: {
        enabled: true,
        features: {
          edit_payout_schedule: false,
          instant_payouts: false,
          standard_payouts: false,
          external_account_collection: false,
        },
      },
      payouts: {
        enabled: true,
        features: {
          edit_payout_schedule: false,
          instant_payouts: false,
          standard_payouts: false,
          external_account_collection: false,
        },
      },
      payments: {
        enabled: true,
        features: {
          refund_management: false,
          dispute_management: false,
          capture_payments: false,
          destination_on_behalf_of_charge_management: false,
        },
      },
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
