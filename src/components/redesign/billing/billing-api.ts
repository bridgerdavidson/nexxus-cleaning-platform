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
import { handleBillingFrozenResponse, isBillingFrozenResponse } from '@/lib/billing/frozenResponse';

export interface PlanSelectionBody {
  tier: PlanTier;
  period: BillingPeriod;
  seat_count: number;
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
  // to toast. The promise below deliberately never settles: the wall is
  // about to replace whatever screen called this, so there is no state left
  // to resolve into, and no catch block gets a chance to surface a toast.
  if (isBillingFrozenResponse(res.status, json)) {
    handleBillingFrozenResponse();
    return new Promise<T>(() => {});
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
