import { describe, it, expect, vi, beforeEach } from 'vitest';

const transfersCreate = vi.fn(async () => ({ id: 'tr_1' }));
const transfersList = vi.fn(async () => ({ data: [] }));
const transfersCreateReversal = vi.fn(async () => ({ id: 'trr_1' }));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    transfers: { create: transfersCreate, list: transfersList, createReversal: transfersCreateReversal },
  }),
}));

import {
  transferGroupFor,
  createPlatformTransfer,
  listTransfersByGroup,
  reversePlatformTransfer,
} from './transfers';

describe('stripe/transfers (separate charges and transfers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transferGroupFor is stable per appointment', () => {
    expect(transferGroupFor('abc')).toBe('appt_abc');
  });

  it('createPlatformTransfer creates a PLATFORM transfer — NEVER connected→connected (no stripeAccount)', async () => {
    await createPlatformTransfer({
      destinationAccountId: 'acct_cleaner',
      amountCents: 6000,
      sourceTransactionId: 'ch_1',
      transferGroup: 'appt_x',
      idempotencyKey: 'cleaner-payout-x',
      appointmentId: 'x',
    });
    expect(transfersCreate).toHaveBeenCalledTimes(1);
    const [params, options] = transfersCreate.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(params).toMatchObject({
      amount: 6000,
      currency: 'usd',
      destination: 'acct_cleaner',
      transfer_group: 'appt_x',
      source_transaction: 'ch_1',
    });
    // The whole point of the rework: no `stripeAccount` header. With it, this would be a
    // connected→connected transfer, which Stripe rejects ("Cannot create transfers between
    // connected accounts"). Omitting it makes that bug structurally impossible.
    expect(options).toEqual({ idempotencyKey: 'cleaner-payout-x' });
    expect(options.stripeAccount).toBeUndefined();
  });

  it('createPlatformTransfer omits source_transaction when none is provided', async () => {
    await createPlatformTransfer({
      destinationAccountId: 'acct_tenant',
      amountCents: 4000,
      sourceTransactionId: null,
      transferGroup: 'appt_x',
      idempotencyKey: 'tenant-payout-x',
      appointmentId: 'x',
    });
    const [params] = transfersCreate.mock.calls[0] as unknown as [Record<string, unknown>];
    expect('source_transaction' in params).toBe(false);
  });

  it('reversePlatformTransfer reverses on the PLATFORM (no stripeAccount); passes an idempotency key when given', async () => {
    // No key → a clean 2-arg call (no 3rd arg that could be read as a stripeAccount).
    await reversePlatformTransfer('tr_1', 1500);
    expect(transfersCreateReversal).toHaveBeenCalledWith('tr_1', { amount: 1500 });
    expect(transfersCreateReversal.mock.calls[0]).toHaveLength(2);

    // With a key → 3rd arg is the idempotency key ONLY, never a stripeAccount (that would make it
    // a forbidden connected→connected reversal).
    transfersCreateReversal.mockClear();
    await reversePlatformTransfer('tr_2', 2000, 'clawback-x-tr_2-dispute_lost');
    const [id, params, options] = transfersCreateReversal.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(id).toBe('tr_2');
    expect(params).toEqual({ amount: 2000 });
    expect(options).toEqual({ idempotencyKey: 'clawback-x-tr_2-dispute_lost' });
    expect(options.stripeAccount).toBeUndefined();
  });

  it('listTransfersByGroup queries Stripe by transfer_group', async () => {
    await listTransfersByGroup('appt_x');
    expect(transfersList).toHaveBeenCalledWith({ transfer_group: 'appt_x', limit: 100 });
  });
});
