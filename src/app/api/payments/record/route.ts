import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      organization_id,
      appointment_id,
      amount,
      payment_method,
      payment_type,
      notes,
      reference,
      idempotency_key,
    } = body;

    // ── Auth first: don't leak validation details to unauthenticated callers. Recording a
    // payment is a payment-spending action, so a manager additionally needs can_manage_payments.
    const auth = await requireOrgPaymentsAuth(request, organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    if (!appointment_id || !amount || !payment_method) {
      return NextResponse.json(
        { error: 'Missing required fields: appointment_id, amount, payment_method' },
        { status: 400 }
      );
    }

    // T1-17: optional client idempotency key, one per form session. Deliberate split/partial
    // records send fresh keys and stay allowed (product decision 2026-07-26); a double-click or
    // network retry of the SAME submission replays the first row instead of inserting a duplicate
    // that double-counts revenue in reporting (payment_stats sums paid revenue rows per-row).
    let manualRecordKey: string | null = null;
    if (idempotency_key != null) {
      if (typeof idempotency_key !== 'string' || !UUID_RE.test(idempotency_key)) {
        return NextResponse.json(
          { error: 'idempotency_key must be a UUID' },
          { status: 400 }
        );
      }
      manualRecordKey = idempotency_key.toLowerCase();
    }

    // Verify the appointment exists *and* belongs to caller's org.
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, authorization_status')
      .eq('id', appointment_id)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 }
      );
    }

    const appt = appointment as { organization_id: string; authorization_status: string | null };

    if (appt.organization_id !== organization_id) {
      return NextResponse.json(
        { error: 'Appointment does not belong to the specified organization' },
        { status: 400 }
      );
    }

    const resolvedType: string = payment_type || 'revenue';

    // T1-5 (in-flight double-collection guard): recording revenue out-of-band collects the money, so
    // it must NOT stack on top of a card charge that is already collecting or has collected for the
    // same job. Refuse when the card path is live:
    //   - authorization_status === 'charging': a card charge is mid-flight (the claim RPC set this
    //     transient sentinel; the revenue row is written only after Stripe returns), OR
    //   - a Stripe-backed revenue row (stripe_payment_intent_id NOT NULL) is already paid/processing:
    //     the card was captured, or an ACH debit is clearing (which settles regardless, ~4 business
    //     days later, and cannot be un-sent).
    // This is precise on purpose: it only ever looks at PI-backed rows, so it never blocks a manual
    // cash record for a job whose card DECLINED (the Stripe row is `failed`, not paid/processing) nor a
    // legitimate second/split cash record (those rows carry no PaymentIntent). The remaining
    // razor-thin window (a charge claim landing between this check and the insert) needs DB-level
    // serialization and is tracked as a follow-up.
    if (resolvedType === 'revenue') {
      if (appt.authorization_status === 'charging') {
        return NextResponse.json(
          { error: 'A card charge for this appointment is in progress. Try again in a moment.' },
          { status: 409 }
        );
      }
      const { data: liveRows, error: liveErr } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('appointment_id', appointment_id)
        .eq('payment_type', 'revenue')
        .not('stripe_payment_intent_id', 'is', null)
        .in('status', ['paid', 'processing'])
        .limit(1);
      if (liveErr) {
        // Fail CLOSED: this is a money-safety guard, so a transient read failure must never let the
        // manual record through. Treating an errored lookup as "no live payment" would re-open the
        // exact double-collection the guard exists to prevent. Refuse and let the operator retry.
        console.error('record payment: live-charge guard lookup failed:', liveErr);
        return NextResponse.json(
          { error: 'Could not verify the payment state for this appointment. Try again in a moment.' },
          { status: 503 }
        );
      }
      if (liveRows && liveRows.length > 0) {
        return NextResponse.json(
          {
            error:
              'A card payment for this appointment has already been collected or is processing. Refund or wait for it to resolve before recording a separate payment.',
          },
          { status: 409 }
        );
      }

      // T1-16: an unknown-outcome card attempt (failed row, no PaymentIntent, verification not
      // yet delivered by the sweep) may actually BE a capture whose response was lost. Recording
      // cash on top of it is the same double-collect this guard exists for — and worse, once the
      // sweep repairs the card row to paid, settlement would read the NEWER manual row. Refuse
      // until the sweep's verdict lands (about 15 minutes); a verified-absent stamp unblocks.
      const { data: unknownRows, error: unknownErr } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('appointment_id', appointment_id)
        .eq('payment_type', 'revenue')
        .eq('charge_kind', 'completion')
        .eq('payment_method', 'card')
        .eq('status', 'failed')
        .is('stripe_payment_intent_id', null)
        .limit(1);
      if (unknownErr) {
        // Same fail-closed posture as the live-charge guard above. The two-step read keeps the
        // migration-116 column out of this first select, so a deploy-before-migrate window only
        // ever blocks appointments actually in the suspicious shape.
        console.error('record payment: unknown-outcome guard lookup failed:', unknownErr);
        return NextResponse.json(
          { error: 'Could not verify the payment state for this appointment. Try again in a moment.' },
          { status: 503 }
        );
      }
      if (unknownRows && unknownRows.length > 0) {
        const { data: verifyRow, error: verifyErr } = await supabaseAdmin
          .from('payments')
          .select('charge_outcome_verified_at')
          .eq('id', (unknownRows[0] as { id: string }).id)
          .maybeSingle();
        const verifiedAt = verifyErr
          ? null
          : ((verifyRow as { charge_outcome_verified_at: string | null } | null)
              ?.charge_outcome_verified_at ?? null);
        if (!verifiedAt) {
          return NextResponse.json(
            {
              error:
                'A recent card attempt for this appointment is being verified with Stripe. Try again in about 15 minutes.',
            },
            { status: 409 }
          );
        }
      }
    }

    const paymentData: Record<string, unknown> = {
      organization_id,
      appointment_id,
      amount: Number(amount),
      payment_method: payment_method || 'manual',
      payment_type: resolvedType,
      status: 'paid',
      paid_at: new Date().toISOString(),
      notes,
      reference,
      ...(manualRecordKey ? { manual_record_key: manualRecordKey } : {}),
    };

    let { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert([paymentData])
      .select()
      .single();

    // Migration-lag fallback (T1-11-F2 class): if this code deploys before migration 115 adds
    // manual_record_key, the insert fails with undefined-column (42703) / schema-cache (PGRST204)
    // instead of blocking every manual record until migrate-prod lands. Retry once WITHOUT the
    // key — only the double-submit dedupe degrades, not the money route.
    if (
      paymentError &&
      manualRecordKey &&
      (paymentError.code === '42703' || paymentError.code === 'PGRST204') &&
      paymentError.message?.includes('manual_record_key')
    ) {
      console.error(
        'record payment: manual_record_key column missing (migration 115 not applied yet); retrying without dedupe:',
        paymentError.message,
      );
      delete paymentData.manual_record_key;
      ({ data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert([paymentData])
        .select()
        .single());
    }

    if (paymentError) {
      // T1-17: a 23505 with a key means a row from THIS form session already landed — manual rows
      // carry no PaymentIntent, so the key's partial unique index is the only constraint they can
      // hit. Replay it as success ONLY when it is the SAME submission (org + appointment + amount
      // + type all match): an idempotency key must never acknowledge a submission it didn't
      // record (the dialog keeps its key across a failed submit, so an EDITED resubmit can carry
      // the old key), and the org scope keeps another tenant's row out of the response entirely.
      if (manualRecordKey && paymentError.code === '23505') {
        const { data: existing } = await supabaseAdmin
          .from('payments')
          .select()
          .eq('manual_record_key', manualRecordKey)
          .eq('organization_id', organization_id)
          .maybeSingle();
        const row = existing as
          | { appointment_id: string; amount: number | string; payment_type: string | null }
          | null;
        const sameSubmission =
          row != null &&
          row.appointment_id === appointment_id &&
          Number(row.amount) === Number(amount) &&
          (row.payment_type ?? 'revenue') === resolvedType;
        if (sameSubmission) {
          // The first request may have died between its insert and the triage flip below — the
          // flip is idempotent and state-filtered, so run it on the replay too before returning.
          if (resolvedType === 'revenue') {
            const { error: replayFlipError } = await supabaseAdmin
              .from('appointments')
              .update({ authorization_status: 'captured' })
              .eq('id', appointment_id)
              .in('authorization_status', ['failed', 'requires_action']);
            if (replayFlipError) {
              console.error('record payment: replay triage flip failed:', replayFlipError);
            }
          }
          return NextResponse.json({
            success: true,
            payment: existing,
            duplicate: true,
            message: 'Payment already recorded',
          });
        }
        // Same key, different payload (edited resubmit) or a cross-org key collision: refuse
        // rather than silently drop the new submission or leak the other row.
        return NextResponse.json(
          {
            error:
              'A payment was already recorded from this form session, possibly with different details. Check the payments list, then close and reopen the dialog to record another payment.',
          },
          { status: 409 }
        );
      }
      console.error('Error creating payment:', paymentError);
      return NextResponse.json(
        { error: 'Failed to create payment', details: paymentError.message },
        { status: 500 }
      );
    }

    // T1-5: recording a revenue payment collects the money out-of-band (cash/check/Zelle), so the
    // appointment must leave card-charge triage. If a prior auto-charge left it `failed` /
    // `requires_action`, flip it to `captured`: that drops the job out of the operator "Retry charge"
    // and homeowner "Pay now" surfaces, invalidates the card-recovery link, and stops the
    // setup_intent.succeeded self-heal from auto-charging a freshly saved card for money we've already
    // collected. Filtered to only ever clear a triage state (never overwrites a real Stripe capture or
    // a NULL not-yet-charged row); the alreadySettled money-guard in chargeCompletedAppointment is the
    // belt-and-suspenders backstop for the NULL case. Non-revenue records (e.g. a manual payout) leave
    // the charge state untouched.
    if (resolvedType === 'revenue') {
      const { error: authFlipError } = await supabaseAdmin
        .from('appointments')
        .update({ authorization_status: 'captured' })
        .eq('id', appointment_id)
        .in('authorization_status', ['failed', 'requires_action']);
      if (authFlipError) {
        // Non-fatal: the payment is recorded and the alreadySettled guard still blocks a double
        // charge. Log so the stuck triage state is visible, but don't fail the record.
        console.error('record payment: failed to clear charge triage state:', authFlipError);
      }
    }

    return NextResponse.json({
      success: true,
      payment,
      message: 'Payment recorded successfully',
    });
  } catch (error) {
    console.error('Error in record payment API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
