/**
 * Homeowner Stripe Customer helpers (platform-level Customer — one per homeowner,
 * reused across every tenant they book with; charges are destination charges so no
 * per-tenant Customer cloning is needed).
 */
import type Stripe from 'stripe';
import { getStripe, getOrCreateStripeCustomer } from '@/lib/stripe';

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/**
 * List a homeowner's saved cards as masked metadata (never the PAN). Used by the
 * admin saved-card picker and the homeowner dashboard.
 */
export async function listSavedCards(customerId: string): Promise<SavedCard[]> {
  const stripe = getStripe();

  let defaultPm: string | null = null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      defaultPm = (customer.invoice_settings?.default_payment_method as string | null) ?? null;
    }
  } catch {
    // customer might not exist yet — return [] below
    return [];
  }

  const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 20 });
  return pms.data
    .filter((pm) => pm.card)
    .map((pm) => ({
      id: pm.id,
      brand: pm.card!.brand,
      last4: pm.card!.last4,
      expMonth: pm.card!.exp_month,
      expYear: pm.card!.exp_year,
      isDefault: pm.id === defaultPm,
    }));
}

/**
 * Whether a PaymentMethod is attached to a given Customer. Used to gate setting a card on an
 * appointment — staff/homeowner can only select a card that already belongs to the appointment's
 * homeowner Customer (never an arbitrary id). Returns false if the PM doesn't exist or isn't theirs.
 */
export async function paymentMethodBelongsToCustomer(
  customerId: string,
  paymentMethodId: string,
): Promise<boolean> {
  const stripe = getStripe();
  try {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    return pm.customer === customerId;
  } catch {
    return false;
  }
}

/**
 * Detach a saved card from a homeowner's Customer. Verifies the payment method actually
 * belongs to the given customer first (so a caller can never detach someone else's card by
 * id-guessing). Returns false if the PM isn't on this customer.
 */
export async function detachPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<boolean> {
  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (pm.customer !== customerId) return false;
  await stripe.paymentMethods.detach(paymentMethodId);
  return true;
}

/**
 * Make a saved card the Customer's default PaymentMethod (what off-session charges read). Verifies
 * the card belongs to this Customer first so a caller can never promote an arbitrary id. Returns
 * false if the PM isn't on this customer.
 */
export async function setDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<boolean> {
  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (pm.customer !== customerId) return false;
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  return true;
}

/**
 * Create a CustomerSession for the homeowner-facing Payment Element — one widget that
 * shows saved cards, lets them add a new one, save it for later, and remove cards.
 * Replaces the legacy ephemeral-key approach.
 */
export async function createHomeownerCustomerSession(
  customerId: string,
): Promise<Stripe.CustomerSession> {
  const stripe = getStripe();
  return stripe.customerSessions.create({
    customer: customerId,
    components: {
      payment_element: {
        enabled: true,
        features: {
          payment_method_save: 'enabled',
          payment_method_redisplay: 'enabled',
          payment_method_remove: 'enabled',
        },
      },
    },
  });
}

export { getOrCreateStripeCustomer };
