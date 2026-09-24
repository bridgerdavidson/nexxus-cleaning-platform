// The client-side twin of guard.ts's 402 (src/lib/billing/guard.ts). Every
// write route wrapped in assertOrgWritable / requireOrgAuth's
// requireWritable answers a frozen organization with exactly this body. This
// is the ONE place that recognises it and reacts, so billing-api.ts's `call`,
// apiFetch.ts, and the invite flow (seatMessagingModel.classifyInviteResult)
// all agree. A mutation dropping the reaction from any one call site is then
// caught by a single direct unit test here instead of three indirect ones.
//
// Task 12 brief, "the thing that will silently defeat this entire task":
// opening the wall alone is not enough. In the stale-tab case the cached
// billing state still says "trialing", and paywallGate (paywallModel.ts:100)
// hides the wall unless access.frozen is true. Invalidating keys.billing.all
// is what lets the very next render see the true state.

import { getQueryClient } from '@/lib/queryClient';
import { keys } from '@/lib/queryKeys';
import { openPaywall } from '@/components/redesign/billing/usePaywall';

export interface BillingFrozenBody {
  error: 'billing_frozen';
  state?: string;
  trial_ends_at?: string | null;
  can_extend_trial?: boolean;
}

/**
 * True only for guard.ts's exact shape (status 402, `error: 'billing_frozen'`).
 * Any other status, or a 402 with a different error code (e.g. a future,
 * unrelated 402), falls through untouched so it still surfaces as a normal
 * error.
 */
export function isBillingFrozenResponse(status: number, body: unknown): body is BillingFrozenBody {
  return (
    status === 402 &&
    !!body &&
    typeof body === 'object' &&
    (body as { error?: unknown }).error === 'billing_frozen'
  );
}

/**
 * The stale-tab safety net (task 12): a tab left open across the trial
 * boundary submits a write and the server 402s. Invalidate BEFORE opening,
 * so the wall's gate (which reads access.frozen off this same cached query
 * via useBilling()) has a fresh refetch in flight rather than racing the
 * stale "trialing" snapshot that let the click through in the first place.
 */
export function handleBillingFrozenResponse(): void {
  getQueryClient().invalidateQueries({ queryKey: keys.billing.all });
  openPaywall();
}
