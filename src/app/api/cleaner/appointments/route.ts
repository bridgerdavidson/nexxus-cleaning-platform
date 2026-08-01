import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export const runtime = 'nodejs';

/**
 * GET /api/cleaner/appointments?organization_id=...
 *
 * The cleaner's own appointment list, shaped server-side and price-free.
 *
 * WHY A ROUTE AND NOT AN RLS READ: the price-seal migration removed the cleaner's SELECT
 * arm on appointments (and payments) because RLS is row-level, so the assigned
 * cleaner could read `total_price` (and `payments.amount`) directly with their
 * own session token, which let a request-mode cleaner compute the auto-approve
 * cap. This route is the price-free replacement, mirroring
 * /api/pay-requests/mine: it selects no price columns at all, and the payment
 * status ride-along carries status only, never an amount. Money the cleaner IS
 * allowed to see comes from the charge-projection route (mode-aware) and
 * GET /api/cleaner/earnings.
 */

type Embed<T> = T | T[] | null;

function firstOf<T>(v: Embed<T> | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

const APPOINTMENT_SELECT = `
  id,
  service_type_id,
  checklist_id,
  scheduled_date,
  scheduled_time,
  status,
  completed_at,
  cancelled_at,
  series_id,
  job_progress,
  photos_skipped,
  special_requests,
  cleaner_confirmation_status,
  response_deadline,
  homeowner_initiated,
  is_self_pay,
  homeowner:user_profiles!homeowner_id(
    first_name,
    last_name,
    email,
    phone
  ),
  property:properties(
    name,
    address,
    city,
    state,
    zip_code
  ),
  service_type:service_types(
    name,
    description,
    duration_minutes
  ),
  checklist:checklists(
    name
  ),
  appointment_requested_slots(
    slot_index,
    scheduled_date,
    scheduled_time
  )
`;

export async function GET(request: NextRequest) {
  try {
    const organizationId = request.nextUrl.searchParams.get('organization_id') ?? undefined;

    // Cleaner-only surface: staff read appointments under their own RLS.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['cleaner'],
    });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('cleaner_id', auth.userId)
      .eq('organization_id', organizationId!)
      .order('scheduled_date', { ascending: true });

    if (error) {
      console.error('cleaner/appointments load failed:', error);
      return NextResponse.json({ error: 'Could not load your jobs' }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];

    // Status only; the amount never leaves the server.
    const appointmentIds = rows.map((a) => a.id as string);
    const paymentStatusMap: Record<string, string> = {};
    if (appointmentIds.length > 0) {
      const { data: payments } = await supabaseAdmin
        .from('payments')
        .select('appointment_id, status')
        .in('appointment_id', appointmentIds);
      for (const p of (payments ?? []) as { appointment_id: string; status: string }[]) {
        paymentStatusMap[p.appointment_id] = p.status;
      }
    }

    const appointments = rows.map((a) => {
      const slots = ((a.appointment_requested_slots ?? []) as Array<{
        slot_index: number;
        scheduled_date: string;
        scheduled_time: string;
      }>)
        .slice()
        .sort((x, y) => x.slot_index - y.slot_index);
      return {
        id: a.id,
        service_type_id: a.service_type_id,
        checklist_id: a.checklist_id,
        scheduled_date: a.scheduled_date,
        scheduled_time: a.scheduled_time,
        status: a.status,
        completed_at: a.completed_at,
        cancelled_at: a.cancelled_at,
        series_id: a.series_id,
        job_progress: a.job_progress,
        photos_skipped: a.photos_skipped,
        special_requests: a.special_requests,
        cleaner_confirmation_status: a.cleaner_confirmation_status,
        response_deadline: a.response_deadline,
        homeowner_initiated: !!a.homeowner_initiated,
        is_self_pay: a.is_self_pay,
        homeowner: firstOf(a.homeowner as Embed<Record<string, unknown>>),
        property: firstOf(a.property as Embed<Record<string, unknown>>),
        service_type: firstOf(a.service_type as Embed<Record<string, unknown>>),
        checklist: firstOf(a.checklist as Embed<Record<string, unknown>>),
        payment_status: paymentStatusMap[a.id as string] ?? null,
        requested_slots: slots,
      };
    });

    return NextResponse.json({ appointments });
  } catch (err) {
    console.error('cleaner/appointments failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
