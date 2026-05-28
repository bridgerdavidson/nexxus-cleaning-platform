/**
 * Atomic Stripe Connect account-slot claim helpers.
 *
 * Race-safe wrappers around the migration-072 RPCs:
 *   • claim_org_connect_slot     / claim_cleaner_connect_slot
 *   • commit_org_connect_slot    / commit_cleaner_connect_slot
 *   • release_org_connect_slot   / release_cleaner_connect_slot
 *
 * Lifecycle inside the /start route:
 *   const { accountId, claimed, pendingToken } = await claimConnectAccountSlot(...)
 *   if (accountId && isStripeAccountId(accountId)) → reuse
 *   else if (claimed) → call stripe.accounts.create, then commitConnectAccountSlot
 *   else if (isPendingToken(accountId)) → another request holds the slot; poll briefly
 *
 * On Stripe error after claiming: releaseConnectAccountSlot restores the column
 * to NULL so the user can retry.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConnectSlotSubject =
  | { kind: 'org'; id: string }
  | { kind: 'cleaner'; id: string };

export interface ClaimResult {
  /** Existing acct_*, a pending:<uuid> placeholder, or null on first-ever claim path. */
  accountId: string | null;
  /** True iff this caller is the one that just placed the placeholder. */
  claimed: boolean;
  /** The placeholder we hold (only set when claimed === true). */
  pendingToken: string | null;
}

export function isPendingToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('pending:');
}

export function isStripeAccountId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('acct_');
}

function rpcNames(subject: ConnectSlotSubject) {
  if (subject.kind === 'org') {
    return {
      claim: 'claim_org_connect_slot' as const,
      commit: 'commit_org_connect_slot' as const,
      release: 'release_org_connect_slot' as const,
      idKey: 'p_org_id' as const,
    };
  }
  return {
    claim: 'claim_cleaner_connect_slot' as const,
    commit: 'commit_cleaner_connect_slot' as const,
    release: 'release_cleaner_connect_slot' as const,
    idKey: 'p_cleaner_id' as const,
  };
}

export async function claimConnectAccountSlot(
  supabase: SupabaseClient,
  subject: ConnectSlotSubject,
): Promise<ClaimResult> {
  const { claim, idKey } = rpcNames(subject);
  const { data, error } = await supabase.rpc(claim, { [idKey]: subject.id });
  if (error) {
    throw new Error(`claim_connect_account_slot (${subject.kind}) failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new Error(`claim_connect_account_slot (${subject.kind}) returned no row`);
  }
  const accountId = (row as { account_id: string | null }).account_id ?? null;
  const claimed = !!(row as { claimed: boolean }).claimed;
  return {
    accountId,
    claimed,
    pendingToken: claimed && isPendingToken(accountId) ? accountId : null,
  };
}

export async function commitConnectAccountSlot(
  supabase: SupabaseClient,
  subject: ConnectSlotSubject,
  pendingToken: string,
  realAccountId: string,
): Promise<boolean> {
  const { commit, idKey } = rpcNames(subject);
  const { data, error } = await supabase.rpc(commit, {
    [idKey]: subject.id,
    p_pending_token: pendingToken,
    p_real_account_id: realAccountId,
  });
  if (error) {
    throw new Error(`commit_connect_account_slot (${subject.kind}) failed: ${error.message}`);
  }
  return !!data;
}

export async function releaseConnectAccountSlot(
  supabase: SupabaseClient,
  subject: ConnectSlotSubject,
  pendingToken: string,
): Promise<boolean> {
  const { release, idKey } = rpcNames(subject);
  const { data, error } = await supabase.rpc(release, {
    [idKey]: subject.id,
    p_pending_token: pendingToken,
  });
  if (error) {
    throw new Error(`release_connect_account_slot (${subject.kind}) failed: ${error.message}`);
  }
  return !!data;
}
