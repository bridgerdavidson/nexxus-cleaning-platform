import Stripe from 'stripe';
import { stripeEnabled, stripeAchEnabled } from './stripe/flags';

// Lazy initialization - only create Stripe instance when needed and enabled
let stripeInstance: Stripe | null = null;

/**
 * Get Stripe instance - lazily initializes only when Stripe is enabled
 * @throws Error if Stripe is disabled or STRIPE_SECRET_KEY is missing
 */
export function getStripe(): Stripe {
  if (!stripeEnabled()) {
    throw new Error('Stripe is disabled. Set STRIPE_ENABLED=true to enable.');
  }

  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
    }

    stripeInstance = new Stripe(key, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });
  }

  return stripeInstance;
}

// Helper function to create or retrieve a Stripe customer
export async function getOrCreateStripeCustomer(
  email: string,
  name: string,
  existingCustomerId?: string | null
): Promise<Stripe.Customer> {
  const stripe = getStripe();

  // If we have an existing customer ID, retrieve and verify it
  if (existingCustomerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(existingCustomerId);
      if (!existingCustomer.deleted) {
        return existingCustomer as Stripe.Customer;
      }
    } catch {
      // Customer doesn't exist or was deleted, create a new one
      console.log('Existing Stripe customer not found, creating new one');
    }
  }

  // Do NOT look the Customer up by email. In a multi-tenant platform an email match
  // can alias onto another org's Customer (or another homeowner who reused the email),
  // leaking/charging their saved cards. The stored stripe_customer_id (passed as
  // existingCustomerId and persisted back by every caller) is the dedup key; when it
  // is absent, always create a fresh Customer. Mirrors getOrCreateOrgSelfPayCustomer.
  const newCustomer = await stripe.customers.create({
    email: email,
    name: name,
    metadata: {
      source: 'nexxus-cleaning-platform',
    },
  });

  return newCustomer;
}

/**
 * Resolve the ORG's dedicated self-pay Stripe Customer (its company card lives here).
 * Unlike getOrCreateStripeCustomer, this NEVER looks a Customer up by email — an email match
 * could alias onto another org's Customer or a homeowner's Customer and leak/charge their saved
 * cards. When there's no existing id, always create a fresh org-scoped Customer.
 */
export async function getOrCreateOrgSelfPayCustomer(
  organizationId: string,
  email: string,
  name: string,
  existingCustomerId?: string | null,
): Promise<Stripe.Customer> {
  const stripe = getStripe();
  if (existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(existingCustomerId);
      if (!existing.deleted) return existing as Stripe.Customer;
    } catch {
      // fall through and create a fresh one
    }
  }
  return stripe.customers.create({
    email,
    name,
    metadata: { organization_id: organizationId, self_pay: 'true', source: 'nexxus-cleaning-platform' },
  });
}

// Helper function to create a SetupIntent for collecting payment method
export async function createSetupIntent(
  customerId: string
): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();

  // Offer ACH (us_bank_account) alongside card when enabled, with Financial Connections so the
  // bank account is verified instantly and usable for off-session debits. The Payment Element
  // renders the bank option automatically from these allowed types.
  const ach = stripeAchEnabled();
  const params: Stripe.SetupIntentCreateParams = {
    customer: customerId,
    payment_method_types: ach ? ['card', 'us_bank_account'] : ['card'],
    usage: 'off_session', // Allow charging the customer when they're not present
    metadata: { source: 'nexxus-cleaning-platform' },
  };
  if (ach) {
    // Only request `payment_method` (collect + instantly verify the bank account). We never read
    // the Financial Connections `balances` product, and requesting it hard-rejects every SetupIntent
    // on a live account not registered for it (which broke all card-adding when ACH was first enabled).
    params.payment_method_options = {
      us_bank_account: { financial_connections: { permissions: ['payment_method'] } },
    };
  }

  const setupIntent = await stripe.setupIntents.create(params);

  return setupIntent;
}

// Helper function to get the default payment method for a customer
export async function getDefaultPaymentMethod(
  customerId: string
): Promise<string | null> {
  const stripe = getStripe();

  const customer = await stripe.customers.retrieve(customerId);
  
  if (customer.deleted) {
    return null;
  }

  // Check for default payment method
  if (customer.invoice_settings?.default_payment_method) {
    return customer.invoice_settings.default_payment_method as string;
  }

  // If no default, get the first attached payment method
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card',
    limit: 1,
  });

  if (paymentMethods.data.length > 0) {
    return paymentMethods.data[0].id;
  }

  return null;
}

// Helper function to attach a payment method to a customer and set as default
export async function attachPaymentMethodToCustomer(
  paymentMethodId: string,
  customerId: string
): Promise<Stripe.PaymentMethod> {
  const stripe = getStripe();

  // Attach the payment method to the customer
  const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  // Set as default payment method
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  return paymentMethod;
}

// Helper function to get payment method details for a customer
export async function getPaymentMethodDetails(
  customerId: string
): Promise<{ last4: string; brand: string; paymentMethodId: string } | null> {
  try {
    const stripe = getStripe();

    const customer = await stripe.customers.retrieve(customerId);
    
    if (customer.deleted) {
      return null;
    }

    let paymentMethodId: string | null = null;

    // Check for default payment method
    if (customer.invoice_settings?.default_payment_method) {
      paymentMethodId = customer.invoice_settings.default_payment_method as string;
    } else {
      // If no default, get the first attached payment method
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
        limit: 1,
      });

      if (paymentMethods.data.length > 0) {
        paymentMethodId = paymentMethods.data[0].id;
      }
    }

    if (!paymentMethodId) {
      return null;
    }

    // Retrieve the payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (paymentMethod.type !== 'card' || !paymentMethod.card) {
      return null;
    }

    return {
      last4: paymentMethod.card.last4,
      brand: paymentMethod.card.brand,
      paymentMethodId: paymentMethod.id,
    };
  } catch (error) {
    console.error('Error getting payment method details:', error);
    return null;
  }
}

// Helper to verify webhook signature
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

// ---------------------------------------------------------------------------
// Stripe Connect helpers
// ---------------------------------------------------------------------------

export async function createConnectAccount(
  email: string,
  name: string,
  options?: { idempotencyKey?: string }
): Promise<Stripe.Account> {
  const stripe = getStripe();

  const account = await stripe.accounts.create(
    {
      type: 'express',
      email,
      business_type: 'individual',
      individual: { first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' ') || undefined },
      capabilities: {
        transfers: { requested: true },
      },
      metadata: {
        source: 'nexxus-cleaning-platform',
      },
    },
    options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  );

  return account;
}

export async function createAccountOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<Stripe.AccountLink> {
  const stripe = getStripe();

  const link = await stripe.accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
  });

  return link;
}

export async function getConnectAccountStatus(
  accountId: string
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);

  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
  };
}

/**
 * Create a short-lived login link that redirects an Express connected account
 * holder to their Stripe Express dashboard. (Stripe dropped `redirect_url`
 * from login-link creation; the API version we pin has no post-logout
 * redirect, so this takes only the account.)
 */
export async function createExpressDashboardLoginLink(
  accountId: string
): Promise<Stripe.LoginLink> {
  const stripe = getStripe();
  return stripe.accounts.createLoginLink(accountId);
}

/**
 * Fetch all payouts (bank transfers) for a connected account and return
 * a map from each payout ID → { arrivalDate, status } for reconciliation.
 */
export async function getConnectedAccountPayouts(
  connectedAccountId: string
): Promise<Array<{ id: string; status: string; arrivalDate: string }>> {
  const stripe = getStripe();
  const payouts: Array<{ id: string; status: string; arrivalDate: string }> = [];

  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.PayoutListParams = {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    };

    const page = await stripe.payouts.list(params, {
      stripeAccount: connectedAccountId,
    });

    for (const p of page.data) {
      if (p.status === 'paid') {
        payouts.push({
          id: p.id,
          status: p.status,
          arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        });
      }
    }

    hasMore = page.has_more;
    if (page.data.length > 0) {
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  return payouts;
}

/**
 * Fetch balance transactions for a connected account's payout (bank transfer).
 * Returns the source transfer IDs that were batched into this Stripe payout.
 *
 * Tries `type: 'payment'` first, and if that yields nothing, retries without a
 * type filter so we catch transfers surfaced under other balance-transaction
 * types (e.g. `transfer`, `payout`, etc.).
 */
export async function getPayoutTransferIds(
  connectedAccountId: string,
  stripePayoutId: string
): Promise<string[]> {
  const stripe = getStripe();

  async function fetchIds(typeFilter: string | undefined): Promise<string[]> {
    const ids: string[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Stripe.BalanceTransactionListParams = {
        payout: stripePayoutId,
        limit: 100,
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      };

      const page = await stripe.balanceTransactions.list(params, {
        stripeAccount: connectedAccountId,
      });

      for (const txn of page.data) {
        if (txn.source && typeof txn.source === 'string') {
          ids.push(txn.source);
        }
      }

      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }
    return ids;
  }

  // Try the narrow filter first (most payouts are payments)
  let transferIds = await fetchIds('payment');

  // If nothing found, retry without a type filter to catch other txn types
  if (transferIds.length === 0) {
    transferIds = await fetchIds(undefined);
  }

  return transferIds;
}

/**
 * Retrieve the available balance on a connected account.
 * Returns the sum of available amounts in the account's default currency (USD).
 */
export async function getConnectedAccountBalance(
  connectedAccountId: string
): Promise<{ available: number; pending: number }> {
  const stripe = getStripe();
  const balance = await stripe.balance.retrieve({
    stripeAccount: connectedAccountId,
  });

  const available = balance.available.reduce((sum, b) => sum + b.amount, 0);
  const pending = balance.pending.reduce((sum, b) => sum + b.amount, 0);

  return { available, pending };
}

/**
 * Fetch the most recent completed bank payout for a connected account.
 * Returns null if no payouts have been completed yet.
 */
export async function getLatestConnectedAccountPayout(
  connectedAccountId: string
): Promise<{ amount: number; arrivalDate: string } | null> {
  const stripe = getStripe();

  const payouts = await stripe.payouts.list(
    { limit: 1, status: 'paid' },
    { stripeAccount: connectedAccountId },
  );

  if (payouts.data.length === 0) return null;

  const p = payouts.data[0];
  return {
    amount: p.amount,
    arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
  };
}

/**
 * Create a Connect transfer to a cleaner's connected account.
 * Uses an idempotency key derived from the appointment ID to safely
 * handle webhook retries without creating duplicate transfers.
 */
export async function createConnectTransfer(
  amountCents: number,
  destinationAccountId: string,
  sourcePaymentIntentId: string,
  appointmentId: string
): Promise<Stripe.Transfer> {
  const stripe = getStripe();

  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: 'usd',
      destination: destinationAccountId,
      source_transaction: sourcePaymentIntentId,
      metadata: {
        appointment_id: appointmentId,
        source: 'nexxus-cleaning-platform',
      },
    },
    { idempotencyKey: `payout-${appointmentId}` }
  );

  return transfer;
}

