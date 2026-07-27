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
import { transferIdempotencyKey, isIdempotencyConflictInFlight } from '@/lib/stripe/idempotencyKeys';
import { retrievePaymentIntent } from '@/lib/stripe/reconcile';
import { recordPaymentEvent } from './events';
import { chargeAmountRefundedCents } from './refundGuards';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

type GroupTransfer = Awaited<ReturnType<typeof listTransfersByGroup>>[number];

// Local (not in stripe/transfers.ts) so integration tests that mock that module wholesale keep
// the real field extraction — mocked shapes hiding real API fields is a repeat bug class here.
function transferDestinationId(t: GroupTransfer): string | null {
  return typeof t.destination === 'string' ? t.destination : t.destination?.id ?? null;
}

function transferSourceChargeId(t: GroupTransfer): string | null {
  const src = (t as { source_transaction?: string | { id?: string } | null }).source_transaction;
  if (!src) return null;
  return typeof src === 'string' ? src : src.id ?? null;
}

export async function settleCleanerPayout(
  supabase: SupabaseClient,
  appointmentId: string,
  /** The PLATFORM charge id (PaymentIntent.latest_charge) to source the transfers from. */
  platformChargeId: string | null,
  /** Amount actually captured, in cents (PaymentIntent.amount_received). Falls back to the
   *  recorded payment / appointment price when omitted (e.g. the reconcile retry path). */
  capturedCents?: number,
  /** The PaymentIntent being settled (webhook path only). Settlement reads processing_fee_cents from
   *  the revenue row that carries THIS PI; when the row isn't that one yet (webhook raced the charge
   *  route's write, or the single row still holds a prior attempt's PI/fee) the split would use the
   *  wrong fee, so settlement defers. Omitted on the reconcile/retry path (capturedCents is null there
   *  and the selected row is already authoritative). */
  paymentIntentId?: string | null,
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
  const { data: payRow, error: payRowError } = await supabase
    .from('payments')
    .select(
      'amount, transfer_amount, processing_fee_cents, status, stripe_payment_intent_id, tenant_transfer_attempt',
    )
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // A select ERROR is not "no row": proceeding on null would erase transfer_amount,
  // processing_fee_cents and the captured-amount source and let settlement move WRONG money (the
  // migration-lag window, where tenant_transfer_attempt doesn't exist yet and every select 42703s,
  // is the concrete case — same class as the T1-10 F3 guard). Fail closed; the webhook redelivery
  // and the 15-min sweep retry after the schema/transient error heals.
  if (payRowError) {
    console.error(
      'settleCleanerPayout: payments select failed, bailing fail-closed',
      appointmentId,
      payRowError.code,
      payRowError.message,
    );
    return { settled: false, reason: 'payment_row_unreadable' };
  }
  const paymentRow = payRow as
    | { status: string | null; stripe_payment_intent_id: string | null }
    | null;
  const tenantAlreadyTransferred =
    (payRow as { transfer_amount: number | null } | null)?.transfer_amount != null;
  // T1-11: idempotency-key rotation counter for the tenant leg. 0 = the historical unsuffixed
  // key; bumped only in the create-failure catch below so the next retry escapes Stripe's ~24h
  // cached-failure replay on the spent key.
  const tenantAttempt = Number(
    (payRow as { tenant_transfer_attempt?: number | null } | null)?.tenant_transfer_attempt ?? 0,
  );

  // T1-4: the webhook (capturedCents != null, = amount_received) can process
  // payment_intent.succeeded BEFORE the charge route commits the revenue payments row — the only
  // carrier of processing_fee_cents. Splitting then reads the fee as 0 (or a stale prior-attempt
  // fee, since the single revenue row is updated IN PLACE) and transfers the full grossed-up amount,
  // over-paying tenant + cleaner by the fee and overdrawing the platform (a re-creation of the prod
  // negative-balance incident), under now-burned idempotency keys. So on the webhook path, settle
  // ONLY once the revenue row carrying THIS PaymentIntent is committed: a missing row, or a newest
  // row still holding a prior attempt's PI (null or different), means the authoritative fee isn't
  // written yet. Defer; finishCharge rewrites the row to this PI + fee moments later and
  // settleUnsettledCaptures re-settles with the correct fee. The reconcile/retry callers pass
  // capturedCents=null (guard skipped) and select the already-authoritative paid row, so they are
  // untouched. The marker is a silent forensic event (deliberately NOT in ALERTABLE_PAYMENT_EVENTS):
  // the deferral self-heals within one sweep.
  if (capturedCents != null) {
    const rowPi = (payRow as { stripe_payment_intent_id?: string | null } | null)?.stripe_payment_intent_id ?? null;
    const rowIsAuthoritative = paymentIntentId ? rowPi === paymentIntentId : !!payRow;
    if (!rowIsAuthoritative) {
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'settlement_deferred_no_row',
        actor: 'webhook',
        amount: capturedCents,
        payload: {
          reason: payRow ? 'revenue_row_stale_pi' : 'revenue_row_not_yet_written',
          firing_payment_intent: paymentIntentId ?? null,
        },
      });
      return { settled: false, reason: 'payment_row_missing' };
    }
  }

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
    // A bumped attempt means a prior create FAILED and the key was rotated (T1-11). A rotated key
    // no longer collides with a transfer whose create actually landed but whose response was lost
    // (or that 400'd on a same-key params mismatch when the null-charge retry path re-used the
    // spent key), so before any ROTATED create, adopt an existing tenant transfer from the group
    // instead of issuing a second one. The scan is the ONLY double-pay guard at attempt>0, so
    // every failure mode inside it fails CLOSED (bail, no bump, next sweep retries) — never
    // through to an unguarded create.
    let adoptedTenantTransfer: GroupTransfer | null = null;
    if (tenantAttempt > 0) {
      // Scope adoption to THIS charge: every charge on an appointment shares one transfer_group
      // (a cancellation fee + a later completion charge, audit T1-12), so a destination-only
      // match could adopt a sibling charge's tenant transfer and silently strand the real
      // remainder. Resolve the settling charge when the caller didn't pass it (retry paths).
      let settlingChargeId = platformChargeId;
      if (!settlingChargeId && paymentRow?.stripe_payment_intent_id) {
        try {
          const pi = await retrievePaymentIntent(paymentRow.stripe_payment_intent_id);
          const latest = pi.latest_charge;
          settlingChargeId = typeof latest === 'string' ? latest : latest?.id ?? null;
        } catch {
          console.error(
            'settleCleanerPayout: cannot resolve settling charge for a rotated tenant retry, bailing fail-closed',
            appointmentId,
          );
          return { settled: false, reason: 'tenant_adopt_scan_unavailable' };
        }
      }
      let groupTransfers: GroupTransfer[];
      try {
        groupTransfers = await listTransfersByGroup(transferGroup);
      } catch {
        console.error(
          'settleCleanerPayout: transfer_group scan failed before a rotated tenant create, bailing fail-closed',
          appointmentId,
        );
        return { settled: false, reason: 'tenant_adopt_scan_unavailable' };
      }
      const tenantCandidates = groupTransfers.filter(
        (t) => transferDestinationId(t) === org.stripe_connect_account_id,
      );
      // Adopt our own leg: source-matched to the settling charge, or a legacy/retry-created
      // transfer with no source whose amount matches the remainder we'd create now.
      adoptedTenantTransfer =
        tenantCandidates.find((t) => {
          const src = transferSourceChargeId(t);
          return src ? src === settlingChargeId : t.amount === tenantRemainderCents;
        }) ?? null;
      // A null-source candidate with a DIFFERENT amount can still be OUR stray (the remainder is
      // recomputed each attempt, so a refund landing between attempts shifts it) — creating
      // alongside it risks paying the tenant twice. Sourced candidates from a different charge
      // are a sibling leg (fee vs completion) and safe to leave alone.
      if (
        !adoptedTenantTransfer &&
        tenantCandidates.some((t) => transferSourceChargeId(t) == null)
      ) {
        console.error(
          'settleCleanerPayout: unattributable tenant transfer in group, refusing rotated create',
          appointmentId,
        );
        return { settled: false, reason: 'tenant_adopt_ambiguous' };
      }
    }
    if (adoptedTenantTransfer) {
      // Record what the tenant actually NETTED: reversals never shrink Transfer.amount, they
      // accumulate in amount_reversed (a refund can partially reverse the stray before adoption).
      const adoptedNetCents = Math.max(
        0,
        adoptedTenantTransfer.amount - (adoptedTenantTransfer.amount_reversed ?? 0),
      );
      await supabase
        .from('payments')
        .update({
          transfer_amount: adoptedNetCents,
          transfer_destination_account_id: org.stripe_connect_account_id,
        })
        .eq('appointment_id', appointmentId)
        .eq('payment_type', 'revenue');
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'tenant_transfer_repaired',
        actor: 'webhook',
        amount: adoptedNetCents,
        payload: { transfer_id: adoptedTenantTransfer.id, source: 'settle-adopt-existing' },
      });
    } else {
      try {
        await createPlatformTransfer({
          destinationAccountId: org.stripe_connect_account_id,
          amountCents: tenantRemainderCents,
          sourceTransactionId: platformChargeId,
          transferGroup,
          idempotencyKey: transferIdempotencyKey(`tenant-payout-${appointmentId}`, tenantAttempt),
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
        // Rotate the key for the NEXT retry (T1-11): Stripe replays this failure under the spent
        // key for ~24h, which would otherwise lock out the admin Retry and the sweep until the key
        // ages out. Absolute set (not increment) so a concurrent double-catch can't skip a key.
        // EXCEPT a concurrent in-flight conflict: the winner's create is still running and will
        // become this key's cached result — rotating here would let an immediate retry race it
        // into a second transfer, so keep the key and let the next retry collide/replay safely.
        if (!isIdempotencyConflictInFlight(err)) {
          await supabase
            .from('payments')
            .update({ tenant_transfer_attempt: tenantAttempt + 1 })
            .eq('appointment_id', appointmentId)
            .eq('payment_type', 'revenue');
        }
        await recordPaymentEvent(supabase, {
          appointmentId,
          organizationId: appt.organization_id,
          eventType: 'tenant_transfer_failed',
          newStatus: 'failed',
          actor: 'webhook',
          amount: tenantRemainderCents,
          payload: {
            error: err instanceof Error ? err.message : String(err),
            attempt: tenantAttempt,
          },
        });
        return { settled: false, reason: 'tenant_transfer_failed' };
      }
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
  const { data: priorPayoutRow, error: priorPayoutError } = await supabase
    .from('payouts')
    .select('id, amount, payout_percent_snapshot, status, stripe_transfer_id, transfer_attempt')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  // Fail closed on a select error (see the payments select above): a null read here would erase
  // the paid/reversed terminal guards and the carved snapshot, re-paying or re-computing a slice.
  if (priorPayoutError) {
    console.error(
      'settleCleanerPayout: payouts select failed, bailing fail-closed',
      appointmentId,
      priorPayoutError.code,
      priorPayoutError.message,
    );
    return { settled: false, reason: 'payout_row_unreadable' };
  }
  const priorPayout = priorPayoutRow as
    | {
        id: string;
        amount: number | string;
        payout_percent_snapshot: number | string | null;
        status: string;
        stripe_transfer_id: string | null;
        transfer_attempt: number | null;
      }
    | null;
  // T1-11: idempotency-key rotation counter for the cleaner leg (see tenantAttempt above). First
  // settlement has no row, so it always uses the historical unsuffixed key.
  const cleanerAttempt = Number(priorPayout?.transfer_attempt ?? 0);

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
        const { error: updateError } = await supabase
          .from('payouts')
          .update(fields)
          .eq('id', priorPayout.id);
        if (updateError) {
          console.error('payout update failed for appointment', appointmentId, updateError.code, updateError.message);
        }
      } else {
        const { error: insertError } = await supabase.from('payouts').insert(fields);
        if (insertError && insertError.code === '23505') {
          // A concurrent settlement inserted the row first (unique index, migration 088); its
          // writer owns the state, and the transfer idempotency key already collapsed the money
          // side, so losing this race is benign.
          console.log('payout insert lost a benign race for appointment', appointmentId);
        } else if (insertError) {
          // Not the benign race: a silently dropped 'failed' row would hide the slice from every
          // sweep (no payout row + tenant transfer_amount already stamped = nothing re-selects it).
          console.error('payout insert failed for appointment', appointmentId, insertError.code, insertError.message);
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
    // Stripe's ~24h key window; and a ROTATED key (T1-11, the lost-response catch bumps
    // transfer_attempt) would not collide at all and double-pay immediately. On a retry, adopt any
    // cleaner transfer already in the group instead of issuing a new one; a post-carve refund
    // already reversed it proportionally, so it carries the correct net amount. (First settlement
    // has no priorPayout, so the extra list is skipped there — and its attempt is always 0.)
    if (priorPayout) {
      let groupTransfers: GroupTransfer[] | null = null;
      try {
        groupTransfers = await listTransfersByGroup(transferGroup);
      } catch {
        if (cleanerAttempt > 0) {
          // At attempt>0 this scan is the ONLY double-pay guard (the rotated key cannot collide
          // with a transfer that landed under a prior key): fail CLOSED, no bump, next sweep
          // retries once Stripe is readable again.
          console.error(
            'settleCleanerPayout: transfer_group scan failed before a rotated cleaner create, bailing fail-closed',
            appointmentId,
          );
          return { settled: false, reason: 'cleaner_adopt_scan_unavailable' };
        }
        // Attempt 0: the constant key still replays/collides — safe to fall through.
      }
      if (groupTransfers) {
        const existingCleanerTransfer =
          groupTransfers.find((t) => transferDestinationId(t) === cleaner!.stripe_connect_account_id) ??
          null;
        if (!existingCleanerTransfer && cleanerAttempt > 0) {
          // A transfer to an account that is neither the tenant nor the cleaner's CURRENT
          // account is likely our cleaner leg paid to a since-reset Connect account (the
          // platform reset route re-provisions stripe_connect_account_id): a rotated create
          // would pay the cut twice. Refuse; this needs a human (or the reset-route guard).
          const unknownDestination = groupTransfers.some((t) => {
            const dest = transferDestinationId(t);
            return dest !== org.stripe_connect_account_id && dest !== cleaner!.stripe_connect_account_id;
          });
          if (unknownDestination) {
            console.error(
              'settleCleanerPayout: transfer to an unrecognized account in group, refusing rotated cleaner create',
              appointmentId,
            );
            return { settled: false, reason: 'cleaner_adopt_ambiguous' };
          }
        }
        if (existingCleanerTransfer) {
          // Record what the cleaner actually NETTED: reversals never shrink Transfer.amount,
          // they accumulate in amount_reversed (a refund can partially reverse the stray while
          // its payout row still carried no transfer id).
          const adoptedNetCents = Math.max(
            0,
            existingCleanerTransfer.amount - (existingCleanerTransfer.amount_reversed ?? 0),
          );
          if (adoptedNetCents <= 0) {
            // Fully clawed back before adoption: the slice is gone, retire the row like a
            // refund-absorbed slice so the sweep stops re-selecting it.
            await upsertPayout({
              ...payoutBase,
              status: 'reversed',
              stripe_transfer_id: existingCleanerTransfer.id,
              reversed_at: new Date().toISOString(),
            });
            await recordPaymentEvent(supabase, {
              appointmentId,
              organizationId: appt.organization_id,
              eventType: 'cleaner_slice_refund_absorbed',
              prevStatus: priorPayout.status,
              newStatus: 'reversed',
              actor: 'webhook',
              amount: existingCleanerTransfer.amount,
              payload: { transfer_id: existingCleanerTransfer.id, source: 'settle-adopt-existing' },
            });
            return { settled: true, reason: 'payout_adopted_reversed' };
          }
          await upsertPayout({
            ...payoutBase,
            amount: adoptedNetCents / 100,
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
            amount: adoptedNetCents,
            payload: { transfer_id: existingCleanerTransfer.id, source: 'settle-adopt-existing' },
          });
          return { settled: true, reason: 'payout_adopted_existing' };
        }
      }
    }

    let transfer;
    try {
      transfer = await createPlatformTransfer({
        destinationAccountId: cleaner!.stripe_connect_account_id!,
        amountCents: cleanerSettleCents,
        sourceTransactionId: platformChargeId,
        transferGroup,
        idempotencyKey: transferIdempotencyKey(`cleaner-payout-${appointmentId}`, cleanerAttempt),
        appointmentId,
      });
    } catch (err) {
      // Rotate the key for the NEXT retry (T1-11); the adopt-existing scan above guards every
      // rotated create against a lost-response transfer that actually landed. EXCEPT a concurrent
      // in-flight conflict: the winner's create is still running and will become this key's
      // cached result — rotating would let an immediate retry race it into a second transfer.
      const nextAttempt = isIdempotencyConflictInFlight(err) ? cleanerAttempt : cleanerAttempt + 1;
      await upsertPayout({ ...payoutBase, status: 'failed', transfer_attempt: nextAttempt });
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'cleaner_transfer_failed',
        newStatus: 'failed',
        actor: 'webhook',
        amount: cleanerSettleCents,
        payload: {
          error: err instanceof Error ? err.message : String(err),
          attempt: cleanerAttempt,
        },
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
