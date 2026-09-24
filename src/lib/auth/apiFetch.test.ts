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
import { apiFetch } from './apiFetch';

const token = vi.mocked(getAccessToken);
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** True only if the promise settled (resolved or rejected) before a flushed tick. */
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

  // Task 12, step 2: the stale-tab 402 net, shared by every caller of
  // apiFetch (services-api.ts, bookings-api.ts, properties-api.ts,
  // checklists-api.ts). Hands off to the wall instead of resolving into a
  // result a caller would toast verbatim as "billing_frozen".
  it('on a billing_frozen 402, hands off to the wall and never resolves', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(
      jsonResponse(402, { error: 'billing_frozen', state: 'trial_expired', can_extend_trial: false }),
    );
    const p = apiFetch('/api/services', { method: 'POST', body: {} });
    const settled = await settledSoon(p);
    expect(handleBillingFrozenResponse).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
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
