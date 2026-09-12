/**
 * A fetch wrapper that retries idempotent requests when the Supabase API gateway fails
 * transiently, for the server-side (service-role) Supabase clients.
 *
 * Why: in Sep 2026 Supabase moved the production project onto its v2 API gateway. On v2,
 * the first request after a few idle minutes can wait 1.5-6s for the gateway to reach
 * PostgREST, and past ~5s the gateway answers 504 Gateway Timeout. The very next request
 * in the same function returns in ~150ms. Every cron sweep (reconcile-payments, the
 * dead-letter webhook retry, auto-defer, the receipt-email drain) opens with a read, so
 * one cold 504 silently skipped a whole sweep until the next tick.
 *
 * Only GET and HEAD are retried. PostgREST inserts, updates, deletes, and RPCs are POST,
 * PATCH, and DELETE, and a 504 on those does not prove the write did not land, so retrying
 * them could apply a write twice. They pass straight through.
 */

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);

export interface GatewayRetryInfo {
  method: string;
  /** URL path only (no query string), safe to log. */
  path: string;
  /** 1-based number of the retry about to run. */
  attempt: number;
  /** The status code, or the network error message, that triggered the retry. */
  reason: string;
}

export interface GatewayRetryOptions {
  /** Extra attempts after the first. Default 1. */
  retries?: number;
  /** Pause before each retry, in ms. Default 250. */
  backoffMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry. Defaults to a console.warn line tagged [gateway-retry]. */
  onRetry?: (info: GatewayRetryInfo) => void;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : undefined) ?? 'GET';
  return method.toUpperCase();
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).pathname;
  } catch {
    return raw.split('?')[0];
  }
}

function isAbort(err: unknown, signal: AbortSignal | null | undefined): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === 'AbortError';
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultOnRetry = ({ method, path, attempt, reason }: GatewayRetryInfo) => {
  console.warn(`[gateway-retry] ${method} ${path} failed (${reason}), retry ${attempt}`);
};

export function withGatewayRetry(
  baseFetch: typeof fetch = (input, init) => globalThis.fetch(input, init),
  options: GatewayRetryOptions = {},
): typeof fetch {
  const { retries = 1, backoffMs = 250, sleep = defaultSleep, onRetry = defaultOnRetry } = options;

  return async (input, init) => {
    const method = requestMethod(input, init);
    if (!IDEMPOTENT_METHODS.has(method) || retries <= 0) {
      return baseFetch(input, init);
    }
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    for (let attempt = 0; ; attempt++) {
      const isLast = attempt >= retries;
      let reason: string;
      try {
        const response = await baseFetch(input, init);
        if (!RETRYABLE_STATUSES.has(response.status) || isLast) return response;
        reason = String(response.status);
        // Free the socket held by the discarded response before trying again.
        await response.body?.cancel().catch(() => {});
      } catch (err) {
        if (isLast || isAbort(err, signal)) throw err;
        reason = err instanceof Error ? err.message : String(err);
      }
      onRetry({ method, path: requestPath(input), attempt: attempt + 1, reason });
      await sleep(backoffMs);
    }
  };
}
