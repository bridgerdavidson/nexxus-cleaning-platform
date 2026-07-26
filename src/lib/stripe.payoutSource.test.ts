import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { payoutTxnSourceTransferId } from './stripe';

/**
 * T1-3 review finding (HIGH): a connected-account payout's balance transactions carry
 * py_ destination-payment sources, not the platform tr_ ids stored on payouts rows.
 * The mapper must dig the tr_ out of the expanded Charge's source_transfer, or the
 * precise bank_paid match can never succeed against real Stripe data.
 */
function txn(source: unknown): Stripe.BalanceTransaction {
  return { id: 'txn_1', object: 'balance_transaction', source } as unknown as Stripe.BalanceTransaction;
}

describe('payoutTxnSourceTransferId', () => {
  it('maps an expanded destination payment (py_) to its originating platform transfer (tr_)', () => {
    expect(
      payoutTxnSourceTransferId(
        txn({ id: 'py_123', object: 'charge', source_transfer: 'tr_abc' }),
      ),
    ).toBe('tr_abc');
  });

  it('unwraps an object-expanded source_transfer to its id', () => {
    expect(
      payoutTxnSourceTransferId(
        txn({ id: 'py_123', object: 'charge', source_transfer: { id: 'tr_def', object: 'transfer' } }),
      ),
    ).toBe('tr_def');
  });

  it('passes a plain string source through (platform-side txns already carry the tr_)', () => {
    expect(payoutTxnSourceTransferId(txn('tr_plain'))).toBe('tr_plain');
  });

  it('falls back to the source object id when there is no source_transfer', () => {
    expect(payoutTxnSourceTransferId(txn({ id: 'po_999', object: 'payout' }))).toBe('po_999');
  });

  it('returns null for a sourceless transaction', () => {
    expect(payoutTxnSourceTransferId(txn(null))).toBeNull();
  });
});
