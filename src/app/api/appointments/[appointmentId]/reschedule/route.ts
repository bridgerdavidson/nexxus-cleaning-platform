import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { findConflicts, type ScheduleAppointment } from '@/lib/appointmentConflicts';
import { usesRequestState } from '@/lib/appointments/flowType';
import {
  decideRescheduleOutcome,
  planRescheduleNotifications,
  normalizeTimeHHMM,
  type SuggestionInputs,
} from '@/lib/appointments/rescheduleOutcome';

/**
 * Operator reschedule (spec: docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md).
 * Atomically moves a pending/confirmed booking to a new date/time (and optionally
 * a new cleaner), applying the re-confirmation policy via rescheduleOutcome and
 * cleaning up EVERY piece of stale sibling state (feedback, requested slots,
 * pending routing rows, request_state) so the auto-defer sweep and stale cleaner
 * accepts cannot clobber the operator's change.
 */
interface RescheduleBody {
  organizationId: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM (HH:MM:SS tolerated)
  cleanerId: string | null;
  force?: boolean;
}

type FeedbackRow = {
  id: string;
  cleaner_id: string;
  cleaner_suggested_times: Array<{ id: string; suggested_date: string; suggested_time: string }> | null;
  cleaner_suggested_windows: Array<{ id: string; window_date: string; start_time: string; end_time: string }> | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = (await request.json()) as RescheduleBody;
    const { organizationId, scheduledDate, cleanerId, force } = body;

    if (!organizationId || !scheduledDate || !body.scheduledTime) {
      return NextResponse.json(
        { success: false, error: 'organizationId, scheduledDate, and scheduledTime are required' },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      return NextResponse.json({ success: false, error: 'scheduledDate must be YYYY-MM-DD' }, { status: 400 });
    }
    const scheduledTime = normalizeTimeHHMM(body.scheduledTime);
    if (!scheduledTime) {
      return NextResponse.json({ success: false, error: 'scheduledTime must be HH:MM' }, { status: 400 });
    }

    const auth = await requireManagerPermission(request, organizationId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
    });
    if (!auth.ok) return auth.response;

    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select(
        `
        id, organization_id, cleaner_id, homeowner_id, scheduled_date, scheduled_time,
        duration_minutes, status, cleaner_confirmation_status, flow_type, homeowner_initiated,
        request_state, series_id,
        cleaner_availability_feedback (
          id, cleaner_id,
          cleaner_suggested_times ( id, suggested_date, suggested_time ),
          cleaner_suggested_windows ( id, window_date, start_time, end_time )
        )
      `,
      )
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }

    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking can no longer be rescheduled' },
        { status: 409 },
      );
    }

    const currentCleanerId = (appt.cleaner_id as string | null) ?? null;
    if (!cleanerId && currentCleanerId) {
      return NextResponse.json(
        { success: false, error: 'Reschedule cannot unassign the cleaner' },
        { status: 400 },
      );
    }
    const cleanerChanged = !!cleanerId && cleanerId !== currentCleanerId;

    if (cleanerChanged) {
      // Changing the cleaner escalates to can_handle_requests (route-level defense,
      // mirroring reassign-cleaner's flag; RLS itself only distinguishes can_edit_bookings).
      if (auth.role === 'manager') {
        const { data: perm } = await supabaseAdmin
          .from('manager_permissions')
          .select('can_handle_requests')
          .eq('manager_id', auth.userId)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (!(perm as { can_handle_requests: boolean } | null)?.can_handle_requests) {
          return NextResponse.json(
            { success: false, error: 'Changing the cleaner requires the Handle Requests permission' },
            { status: 403 },
          );
        }
      }
      const { data: cleanerProfile } = await supabaseAdmin
        .from('cleaner_profiles')
        .select('id, organization_id')
        .eq('id', cleanerId!)
        .maybeSingle();
      if (!cleanerProfile || cleanerProfile.organization_id !== organizationId) {
        return NextResponse.json({ success: false, error: 'Cleaner not in this organization' }, { status: 400 });
      }
    }

    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('default_payout_model')
      .eq('id', organizationId)
      .maybeSingle();
    const orgDefaultPayoutModel = (orgRow as { default_payout_model: string | null } | null)?.default_payout_model ?? null;

    // Conflict check on the target cleaner (server-side backstop; the dialog
    // pre-warns from cache and sends force:true once the warning is visible).
    if (cleanerId && !force) {
      const { data: sameDay } = await supabaseAdmin
        .from('appointments')
        .select(
          'id, status, scheduled_date, scheduled_time, duration_minutes, homeowner:user_profiles!homeowner_id(first_name,last_name), property:properties(name,address)',
        )
        .eq('organization_id', organizationId)
        .eq('cleaner_id', cleanerId)
        .eq('scheduled_date', scheduledDate);
      const rows = (sameDay ?? []) as unknown as Array<
        ScheduleAppointment & {
          homeowner: { first_name: string; last_name: string } | null;
          property: { name: string | null; address: string | null } | null;
        }
      >;
      const conflicts = findConflicts(
        rows,
        { date: scheduledDate, time: scheduledTime, durationMinutes: (appt.duration_minutes as number) || 60 },
        { excludeAppointmentId: appointmentId },
      );
      if (conflicts.length > 0) {
        const hit = rows.find((r) => r.id === conflicts[0].id) ?? null;
        const customerName = hit?.homeowner
          ? `${hit.homeowner.first_name ?? ''} ${hit.homeowner.last_name ?? ''}`.trim()
          : hit?.property?.name || hit?.property?.address || 'another job';
        return NextResponse.json(
          {
            success: false,
            error: 'Cleaner has a conflicting appointment at that time',
            conflict: true,
            details: {
              appointmentId: conflicts[0].id,
              scheduledTime: conflicts[0].scheduled_time,
              durationMinutes: conflicts[0].duration_minutes,
              customerName,
            },
          },
          { status: 409 },
        );
      }
    }

    const feedback = ((appt as { cleaner_availability_feedback?: FeedbackRow[] | null }).cleaner_availability_feedback ?? []) as FeedbackRow[];
    const suggestions: SuggestionInputs = {
      times: feedback.flatMap((f) =>
        (f.cleaner_suggested_times ?? []).map((t) => ({
          feedbackCleanerId: f.cleaner_id,
          suggestedDate: t.suggested_date,
          suggestedTime: t.suggested_time,
        })),
      ),
      windows: feedback.flatMap((f) =>
        (f.cleaner_suggested_windows ?? []).map((w) => ({
          feedbackCleanerId: f.cleaner_id,
          windowDate: w.window_date,
          startTime: w.start_time,
          endTime: w.end_time,
        })),
      ),
    };

    const outcome = decideRescheduleOutcome({
      scheduledDate,
      scheduledTime,
      targetCleanerId: cleanerId ?? null,
      currentCleanerId,
      orgDefaultPayoutModel,
      suggestions,
    });
    const deadline = outcome.recomputeDeadline ? computeResponseDeadlineISO(scheduledDate, scheduledTime) : null;
    const isRequest = usesRequestState(appt);

    const update: Record<string, unknown> = {
      scheduled_date: scheduledDate,
      scheduled_time: `${scheduledTime}:00`,
      cleaner_id: cleanerId ?? null,
      response_deadline: deadline,
      updated_at: new Date().toISOString(),
    };
    if (outcome.status) update.status = outcome.status;
    if (outcome.cleanerConfirmationStatus) update.cleaner_confirmation_status = outcome.cleanerConfirmationStatus;
    if (isRequest && outcome.kind !== 'unassigned') {
      update.request_state = outcome.settled ? 'completed' : 'routing';
    }

    // Atomic status gate: the conditional .in() makes a concurrent cancel/accept
    // fail this write (0 rows) instead of silently resurrecting the booking.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('appointments')
      .update(update)
      .eq('id', appointmentId)
      .in('status', ['pending', 'confirmed'])
      .select('id');
    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking changed. Refresh and try again.' },
        { status: 409 },
      );
    }

    // Stale-sibling cleanup AFTER the write succeeds (legacy deleted feedback
    // first and could lose it on a failed save). Non-fatal but logged.
    const nowIso = new Date().toISOString();
    try {
      await supabaseAdmin.from('cleaner_availability_feedback').delete().eq('appointment_id', appointmentId);
      await supabaseAdmin.from('appointment_requested_slots').delete().eq('appointment_id', appointmentId);
      // Close pending routing rows or the auto-defer sweep later re-routes this
      // booking over the operator's reschedule. appointment_routing_log.response
      // is `text NOT NULL DEFAULT 'pending'` (migration 059) and assign-cleaner's
      // non-forceAssign insert omits the column entirely, relying on that default
      // -- so pending rows always have response = 'pending' (never NULL). The
      // auto-defer sweep filters the same way.
      await supabaseAdmin
        .from('appointment_routing_log')
        .update({ response: 'expired', responded_at: nowIso })
        .eq('appointment_id', appointmentId)
        .eq('response', 'pending');
    } catch (cleanupErr) {
      console.error('reschedule: sibling-state cleanup failed (non-fatal):', cleanupErr);
    }

    // Homeowner-request re-ask re-enters the routing machine so the SLA sweep
    // governs the new deadline (mirrors assign-cleaner; no chain-cap check here,
    // an explicit operator action may always re-offer).
    if (isRequest && outcome.kind === 'reask' && cleanerId) {
      try {
        const { data: existingLog } = await supabaseAdmin
          .from('appointment_routing_log')
          .select('attempt_index')
          .eq('appointment_id', appointmentId)
          .order('attempt_index', { ascending: true });
        const nextAttempt = (((existingLog ?? []) as Array<{ attempt_index: number }>).at(-1)?.attempt_index ?? 0) + 1;
        await supabaseAdmin.from('appointment_routing_log').insert({
          appointment_id: appointmentId,
          cleaner_id: cleanerId,
          attempt_index: nextAttempt,
          deadline_at: deadline,
        });
      } catch (logErr) {
        console.error('reschedule: routing-log insert failed (non-fatal):', logErr);
      }
    }

    // Notifications, best-effort (recordNotificationEvent semantics).
    const plan = planRescheduleNotifications(outcome, cleanerChanged);
    try {
      const ctx = await loadNotificationContext(supabaseAdmin, {
        appointmentId,
        ...(cleanerId ? { cleanerId } : {}),
      });
      if (plan.cleanerEvent && cleanerId) {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: plan.cleanerEvent,
          appointment_id: appointmentId,
          organization_id: organizationId,
          recipient_user_id: cleanerId,
          payload: {
            ...ctx,
            audience: 'cleaner',
            scheduled_date: scheduledDate,
            scheduled_time: scheduledTime,
            ...(plan.cleanerEvent === 'appointment_rescheduled'
              ? { requires_confirmation: plan.requiresConfirmation, response_deadline: deadline }
              : {}),
          },
        });
      }
      if (plan.notifyHomeowner && appt.homeowner_id) {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: 'appointment_time_changed',
          appointment_id: appointmentId,
          organization_id: organizationId,
          recipient_user_id: appt.homeowner_id as string,
          payload: { ...ctx, audience: 'homeowner', scheduled_date: scheduledDate, scheduled_time: scheduledTime },
        });
      }
    } catch (notifyErr) {
      console.error('reschedule: notification failed (non-fatal):', notifyErr);
    }

    return NextResponse.json({ success: true, outcome: outcome.settled ? 'settled' : 'awaiting' });
  } catch (error) {
    console.error('Error in appointments/[appointmentId]/reschedule POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
