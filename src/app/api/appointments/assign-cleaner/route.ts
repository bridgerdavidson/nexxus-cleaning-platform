import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth, type OrgRole } from '@/lib/auth/requireOrgAuth';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';

interface AssignCleanerInput {
  appointmentId: string;
  cleanerId: string;
  organizationId: string;
}

export async function POST(request: NextRequest) {
  try {
    const { appointmentId, cleanerId, organizationId } = (await request.json()) as AssignCleanerInput;
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

    // Appointment must be in this org and in a routable state.
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_initiated, request_state')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    if (!appt.homeowner_initiated) {
      return NextResponse.json(
        { success: false, error: 'assign-cleaner is only for homeowner-initiated requests' },
        { status: 400 },
      );
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
    if (nextAttempt > 3) {
      return NextResponse.json(
        { success: false, error: 'Chain limit reached; force-assign required' },
        { status: 409 },
      );
    }

    // Primary slot drives the SLA deadline.
    const { data: primarySlot } = await supabaseAdmin
      .from('appointment_requested_slots')
      .select('scheduled_date, scheduled_time')
      .eq('appointment_id', appointmentId)
      .eq('slot_index', 0)
      .maybeSingle();
    if (!primarySlot) {
      return NextResponse.json(
        { success: false, error: 'Request has no primary slot' },
        { status: 400 },
      );
    }
    const deadline = computeResponseDeadlineISO(
      primarySlot.scheduled_date as string,
      primarySlot.scheduled_time as string,
    );

    const { error: insertErr } = await supabaseAdmin
      .from('appointment_routing_log')
      .insert({
        appointment_id: appointmentId,
        cleaner_id: cleanerId,
        attempt_index: nextAttempt,
        deadline_at: deadline,
      });
    if (insertErr) {
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('appointments')
      .update({
        cleaner_id: cleanerId,
        cleaner_confirmation_status: 'awaiting',
        response_deadline: deadline,
        request_state: 'routing',
      })
      .eq('id', appointmentId);

    return NextResponse.json({ success: true, attemptIndex: nextAttempt });
  } catch (error) {
    console.error('Error in appointments/assign-cleaner POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
