// Task 12, step 2: the stale-tab 402 net inside billing-api.ts's shared
// `call` helper, exercised through extendTrial (the simplest call() caller,
// POST with no response payload the test needs to shape). Two properties
// matter: a billing_frozen 402 must hand off to the wall and never resolve
// into a caller's catch/toast, and anything else (a different error code, a
// different status) must still behave exactly as before, so a mutation that
// widens the check cannot silently swallow real errors.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/clientAccessToken', () => ({ getAccessToken: vi.fn() }));
vi.mock('@/lib/billing/frozenResponse', () => ({
  isBillingFrozenResponse: vi.fn(
    (status: number, body: unknown) =>
      status === 402 && !!body && typeof body === 'object' && (body as { error?: unknown }).error === 'billing_frozen',
  ),
  handleBillingFrozenResponse: vi.fn(),
}));

import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { handleBillingFrozenResponse } from '@/lib/billing/frozenResponse';
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

  it('on a billing_frozen 402, hands off to the wall and never resolves (no toast-able error)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(402, { error: 'billing_frozen', state: 'trial_expired' }));
    const p = extendTrial('org_1');
    const settled = await settledSoon(p);
    expect(handleBillingFrozenResponse).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
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
