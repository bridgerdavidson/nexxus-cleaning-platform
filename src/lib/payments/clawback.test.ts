import { describe, it, expect } from 'vitest';
import { proportionalReversalCents, invariantReversalPlan } from './clawback';

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

// T1-12a: reversal targets from the split invariant. Settlement splits transfers from
// `captured − processingFee − refundedAtSettlement`, so proportional-to-gross over-claws any leg
// split net of an earlier refund. The plan reverses each leg down to its share of the base the
// FULL cumulative refund implies — the same formula T1-13 locked for late-settled held slices,
// so refund-then-settle and settle-then-refund converge on identical end states.
describe('invariantReversalPlan', () => {
  const leg = (id: string, amount: number, amountReversed = 0) => ({ id, amount, amountReversed });

  it('matches the proportional math for a fee-less gross split (no behavior change)', () => {
    // $100 job split from gross (no prior refund): cleaner 6000, tenant 4000. Refund 40%.
    const plan = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 4000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 0,
      cleanerTransfer: leg('tr_c', 6000),
      tenantTransfers: [leg('tr_t', 4000)],
    });
    expect(plan.get('tr_c')).toBe(2400);
    expect(plan.get('tr_t')).toBe(1600);
  });

  it('REGRESSION (the T1-12a over-claw): transfers split net of a prior refund top up only the delta', () => {
    // $100 job, $40 refunded BEFORE settlement → transfers split from $60: cleaner 3600, tenant
    // 2400. A second $30 refund (cumulative $70) → target base $30: cleaner 1800, tenant 1200.
    const plan = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 7000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 0,
      cleanerTransfer: leg('tr_c', 3600),
      tenantTransfers: [leg('tr_t', 2400)],
    });
    // Proportional-to-gross would have demanded 3600*0.7=2520 / 2400*0.7=1680 — an over-claw of
    // 720+480 cents on money settlement already withheld.
    expect(plan.get('tr_c')).toBe(1800);
    expect(plan.get('tr_t')).toBe(1200);
  });

  it('is order-independent with the T1-13 late-settlement policy (fees + passthrough on)', () => {
    // $123.89 charge (=$120 base + $3.89 passthrough), 1% fee, 60% cleaner.
    // Split from the full base 12000: cleaner 7200, fee 120, tenant 4680. Refund $60.
    const plan = invariantReversalPlan({
      capturedCents: 12389,
      processingFeeCents: 389,
      totalRefundedCents: 6000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 100,
      cleanerTransfer: leg('tr_c', 7200),
      tenantTransfers: [leg('tr_t', 4680)],
    });
    // Target base 6000: cleaner 3600, fee 60, tenant 2340 — exactly what a post-refund
    // settlement (T1-13) would have paid each leg.
    expect(plan.get('tr_c')).toBe(7200 - 3600);
    expect(plan.get('tr_t')).toBe(4680 - 2340);
  });

  it('a full refund reverses everything', () => {
    const plan = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 10000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 100,
      cleanerTransfer: leg('tr_c', 6000),
      tenantTransfers: [leg('tr_t', 3900)],
    });
    expect(plan.get('tr_c')).toBe(6000);
    expect(plan.get('tr_t')).toBe(3900);
  });

  it('is cumulative and replay-idempotent', () => {
    const first = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 7000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 0,
      cleanerTransfer: leg('tr_c', 3600),
      tenantTransfers: [leg('tr_t', 2400)],
    });
    // Replay with amount_reversed reflecting the first pass: nothing more to reverse.
    const replay = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 7000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 0,
      cleanerTransfer: leg('tr_c', 3600, first.get('tr_c')!),
      tenantTransfers: [leg('tr_t', 2400, first.get('tr_t')!)],
    });
    expect(replay.get('tr_c')).toBe(0);
    expect(replay.get('tr_t')).toBe(0);
  });

  it('handles a HELD cleaner slice (no cleaner transfer): the tenant reverses only its own share', () => {
    // Slice carved+held, only the tenant leg transferred (from base 6000 after a $40 pre-settle
    // refund): tenant 2400. Cumulative refund $70 → target base 3000 → tenant target 1200.
    const plan = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 7000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 0,
      cleanerTransfer: null,
      tenantTransfers: [leg('tr_t', 2400)],
    });
    expect(plan.get('tr_t')).toBe(1200);
  });

  it('allocates across multiple tenant legs deterministically (sorted by id)', () => {
    const plan = invariantReversalPlan({
      capturedCents: 10000,
      processingFeeCents: 0,
      totalRefundedCents: 5000,
      payoutPercentSnapshot: 60,
      platformFeeBpsSnapshot: 0,
      cleanerTransfer: leg('tr_c', 6000),
      tenantTransfers: [leg('tr_b', 1000), leg('tr_a', 3000)],
    });
    // Tenant total 4000, target net 2000 → reverse 2000, filling tr_a (sorted first) then tr_b.
    expect(plan.get('tr_a')).toBe(2000);
    expect(plan.get('tr_b')).toBe(0);
    expect(plan.get('tr_c')).toBe(3000);
  });
});
