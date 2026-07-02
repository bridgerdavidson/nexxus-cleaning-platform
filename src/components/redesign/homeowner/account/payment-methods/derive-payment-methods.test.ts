import { describe, it, expect } from 'vitest';
import {
  cardBrandLabel,
  paymentMethodTitle,
  paymentMethodSubtitle,
  sortPaymentMethods,
  type SavedPaymentMethod,
} from './derive-payment-methods';

const card = (over: Partial<SavedPaymentMethod> = {}): SavedPaymentMethod => ({
  id: 'pm_1',
  type: 'card',
  last4: '4242',
  isDefault: false,
  brand: 'visa',
  expMonth: 1,
  expYear: 2030,
  ...over,
});

const bank = (over: Partial<SavedPaymentMethod> = {}): SavedPaymentMethod => ({
  id: 'pm_b',
  type: 'us_bank_account',
  last4: '6789',
  isDefault: false,
  bankName: 'Chase',
  ...over,
});

describe('cardBrandLabel', () => {
  it('title-cases a single-word brand', () => {
    expect(cardBrandLabel('visa')).toBe('Visa');
  });

  it('title-cases a multi-word brand', () => {
    expect(cardBrandLabel('american_express')).toBe('American Express');
  });

  it('falls back to "Card" when the brand is missing', () => {
    expect(cardBrandLabel(undefined)).toBe('Card');
  });
});

describe('paymentMethodTitle', () => {
  it('renders a card as brand + masked last4', () => {
    expect(paymentMethodTitle(card())).toBe('Visa •••• 4242');
  });

  it('renders a bank account as bank name + masked last4', () => {
    expect(paymentMethodTitle(bank())).toBe('Chase •••• 6789');
  });

  it('falls back to "Bank account" when the bank name is missing', () => {
    expect(paymentMethodTitle(bank({ bankName: undefined }))).toBe('Bank account •••• 6789');
  });
});

describe('paymentMethodSubtitle', () => {
  it('renders a padded expiry for cards', () => {
    expect(paymentMethodSubtitle(card({ expMonth: 1, expYear: 2030 }))).toBe('Expires 01/2030');
  });

  it('renders "Bank account" for ACH', () => {
    expect(paymentMethodSubtitle(bank())).toBe('Bank account');
  });

  it('falls back to "Card" when expiry is unknown', () => {
    expect(paymentMethodSubtitle(card({ expMonth: undefined, expYear: undefined }))).toBe('Card');
  });
});

describe('sortPaymentMethods', () => {
  it('moves the default method to the front and keeps the rest stable', () => {
    const a = card({ id: 'a' });
    const b = card({ id: 'b', isDefault: true });
    const c = card({ id: 'c' });
    expect(sortPaymentMethods([a, b, c]).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate the input array', () => {
    const list = [card({ id: 'a' }), card({ id: 'b', isDefault: true })];
    sortPaymentMethods(list);
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
