import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

interface CancelInput {
  appointmentId: string;
  organizationId: string;
}

const ALLOWED_STATES = new Set(['awaiting_admin', 'routing', 'needs_admin_attention']);

export async function POST(request: NextRequest) {
  try {
    const { appointmentId, organizationId } = (await request.json()) as CancelInput;
    if (!appointmentId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'appointmentId and organizationId are required' },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['homeowner', 'owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    const { data: appointment, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_id, status, request_state, homeowner_initiated')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appointment) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    if (!appointment.homeowner_initiated) {
      return NextResponse.json(
        { success: false, error: 'Only homeowner-initiated requests can be cancelled here' },
        { status: 400 },
      );
    }
    // Homeowners can only cancel their own; admins/managers can cancel any
    // homeowner-initiated request in their org.
    if (auth.role === 'homeowner' && appointment.homeowner_id !== auth.userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (!ALLOWED_STATES.has(appointment.request_state ?? '')) {
      return NextResponse.json(
        { success: false, error: 'Request cannot be cancelled in its current state' },
        { status: 400 },
      );
    }
    if (appointment.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'Only pending requests can be cancelled' },
        { status: 400 },
      );
    }

    const { error: updateErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        cleaner_confirmation_status: 'rejected',
        response_deadline: null,
      })
      .eq('id', appointmentId);
    if (updateErr) {
      return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in appointments/request/cancel POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
