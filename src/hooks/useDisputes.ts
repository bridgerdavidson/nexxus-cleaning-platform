'use client';

/**
 * Org-scoped read of the `disputes` ledger (written by the charge.dispute.* webhooks).
 *
 * Until this hook, disputes were recorded + bell-notified but nothing rendered them: a disputed
 * charge still read "Paid" in the Finance table (audit M7). RLS limits reads to org
 * owner/admin/manager, so the anon client query is safe to make from any dashboard.
 */
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { keys } from '../lib/queryKeys';
import { supabase } from '../lib/supabase';

export interface Dispute {
  id: string;
  payment_id: string | null;
  stripe_dispute_id: string;
  /** Disputed amount in CENTS (mirrors Stripe). */
  amount: number;
  status: string;
  reason: string | null;
  evidence_due_by: string | null;
  created_at: string;
}

/** Stripe dispute statuses that still need attention (not terminally closed). */
const OPEN_STATUSES = new Set([
  'needs_response',
  'warning_needs_response',
  'under_review',
  'warning_under_review',
]);

export function isDisputeOpen(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

export interface UseDisputesResult {
  disputes: Dispute[];
  /** payment_id -> its OPEN dispute, for the "Disputed" badge override on the payment row. */
  openByPaymentId: Record<string, Dispute>;
  loading: boolean;
}

export function useDisputes(): UseDisputesResult {
  const { currentOrganizationId } = useAuth();

  const query = useOrgQuery({
    queryKey: keys.disputes.byOrg(currentOrganizationId ?? ''),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('disputes')
        .select('id, payment_id, stripe_dispute_id, amount, status, reason, evidence_due_by, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Dispute[];
    },
  });

  const disputes = query.data ?? [];
  const openByPaymentId: Record<string, Dispute> = {};
  for (const d of disputes) {
    if (d.payment_id && isDisputeOpen(d.status) && !openByPaymentId[d.payment_id]) {
      openByPaymentId[d.payment_id] = d;
    }
  }

  return { disputes, openByPaymentId, loading: query.isLoading };
}
