/**
 * Settle a captured homeowner charge across the tenant and (Scenario 1) the cleaner.
 *
 * In the separate-charges-and-transfers model the captured funds sit on the PLATFORM balance, so
 * settlement MUST move them out: the platform transfers the tenant remainder to the tenant
 * account and the cleaner's percentage to the cleaner account, keeping the platform fee. Both are
 * platform→connected transfers tagged with the job's transfer_group; connected→connected transfers
 * are forbidden by Stripe (the bug this replaces).
 *
 * The split is computed on the AMOUNT ACTUALLY CAPTURED (so partial captures and cancellation
 * fees are handled correctly), per decision #11 floored so the parts never exceed it. A cancelled
 * appointment never pays the cleaner — its captured fee goes entirely to the tenant.
 *
 * Idempotent (idempotency keys on both transfers) and best-effort: a failed tenant transfer
 * records a ledger event and bails (the cleaner isn't paid before the tenant is made whole); a
 * failed cleaner transfer records a `failed` payout row for the retry job. Never throws into the
 * webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { transferGroupFor, createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';
import { chargeAmountRefundedCents } from './refundGuards';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

export async function settleCleanerPayout(
  supabase: SupabaseClient,
  appointmentId: string,
  /** The PLATFORM charge id (PaymentIntent.latest_charge) to source the transfers from. */
  platformChargeId: string | null,
  /** Amount actually captured, in cents (PaymentIntent.amount_received). Falls back to the
   *  recorded payment / appointment price when omitted (e.g. the reconcile retry path). */
  capturedCents?: number,
): Promise<SettleResult> {
  const { data: apptRow } = await supabase
    .from('appointments')
    .select('cleaner_id, organization_id, total_price, status')
    .eq('id', appointmentId)
    .maybeSingle();
  const appt = apptRow as
    | { cleaner_id: string | null; organization_id: string; total_price: number | string; status: string }
    | null;
  if (!appt) return { settled: false, reason: 'no_appointment' };

  // The tenant MUST be a ready connected account: the funds are on the platform and have to be
  // transferred out, or no one gets paid.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('stripe_connect_account_id, platform_fee_bps')
    .eq('id', appt.organization_id)
    .maybeSingle();
  const org = orgRow as { stripe_connect_account_id: string | null; platform_fee_bps: number } | null;
  if (!org?.stripe_connect_account_id) return { settled: false, reason: 'tenant_not_ready' };

  // The revenue payment row drives the captured-amount fallback AND tells us whether the tenant
  // leg already ran (transfer_amount recorded). On a retry `platformChargeId` is null, so
  // re-attempting the tenant transfer under the same `tenant-payout-${id}` idempotency key with
  // different params would be rejected by Stripe and bail before the cleaner leg — so the failed
  // cleaner payout could never self-heal. Skip the tenant leg once it's already recorded.
  const { data: payRow } = await supabase
    .from('payments')
    .select('amount, transfer_amount, processing_fee_cents, status, stripe_payment_intent_id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const paymentRow = payRow as
    | { status: string | null; stripe_payment_intent_id: string | null }
    | null;
  const tenantAlreadyTransferred =
    (payRow as { transfer_amount: number | null } | null)?.transfer_amount != null;

  // Amount actually captured (handles partial capture + cancellation fees). Includes any
  // processing fee the payer funded on top of the service price.
  let capturedTotalCents = capturedCents ?? 0;
  if (!capturedTotalCents) {
    const amt = (payRow as { amount: number | string } | null)?.amount;
    capturedTotalCents = amt != null ? Math.round(Number(amt) * 100) : Math.round(Number(appt.total_price) * 100);
  }
  if (capturedTotalCents <= 0) return { settled: false, reason: 'nothing_captured' };

  // Money that already went BACK to the payer must never be split out (audit H2). A refund can
  // land before settlement (out-of-band Dashboard refund, or charge.refunded delivered ahead of
  // payment_intent.succeeded); the transfer-reversal path no-ops then because there are no
  // transfers yet, so settlement itself has to shrink to what's left. Stripe is the source of
  // truth; if it can't be read, the DB's terminal 'refunded' still blocks a known-refunded row.
  let refundedCents = await chargeAmountRefundedCents({
    platformChargeId,
    paymentIntentId: paymentRow?.stripe_payment_intent_id ?? null,
  });
  if (refundedCents == null) {
    // Stripe unreadable: assuming zero would overpay a carved slice that was PARTIALLY refunded (a
    // partial refund never sets payments.status='refunded'), a silent loss. Fall back to the local
    // refunds ledger (partial-aware), then the terminal 'refunded' status as a last resort.
    const { data: refundRows } = await supabase
      .from('refunds')
      .select('amount')
      .eq('appointment_id', appointmentId)
      .in('status', ['pending', 'succeeded']);
    const ledgerRefundedCents = (refundRows ?? []).reduce(
      (sum, r) => sum + Number((r as { amount: number }).amount),
      0,
    );
    refundedCents =
      ledgerRefundedCents > 0
        ? ledgerRefundedCents
        : paymentRow?.status === 'refunded'
          ? capturedTotalCents
          : 0;
  }
  if (refundedCents >= capturedTotalCents) {
    // Fully refunded before settlement: nothing to distribute. Retire any retryable payout row
    // so the failed-payout sweep stops re-selecting it.
    await supabase
      .from('payouts')
      .update({ status: 'reversed', reversed_at: new Date().toISOString() })
      .eq('appointment_id', appointmentId)
      .in('status', ['pending', 'failed']);
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'settlement_skipped_refunded',
      actor: 'webhook',
      amount: refundedCents,
      payload: { captured_cents: capturedTotalCents },
    });
    return { settled: false, reason: 'fully_refunded' };
  }

  // Distribute only the SERVICE PRICE (captured minus the passed-through fee) — the fee was
  // consumed by Stripe, so splitting on it would overdraw the platform balance. Legacy/no-
  // passthrough rows (null fee) distribute the full captured amount, unchanged. A PARTIAL
  // pre-settlement refund shrinks the base the same way: only un-refunded money is split.
  const processingFeeCents = Number(
    (payRow as { processing_fee_cents: number | null } | null)?.processing_fee_cents ?? 0,
  );
  const splitBaseCents = Math.max(0, capturedTotalCents - processingFeeCents - refundedCents);

  // Cleaner payability — never pay the cleaner for a cancelled job (the captured fee compensates
  // the tenant, not the cleaner).
  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
  };
  let cleaner: CleanerRow | null = null;
  if (appt.cleaner_id && appt.status !== 'cancelled') {
    const { data: cleanerRow } = await supabase
      .from('cleaner_profiles')
      .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
      .eq('id', appt.cleaner_id)
      .maybeSingle();
    cleaner = cleanerRow as CleanerRow | null;
  }
  // A cleaner whose payout share we must CARVE OUT, even if they can't be paid yet: assigned,
  // not hourly-external, positive %. We split on their real % so the tenant gets only their TRUE
  // remainder; then either pay the cleaner now (onboarded) or HOLD their slice for a later retry.
  // This replaces the old behavior where an un-onboarded cleaner's share silently folded into the
  // tenant payout (payoutPercent forced to 0).
  const cleanerHasShare =
    !!cleaner &&
    cleaner.payout_model !== 'hourly_external' &&
    Number(cleaner.payout_percent) > 0;
  // Connect-readiness of the cleaner's account, independent of their CURRENT share: a slice that
  // was already carved out must be paid once they finish onboarding even if their percent was
  // later edited (including down to 0) — the money was set aside at settlement time.
  const cleanerAccountReady =
    !!cleaner && !!cleaner.stripe_connect_account_id && cleaner.stripe_connect_onboarding_complete;
  const payoutPercent = cleanerHasShare ? Number(cleaner!.payout_percent) : 0;

  const { cleanerCents, tenantRemainderCents } = computePaymentSplit({
    grossCents: splitBaseCents,
    payoutPercent,
    platformFeeBps: org.platform_fee_bps ?? 0,
  });

  const transferGroup = transferGroupFor(appointmentId);

  // 1) Tenant remainder → tenant connected account. This MUST happen or the tenant never gets
  //    paid (funds are stranded on the platform); on failure, record + bail before paying the cleaner.
  if (tenantRemainderCents > 0 && !tenantAlreadyTransferred) {
    try {
      await createPlatformTransfer({
        destinationAccountId: org.stripe_connect_account_id,
        amountCents: tenantRemainderCents,
        sourceTransactionId: platformChargeId,
        transferGroup,
        idempotencyKey: `tenant-payout-${appointmentId}`,
        appointmentId,
      });
      await supabase
        .from('payments')
        .update({
          transfer_amount: tenantRemainderCents,
          transfer_destination_account_id: org.stripe_connect_account_id,
        })
        .eq('appointment_id', appointmentId)
        .eq('payment_type', 'revenue');
    } catch (err) {
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'tenant_transfer_failed',
        newStatus: 'failed',
        actor: 'webhook',
        amount: tenantRemainderCents,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
      return { settled: false, reason: 'tenant_transfer_failed' };
    }
  }

  // 2) Cleaner percentage → cleaner connected account (Scenario 1). Soft-fail → 'failed' payout
  //    row for the retry sweep; not-yet-onboarded → 'pending' (held) for the retry sweep.
  //
  // On a RETRY, an existing payout row carries the slice CARVED OUT at first settlement (its
  // `amount` + `payout_percent_snapshot`). The tenant was already paid the complementary remainder
  // against that original percent, so we MUST pay the cleaner that snapshot, never a fresh recompute:
  // if the cleaner's payout_percent was edited while they were still onboarding, recomputing would
  // over/underpay the cleaner and strand funds (conservation breaks).
  const { data: priorPayoutRow } = await supabase
    .from('payouts')
    .select('id, amount, payout_percent_snapshot, status, stripe_transfer_id')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  const priorPayout = priorPayoutRow as
    | {
        id: string;
        amount: number | string;
        payout_percent_snapshot: number | string | null;
        status: string;
        stripe_transfer_id: string | null;
      }
    | null;

  // Terminal payout states end the cleaner leg here. 'paid'/'bank_paid' = settled (re-running the
  // transfer with a recomputed amount would collide with the spent idempotency key and falsely
  // fail the row); 'reversed' = clawed back, never re-paid.
  if (priorPayout && ['paid', 'bank_paid', 'reversed'].includes(priorPayout.status)) {
    return { settled: true, reason: 'cleaner_already_settled' };
  }

  // A retryable row that ALREADY carries a transfer id means the money moved but the row was
  // never marked paid: a crash between transfer and update, a payout.failed revert, or a legacy
  // transfer under the old `payout-{id}` idempotency key (audit H4). Re-transferring under the
  // current `cleaner-payout-{id}` key would double-pay the cleaner — repair the row instead.
  if (
    priorPayout &&
    priorPayout.stripe_transfer_id &&
    (priorPayout.status === 'pending' || priorPayout.status === 'failed')
  ) {
    await supabase
      .from('payouts')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', priorPayout.id);
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_payout_repaired',
      prevStatus: priorPayout.status,
      newStatus: 'paid',
      actor: 'webhook',
      amount: Math.round(Number(priorPayout.amount) * 100),
      payload: { transfer_id: priorPayout.stripe_transfer_id, source: 'settle-repair' },
    });
    return { settled: true, reason: 'payout_repaired' };
  }

  // A carved slice we still owe the cleaner: held ('pending') or a failed transfer. 'paid'/'reversed'
  // are terminal and must never be re-paid.
  const hasCarvedSlice =
    !!priorPayout &&
    (priorPayout.status === 'pending' || priorPayout.status === 'failed') &&
    priorPayout.amount != null;

  // Percent snapshot to settle: the carved slice's LOCKED percent on a retry (so a mid-onboarding
  // percent edit can't break conservation vs the tenant's already-paid remainder), else the current
  // share on first settlement.
  const cleanerSettlePercent =
    hasCarvedSlice && priorPayout!.payout_percent_snapshot != null
      ? Number(priorPayout!.payout_percent_snapshot)
      : payoutPercent;

  // Amount to settle. First settlement pays the freshly computed split. A retry of a carved slice
  // pays the SNAPSHOT amount — EXCEPT a refund that landed AFTER the carve, which shrank the split
  // base (splitBaseCents already nets the live refunded total). The cleaner must then be paid their
  // snapshot-percent share of the CURRENT base, never the pre-refund snapshot: paying the snapshot
  // hands the cleaner money the homeowner got back, a silent platform loss (audit T1-13). Capped by
  // the snapshot so a later percent edit can never push it ABOVE what was carved.
  const carvedSnapshotCents = priorPayout ? Math.round(Number(priorPayout.amount) * 100) : 0;
  const refundAdjustedCarvedCents = hasCarvedSlice
    ? computePaymentSplit({
        grossCents: splitBaseCents,
        payoutPercent: cleanerSettlePercent,
        platformFeeBps: org.platform_fee_bps ?? 0,
      }).cleanerCents
    : 0;
  const cleanerSettleCents = hasCarvedSlice
    ? Math.min(carvedSnapshotCents, refundAdjustedCarvedCents)
    : cleanerCents;

  // A refund since the carve fully absorbed the held slice (nothing left to pay). Retire the row so
  // the failed-payout sweep stops re-selecting it, and leave a forensic marker.
  if (hasCarvedSlice && cleanerSettleCents <= 0) {
    await supabase
      .from('payouts')
      .update({ status: 'reversed', reversed_at: new Date().toISOString() })
      .eq('id', priorPayout!.id);
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_slice_refund_absorbed',
      prevStatus: priorPayout!.status,
      newStatus: 'reversed',
      actor: 'webhook',
      amount: carvedSnapshotCents,
      payload: { split_base_cents: splitBaseCents, refunded_cents: refundedCents },
    });
    return { settled: true, reason: 'cleaner_slice_refund_absorbed' };
  }

  const shouldSettleCleaner = (cleanerHasShare || hasCarvedSlice) && cleanerSettleCents > 0;

  if (shouldSettleCleaner) {
    const payoutBase = {
      organization_id: appt.organization_id,
      cleaner_id: appt.cleaner_id,
      appointment_id: appointmentId,
      amount: cleanerSettleCents / 100,
      payout_percent_snapshot: cleanerSettlePercent,
    };

    const upsertPayout = async (fields: Record<string, unknown>) => {
      if (priorPayout) {
        await supabase.from('payouts').update(fields).eq('id', priorPayout.id);
      } else {
        const { error: insertError } = await supabase.from('payouts').insert(fields);
        if (insertError && insertError.code === '23505') {
          // A concurrent settlement inserted the row first (unique index, migration 088); its
          // writer owns the state, and the transfer idempotency key already collapsed the money
          // side, so losing this race is benign.
          console.log('payout insert lost a benign race for appointment', appointmentId);
        }
      }
    };

    // Cleaner isn't Connect-ready yet: HOLD their slice on the platform (the tenant already got
    // only their remainder, so the money stays put) as a 'pending' payout. The reconcile retry
    // settles it once the cleaner finishes onboarding (account.updated flips onboarding_complete).
    if (!cleanerAccountReady) {
      await upsertPayout({ ...payoutBase, status: 'pending' });
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'cleaner_payout_held',
        newStatus: 'pending',
        actor: 'webhook',
        amount: cleanerSettleCents,
        payload: { reason: 'cleaner_not_onboarded' },
      });
      return { settled: true, reason: 'cleaner_slice_held' };
    }

    // A prior attempt can create the cleaner transfer at Stripe but LOSE the response (a network
    // timeout after the request landed): the catch below then writes a 'failed'/'pending' row with a
    // NULL transfer_id, which the H4 repair above (transfer_id required) doesn't cover. Re-issuing
    // under the constant `cleaner-payout-${id}` key with a DIFFERENT amount — which a post-carve
    // refund now produces (T1-13) — would 400 on the spent key and loop forever, or double-pay after
    // Stripe's ~24h key window. On a retry, adopt any cleaner transfer already in the group instead of
    // issuing a new one; a post-carve refund already reversed it proportionally, so it carries the
    // correct net amount. (First settlement has no priorPayout, so the extra list is skipped there.)
    if (priorPayout) {
      let existingCleanerTransfer:
        | Awaited<ReturnType<typeof listTransfersByGroup>>[number]
        | null = null;
      try {
        const groupTransfers = await listTransfersByGroup(transferGroup);
        existingCleanerTransfer =
          groupTransfers.find((t) => {
            const dest = typeof t.destination === 'string' ? t.destination : t.destination?.id ?? null;
            return dest === cleaner!.stripe_connect_account_id;
          }) ?? null;
      } catch {
        // Stripe unreadable — fall through; the constant key still protects a same-amount retry.
      }
      if (existingCleanerTransfer) {
        await upsertPayout({
          ...payoutBase,
          amount: existingCleanerTransfer.amount / 100,
          status: 'paid',
          stripe_transfer_id: existingCleanerTransfer.id,
          paid_at: new Date().toISOString(),
        });
        await recordPaymentEvent(supabase, {
          appointmentId,
          organizationId: appt.organization_id,
          eventType: 'cleaner_payout_repaired',
          prevStatus: priorPayout.status,
          newStatus: 'paid',
          actor: 'webhook',
          amount: existingCleanerTransfer.amount,
          payload: { transfer_id: existingCleanerTransfer.id, source: 'settle-adopt-existing' },
        });
        return { settled: true, reason: 'payout_adopted_existing' };
      }
    }

    let transfer;
    try {
      transfer = await createPlatformTransfer({
        destinationAccountId: cleaner!.stripe_connect_account_id!,
        amountCents: cleanerSettleCents,
        sourceTransactionId: platformChargeId,
        transferGroup,
        idempotencyKey: `cleaner-payout-${appointmentId}`,
        appointmentId,
      });
    } catch (err) {
      await upsertPayout({ ...payoutBase, status: 'failed' });
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'cleaner_transfer_failed',
        newStatus: 'failed',
        actor: 'webhook',
        amount: cleanerSettleCents,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
      return { settled: false, reason: 'cleaner_transfer_failed' };
    }

    await upsertPayout({
      ...payoutBase,
      status: 'paid',
      stripe_transfer_id: transfer.id,
      paid_at: new Date().toISOString(),
    });
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_paid',
      newStatus: 'paid',
      actor: 'webhook',
      amount: cleanerSettleCents,
      payload: { transfer_id: transfer.id },
    });
  }

  return { settled: true };
}
