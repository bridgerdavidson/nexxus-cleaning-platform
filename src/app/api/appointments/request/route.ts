import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

interface OfferedSlot {
  scheduled_date: string;
  scheduled_time: string;
}

interface RequestAppointmentInput {
  organizationId: string;
  propertyId: string;
  serviceTypeId: string;
  checklistId?: string | null;
  slots: OfferedSlot[];
  specialRequests?: string | null;
}

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isHMM(s: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestAppointmentInput;
    const { organizationId, propertyId, serviceTypeId, checklistId, slots, specialRequests } = body;
    if (!organizationId || !propertyId || !serviceTypeId) {
      return NextResponse.json(
        { success: false, error: 'organizationId, propertyId, and serviceTypeId are required' },
        { status: 400 },
      );
    }
    if (!Array.isArray(slots) || slots.length < 1 || slots.length > 3) {
      return NextResponse.json(
        { success: false, error: 'slots must contain 1-3 offered times' },
        { status: 400 },
      );
    }
    for (const s of slots) {
      if (!isYMD(s.scheduled_date) || !isHMM(s.scheduled_time)) {
        return NextResponse.json(
          { success: false, error: 'each slot needs valid scheduled_date (YYYY-MM-DD) and scheduled_time (HH:MM)' },
          { status: 400 },
        );
      }
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['homeowner', 'owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;
    const homeownerId = auth.userId;

    // Property must belong to the homeowner who is requesting.
    const { data: property, error: propertyError } = await supabaseAdmin
      .from('properties')
      .select('id, owner_id, organization_id')
      .eq('id', propertyId)
      .maybeSingle();
    if (propertyError || !property) {
      return NextResponse.json({ success: false, error: 'Property not found' }, { status: 404 });
    }
    if (property.owner_id !== homeownerId) {
      return NextResponse.json(
        { success: false, error: 'Property does not belong to this homeowner' },
        { status: 403 },
      );
    }
    if (property.organization_id && property.organization_id !== organizationId) {
      return NextResponse.json(
        { success: false, error: 'Property is in a different organization' },
        { status: 403 },
      );
    }

    const { data: serviceType, error: serviceErr } = await supabaseAdmin
      .from('service_types')
      .select('id, organization_id, base_price, duration_minutes')
      .eq('id', serviceTypeId)
      .maybeSingle();
    if (serviceErr || !serviceType) {
      return NextResponse.json({ success: false, error: 'Service type not found' }, { status: 404 });
    }
    if (serviceType.organization_id !== organizationId) {
      return NextResponse.json(
        { success: false, error: 'Service type is in a different organization' },
        { status: 403 },
      );
    }

    if (checklistId) {
      const { data: checklist } = await supabaseAdmin
        .from('checklists')
        .select('id, service_type_id')
        .eq('id', checklistId)
        .maybeSingle();
      if (!checklist || checklist.service_type_id !== serviceTypeId) {
        return NextResponse.json(
          { success: false, error: 'Checklist does not match the selected service type' },
          { status: 400 },
        );
      }
    }

    // Insert the appointment row with the primary slot as the placeholder
    // scheduled_date/time (NOT NULL columns). The accept path overwrites these
    // with the cleaner's chosen slot.
    const primary = slots[0];
    const { data: appointment, error: insertErr } = await supabaseAdmin
      .from('appointments')
      .insert({
        organization_id: organizationId,
        homeowner_id: homeownerId,
        cleaner_id: null,
        property_id: propertyId,
        service_type_id: serviceTypeId,
        checklist_id: checklistId ?? null,
        scheduled_date: primary.scheduled_date,
        scheduled_time: primary.scheduled_time,
        duration_minutes: serviceType.duration_minutes,
        total_price: serviceType.base_price,
        special_requests: specialRequests ?? null,
        status: 'pending',
        cleaner_confirmation_status: 'awaiting',
        homeowner_initiated: true,
        flow_type: 'homeowner_request',
        request_state: 'awaiting_admin',
      })
      .select('id')
      .single();
    if (insertErr || !appointment) {
      console.error('Error creating appointment request:', insertErr);
      return NextResponse.json(
        { success: false, error: insertErr?.message ?? 'Failed to create appointment request' },
        { status: 500 },
      );
    }

    const slotRows = slots.map((s, idx) => ({
      appointment_id: appointment.id,
      slot_index: idx,
      scheduled_date: s.scheduled_date,
      scheduled_time: s.scheduled_time,
    }));
    const { error: slotsErr } = await supabaseAdmin
      .from('appointment_requested_slots')
      .insert(slotRows);
    if (slotsErr) {
      // Clean up the parent row so we don't leak an empty request.
      await supabaseAdmin.from('appointments').delete().eq('id', appointment.id);
      return NextResponse.json(
        { success: false, error: slotsErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, appointmentId: appointment.id });
  } catch (error) {
    console.error('Error in appointments/request POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
