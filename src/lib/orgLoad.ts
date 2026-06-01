// Pure classification logic for the org-context load in AuthContext.
//
// Background: a blank-but-logged-in dashboard is caused by `currentOrganizationId`
// getting stuck at null, which disables every org-scoped query (see useOrgQuery).
// The org load can transiently return an error OR zero rows when it races an
// in-flight Supabase token rotation (RLS evaluates auth.uid() as null → 0 rows,
// or the gateway returns 401/PGRST301). Those are NOT a real "no membership"
// signal, so they must be retried — and a transient failure must never wipe an
// org id we already loaded. This module isolates that decision so it's unit-testable
// without React/Supabase.

export type OrgStatus = 'idle' | 'loading' | 'loaded' | 'no-org' | 'error';

export type OrgLoadOutcome = 'rows' | 'empty' | 'error';

/** Classify a single organization_members query result. */
export function classifyOrgLoadResult(res: {
  error: unknown;
  data: unknown[] | null | undefined;
}): OrgLoadOutcome {
  if (res.error) return 'error';
  if (!res.data || res.data.length === 0) return 'empty';
  return 'rows';
}

/**
 * Both `error` and `empty` are treated as retryable: a member who momentarily
 * gets 0 rows (RLS with a null uid during token rotation) should be retried with
 * a fresh token before we ever conclude they have no organization.
 */
export function isRetryableOutcome(outcome: OrgLoadOutcome): boolean {
  return outcome === 'error' || outcome === 'empty';
}

/**
 * Decide the terminal org state after all attempts are exhausted.
 *
 * Invariant: if we already had a working org id loaded, a transient reload
 * failure (whether it surfaced as an error or as an empty result) must NOT wipe
 * the dashboard — keep the existing org and stay 'loaded'. Only a first-ever load
 * that never produced rows is allowed to resolve to 'no-org' (clear) or 'error'.
 */
export function resolveTerminalOrgState(
  lastOutcome: 'empty' | 'error',
  hadOrg: boolean,
): { status: OrgStatus; clearOrg: boolean } {
  if (hadOrg) {
    return { status: 'loaded', clearOrg: false };
  }
  if (lastOutcome === 'empty') {
    return { status: 'no-org', clearOrg: true };
  }
  return { status: 'error', clearOrg: false };
}
