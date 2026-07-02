/**
 * Pure presenters for the homeowner saved-payment-methods list. The shape mirrors the
 * `/api/stripe/my-payment-methods` GET response (masked metadata only, never the PAN).
 */

export interface SavedPaymentMethod {
  id: string;
  /** Discriminator: card vs bank account (ACH / us_bank_account). */
  type: 'card' | 'us_bank_account';
  /** Last 4 of the card number or bank account number. */
  last4: string;
  isDefault: boolean;
  // card only
  brand?: string;
  expMonth?: number;
  expYear?: number;
  // us_bank_account only
  bankName?: string;
}

/** Title-case a card brand id ("visa" -> "Visa", "american_express" -> "American Express"). */
export function cardBrandLabel(brand: string | undefined): string {
  if (!brand) return 'Card';
  return brand
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Row title: "Visa •••• 4242" for cards, "Chase •••• 6789" for bank accounts. */
export function paymentMethodTitle(pm: SavedPaymentMethod): string {
  const label = pm.type === 'us_bank_account' ? pm.bankName || 'Bank account' : cardBrandLabel(pm.brand);
  return `${label} •••• ${pm.last4 || '••••'}`;
}

/** Row subtitle: "Expires 01/2030" for cards, "Bank account" for ACH. */
export function paymentMethodSubtitle(pm: SavedPaymentMethod): string {
  if (pm.type === 'us_bank_account') return 'Bank account';
  if (pm.expMonth && pm.expYear) {
    return `Expires ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}`;
  }
  return 'Card';
}

/** Default method first, then original order preserved (stable). */
export function sortPaymentMethods(list: SavedPaymentMethod[]): SavedPaymentMethod[] {
  return [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
