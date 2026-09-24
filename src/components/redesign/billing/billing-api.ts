// Client fetch helpers for the billing UI. Nothing above this module talks to
// `fetch` directly; every billing surface reads and writes through these
// functions (and, for reads, through the useBilling hook that wraps
// fetchBillingState).
//
// Response shapes are imported from the route files, never retyped by hand,
// so a payload change is a compile error here instead of a silent drift.

import { getAccessToken } from '@/lib/auth/clientAccessToken';
import type { BillingPeriod, PlanTier } from '@/lib/billing/plans';
import type { BillingStatePayload } from '@/app/api/billing/state/route';
import type { PlanPreviewPayload } from '@/app/api/billing/plan/preview/route';
import {
  BILLING_FROZEN_MESSAGE,
  handleBillingFrozenResponse,
  isBillingFrozenResponse,
} from '@/lib/billing/frozenResponse';

export interface PlanSelectionBody {
  tier: PlanTier;
  period: BillingPeriod;
  seat_count: number;
  /**
   * The instant the quote on screen was priced at, echoed back from the
   * preview so POST /api/billing/plan prorates at the SAME second rather than
   * its own (Stripe's prorations guide asks for this; without it the quoted
   * number and the charged number drift apart).
   *
   * Optional and IGNORED by the preview route, which prices at now by
   * definition. The apply route drops it when it is stale, so a forgotten or
   * missing value only costs the precision, never the change.
   */
  proration_date?: number | null;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; data?: T };
  // Task 12, step 2: the stale-tab 402 net. A tab open across the trial
  // boundary submits a write here (e.g. changePlan / extendTrial racing a
  // freeze) and the server refuses. Land on the wall instead of throwing an
  // Error whose message is the literal string "billing_frozen" for a caller
  // to toast.
  //
  // This used to `return new Promise(() => {})`, on the reasoning that the
  // wall was about to replace whatever called this. That held only for an
  // OWNER (paywallGate hides the wall for everyone else), which is the exact
  // shape src/lib/auth/apiFetch.ts's own fix already documents: an admin or
  // manager caller got no wall, no message, and a promise that never settled,
  // so a `finally { setBusy(false) }` never ran and a dialog stayed open over
  // a spinner that spun forever. Every caller of `call` already has a
  // try/catch (PlanPicker.handleSubmit, SeatCapDialog.handleConfirm,
  // BillingBanners/BillingPaywall's handleExtend), so throwing settles
  // safely in both directions: the non-owner's existing catch shows a
  // friendly failure, and the owner gets the same settled rejection under a
  // wall that covers the screen anyway.
  if (isBillingFrozenResponse(res.status, json)) {
    handleBillingFrozenResponse();
    throw new Error(BILLING_FROZEN_MESSAGE);
  }
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
  return json.data as T;
}

export function fetchBillingState(orgId: string): Promise<BillingStatePayload> {
  return call<BillingStatePayload>(
    `/api/billing/state?organization_id=${encodeURIComponent(orgId)}`,
    { method: 'GET' },
  );
}

export function previewPlan(orgId: string, sel: PlanSelectionBody): Promise<PlanPreviewPayload> {
  return call<PlanPreviewPayload>('/api/billing/plan/preview', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, ...sel }),
  });
}

/** Applies a change on a live subscription, or returns a checkout_url when there is none. */
export function changePlan(orgId: string, sel: PlanSelectionBody): Promise<{ checkout_url?: string }> {
  return call<{ checkout_url?: string }>('/api/billing/plan', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, ...sel }),
  });
}

/** First purchase. Always returns a hosted Stripe Checkout URL (ruling R10). */
export function startCheckout(orgId: string, sel: PlanSelectionBody): Promise<{ checkout_url: string }> {
  return call<{ checkout_url: string }>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, ...sel }),
  });
}

/**
 * Stripe Customer Portal. NOTE the shape, verified against
 * src/app/api/stripe/billing/portal-link/route.ts: the route is a GET, takes
 * return_url as a query param, and returns `{ success, url }` with NO `data`
 * envelope, unlike every other billing route. Do not route it through `call`,
 * which would return undefined.
 */
export async function getPortalUrl(orgId: string, returnUrl: string): Promise<string> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ organization_id: orgId, return_url: returnUrl });
  const res = await fetch(`/api/stripe/billing/portal-link?${qs}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!res.ok || !json.url) throw new Error(json.error || 'Could not open the billing portal.');
  return json.url;
}

export async function extendTrial(orgId: string): Promise<void> {
  await call<unknown>('/api/billing/trial/extend', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId }),
  });
}
