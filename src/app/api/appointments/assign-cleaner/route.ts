import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth, type OrgRole } from '@/lib/auth/requireOrgAuth';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

interface AssignCleanerInput {
  appointmentId: string;
  cleanerId: string;
  organizationId: string;
  /** Force-accept on the cleaner's behalf (used by the "all cleaners declined"
   *  recovery surface). Skips the cleaner-confirmation handshake and marks
   *  the appointment as confirmed immediately. */
  forceAssign?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { appointmentId, cleanerId, organizationId, forceAssign } =
      (await request.json()) as AssignCleanerInput;
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

    // Managers need can_handle_requests or can_approve_decline_bookings.
    if (auth.role === ('manager' satisfies OrgRole)) {
      const { data: perms } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_handle_requests, can_approve_decline_bookings')
        .eq('manager_id', auth.userId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (!perms?.can_handle_requests && !perms?.can_approve_decline_bookings) {
        return NextResponse.json(
          { success: false, error: 'Manager lacks permission to handle booking requests' },
          { status: 403 },
        );
      }
    }

    // Appointment must be in this org and in a routable state. Both
    // homeowner-initiated and admin-direct appointments can land here:
    // admin-direct ends up needing reassignment when its cleaner declines
    // and the auto-defer chain exhausts.
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_initiated, request_state')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    if (!['awaiting_admin', 'needs_admin_attention', 'routing'].includes(appt.request_state ?? '')) {
      return NextResponse.json(
        { success: false, error: 'Request is not in an assignable state' },
        { status: 400 },
      );
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

    // Reject double-assign: a pending routing_log row blocks new attempts.
    const { data: existingLog } = await supabaseAdmin
      .from('appointment_routing_log')
      .select('id, attempt_index, response')
      .eq('appointment_id', appointmentId)
      .order('attempt_index', { ascending: true });
    if ((existingLog ?? []).some((r) => r.response === 'pending')) {
      return NextResponse.json(
        { success: false, error: 'A cleaner is already pending response on this request' },
        { status: 409 },
      );
    }

    const nextAttempt = ((existingLog ?? []).at(-1)?.attempt_index ?? 0) + 1;
    // After the auto-defer chain exhausts (3 attempts), `request_state` flips
    // to `needs_admin_attention` and admins use this same endpoint to force-
    // assign past the cap. Without this exemption the force-assign path is
    // permanently blocked once 3 routing-log rows exist.
    if (nextAttempt > 3 && appt.request_state !== 'needs_admin_attention') {
      return NextResponse.json(
        { success: false, error: 'Chain limit reached; force-assign required' },
        { status: 409 },
      );
    }

    // Primary slot drives the SLA deadline. Homeowner-initiated + admin-direct-
    // with-alts have rows in appointment_requested_slots; admin-direct without
    // alternates falls back to the appointment's single scheduled slot.
    const { data: primarySlot } = await supabaseAdmin
      .from('appointment_requested_slots')
      .select('scheduled_date, scheduled_time')
      .eq('appointment_id', appointmentId)
      .eq('slot_index', 0)
      .maybeSingle();
    let primaryDate: string;
    let primaryTime: string;
    if (primarySlot) {
      primaryDate = primarySlot.scheduled_date as string;
      primaryTime = primarySlot.scheduled_time as string;
    } else {
      const { data: apptSlot } = await supabaseAdmin
        .from('appointments')
        .select('scheduled_date, scheduled_time')
        .eq('id', appointmentId)
        .maybeSingle();
      if (!apptSlot) {
        return NextResponse.json(
          { success: false, error: 'Request has no primary slot' },
          { status: 400 },
        );
      }
      primaryDate = (apptSlot as { scheduled_date: string }).scheduled_date;
      primaryTime = (apptSlot as { scheduled_time: string }).scheduled_time;
    }
    const deadline = computeResponseDeadlineISO(primaryDate, primaryTime);

    // Force-assign records the routing log row as already-accepted (admin
    // accepted on the cleaner's behalf). Normal assign leaves it pending so
    // the cleaner can respond.
    const nowIso = new Date().toISOString();
    const { error: insertErr } = await supabaseAdmin
      .from('appointment_routing_log')
      .insert({
        appointment_id: appointmentId,
        cleaner_id: cleanerId,
        attempt_index: nextAttempt,
        deadline_at: deadline,
        ...(forceAssign
          ? { response: 'accepted', responded_at: nowIso }
          : {}),
      });
    if (insertErr) {
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    const apptUpdate: Record<string, unknown> = forceAssign
      ? {
          cleaner_id: cleanerId,
          cleaner_confirmation_status: 'approved',
          status: 'confirmed',
          response_deadline: null,
          request_state: 'completed',
        }
      : {
          cleaner_id: cleanerId,
          cleaner_confirmation_status: 'awaiting',
          response_deadline: deadline,
          request_state: 'routing',
        };
    await supabaseAdmin.from('appointments').update(apptUpdate).eq('id', appointmentId);

    // Enrich with property + date/time so the cleaner's notification says which
    // job ("New job at 123 Oak St, 06/06/26 at 2:00 PM").
    const assignCtx = await loadNotificationContext(supabaseAdmin, { appointmentId });
    await recordNotificationEvent(supabaseAdmin, {
      event_type: forceAssign ? 'cleaner_force_assigned' : 'cleaner_assigned',
      appointment_id: appointmentId,
      organization_id: organizationId,
      recipient_user_id: cleanerId,
      payload: { ...assignCtx, audience: 'cleaner', attempt_index: nextAttempt },
    });

    return NextResponse.json({ success: true, attemptIndex: nextAttempt, forceAssigned: !!forceAssign });
  } catch (error) {
    console.error('Error in appointments/assign-cleaner POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
