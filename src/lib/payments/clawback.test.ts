import { describe, it, expect } from 'vitest';
import { proportionalReversalCents } from './clawback';

describe('proportionalReversalCents', () => {
  it('reverses the full transfer for a full refund (nothing already reversed)', () => {
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 0, totalRefundedCents: 10000, grossCents: 10000 }),
    ).toBe(6000);
    expect(
      proportionalReversalCents({ transferAmount: 4000, transferAmountReversed: 0, totalRefundedCents: 10000, grossCents: 10000 }),
    ).toBe(4000);
  });

  it('reverses proportionally for a partial refund', () => {
    // $40 of $100 → 40% of each transfer.
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 0, totalRefundedCents: 4000, grossCents: 10000 }),
    ).toBe(2400);
    expect(
      proportionalReversalCents({ transferAmount: 4000, transferAmountReversed: 0, totalRefundedCents: 4000, grossCents: 10000 }),
    ).toBe(1600);
  });

  it('is cumulative: a second partial refund tops up to the new target only', () => {
    // $30 already reversed (1800 of a 6000 transfer); cumulative refunded is now $50 → target 3000.
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 1800, totalRefundedCents: 5000, grossCents: 10000 }),
    ).toBe(1200);
  });

  it('is idempotent: replaying the same cumulative refund reverses nothing more', () => {
    // Target for $50 cumulative = 3000; already 3000 reversed → 0.
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 3000, totalRefundedCents: 5000, grossCents: 10000 }),
    ).toBe(0);
  });

  it('caps at the transfer amount and never returns a negative', () => {
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 6000, totalRefundedCents: 10000, grossCents: 10000 }),
    ).toBe(0);
    // amount_reversed already exceeds the new target (defensive) → clamp to 0, not negative.
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 5000, totalRefundedCents: 4000, grossCents: 10000 }),
    ).toBe(0);
  });

  it('returns 0 for a zero/invalid gross or a zero transfer', () => {
    expect(
      proportionalReversalCents({ transferAmount: 6000, transferAmountReversed: 0, totalRefundedCents: 1000, grossCents: 0 }),
    ).toBe(0);
    expect(
      proportionalReversalCents({ transferAmount: 0, transferAmountReversed: 0, totalRefundedCents: 1000, grossCents: 10000 }),
    ).toBe(0);
  });
});
