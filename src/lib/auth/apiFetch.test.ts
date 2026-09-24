import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/clientAccessToken', () => ({ getAccessToken: vi.fn() }));
// BILLING_FROZEN_MESSAGE is imported from the REAL module below rather than
// stubbed here, so this suite pins the sentence a caller actually toasts.
vi.mock('@/lib/billing/frozenResponse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/frozenResponse')>()),
  handleBillingFrozenResponse: vi.fn(),
}));

import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { BILLING_FROZEN_MESSAGE, handleBillingFrozenResponse } from '@/lib/billing/frozenResponse';
import { apiFetch } from './apiFetch';

const token = vi.mocked(getAccessToken);
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * True only if the promise settled (resolved or rejected) before a flushed tick.
 *
 * A promise that never settles is invisible to an ordinary `await`: the test
 * would hang until the runner's timeout and report a timeout rather than the
 * defect. Racing it against a flushed macrotask turns "never settles" into a
 * plain boolean this suite can assert on directly.
 */
async function settledSoon(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((r) => setTimeout(r, 0));
  return settled;
}

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    token.mockReset();
    vi.mocked(handleBillingFrozenResponse).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Task 12, step 2: the stale-tab 402 net, shared by every owner/admin/manager
  // caller of apiFetch (services-api.ts, bookings-api.ts, checklists-api.ts).
  // Task 13: properties-api.ts's createPropertyApi (a homeowner "add a home"
  // call) moved OFF apiFetch because this net opens the owner-only paywall,
  // which must never reach a homeowner; see bookingUnavailable.ts.
  //
  // ⚠ THE MUTATION THIS PAIR EXISTS TO CATCH: restoring the original
  // `return new Promise(() => {})` here. paywallGate hides the wall for anyone
  // who is not the owner, so a hanging promise leaves an admin or a manager
  // with a dialog that never closes, a Save spinner that never stops, and no
  // message at all. The first assertion is the one that matters, and it is
  // written as a race rather than an `await` precisely because a hanging
  // promise cannot be observed any other way.
  it('on a billing_frozen 402, SETTLES rather than hanging a non-owner caller forever', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(
      jsonResponse(402, { error: 'billing_frozen', state: 'trial_expired', can_extend_trial: false }),
    );
    const p = apiFetch('/api/services', { method: 'POST', body: {} });
    expect(await settledSoon(p)).toBe(true);
    expect(handleBillingFrozenResponse).toHaveBeenCalledTimes(1);
  });

  it('on a billing_frozen 402, resolves a friendly failure that never leaks the machine string', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(
      jsonResponse(402, { error: 'billing_frozen', state: 'trial_expired', can_extend_trial: false }),
    );
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({ success: false, error: BILLING_FROZEN_MESSAGE, status: 402 });
    // Every caller toasts `res.error` verbatim, so the 402's own error code and
    // the billing state that rode along with it must not appear in it.
    expect(res.success === false && res.error).not.toContain('billing_frozen');
    expect(res.success === false && res.error).not.toContain('trial_expired');
    // Copy rule: no em dash in any user-facing string.
    expect(BILLING_FROZEN_MESSAGE).not.toContain('—');
  });

  // Mutation target: widening the check to every 402, or every non-2xx,
  // instead of guard.ts's exact billing_frozen shape. A seat-cap 409 (a real
  // 4xx this codebase already special-cases elsewhere) and a 402 with an
  // unrelated error code must both resolve normally and never touch the wall.
  it('a 402 with a different error code resolves normally, untouched by the wall', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(402, { error: 'some_other_reason' }));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({ success: false, error: 'some_other_reason', status: 402 });
    expect(handleBillingFrozenResponse).not.toHaveBeenCalled();
  });

  it('a 409 seat-cap response resolves normally, untouched by the wall', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'seat_cap_reached' }));
    const res = await apiFetch('/api/admin/send-invite', { method: 'POST', body: {} });
    expect(res).toEqual({ success: false, error: 'seat_cap_reached', status: 409 });
    expect(handleBillingFrozenResponse).not.toHaveBeenCalled();
  });

  it('returns a 401 result without calling fetch when there is no session', async () => {
    token.mockResolvedValue(null);
    const res = await apiFetch('/api/services', { method: 'POST', body: { a: 1 } });
    expect(res).toEqual({
      success: false,
      error: 'You are signed out. Please sign in again.',
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bearer token and JSON body and returns data on success', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(201, { success: true, data: { id: 'svc_1' } }));
    const res = await apiFetch<{ id: string }>('/api/services', { method: 'POST', body: { name: 'x' } });
    expect(res).toEqual({ success: true, data: { id: 'svc_1' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_123' },
      body: JSON.stringify({ name: 'x' }),
    });
  });

  it('omits the body for a DELETE with no body', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
    const res = await apiFetch<void>('/api/services/abc', { method: 'DELETE' });
    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: undefined });
  });

  it('surfaces the route error and status on a non-2xx response', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Requires the Manage services permission' }));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({
      success: false,
      error: 'Requires the Manage services permission',
      status: 403,
    });
  });

  it('treats a 200 without success:true as a failure with a generic message', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({
      success: false,
      error: 'Something went wrong. Please try again.',
      status: 200,
    });
  });

  it('returns a network error result when fetch throws', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({
      success: false,
      error: 'Network error. Check your connection and try again.',
      status: 0,
    });
  });

  it('returns a 401 result without calling fetch when getAccessToken throws', async () => {
    token.mockRejectedValue(new Error('AbortError: navigator.locks request aborted'));
    const res = await apiFetch('/api/services', { method: 'POST', body: { a: 1 } });
    expect(res).toEqual({
      success: false,
      error: 'You are signed out. Please sign in again.',
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
