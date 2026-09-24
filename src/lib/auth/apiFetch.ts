import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { handleBillingFrozenResponse, isBillingFrozenResponse } from '@/lib/billing/frozenResponse';

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };

export interface ApiFetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

/**
 * Client -> API route call with the Supabase access token attached.
 *
 * Never throws. A missing session, a network failure, a non-2xx status, and a
 * response that is not `{ success: true }` all come back as `{ success: false }`
 * with the route's `error` message when there is one, so hook functions can
 * return the same `{ success, error }` shape the pages already handle.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit): Promise<ApiResult<T>> {
  let token: string | null;
  try {
    token = await getAccessToken();
  } catch {
    return { success: false, error: 'You are signed out. Please sign in again.', status: 401 };
  }
  if (!token) {
    return { success: false, error: 'You are signed out. Please sign in again.', status: 401 };
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.', status: 0 };
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null;

  // Task 12, step 2: the stale-tab 402 net. A write route guarded by
  // assertOrgWritable (src/lib/billing/guard.ts) refuses because the org
  // froze after this tab last checked. Hand off to the paywall instead of
  // resolving into `{ success: false, error: 'billing_frozen' }`, which every
  // caller in this codebase toasts verbatim. The returned promise never
  // settles: the wall is about to replace whatever called this, so there is
  // no caller left to hand a result to.
  if (isBillingFrozenResponse(res.status, json)) {
    handleBillingFrozenResponse();
    return new Promise<ApiResult<T>>(() => {});
  }

  if (!res.ok || !json || json.success !== true) {
    return {
      success: false,
      error: json?.error || 'Something went wrong. Please try again.',
      status: res.status,
    };
  }
  return { success: true, data: json.data as T };
}
