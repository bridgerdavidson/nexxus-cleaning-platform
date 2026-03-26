import Stripe from 'stripe';
import { stripeEnabled } from './stripe/flags';

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

  // Check if a customer with this email already exists
  const existingCustomers = await stripe.customers.list({
    email: email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create a new customer
  const newCustomer = await stripe.customers.create({
    email: email,
    name: name,
    metadata: {
      source: 'nexxus-cleaning-platform',
    },
  });

  return newCustomer;
}

// Helper function to create a SetupIntent for collecting payment method
export async function createSetupIntent(
  customerId: string
): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session', // Allow charging the customer when they're not present
    metadata: {
      source: 'nexxus-cleaning-platform',
    },
  });

  return setupIntent;
}

// Helper function to create a PaymentIntent to charge a customer
export async function createPaymentIntent(
  customerId: string,
  amount: number, // Amount in cents
  appointmentId: string,
  paymentMethodId?: string
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const paymentIntentData: Stripe.PaymentIntentCreateParams = {
    amount: Math.round(amount * 100), // Convert dollars to cents
    currency: 'usd',
    customer: customerId,
    off_session: true,
    confirm: true,
    metadata: {
      appointment_id: appointmentId,
      source: 'nexxus-cleaning-platform',
    },
  };

  // If a specific payment method is provided, use it
  if (paymentMethodId) {
    paymentIntentData.payment_method = paymentMethodId;
  }

  const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

  return paymentIntent;
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
  name: string
): Promise<Stripe.Account> {
  const stripe = getStripe();

  const account = await stripe.accounts.create({
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
  });

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

