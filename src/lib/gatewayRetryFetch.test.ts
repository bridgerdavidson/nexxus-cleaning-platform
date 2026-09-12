import { describe, expect, it, vi } from 'vitest';
import { withGatewayRetry } from './gatewayRetryFetch';

const URL_ = 'https://example.supabase.co/rest/v1/webhook_events?select=id';

function res(status: number): Response {
  return new Response(status === 200 ? '[]' : 'upstream timeout', { status });
}

function setup(responses: Array<Response | Error>) {
  const queue = [...responses];
  const base = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => {});
  const onRetry = vi.fn();
  const fetchWithRetry = withGatewayRetry(base as unknown as typeof fetch, { sleep, onRetry });
  return { base, sleep, onRetry, fetchWithRetry };
}

describe('withGatewayRetry', () => {
  it('retries a GET once after a 504 and returns the retry result', async () => {
    const { base, sleep, onRetry, fetchWithRetry } = setup([res(504), res(200)]);
    const out = await fetchWithRetry(URL_, { method: 'GET' });
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/rest/v1/webhook_events', attempt: 1, reason: '504' }),
    );
  });

  it('treats a request with no method as a GET', async () => {
    const { base, fetchWithRetry } = setup([res(502), res(200)]);
    const out = await fetchWithRetry(URL_);
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('retries 503 and HEAD requests', async () => {
    const { base, fetchWithRetry } = setup([res(503), res(200)]);
    const out = await fetchWithRetry(URL_, { method: 'HEAD' });
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('returns the last gateway error response once retries are exhausted', async () => {
    const { base, fetchWithRetry } = setup([res(504), res(504)]);
    const out = await fetchWithRetry(URL_, { method: 'GET' });
    expect(out.status).toBe(504);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('honors a larger retry budget', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(res(504))
      .mockResolvedValueOnce(res(504))
      .mockResolvedValueOnce(res(200));
    const fetchWithRetry = withGatewayRetry(base as unknown as typeof fetch, {
      retries: 2,
      sleep: async () => {},
    });
    const out = await fetchWithRetry(URL_);
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('never retries a %s, even on a 504', async (method) => {
    const { base, sleep, fetchWithRetry } = setup([res(504)]);
    const out = await fetchWithRetry(URL_, { method, body: '{}' });
    expect(out.status).toBe(504);
    expect(base).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reads the method from a Request object', async () => {
    const { base, fetchWithRetry } = setup([res(504)]);
    const out = await fetchWithRetry(new Request(URL_, { method: 'POST', body: '{}' }));
    expect(out.status).toBe(504);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-gateway errors like 500 or 404', async () => {
    const { base, fetchWithRetry } = setup([res(500)]);
    const out = await fetchWithRetry(URL_);
    expect(out.status).toBe(500);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('does not wait or retry on success', async () => {
    const { base, sleep, fetchWithRetry } = setup([res(200)]);
    await fetchWithRetry(URL_);
    expect(base).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a GET after a network error', async () => {
    const { base, onRetry, fetchWithRetry } = setup([new TypeError('fetch failed'), res(200)]);
    const out = await fetchWithRetry(URL_);
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ reason: 'fetch failed' }));
  });

  it('rethrows a network error on a write without retrying', async () => {
    const { base, fetchWithRetry } = setup([new TypeError('fetch failed')]);
    await expect(fetchWithRetry(URL_, { method: 'POST', body: '{}' })).rejects.toThrow('fetch failed');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last network error once retries are exhausted', async () => {
    const { base, fetchWithRetry } = setup([new TypeError('fetch failed'), new TypeError('socket hang up')]);
    await expect(fetchWithRetry(URL_)).rejects.toThrow('socket hang up');
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('never retries an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const { base, fetchWithRetry } = setup([abortError]);
    await expect(fetchWithRetry(URL_, { signal: controller.signal })).rejects.toThrow('aborted');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('releases the discarded response body before retrying', async () => {
    const first = res(504);
    const cancel = vi.spyOn(first.body!, 'cancel');
    const { fetchWithRetry } = setup([first, res(200)]);
    await fetchWithRetry(URL_);
    expect(cancel).toHaveBeenCalled();
  });
});
