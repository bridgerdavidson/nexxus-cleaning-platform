/**
 * Cleaner Stripe Connect helpers.
 *
 * A cleaner is a percentage contractor paid via platform→cleaner transfers, so the
 * Express account only needs the `transfers` capability (distinct from the tenant,
 * which is the merchant of record and also needs `card_payments`). Account creation
 * reuses the flat `createConnectAccount` helper.
 *
 * Onboarding is EMBEDDED: we create an Account Session and the client mounts Stripe's
 * `account-onboarding` Connect component inline, so the cleaner never leaves the app —
 * the same pattern used for the tenant. Wrapping account creation here (rather than the
 * route calling `@/lib/stripe` directly) keeps every Stripe call for this flow in one
 * module so integration tests can mock it without touching the global `@/lib/stripe` mock.
 */
import type Stripe from 'stripe';
import { getStripe, createConnectAccount } from '@/lib/stripe';

/**
 * Create the cleaner's Express (transfers-only) connected account.
 *
 * Pass `idempotencyKey` (typically `cleaner-connect-${cleaner_id}-${env}`) so
 * concurrent or retried `/start` calls within Stripe's 24h dedup window resolve
 * to the same account instead of creating an orphan stub. The DB-side
 * claim/commit slot is the primary guard; the Stripe key is a backstop.
 */
export async function createCleanerConnectAccount(
  email: string,
  name: string,
  options?: { idempotencyKey?: string },
): Promise<Stripe.Account> {
  return createConnectAccount(email, name, options);
}

/**
 * Create an Account Session for embedded onboarding + payout visibility of a cleaner's
 * connected account. Returns the client secret the frontend passes to
 * `loadConnectAndInitialize`. Onboarding + account management let the cleaner finish
 * verification inline; balances + payouts surface their earnings without the Express
 * dashboard; the notification banner prompts when Stripe needs more info.
 */
export async function createCleanerAccountSession(
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
