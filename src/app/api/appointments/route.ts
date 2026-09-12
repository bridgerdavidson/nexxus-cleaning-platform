import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { parseOperatorBookingBody } from '@/lib/appointments/parseOperatorBooking';
import { selfPayCleanerBlockReason, type CleanerPayoutFields } from '@/lib/payments/isCleanerPayable';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';

export const runtime = 'nodejs';

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/appointments
 *
 * Creates an operator one-off booking (the recurring path is
 * /api/recurring-appointments). Owner or admin, or a manager with
 * can_edit_bookings. Body: { organization_id, appointment, slots } where
 * `appointment` is buildBookingInsert's output (extra fields ignored) and
 * `slots` is the primary time plus up to two alternates.
 *
 * Every referenced row must belong to the org: the property, the customer
 * (a homeowner member, checked before the property/customer ownership match so
 * an invalid customer reports as such), the service, the checklist (on that
 * service), and the cleaner. A company-paid job is refused for a cleaner
 * settlement could not pay, with the same reason text the booking form shows.
 *
 * The row is inserted as pending / awaiting with a server-computed response
 * deadline. Offered slots are recorded only when more than one was given.
 * Returns 201 { success: true, data: { id } }.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parseOperatorBookingBody(await request.json().catch(() => null));
    if (!parsed.ok) return fail(400, parsed.error);
    const { organization_id: orgId, appointment: a, slots } = parsed.value;

    const auth = await requireManagerPermission(request, orgId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
    });
    if (!auth.ok) return auth.response;

    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('id, owner_id, organization_id')
      .eq('id', a.property_id)
      .maybeSingle();
    if (!property) return fail(404, 'Property not found');
    if (property.organization_id !== orgId) return fail(403, 'Property is in a different organization');

    if (a.homeowner_id) {
      const { data: member } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', a.homeowner_id)
        .eq('organization_id', orgId)
        .eq('role', 'homeowner')
        .maybeSingle();
      if (!member) return fail(400, 'Customer is not a homeowner in this organization');
    }

    if ((property.owner_id ?? null) !== a.homeowner_id) {
      return fail(400, 'Property does not belong to the selected customer');
    }

    const { data: service } = await supabaseAdmin
      .from('service_types')
      .select('id, organization_id')
      .eq('id', a.service_type_id)
      .maybeSingle();
    if (!service) return fail(404, 'Service type not found');
    if (service.organization_id !== orgId) return fail(403, 'Service type is in a different organization');

    if (a.checklist_id) {
      const { data: checklist } = await supabaseAdmin
        .from('checklists')
        .select('id, service_type_id')
        .eq('id', a.checklist_id)
        .maybeSingle();
      if (!checklist || checklist.service_type_id !== a.service_type_id) {
        return fail(400, 'Checklist does not match the selected service type');
      }
    }

    if (a.cleaner_id) {
      const { data: cleaner } = await supabaseAdmin
        .from('cleaner_profiles')
        .select(
          'id, organization_id, payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent, flat_rate_cents, payout_configured_at',
        )
        .eq('id', a.cleaner_id)
        .maybeSingle();
      if (!cleaner) return fail(404, 'Cleaner not found');
      if (cleaner.organization_id !== orgId) return fail(403, 'Cleaner is in a different organization');
      if (a.is_self_pay) {
        const reason = selfPayCleanerBlockReason(cleaner as CleanerPayoutFields);
        if (reason) return fail(400, `Cleaner cannot be offered a company-paid job: ${reason}`);
      }
    }

    const { data: created, error: insertError } = await supabaseAdmin
      .from('appointments')
      .insert({
        organization_id: orgId,
        homeowner_id: a.homeowner_id,
        cleaner_id: a.cleaner_id,
        property_id: a.property_id,
        service_type_id: a.service_type_id,
        checklist_id: a.checklist_id,
        scheduled_date: a.scheduled_date,
        scheduled_time: a.scheduled_time,
        duration_minutes: a.duration_minutes,
        total_price: a.total_price,
        price_override_enabled: a.price_override_enabled,
        price_override_total: a.price_override_total,
        special_requests: a.special_requests,
        payment_method_id: a.payment_method_id,
        is_self_pay: a.is_self_pay,
        status: 'pending',
        cleaner_confirmation_status: 'awaiting',
        response_deadline: computeResponseDeadlineISO(a.scheduled_date, a.scheduled_time),
      })
      .select('id')
      .single();
    if (insertError || !created) {
      return fail(500, insertError?.message ?? 'Could not create the booking');
    }

    if (slots.length > 1) {
      const { error: slotsError } = await supabaseAdmin
        .from('appointment_requested_slots')
        .insert(slots.map((s) => ({ appointment_id: created.id, ...s })));
      if (slotsError) console.error('appointment_requested_slots insert failed:', slotsError.message);
    }

    return NextResponse.json({ success: true, data: { id: created.id as string } }, { status: 201 });
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : 'Internal server error');
  }
}
