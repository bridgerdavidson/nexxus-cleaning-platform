import { getAccessToken } from '@/lib/auth/clientAccessToken';
import {
  BILLING_FROZEN_MESSAGE,
  handleBillingFrozenResponse,
  isBillingFrozenResponse,
} from '@/lib/billing/frozenResponse';

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
  // assertOrgWritable (src/lib/billing/guard.ts) refuses because the org is
  // frozen. Hand off to the paywall, then ALWAYS SETTLE.
  //
  // This used to return `new Promise(() => {})`, on the reasoning that the wall
  // was about to replace whatever called this. That holds only for an OWNER:
  // paywallGate (billing/paywallModel.ts) returns hidden when `!isOwner`, so an
  // admin or a manager got no wall, no message, and a promise that never
  // resolved. `finally { setBusy(false) }` never ran, so Edit service, Add
  // checklist and every checklist item mutation left a dialog open over a
  // spinner that turned forever, on the FIRST click, not only in a stale tab.
  //
  // Settling is safe in both directions. The non-owner gets the friendly
  // message their existing `toast.error(result.error)` already renders, on top
  // of the neutral explanation bar the invalidation above refreshes. The owner
  // gets the same settled result under a wall that covers the screen anyway.
  // Same shape as the homeowner fix (redesign/homeowner/bookingUnavailable.ts),
  // which settles with a typed error for exactly this reason.
  if (isBillingFrozenResponse(res.status, json)) {
    handleBillingFrozenResponse();
    return { success: false, error: BILLING_FROZEN_MESSAGE, status: res.status };
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
