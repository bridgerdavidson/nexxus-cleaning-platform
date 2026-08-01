/**
 * Charge orchestration for a COMPLETED appointment — the primary money-collection path under
 * charge-at-completion (a card/bank is SAVED at booking and charged HERE once the job is done),
 * and equally the "charge now" recovery entry once a failed charge gets a working card.
 *
 * Uses the auto-capture charge primitives (`createDestinationCharge` / `createSelfPayCharge`):
 *   - a `succeeded` PaymentIntent is a paid revenue row;
 *   - the cleaner/tenant split settles on `payment_intent.succeeded` (homeowner via
 *     `on_behalf_of` → settleCleanerPayout; self-pay via `metadata.self_pay` → settleSelfPay), with
 *     the reconciliation sweep as the backstop, so settlement is webhook-driven, not inline.
 *
 * A bank (us_bank_account) payment method falls through to the ACH charge-at-completion
 * orchestrations (which do an immediate debit that clears asynchronously). A saved card that was
 * detached/deleted between booking and completion is substituted with the customer's default card
 * (persisted + ledgered) rather than failing on a dead id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { createSelfPayCharge } from '@/lib/stripe/charges/chargeSelfPay';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { computeChargeBreakdown } from './processingFee';
import { computeSelfPayAmountsFromCents } from './selfPayMath';
import { resolveSelfPayCutCents } from './payRequests/selfPayCut';
import { isCleanerPayable } from './isCleanerPayable';
import { stripeFeePassthroughEnabled, stripeAchEnabled, stripeSelfPayEnabled } from '@/lib/stripe/flags';
import {
  getPaymentMethodType,
  listSavedCards,
  paymentMethodBelongsToCustomer,
} from '@/lib/stripe/customers/homeowner';
import { getDefaultPaymentMethod } from '@/lib/stripe';
import { chargeAchAppointment } from './chargeAchAppointment';
import { chargeSelfPayAchAppointment } from './chargeSelfPayAchAppointment';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { clearFailedForBank } from './clearFailedForBank';

export type ChargeNowCode =
  | 'charged'
  | 'processing'
  | 'requires_action'
  | 'declined'
  | 'no_card'
  | 'no_org_card'
  | 'no_org_bank'
  | 'tenant_not_ready'
  | 'cleaner_not_payable'
  | 'pay_request_pending'
  | 'not_chargeable'
  | 'charge_in_progress'
  | 'outcome_verification_pending'
  | 'failed'
  | 'error';

export interface ChargeNowOutcome {
  ok: boolean;
  code: ChargeNowCode;
  message?: string;
  paymentIntentId?: string;
  /**
   * True when the path that produced this outcome wrote a terminal authorization_status itself
   * (overwriting the 'charging' claim). The caller must then SKIP the claim release: once the row
   * leaves 'charging' it is re-claimable, and a late release UPDATE (guarded only by
   * .eq('authorization_status','charging')) would match a SUCCESSOR's live claim and could free an
   * in-flight charge's sentinel (double-charge risk, see the T1-7 review's HIGH finding).
   */
  stamped?: boolean;
}

/**
 * Pre-Stripe precondition outcomes: the charge bailed BEFORE any PaymentIntent was created and
 * WITHOUT bumping reauth_count (each of these returns ahead of nextReauthAttempt in both
 * chargeHomeownerNow and chargeSelfPayNow, and ahead of any charge in the ACH sub-paths, which never
 * bump reauth_count at all). Releasing the transient 'charging' claim to NULL for these would ERASE a
 * prior `failed` / `requires_action` recovery state, silently dropping the row out of operator triage
 * (authorization_status IN ('failed','requires_action')), the setup_intent.succeeded self-heal, and
 * back into the reconcile sweep the failed state was meant to exclude. So the claim releases to the
 * PRE-CLAIM status for these ONLY. Any other non-terminal exit (processing, a thrown exception) DID
 * create a PaymentIntent and/or bump reauth_count, so it releases to NULL: restoring priorStatus there
 * would double-charge (a `failed` row makes nextReauthAttempt bump reauth_count → fresh idempotency
 * key → second PaymentIntent).
 *
 * T1-7: the homeowner-card `no_card` bails additionally stamp authorization_status='failed'
 * themselves (recordNoCardBail) and return `stamped: true`, which routes them into the
 * terminalWritten branch so the finally SKIPS the release entirely. Skipping (rather than relying
 * on the `.eq('authorization_status','charging')` guard to no-op) is load-bearing: the stamp makes
 * the row instantly re-claimable, and a late release UPDATE could otherwise match a SUCCESSOR's
 * live 'charging' claim and free its in-flight sentinel. The other codes keep restore-to-prior.
 */
const PRECONDITION_CODES: ReadonlySet<ChargeNowCode> = new Set([
  'no_card',
  'no_org_card',
  'no_org_bank',
  'tenant_not_ready',
  'cleaner_not_payable',
  'pay_request_pending', // self-pay: the charge amount IS the approved request; waits like tenant_not_ready
  'not_chargeable',
]);

interface AppointmentRow {
  id: string;
  organization_id: string;
  homeowner_id: string | null;
  cleaner_id: string | null;
  total_price: number | string;
  status: string;
  authorization_status: string | null;
  is_self_pay: boolean;
  payment_method_id: string | null;
  reauth_count: number | null;
}

/**
 * Routes a completed appointment to the homeowner or self-pay charge-now path.
 *
 * `actorRole` is the caller's org role (owner/admin/manager/cleaner/homeowner). It is used only as a
 * defense-in-depth guard on the self-pay company-card path; the operator route passes staff roles,
 * and the R7 homeowner "Pay now" route passes `homeowner` (which self-pay refuses here as a second
 * layer behind that route's own self-pay block).
 */
export async function chargeCompletedAppointmentAuto(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
  actorRole?: string,
): Promise<ChargeNowOutcome> {
  const { data: apptData, error: apptErr } = await supabase
    .from('appointments')
    .select(
      'id, organization_id, homeowner_id, cleaner_id, total_price, status, authorization_status, is_self_pay, payment_method_id, reauth_count',
    )
    .eq('id', appointmentId)
    .maybeSingle();
  if (apptErr || !apptData) return { ok: false, code: 'error', message: 'Appointment not found' };
  const appt = apptData as AppointmentRow;

  // Charge-now is for a finished job. Upcoming jobs authorize a hold instead; cancelled jobs are
  // never charged.
  if (appt.status !== 'completed') {
    return { ok: false, code: 'not_chargeable', message: `Appointment is ${appt.status}, not completed` };
  }

  // Idempotency: a revenue row that is already paid or processing means the money is in flight (a
  // double-submit, a prior capture, or the webhook). Don't charge twice.
  const settled = await alreadySettled(supabase, appt.id);
  if (settled) return { ok: true, code: settled.code, message: 'Already charged', paymentIntentId: settled.paymentIntentId };

  // T1-16: a prior completion attempt whose OUTCOME IS UNKNOWN — the create threw with no
  // PaymentIntent attached (lost response after Stripe may have captured), recorded as a failed
  // PI-less revenue row — blocks fresh charges until the verifyUnknownChargeOutcomes sweep has
  // checked Stripe. A fresh attempt would mint a fresh idempotency key and could charge a SECOND
  // time on top of a capture we never saw. Two-step read so the migration-116 lag window blocks
  // only appointments actually in the suspicious shape, never all charges.
  const { data: unknownRows, error: unknownErr } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .eq('charge_kind', 'completion')
    .eq('payment_method', 'card')
    .eq('status', 'failed')
    .is('stripe_payment_intent_id', null)
    .limit(1);
  if (unknownErr) {
    // A double-charge guard fails CLOSED on an unreadable state.
    return {
      ok: false,
      code: 'outcome_verification_pending',
      message: 'Could not verify the previous charge attempt. Try again in a few minutes.',
    };
  }
  if (unknownRows && unknownRows.length > 0) {
    const unknownRowId = (unknownRows[0] as { id: string }).id;
    const { data: verifyRow, error: verifyErr } = await supabase
      .from('payments')
      .select('status, charge_outcome_verified_at')
      .eq('id', unknownRowId)
      .maybeSingle();
    const verify = verifyErr
      ? null
      : (verifyRow as { status: string; charge_outcome_verified_at: string | null } | null);
    // Status re-check closes the TOCTOU with a concurrent sweep repair: the verified stamp is
    // ALSO written when the sweep repairs the row to paid (a capture exists), and the claim RPC
    // can still succeed in the instant before the sweep's triage flip lands. A row that left
    // 'failed' between our two reads means the state just changed under us — bail, never charge.
    if (verify && verify.status !== 'failed') {
      return {
        ok: false,
        code: 'charge_in_progress',
        message: 'The payment state for this appointment just changed. Refresh and try again.',
      };
    }
    if (!verify?.charge_outcome_verified_at) {
      return {
        ok: false,
        code: 'outcome_verification_pending',
        message:
          'The previous charge attempt is being verified with Stripe. Try again in about 15 minutes.',
      };
    }
  }

  // Atomic per-appointment charge claim. R7 adds a homeowner "Pay now" alongside the operator
  // "Retry charge", so two humans (or a double-click) can fire a retry for the same completed job
  // inside the Stripe-latency window; because each attempt bumps reauth_count for a fresh
  // idempotency key, both would otherwise create a real charge. Flip the row into a transient
  // 'charging' sentinel, but only while it is still chargeable: NULL for the initial completion
  // charge (this MUST be allowed or normal completions could never claim) OR 'failed' /
  // 'requires_action' for a recovery retry. Postgres serializes the two UPDATEs on the row lock, so
  // exactly one caller matches the WHERE and updates the row; the loser matches 0 rows and bows out
  // with charge_in_progress (the route maps it to HTTP 409). Every charge caller (operator route,
  // R7 homeowner route, webhook re-charge) funnels through here, so one claim covers them all.
  // Capture the pre-claim status so the finally can restore it on a pre-Stripe precondition bail
  // (see PRECONDITION_CODES) rather than erasing a `failed` / `requires_action` recovery state.
  //
  // The claim runs as a raw-SQL RPC (migration 109), not an inline `.update().or()` query:
  // PostgREST intermittently fails to resolve authorization_status inside an OR-filtered mutation
  // (42703), while the identical predicate inside a function is immune. Same statement, same
  // row-lock serialization; the RPC returns the claimed id (empty = a concurrent charge won).
  const priorStatus = appt.authorization_status;

  const { data: claimRows, error: claimErr } = await supabase.rpc('claim_appointment_for_charge', {
    p_appointment_id: appointmentId,
  });
  if (claimErr) throw claimErr;
  if (!claimRows || (claimRows as unknown[]).length === 0) {
    return { ok: false, code: 'charge_in_progress', message: 'A charge for this appointment is already in progress' };
  }

  // finishCharge / recordChargeDecline (inside the dispatched path) write the REAL terminal
  // authorization_status (captured / requires_action / failed), overwriting the 'charging' sentinel.
  // Track that so the finally never stomps a terminal status: it releases the claim only when we
  // exit before a terminal write. The release target is `restoreStatus`: NULL by default (so the
  // reconcile sweep re-attempts), or the PRE-CLAIM status for a pre-Stripe precondition bail (so a
  // recovery row stays in triage, see PRECONDITION_CODES). The `.eq('authorization_status',
  // 'charging')` guard is the hard safety: it only ever resets a STILL-claimed row and can never
  // clobber a status a racing finish just wrote.
  //
  // Residual (hard process crash between the claim and finishCharge): the finally never runs, so the
  // row is left stuck in 'charging'. recoverStuckCharging in the reconcile sweep (reconcile.ts)
  // releases such rows back to NULL after a 10-minute grace window. It does not double-charge.
  let terminalWritten = false;
  let restoreStatus: string | null = null;
  try {
    const outcome = appt.is_self_pay
      ? await chargeSelfPayNow(supabase, appt, actor, actorRole)
      : await chargeHomeownerNow(supabase, appt, actor);
    // These are exactly the outcomes whose path wrote a non-'charging' terminal authorization_status
    // (charged -> captured, requires_action -> requires_action, declined -> failed), plus any outcome
    // explicitly marked `stamped` (the T1-7 no_card bail, finishCharge's unexpected-status branch).
    // Skipping the release for a stamped outcome is load-bearing: the stamp makes the row
    // re-claimable immediately, so a late release could otherwise free a successor's live claim.
    if (
      outcome.code === 'charged' ||
      outcome.code === 'requires_action' ||
      outcome.code === 'declined' ||
      outcome.stamped
    ) {
      terminalWritten = true;
    } else if (PRECONDITION_CODES.has(outcome.code)) {
      // Pre-Stripe bail: release back to the pre-claim status, not NULL, so a `failed` /
      // `requires_action` recovery row is not silently dropped from triage / the self-heal / the sweep.
      restoreStatus = priorStatus;
    }
    return outcome;
  } finally {
    if (!terminalWritten) {
      await supabase
        .from('appointments')
        .update({ authorization_status: restoreStatus })
        .eq('id', appointmentId)
        .eq('authorization_status', 'charging');
    }
  }
}

/** Returns the in-flight outcome if a revenue row for the appointment is already paid/processing. */
async function alreadySettled(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<{ code: 'charged' | 'processing'; paymentIntentId?: string } | null> {
  // Money-in-flight guard (T1-5). An appointment can carry MORE THAN ONE revenue row: the partial
  // unique index (migration 088) only covers Stripe-backed rows, so an operator's manual cash record
  // (payment_type='revenue', stripe_payment_intent_id NULL, status='paid') legitimately coexists with
  // a Stripe row that may be `failed` from an earlier decline. An unordered `.limit(1)` could return
  // the `failed` sibling and let a SECOND charge through, double-collecting money already taken in
  // cash. So filter to paid/processing at the DB and prefer a `paid` row over a `processing` one — a
  // settled charge (cash or card) always wins, and a coexisting `failed` row can never mask it.
  const { data: rows } = await supabase
    .from('payments')
    .select('status, stripe_payment_intent_id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .in('status', ['paid', 'processing']);
  const list = (rows ?? []) as Array<{ status: string; stripe_payment_intent_id: string | null }>;
  if (list.length === 0) return null;
  const paid = list.find((r) => r.status === 'paid');
  if (paid) return { code: 'charged', paymentIntentId: paid.stripe_payment_intent_id ?? undefined };
  const processing = list.find((r) => r.status === 'processing');
  if (processing) return { code: 'processing', paymentIntentId: processing.stripe_payment_intent_id ?? undefined };
  return null;
}

/**
 * A prior terminal decline (`failed`) or unauthenticated `requires_action` means the old idempotency
 * key is spent (cached against that result, and the card has likely changed). Bump reauth_count so
 * the charge gets a fresh key.
 */
async function nextReauthAttempt(supabase: SupabaseClient, appt: AppointmentRow): Promise<number> {
  let attempt = appt.reauth_count ?? 0;
  if (appt.authorization_status === 'failed' || appt.authorization_status === 'requires_action') {
    attempt += 1;
    await supabase.from('appointments').update({ reauth_count: attempt }).eq('id', appt.id);
  }
  return attempt;
}

/**
 * Upsert the single revenue payment row for an appointment. The partial unique index
 * (migration 088) backstops the check-then-insert race: on a 23505 the concurrent writer won,
 * so re-select its row — if it carries a DIFFERENT PaymentIntent, two real charges exist
 * (e.g. a completion charge racing a cancellation fee) and that's flagged loudly instead of
 * silently overwriting either record.
 */
async function upsertRevenueRow(
  supabase: SupabaseClient,
  appointmentId: string,
  row: Record<string, unknown>,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1);
  if (existing && existing.length > 0) {
    const id = (existing[0] as { id: string }).id;
    await supabase.from('payments').update(row).eq('id', id);
    return id;
  }
  const { data: inserted, error: insertError } = await supabase
    .from('payments')
    .insert(row)
    .select('id')
    .single();
  if (insertError && insertError.code === '23505') {
    const { data: winner } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id')
      .eq('appointment_id', appointmentId)
      .eq('payment_type', 'revenue')
      .not('stripe_payment_intent_id', 'is', null)
      .limit(1)
      .maybeSingle();
    const w = winner as { id: string; stripe_payment_intent_id: string | null } | null;
    if (!w) return null;
    if (w.stripe_payment_intent_id === (row.stripe_payment_intent_id ?? null)) {
      // Same PaymentIntent (idempotency key collapsed the race) — the winner's row IS this charge.
      await supabase.from('payments').update(row).eq('id', w.id);
      return w.id;
    }
    await recordPaymentEvent(supabase, {
      paymentId: w.id,
      appointmentId,
      organizationId: (row.organization_id as string) ?? null,
      eventType: 'duplicate_charge_detected',
      actor: 'system',
      payload: {
        kept_payment_intent_id: w.stripe_payment_intent_id,
        duplicate_payment_intent_id: row.stripe_payment_intent_id ?? null,
      },
    });
    return w.id;
  }
  return (inserted as { id: string } | null)?.id ?? null;
}

// --- Homeowner -----------------------------------------------------------------------------------

async function chargeHomeownerNow(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
): Promise<ChargeNowOutcome> {
  if (!appt.payment_method_id) {
    return recordNoCardBail(supabase, appt, actor, 'No payment method on the appointment');
  }

  const { data: hoData } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', appt.homeowner_id)
    .maybeSingle();
  const customerId = (hoData as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
  if (!customerId) {
    return recordNoCardBail(supabase, appt, actor, 'Homeowner has no saved payment profile');
  }

  // The saved payment method can be detached/deleted between booking and completion (the customer
  // rotated cards). Charging the dead id would surface as a confusing generic decline, so
  // substitute the customer's default method, persist it on the appointment (the ACH path and any
  // retry re-read it from there), and ledger the substitution.
  let paymentMethodId = appt.payment_method_id;
  if (!(await paymentMethodBelongsToCustomer(customerId, paymentMethodId))) {
    let fallback: string | null = null;
    try {
      fallback = await getDefaultPaymentMethod(customerId);
    } catch {
      fallback = null;
    }
    if (!fallback) {
      return recordNoCardBail(supabase, appt, actor, 'The saved payment method is no longer available');
    }
    paymentMethodId = fallback;
    await supabase.from('appointments').update({ payment_method_id: fallback }).eq('id', appt.id);
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'payment_method_substituted',
      actor,
      payload: { detached_payment_method_id: appt.payment_method_id, substituted_payment_method_id: fallback },
    });
  }

  // A bank method is debited via the existing ACH charge-at-completion path (also immediate).
  if (stripeAchEnabled() && (await getPaymentMethodType(paymentMethodId)) === 'us_bank_account') {
    const outcome = await chargeAchAppointment(supabase, appt.id, actor);
    // The debit is in flight (processing), so the prior failed card auth is resolved — drop it out
    // of "Payments needing attention".
    if (outcome.ok) await clearFailedForBank(supabase, appt);
    return outcome;
  }

  const { data: orgData } = await supabase
    .from('organizations')
    .select('stripe_connect_account_id, stripe_connect_charges_enabled, platform_fee_bps')
    .eq('id', appt.organization_id)
    .maybeSingle();
  const org = orgData as
    | { stripe_connect_account_id: string | null; stripe_connect_charges_enabled: boolean; platform_fee_bps: number }
    | null;
  if (!org?.stripe_connect_account_id || !org.stripe_connect_charges_enabled) {
    return recordTenantNotReadyBail(
      supabase,
      appt,
      actor,
      'Organization Stripe account is not ready to accept charges',
    );
  }

  const baseCents = Math.round(Number(appt.total_price) * 100);
  const passthrough = stripeFeePassthroughEnabled();
  const { chargeCents, feeCents } = passthrough
    ? computeChargeBreakdown('card', baseCents)
    : { chargeCents: baseCents, feeCents: 0 };
  const platformFeeBps = org.platform_fee_bps ?? 0;
  const { platformFeeCents } = computePaymentSplit({ grossCents: baseCents, payoutPercent: 0, platformFeeBps });

  const reauthAttempt = await nextReauthAttempt(supabase, appt);

  let pi;
  try {
    pi = await createDestinationCharge({
      grossCents: chargeCents,
      customerId,
      paymentMethodId,
      tenantAccountId: org.stripe_connect_account_id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt,
    });
  } catch (err) {
    return recordChargeDecline(supabase, appt, actor, {
      amountCents: chargeCents,
      feeCents: passthrough ? feeCents : null,
      isSelfPay: false,
      err,
    });
  }

  const baseRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: passthrough ? feeCents : null,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    charge_kind: 'completion' as const,
    stripe_payment_intent_id: pi.id,
    on_behalf_of_account_id: org.stripe_connect_account_id,
    transfer_destination_account_id: org.stripe_connect_account_id,
    application_fee_amount: platformFeeCents,
    application_fee_bps_snapshot: platformFeeBps,
    payment_intent_status: pi.status,
  };
  return finishCharge(supabase, appt, pi, baseRow, chargeCents, actor);
}

// --- Self-pay ------------------------------------------------------------------------------------

async function chargeSelfPayNow(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  actorRole?: string,
): Promise<ChargeNowOutcome> {
  // Defense in depth: self-pay draws on the COMPANY card, never a homeowner's. The R7 homeowner
  // "Pay now" route already refuses self-pay appointments up front; rejecting a homeowner actor here
  // too means a future route regression can never reach a company-card charge from a homeowner.
  if (actorRole === 'homeowner') {
    return { ok: false, code: 'not_chargeable', message: 'Self-pay appointments cannot be charged by a homeowner' };
  }

  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
    flat_rate_cents: number | null;
    payout_configured_at: string | null;
  };
  const [orgRes, cleanerRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('stripe_self_pay_customer_id, platform_fee_bps')
      .eq('id', appt.organization_id)
      .maybeSingle(),
    appt.cleaner_id
      ? supabase
          .from('cleaner_profiles')
          .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent, flat_rate_cents, payout_configured_at')
          .eq('id', appt.cleaner_id)
          .maybeSingle()
      : Promise.resolve({ data: null as CleanerRow | null }),
  ]);

  const orgRow = orgRes.data as { stripe_self_pay_customer_id: string | null; platform_fee_bps: number } | null;
  const customerId = orgRow?.stripe_self_pay_customer_id ?? null;
  if (!customerId) {
    await recordSelfPayNoCard(supabase, appt, actor, 'no_self_pay_customer');
    return { ok: false, code: 'no_org_card', message: 'Organization has no company card on file' };
  }

  const cleaner = cleanerRes.data as CleanerRow | null;
  // Mode-aware payability (isCleanerPayable): percentage needs % > 0, flat
  // needs a positive rate, request needs only Connect readiness.
  if (!cleaner || !isCleanerPayable(cleaner)) {
    return recordCleanerNotPayableBail(
      supabase,
      appt,
      actor,
      'Self-pay requires a payout-capable cleaner (Connect onboarded with pay set up)',
    );
  }

  // Request mode defers the CHARGE itself: the org's charge amount is derived
  // from the cleaner's cut, which does not exist until the pay request
  // approves. Precondition bail (non-stamping, authorization_status untouched)
  // so the approve trigger / reconcile sweep collects once approved. Gated
  // BEFORE the method lookup so the card and ACH paths wait identically.
  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const cut = await resolveSelfPayCutCents(supabase, { appointmentId: appt.id, cleaner, jobGrossCents });
  if (!cut.ok) {
    return { ok: false, code: 'pay_request_pending', message: 'Waiting for the pay request to be approved' };
  }

  // Resolve the company method: default, else first. A bank default is debited via the existing
  // self-pay ACH charge-at-completion path (also immediate).
  const methods = await listSavedCards(customerId);
  if (methods.length === 0) {
    await recordSelfPayNoCard(supabase, appt, actor, 'no_saved_method');
    return { ok: false, code: 'no_org_card', message: 'No saved company card to charge' };
  }
  const method = methods.find((m) => m.isDefault) ?? methods[0];
  if (stripeAchEnabled() && stripeSelfPayEnabled() && method.type === 'us_bank_account') {
    const outcome = await chargeSelfPayAchAppointment(supabase, appt.id, actor);
    if (outcome.ok) await clearFailedForBank(supabase, appt);
    return outcome;
  }

  const platformFeeBps = orgRow?.platform_fee_bps ?? 0;
  const { chargeCents, cleanerCutCents, platformFeeCents, estimatedFeeCents } = computeSelfPayAmountsFromCents({
    jobGrossCents,
    cleanerCutCents: cut.cutCents,
    platformFeeBps,
  });

  const reauthAttempt = await nextReauthAttempt(supabase, appt);

  let pi;
  try {
    pi = await createSelfPayCharge({
      chargeCents,
      customerId,
      paymentMethodId: method.id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt,
    });
  } catch (err) {
    return recordChargeDecline(supabase, appt, actor, {
      amountCents: chargeCents,
      feeCents: estimatedFeeCents,
      isSelfPay: true,
      err,
    });
  }

  // application_fee_amount/bps mirror the homeowner row: the platform's retained fee. Self-pay has
  // no Stripe-side application fee object — the funds land on the platform balance and only the
  // cleaner cut is transferred out, so the fee is retained implicitly; the row is the record.
  const baseRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: estimatedFeeCents,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    charge_kind: 'completion' as const,
    is_self_pay: true,
    stripe_payment_intent_id: pi.id,
    application_fee_amount: platformFeeCents,
    application_fee_bps_snapshot: platformFeeBps,
    payment_intent_status: pi.status,
  };
  return finishCharge(supabase, appt, pi, baseRow, chargeCents, actor, { cleanerCutCents, platformFeeCents });
}

// --- Shared result handling ----------------------------------------------------------------------

/**
 * Maps the auto-capture PaymentIntent status to DB state + outcome. `succeeded` is the happy path
 * (paid row, captured); settlement to the cleaner runs on the payment_intent.succeeded webhook.
 */
async function finishCharge(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  pi: { id: string; status: string },
  baseRow: Record<string, unknown>,
  chargeCents: number,
  actor: string,
  extra?: { cleanerCutCents?: number; platformFeeCents?: number },
): Promise<ChargeNowOutcome> {
  const now = new Date().toISOString();

  if (pi.status === 'succeeded') {
    await supabase.from('appointments').update({ authorization_status: 'captured' }).eq('id', appt.id);
    const paymentId = await upsertRevenueRow(supabase, appt.id, {
      ...baseRow,
      status: 'paid',
      authorized_at: now,
      captured_at: now,
      paid_at: now,
    });
    await recordPaymentEvent(supabase, {
      paymentId,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'charged',
      prevStatus: appt.authorization_status,
      newStatus: 'paid',
      actor,
      amount: chargeCents,
      payload: { payment_intent_id: pi.id, pi_status: pi.status, ...(extra ?? {}) },
    });
    return { ok: true, code: 'charged', paymentIntentId: pi.id };
  }

  if (pi.status === 'processing') {
    await upsertRevenueRow(supabase, appt.id, { ...baseRow, status: 'processing' });
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'charged',
      prevStatus: appt.authorization_status,
      newStatus: 'processing',
      actor,
      amount: chargeCents,
      payload: { payment_intent_id: pi.id, pi_status: pi.status, ...(extra ?? {}) },
    });
    return { ok: true, code: 'processing', paymentIntentId: pi.id };
  }

  if (pi.status === 'requires_action') {
    // 3-D Secure on an off-session charge: nothing was captured and the customer isn't present to
    // authenticate. Surface it so the row stays in "needs attention"; recovery is the card link
    // (setup_intent.succeeded re-points + re-charges completed jobs) or a different card.
    await supabase.from('appointments').update({ authorization_status: 'requires_action' }).eq('id', appt.id);
    await upsertRevenueRow(supabase, appt.id, { ...baseRow, status: 'failed' });
    await notifyChargeFailed(supabase, appt, {
      amountCents: chargeCents,
      reason: 'authentication_required',
      dedupeSuffix: pi.id,
      actor,
    });
    return { ok: false, code: 'requires_action', paymentIntentId: pi.id, message: 'Customer authentication required' };
  }

  // Any other terminal status is a failure.
  await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
  await upsertRevenueRow(supabase, appt.id, { ...baseRow, status: 'failed' });
  await notifyChargeFailed(supabase, appt, {
    amountCents: chargeCents,
    reason: 'declined',
    error: `Unexpected PaymentIntent status: ${pi.status}`,
    dedupeSuffix: pi.id,
    actor,
  });
  // stamped: this branch wrote authorization_status='failed' above, so the claim release must be
  // skipped (same successor-claim hazard as the no_card bail; pinned by the T1-7 review).
  return { ok: false, code: 'error', message: `Unexpected PaymentIntent status: ${pi.status}`, paymentIntentId: pi.id, stamped: true };
}

/** Mirrors a charge decline into appointments/payments/ledger so the pill reads "Failed". */
async function recordChargeDecline(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  opts: { amountCents: number; feeCents: number | null; isSelfPay: boolean; err: unknown },
): Promise<ChargeNowOutcome> {
  const failedPi = (opts.err as { payment_intent?: { id?: string; status?: string } }).payment_intent ?? null;
  await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
  const row: Record<string, unknown> = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: opts.amountCents / 100,
    processing_fee_cents: opts.feeCents,
    status: 'failed',
    payment_type: 'revenue',
    payment_method: 'card',
    charge_kind: 'completion',
    ...(opts.isSelfPay ? { is_self_pay: true } : {}),
  };
  if (failedPi?.id) {
    row.stripe_payment_intent_id = failedPi.id;
    row.payment_intent_status = failedPi.status ?? 'requires_payment_method';
  } else {
    // T1-16: no PaymentIntent on the error means the OUTCOME IS UNKNOWN — Stripe may have
    // captured before the response was lost. Null the PI columns explicitly (upsertRevenueRow
    // updates in place, so a PRIOR attempt's failed PI would otherwise mask this shape from the
    // verification sweep and the fresh-charge guard).
    row.stripe_payment_intent_id = null;
    row.payment_intent_status = null;
  }
  const paymentId = await upsertRevenueRow(supabase, appt.id, row);
  if (!failedPi && paymentId) {
    // Re-arm verification for THIS unknown outcome: clear any verified-absent stamp a previous
    // sweep pass left (it would let a fresh charge through before the sweep checks Stripe for
    // this attempt) and stamp unknown_since, the sweep's grace anchor + concurrency token — the
    // row's created_at is the FIRST attempt's time and can't anchor the current attempt. One
    // statement so the two can never diverge. Migration-116 lag is benign (nothing could have
    // stamped it yet); any OTHER failure leaves a possibly-stale stamp armed, so it pages the
    // owner via the alertable rearm-failed event rather than being swallowed.
    const { error: rearmErr } = await supabase
      .from('payments')
      .update({
        charge_outcome_verified_at: null,
        charge_outcome_unknown_since: new Date().toISOString(),
      })
      .eq('id', paymentId);
    if (
      rearmErr &&
      !(
        (rearmErr.code === '42703' || rearmErr.code === 'PGRST204') &&
        rearmErr.message?.includes('charge_outcome_')
      )
    ) {
      console.error('recordChargeDecline: could not re-arm outcome verification:', rearmErr);
      await recordPaymentEvent(supabase, {
        paymentId,
        appointmentId: appt.id,
        organizationId: appt.organization_id,
        eventType: 'charge_outcome_rearm_failed',
        actor,
        amount: opts.amountCents,
        payload: { error: rearmErr.message, self_pay: opts.isSelfPay },
      });
    }
  }
  await recordPaymentEvent(supabase, {
    paymentId,
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'charge_failed',
    prevStatus: appt.authorization_status,
    newStatus: 'failed',
    actor,
    amount: opts.amountCents,
    payload: {
      error: opts.err instanceof Error ? opts.err.message : String(opts.err),
      payment_intent_id: failedPi?.id ?? null,
      self_pay: opts.isSelfPay,
      // T1-16: flags the unknown-outcome shape for forensics (no PI on the error, so the charge
      // may actually have captured; the verification sweep resolves it).
      outcome_unknown: !failedPi,
    },
  });
  await notifyChargeFailed(supabase, appt, {
    amountCents: opts.amountCents,
    reason: 'declined',
    error: opts.err instanceof Error ? opts.err.message : String(opts.err),
    selfPay: opts.isSelfPay,
    dedupeSuffix: failedPi?.id ?? 'na',
    actor,
  });
  return { ok: false, code: 'declined', message: opts.err instanceof Error ? opts.err.message : 'Charge declined' };
}

/**
 * Notifications for a failed completion charge (decline or off-session 3-D Secure):
 * an org-staff fan-out row, plus a bell notification to the HOMEOWNER whose card
 * it actually is (skipped for self-pay, where the failure is the company card and
 * only staff can act on it). The homeowner payload omits the raw Stripe error.
 */
async function notifyChargeFailed(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  opts: {
    amountCents: number;
    reason: 'declined' | 'authentication_required' | 'no_card';
    error?: string;
    selfPay?: boolean;
    dedupeSuffix: string;
    /** Who triggered the charge (route passes `user:{id}`); used for actor exclusion. */
    actor: string;
  },
): Promise<void> {
  const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id, cleanerId: appt.cleaner_id });
  await recordNotificationEvent(supabase, {
    event_type: 'charge_failed',
    appointment_id: appt.id,
    organization_id: appt.organization_id,
    dedupe_key: `charge_failed:${appt.id}:${opts.dedupeSuffix}`,
    payload: {
      ...ctx,
      audience: 'admin',
      amount_cents: opts.amountCents,
      reason: opts.reason,
      ...(opts.error ? { error: opts.error } : {}),
      ...(opts.selfPay ? { self_pay: true } : {}),
    },
  });
  if (!appt.is_self_pay && appt.homeowner_id) {
    // Actor exclusion: a homeowner who just tapped Pay now is reading the inline
    // decline already; a toast + unread bell row about their own action is noise
    // (and would stack one per retry). Staff retries and automatic charges
    // (actor 'system:*' / 'webhook:*') still notify them, which is the point.
    const actorUserId = opts.actor.startsWith('user:') ? opts.actor.slice('user:'.length) : null;
    await recordNotificationEvent(supabase, {
      event_type: 'charge_failed',
      appointment_id: appt.id,
      organization_id: appt.organization_id,
      recipient_user_id: appt.homeowner_id,
      dedupe_key: `charge_failed:homeowner:${appt.id}:${opts.dedupeSuffix}`,
      ...(actorUserId ? { exclude_user_ids: [actorUserId] } : {}),
      payload: {
        ...ctx,
        audience: 'homeowner',
        amount_cents: opts.amountCents,
        reason: opts.reason,
      },
    });
  }
}

/** The amount a completion charge would collect: gross, plus the processing fee when passthrough is on. */
function wouldChargeCents(appt: AppointmentRow): number {
  const baseCents = Math.round(Number(appt.total_price) * 100);
  return stripeFeePassthroughEnabled() ? computeChargeBreakdown('card', baseCents).chargeCents : baseCents;
}

/**
 * Bounds the forensic ledger for the keep-NULL bails: the sweep re-attempts them every ~30 minutes
 * for as long as the org/cleaner setup is unfinished, and an unbounded stream of identical
 * `charge_precondition_failed` rows would drown the drift signal payment_events exists for. Skip
 * the append when the appointment's LATEST precondition event already carries the same code (a
 * code CHANGE, e.g. tenant_not_ready -> no_card, still appends). Fails open: a read error records
 * anyway, since an extra row is harmless and a missing first row is not.
 */
async function shouldAppendPreconditionEvent(
  supabase: SupabaseClient,
  appointmentId: string,
  code: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('payment_events')
    .select('payload')
    .eq('appointment_id', appointmentId)
    .eq('event_type', 'charge_precondition_failed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return true;
  const last = data as { payload: { code?: string } | null } | null;
  return (last?.payload?.code ?? null) !== code;
}

/**
 * T1-7: a homeowner-card charge that bails with `no_card` (no PM saved, no Stripe customer, or the
 * saved card is gone with no default to substitute) is unrecoverable by anything automated: the
 * NULL-PM subcase is excluded from the reconcile sweep outright, and the other two would bail again
 * on every sweep pass forever. Recovery needs a human (a new card, a card link, or a manual cash
 * record), so stamp authorization_status='failed'. That one write plugs the job into every existing
 * recovery surface at once: the operator "Needs you now" triage band (with Send card link), the
 * card-link route's failed/requires_action gate, the setup_intent.succeeded self-heal (re-points the
 * new card and re-charges), the homeowner recovery card, and the manual-record captured flip. The
 * returned `stamped: true` makes the caller skip its claim release (see ChargeNowOutcome.stamped).
 * No revenue row is written: no charge was attempted, and a failed PI-less row would muddy the
 * manual-record and T1-16 semantics.
 */
async function recordNoCardBail(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  message: string,
): Promise<ChargeNowOutcome> {
  // Money may have arrived since the entry alreadySettled check (a manual cash record racing into
  // the claim window: its captured-flip matches 0 rows while we hold 'charging', so nothing else
  // re-checks). Never stamp "failed" over a job that is actually collected; bail plainly and let
  // the finally restore the pre-claim status.
  const settled = await alreadySettled(supabase, appt.id);
  if (settled) return { ok: false, code: 'no_card', message };

  const amountCents = wouldChargeCents(appt);
  // Clear the payment method along with the stamp: every no_card branch means the saved id is
  // unusable (never set, customer profile missing, or detached at Stripe). A NULL PM lets every
  // downstream surface (payment-section state, home alerts, the card-link email) distinguish
  // "no card" from a real decline instead of showing false "card declined" copy. The dead id is
  // preserved in the ledger payload below.
  const { error: stampErr } = await supabase
    .from('appointments')
    .update({ authorization_status: 'failed', payment_method_id: null })
    .eq('id', appt.id);
  if (stampErr) {
    // Fail plain (no ledger, no notifications, no `stamped`): announcing a failed state the row is
    // not actually in would burn the dedupe keys and strand the job invisibly once the finally
    // restores the pre-claim status. The next attempt (sweep, retry) re-runs this path.
    console.error('recordNoCardBail: could not stamp authorization_status=failed:', stampErr);
    return { ok: false, code: 'no_card', message };
  }
  await recordPaymentEvent(supabase, {
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'charge_precondition_failed',
    prevStatus: appt.authorization_status,
    newStatus: 'failed',
    actor,
    amount: amountCents,
    payload: { code: 'no_card', message, payment_method_id: appt.payment_method_id },
  });
  await notifyChargeFailed(supabase, appt, {
    amountCents,
    reason: 'no_card',
    // Stable per EPISODE, not forever: intra-episode re-bails (sweep passes, retries) never stack
    // bell rows, but both card-reset paths (the payment-method route, the setup_intent self-heal)
    // bump reauth_count, so a genuinely new no-card episode months later notifies again.
    dedupeSuffix: `no_card:${appt.reauth_count ?? 0}`,
    actor,
  });
  // stamped: the terminal 'failed' is written; the caller must skip the claim release (the row is
  // re-claimable from this moment, and a late release could free a successor's live claim).
  return { ok: false, code: 'no_card', message, stamped: true };
}

/**
 * T1-7: an org whose Stripe account can't accept charges blocks EVERY completion charge, but the
 * fix is one org-level action (finish Connect onboarding), not per-appointment surgery. The row
 * deliberately KEEPS authorization_status NULL so the reconcile sweep re-attempts and collection
 * resumes automatically the moment onboarding completes; a `failed` stamp here would instead park
 * every job in triage demanding a manual retry each. Visibility comes from the per-appointment
 * (deduped) admin notification + the forensic ledger.
 */
async function recordTenantNotReadyBail(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  message: string,
): Promise<ChargeNowOutcome> {
  const amountCents = wouldChargeCents(appt);
  if (await shouldAppendPreconditionEvent(supabase, appt.id, 'tenant_not_ready')) {
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'charge_precondition_failed',
      actor,
      amount: amountCents,
      payload: { code: 'tenant_not_ready', message },
    });
  }
  const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id, cleanerId: appt.cleaner_id });
  await recordNotificationEvent(supabase, {
    event_type: 'tenant_payments_not_ready',
    appointment_id: appt.id,
    organization_id: appt.organization_id,
    dedupe_key: `tenant_payments_not_ready:${appt.id}`,
    payload: { ...ctx, audience: 'admin', amount_cents: amountCents },
  });
  return { ok: false, code: 'tenant_not_ready', message };
}

/**
 * T1-7: same shape as the tenant bail, for self-pay jobs blocked on the cleaner's payout setup
 * (not Connect-onboarded, hourly-external model, or payout % of 0). Self-pay rows pass the
 * reconcile sweep's filter, so leaving authorization_status NULL keeps auto-collection armed for
 * the moment the cleaner becomes payable; the deduped admin notification supplies the visibility.
 */
async function recordCleanerNotPayableBail(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  message: string,
): Promise<ChargeNowOutcome> {
  // Job gross, not wouldChargeCents: the self-pay gross-up (computeSelfPayAmounts) needs the
  // cleaner's payout %, which is exactly what's missing/zero on this bail.
  const amountCents = Math.round(Number(appt.total_price) * 100);
  if (await shouldAppendPreconditionEvent(supabase, appt.id, 'cleaner_not_payable')) {
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'charge_precondition_failed',
      actor,
      amount: amountCents,
      payload: { code: 'cleaner_not_payable', message },
    });
  }
  const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id, cleanerId: appt.cleaner_id });
  await recordNotificationEvent(supabase, {
    event_type: 'cleaner_not_payable',
    appointment_id: appt.id,
    organization_id: appt.organization_id,
    dedupe_key: `cleaner_not_payable:${appt.id}`,
    payload: { ...ctx, audience: 'admin', amount_cents: amountCents },
  });
  return { ok: false, code: 'cleaner_not_payable', message };
}

/** Ledger + admin notification for a self-pay completion with nothing to charge. */
async function recordSelfPayNoCard(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  reason: string,
): Promise<void> {
  await recordPaymentEvent(supabase, {
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'self_pay_no_card',
    actor,
    payload: { reason },
  });
  const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id, cleanerId: appt.cleaner_id });
  await recordNotificationEvent(supabase, {
    event_type: 'self_pay_no_card',
    appointment_id: appt.id,
    organization_id: appt.organization_id,
    dedupe_key: `self_pay_no_card:${appt.id}`,
    payload: { ...ctx, audience: 'admin', reason },
  });
}
