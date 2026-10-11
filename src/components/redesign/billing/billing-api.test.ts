// Task 12, step 2 (and I6's fix pass): the stale-tab 402 net inside
// billing-api.ts's shared `call` helper, exercised through extendTrial (the
// simplest call() caller, POST with no response payload the test needs to
// shape). Three properties matter: a billing_frozen 402 must hand off to the
// wall and SETTLE (reject) rather than hang a caller's catch/toast forever;
// the rejection must carry the friendly BILLING_FROZEN_MESSAGE, never the
// machine string; and anything else (a different error code, a different
// status) must still behave exactly as before, so a mutation that widens the
// check cannot silently swallow real errors.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/clientAccessToken', () => ({ getAccessToken: vi.fn() }));
// BILLING_FROZEN_MESSAGE is imported from the REAL module below (as
// apiFetch.test.ts does) so this suite pins the sentence a caller actually
// catches, rather than a value this file invents.
vi.mock('@/lib/billing/frozenResponse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/frozenResponse')>()),
  handleBillingFrozenResponse: vi.fn(),
}));

import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { BILLING_FROZEN_MESSAGE, handleBillingFrozenResponse } from '@/lib/billing/frozenResponse';
import { extendTrial } from './billing-api';

const token = vi.mocked(getAccessToken);
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Races the promise against a flushed microtask/macrotask queue: true only
 *  if it settled (resolved or rejected) before the timer fired. */
async function settledSoon(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((r) => setTimeout(r, 0));
  return settled;
}

describe('billing-api call() 402 handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    token.mockReset().mockResolvedValue('tok_123');
    vi.mocked(handleBillingFrozenResponse).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ⚠ THE MUTATION THIS PAIR EXISTS TO CATCH: restoring the original
  // `return new Promise(() => {})`. Every caller of `call` (PlanPicker's
  // handleSubmit, SeatCapDialog's handleConfirm, the extend handlers in
  // BillingBanners/BillingPaywall) already has a try/catch; a promise that
  // never settles leaves that catch unreachable and any `finally { setBusy /
  // setSubmitting(false) }` never runs. Written as a race (settledSoon)
  // rather than a plain await, because a hanging promise is otherwise
  // invisible to an assertion until the runner times out.
  it('on a billing_frozen 402, hands off to the wall and SETTLES (rejects) rather than hanging', async () => {
    fetchMock.mockResolvedValue(jsonResponse(402, { error: 'billing_frozen', state: 'trial_expired' }));
    const p = extendTrial('org_1');
    expect(await settledSoon(p)).toBe(true);
    expect(handleBillingFrozenResponse).toHaveBeenCalledTimes(1);
  });

  it('on a billing_frozen 402, rejects with the friendly message, never the machine string', async () => {
    fetchMock.mockResolvedValue(jsonResponse(402, { error: 'billing_frozen', state: 'trial_expired' }));
    let err: unknown;
    try {
      await extendTrial('org_1');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(BILLING_FROZEN_MESSAGE);
    // Every caller's catch block would otherwise render this verbatim.
    expect((err as Error).message).not.toContain('billing_frozen');
    expect(BILLING_FROZEN_MESSAGE).not.toContain('—');
  });

  // Mutation target: the 402 branch swallowing every error, or every 402,
  // rather than only guard.ts's exact billing_frozen shape.
  it('a 402 with a different error code still throws normally, and never touches the wall', async () => {
    fetchMock.mockResolvedValue(jsonResponse(402, { error: 'some_other_reason' }));
    await expect(extendTrial('org_1')).rejects.toThrow('some_other_reason');
    expect(handleBillingFrozenResponse).not.toHaveBeenCalled();
  });

  it('a plain 500 still throws normally, and never touches the wall', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'Internal error' }));
    await expect(extendTrial('org_1')).rejects.toThrow('Internal error');
    expect(handleBillingFrozenResponse).not.toHaveBeenCalled();
  });

  it('a 2xx response resolves normally, untouched by the frozen check', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: null }));
    await expect(extendTrial('org_1')).resolves.toBeUndefined();
    expect(handleBillingFrozenResponse).not.toHaveBeenCalled();
  });
});
