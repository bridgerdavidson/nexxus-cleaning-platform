import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';

/**
 * Edit-details save for the redesign booking sheet (spec: docs/superpowers/specs/
 * 2026-07-09-reschedule-edit-booking-design.md). Never touches schedule, cleaner,
 * or confirmation state. Recompute is CHANGE-DRIVEN: total_price/duration_minutes
 * are rewritten only when service/checklist/override actually differ from the
 * stored row, so a notes-only save can never silently reprice a booking.
 */
interface DetailsBody {
  organizationId: string;
  serviceTypeId: string;
  checklistId: string | null;
  priceOverrideEnabled: boolean;
  priceOverrideTotal: number | null;
  specialRequests: string | null;
  notes: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = (await request.json()) as DetailsBody;
    const { organizationId, serviceTypeId, checklistId } = body;
    if (!organizationId || !serviceTypeId) {
      return NextResponse.json(
        { success: false, error: 'organizationId and serviceTypeId are required' },
        { status: 400 },
      );
    }
    if (body.priceOverrideEnabled && !(Number.isFinite(body.priceOverrideTotal) && (body.priceOverrideTotal as number) >= 0)) {
      return NextResponse.json(
        { success: false, error: 'priceOverrideTotal must be a number >= 0 when the override is enabled' },
        { status: 400 },
      );
    }

    const auth = await requireManagerPermission(request, organizationId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
    });
    if (!auth.ok) return auth.response;

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, status, service_type_id, checklist_id, price_override_enabled, price_override_total, total_price')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking can no longer be edited' },
        { status: 409 },
      );
    }

    const { data: service } = await supabaseAdmin
      .from('service_types')
      .select('id, organization_id, base_price, duration_minutes')
      .eq('id', serviceTypeId)
      .maybeSingle();
    if (!service || service.organization_id !== organizationId) {
      return NextResponse.json({ success: false, error: 'Service not in this organization' }, { status: 400 });
    }

    // checklists have NO organization_id column; org scoping is transitive via
    // the service, and the service-match check also blocks cross-service adder
    // corruption (mirrors /api/appointments/request).
    let checklistAdder = 0;
    if (checklistId) {
      const { data: checklist } = await supabaseAdmin
        .from('checklists')
        .select('id, service_type_id, price_adder')
        .eq('id', checklistId)
        .maybeSingle();
      if (!checklist || checklist.service_type_id !== serviceTypeId) {
        return NextResponse.json(
          { success: false, error: 'Checklist does not match the selected service type' },
          { status: 400 },
        );
      }
      checklistAdder = Number(checklist.price_adder) || 0;
    }

    const serviceChanged = serviceTypeId !== appt.service_type_id;
    const checklistChanged = (checklistId ?? null) !== ((appt.checklist_id as string | null) ?? null);
    const storedOverrideEnabled = !!appt.price_override_enabled;
    const storedOverrideTotal = appt.price_override_total == null ? null : Number(appt.price_override_total);
    const overrideChanged =
      body.priceOverrideEnabled !== storedOverrideEnabled ||
      (body.priceOverrideEnabled && Number(body.priceOverrideTotal) !== storedOverrideTotal);
    const priceAffecting = serviceChanged || checklistChanged || overrideChanged;

    if (priceAffecting) {
      // Reconcile-parity predicate: a collected or in-flight revenue charge locks
      // the money fields. NULL charge_kind must block (legacy Stripe charges and
      // manual recorded payments carry no charge_kind); only cancellation_fee
      // rows are exempt.
      const { data: paidRows } = await supabaseAdmin
        .from('payments')
        .select('id, status, payment_type, charge_kind')
        .eq('appointment_id', appointmentId)
        .eq('payment_type', 'revenue')
        .in('status', ['paid', 'processing']);
      const blocking = ((paidRows ?? []) as Array<{ charge_kind: string | null }>).filter(
        (p) => p.charge_kind !== 'cancellation_fee',
      );
      if (blocking.length > 0) {
        return NextResponse.json(
          { success: false, paidGuard: true, error: 'A payment already exists for this booking, so its price cannot change' },
          { status: 409 },
        );
      }
    }

    const update: Record<string, unknown> = {
      special_requests: body.specialRequests?.trim() ? body.specialRequests.trim() : null,
      notes: body.notes?.trim() ? body.notes.trim() : null,
      updated_at: new Date().toISOString(),
    };
    if (priceAffecting) {
      update.service_type_id = serviceTypeId;
      update.checklist_id = checklistId ?? null;
      update.price_override_enabled = body.priceOverrideEnabled;
      update.price_override_total = body.priceOverrideEnabled ? body.priceOverrideTotal : null;
      update.total_price = body.priceOverrideEnabled
        ? body.priceOverrideTotal
        : Number(service.base_price) + checklistAdder;
      if (serviceChanged) update.duration_minutes = service.duration_minutes;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('appointments')
      .update(update)
      .eq('id', appointmentId)
      .in('status', ['pending', 'confirmed'])
      .select('id');
    if (updErr) return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking changed. Refresh and try again.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in appointments/[appointmentId]/details PATCH:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
