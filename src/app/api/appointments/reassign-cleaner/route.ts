import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth, type OrgRole } from '@/lib/auth/requireOrgAuth';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { findConflicts, type ScheduleAppointment } from '@/lib/appointmentConflicts';

/**
 * Admin/manager reassigns an already-scheduled appointment to a different cleaner from the
 * calendar dispatch board. Unlike `assign-cleaner` (which is wired to the homeowner-request
 * routing/escalation machine and only accepts `request_state in {awaiting_admin,
 * needs_admin_attention, routing}`), this endpoint works on a normal confirmed/pending job:
 * it sets the new cleaner, returns the job to pending + awaiting the new cleaner's acceptance,
 * computes a response deadline, and notifies the cleaner. Payment columns are untouched (a
 * held card survives the reassignment).
 *
 * Scheduling conflicts with the target cleaner's other jobs that day are rejected with 409
 * unless `force` is set (the board surfaces an "assign anyway?" override).
 */
interface ReassignInput {
  appointmentId: string;
  cleanerId: string;
  organizationId: string;
  /** Proceed despite a scheduling conflict with the target cleaner. */
  force?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { appointmentId, cleanerId, organizationId, force } =
      (await request.json()) as ReassignInput;
    if (!appointmentId || !cleanerId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'appointmentId, cleanerId, and organizationId are required' },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    // Managers need can_approve_decline_bookings or can_handle_requests (mirrors assign-cleaner).
    if (auth.role === ('manager' satisfies OrgRole)) {
      const { data: perms } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_handle_requests, can_approve_decline_bookings')
        .eq('manager_id', auth.userId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (!perms?.can_handle_requests && !perms?.can_approve_decline_bookings) {
        return NextResponse.json(
          { success: false, error: 'Manager lacks permission to reassign bookings' },
          { status: 403 },
        );
      }
    }

    // Appointment must belong to this org.
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, scheduled_date, scheduled_time, duration_minutes')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }

    // Cleaner must exist and belong to this org.
    const { data: cleanerProfile } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('id, organization_id')
      .eq('id', cleanerId)
      .maybeSingle();
    if (!cleanerProfile || cleanerProfile.organization_id !== organizationId) {
      return NextResponse.json(
        { success: false, error: 'Cleaner not in this organization' },
        { status: 400 },
      );
    }

    // Reject a scheduling collision with the target cleaner's other active jobs that day,
    // unless the caller forced past it.
    if (!force) {
      const { data: sameDay } = await supabaseAdmin
        .from('appointments')
        .select('id, status, scheduled_date, scheduled_time, duration_minutes')
        .eq('organization_id', organizationId)
        .eq('cleaner_id', cleanerId)
        .eq('scheduled_date', appt.scheduled_date as string);
      const conflicts = findConflicts(
        (sameDay ?? []) as ScheduleAppointment[],
        {
          date: appt.scheduled_date as string,
          time: appt.scheduled_time as string,
          durationMinutes: (appt.duration_minutes as number) || 60,
        },
        { excludeAppointmentId: appointmentId },
      );
      if (conflicts.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Cleaner has a conflicting appointment at that time', conflict: true },
          { status: 409 },
        );
      }
    }

    const deadline = computeResponseDeadlineISO(
      appt.scheduled_date as string,
      appt.scheduled_time as string,
    );

    // Reassign: new cleaner, back to pending + awaiting acceptance. Payment columns untouched.
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        cleaner_id: cleanerId,
        status: 'pending',
        cleaner_confirmation_status: 'awaiting',
        response_deadline: deadline,
      })
      .eq('id', appointmentId);
    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }

    // Notify the newly-assigned cleaner. Best-effort: a notification hiccup must not fail the
    // reassignment (the reconciliation/outbox is the backstop).
    try {
      const ctx = await loadNotificationContext(supabaseAdmin, { appointmentId });
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_assigned',
        appointment_id: appointmentId,
        organization_id: organizationId,
        recipient_user_id: cleanerId,
        payload: { ...ctx, audience: 'cleaner' },
      });
    } catch (notifyErr) {
      console.error('reassign-cleaner: notification failed (non-fatal):', notifyErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in appointments/reassign-cleaner POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
