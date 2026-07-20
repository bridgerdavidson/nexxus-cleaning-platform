import { afterEach, beforeAll, vi } from 'vitest';
import type Stripe from 'stripe';
import type { StripeFake } from '../helpers/stripe';

// Mock factory uses `globalThis.__stripeFake` for state to dodge the
// hoisting/temporal-dead-zone issue: `vi.mock` is statically lifted above
// every `import`, so it can't safely reference module-level `const`s.
// `globalThis` is reachable from a hoisted scope.
vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  const getState = (): StripeFake => {
    if (!(globalThis as { __stripeFake?: StripeFake }).__stripeFake) {
      (globalThis as { __stripeFake?: StripeFake }).__stripeFake = {
        transferCalls: [],
        paymentIntentCalls: [],
        reset() {
          const s = (globalThis as { __stripeFake: StripeFake }).__stripeFake;
          s.transferCalls.length = 0;
          s.paymentIntentCalls.length = 0;
        },
      };
    }
    return (globalThis as { __stripeFake: StripeFake }).__stripeFake;
  };
  return {
    ...actual,
    getStripe: () => {
      throw new Error('getStripe() called in a test. Mock @/lib/stripe exports instead.');
    },
    createConnectTransfer: vi.fn(
      async (amount: number, destination: string, source: string, appointmentId: string) => {
        const state = getState();
        const key = `payout-${appointmentId}`;
        const existing = state.transferCalls.find((c) => c.idempotencyKey === key);
        if (existing) {
          return {
            id: `tr_test_${existing.appointmentId}`,
            object: 'transfer',
            amount: Math.round(existing.amount * 100),
            destination: existing.destinationAccountId,
          } as unknown as Stripe.Transfer;
        }
        state.transferCalls.push({
          amount,
          destinationAccountId: destination,
          sourceChargeId: source,
          appointmentId,
          idempotencyKey: key,
        });
        return {
          id: `tr_test_${appointmentId}`,
          object: 'transfer',
          amount: Math.round(amount * 100),
          destination,
        } as unknown as Stripe.Transfer;
      },
    ),
    getDefaultPaymentMethod: vi.fn(async () => 'pm_test_default'),
    getPayoutTransferIds: vi.fn(async () => []),
  };
});

declare global {
  var __stripeFake: StripeFake | undefined;
}

beforeAll(() => {
  // Ensure state is initialized — the mock factory does it lazily, but in case
  // a test reads `globalThis.__stripeFake` before any mock call, initialize here.
  if (!globalThis.__stripeFake) {
    globalThis.__stripeFake = {
      transferCalls: [],
      paymentIntentCalls: [],
      reset() {
        this.transferCalls.length = 0;
        this.paymentIntentCalls.length = 0;
      },
    };
  }
});

afterEach(() => {
  globalThis.__stripeFake?.reset();
  vi.clearAllMocks();
});
