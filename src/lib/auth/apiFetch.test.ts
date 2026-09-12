import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/clientAccessToken', () => ({ getAccessToken: vi.fn() }));

import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { apiFetch } from './apiFetch';

const token = vi.mocked(getAccessToken);
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    token.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
