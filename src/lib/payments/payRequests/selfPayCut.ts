import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCleanerShareCents } from '@/lib/payments/payMode';

/**
 * Resolves the cleaner's self-pay cut for any pay mode, shared by the two
 * self-pay charge paths and settleSelfPay so the three can never disagree.
 *
 * Self-pay + request mode defers the CHARGE itself (spec §6): the org's charge
 * amount IS derived from the cleaner's cut, so nothing can be charged until
 * the pay request approves. Callers bail with a non-stamping
 * 'pay_request_pending' precondition (authorization_status stays NULL, same
 * class as tenant_not_ready) so the reconcile sweep re-collects automatically
 * once the thread approves.
 *
 * The approval price cap (approved <= job price) is enforced by the thread
 * routes; the resolver still caps at the gross defensively.
 */

export interface SelfPayCleanerFields {
  payout_model: string | null;
  payout_percent: number | string;
  flat_rate_cents?: number | null;
}

export type SelfPayCutResult =
  | {
      ok: true;
      cutCents: number;
      basis: 'percent' | 'flat' | 'request' | 'none';
      payRequestId: string | null;
      /** The percent used, for payout_percent_snapshot; 0 for cents bases. */
      payoutPercent: number;
    }
  | { ok: false; code: 'pay_request_pending'; threadStatus: string };

export async function resolveSelfPayCutCents(
  supabase: SupabaseClient,
  args: { appointmentId: string; cleaner: SelfPayCleanerFields; jobGrossCents: number },
): Promise<SelfPayCutResult> {
  const model = args.cleaner.payout_model ?? 'percentage';

  let approvedRequestCents: number | null = null;
  let payRequestId: string | null = null;
  if (model === 'request') {
    const { data: prRow } = await supabase
      .from('pay_requests')
      .select('id, status, approved_amount_cents')
      .eq('appointment_id', args.appointmentId)
      .maybeSingle();
    const pr = prRow as { id: string; status: string; approved_amount_cents: number | null } | null;
    if (!pr || pr.status !== 'approved') {
      return { ok: false, code: 'pay_request_pending', threadStatus: pr?.status ?? 'missing' };
    }
    approvedRequestCents = pr.approved_amount_cents;
    payRequestId = pr.id;
  }

  const share = resolveCleanerShareCents({
    payoutModel: model,
    payoutPercent: args.cleaner.payout_percent,
    flatRateCents: args.cleaner.flat_rate_cents ?? null,
    approvedRequestCents,
    grossCents: args.jobGrossCents,
  });

  return {
    ok: true,
    cutCents: share.cents,
    basis: share.basis,
    payRequestId,
    payoutPercent: share.basis === 'percent' ? Number(args.cleaner.payout_percent) : 0,
  };
}
