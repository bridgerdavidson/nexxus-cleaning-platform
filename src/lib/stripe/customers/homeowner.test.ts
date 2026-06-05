import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMock = vi.fn();
const retrieveCustomerMock = vi.fn();
const achEnabledMock = vi.fn(() => true);

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    customers: { retrieve: retrieveCustomerMock },
    paymentMethods: { list: listMock },
  }),
  getOrCreateStripeCustomer: vi.fn(),
}));
vi.mock('@/lib/stripe/flags', () => ({ stripeAchEnabled: () => achEnabledMock() }));

import { listSavedCards } from './homeowner';

const cardList = {
  data: [{ id: 'pm_card1', card: { brand: 'visa', last4: '4242', exp_month: 9, exp_year: 2030 } }],
};
const bankList = {
  data: [{ id: 'pm_bank1', us_bank_account: { bank_name: 'Chase', last4: '6789' } }],
};

describe('listSavedCards', () => {
  beforeEach(() => {
    listMock.mockReset();
    retrieveCustomerMock.mockReset();
    achEnabledMock.mockReturnValue(true);
    retrieveCustomerMock.mockResolvedValue({
      deleted: false,
      invoice_settings: { default_payment_method: 'pm_card1' },
    });
    listMock.mockImplementation(async ({ type }: { type: string }) => {
      if (type === 'card') return cardList;
      if (type === 'us_bank_account') return bankList;
      return { data: [] };
    });
  });

  it('returns cards with a card type discriminator and masked fields', async () => {
    const result = await listSavedCards('cus_x');
    const card = result.find((p) => p.id === 'pm_card1');
    expect(card).toMatchObject({
      id: 'pm_card1',
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 9,
      expYear: 2030,
      isDefault: true,
    });
  });

  it('includes saved bank accounts (us_bank_account) when ACH is enabled', async () => {
    const result = await listSavedCards('cus_x');
    const bank = result.find((p) => p.id === 'pm_bank1');
    expect(bank).toMatchObject({
      id: 'pm_bank1',
      type: 'us_bank_account',
      bankName: 'Chase',
      last4: '6789',
      isDefault: false,
    });
  });

  it('omits bank accounts when ACH is disabled (card-only, unchanged behavior)', async () => {
    achEnabledMock.mockReturnValue(false);
    const result = await listSavedCards('cus_x');
    expect(result.every((p) => p.type === 'card')).toBe(true);
    expect(result.find((p) => p.id === 'pm_bank1')).toBeUndefined();
    // the us_bank_account list call is not made when ACH is off
    expect(listMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'us_bank_account' }));
  });

  it('returns [] when the customer does not exist', async () => {
    retrieveCustomerMock.mockRejectedValueOnce(new Error('no such customer'));
    const result = await listSavedCards('cus_missing');
    expect(result).toEqual([]);
  });
});
