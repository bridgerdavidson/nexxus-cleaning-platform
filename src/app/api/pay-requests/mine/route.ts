import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export const runtime = 'nodejs';

/**
 * GET /api/pay-requests/mine?organization_id=...&appointment_id=...
 *
 * The request-mode cleaner's own pay-request threads, shaped server-side.
 *
 * WHY A ROUTE AND NOT AN RLS READ: migration 119 removed the cleaner's SELECT
 * arm from pay_requests precisely because the row carries
 * `job_price_cents_snapshot`, the number a request-mode cleaner must never see.
 * This route is the price-free replacement: it selects the price column only to
 * compute nothing with it, and never puts it (or anything derived from it) in
 * the response. Mirrors the payout_only charge-projection pattern.
 *
 * `appointment_id` is optional. When present, the response also carries an
 * `anchor`: what this cleaner was last approved for at the SAME property, or
 * failing that their most recent approved amount anywhere in the org. Since the
 * job price is hidden from them, their own history is the only reference point
 * they have when naming a number.
 *
 * Returns: { threads: CleanerPayRequestThread[], anchor: PayAnchor | null }
 */

type OfferRow = {
  id: string;
  actor: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
};

type ApptJoin = {
  scheduled_date?: string;
  property_id?: string;
  service_type?: { name?: string } | { name?: string }[] | null;
  property?: { name?: string; address?: string } | { name?: string; address?: string }[] | null;
} | null;

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const organizationId = searchParams.get('organization_id') ?? undefined;
    const appointmentId = searchParams.get('appointment_id');

    // Cleaner-only surface: org staff have the full queue on the Payments screen.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['cleaner'],
    });
    if (!auth.ok) return auth.response;

    const { data: rows, error } = await supabaseAdmin
      .from('pay_requests')
      .select(
        `id, status, appointment_id, current_offer_cents, updated_at,
         appointment:appointments!appointment_id(
           scheduled_date, property_id,
           service_type:service_types(name),
           property:properties(name, address)
         ),
         offers:pay_request_offers(id, actor, amount_cents, note, created_at)`,
      )
      .eq('organization_id', organizationId!)
      .eq('cleaner_id', auth.userId)
      .in('status', ['pending_org', 'pending_cleaner'])
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('pay-requests/mine load failed:', error);
      return NextResponse.json({ error: 'Could not load your pay requests' }, { status: 500 });
    }

    const threads = ((rows as unknown as Record<string, unknown>[]) ?? [])
      .map((r) => {
        const appt = firstOf(r.appointment as ApptJoin | ApptJoin[]);
        const property = firstOf(appt?.property);
        const offers = [...((r.offers as OfferRow[] | null) ?? [])].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        return {
          id: r.id as string,
          appointmentId: r.appointment_id as string,
          status: r.status as 'pending_org' | 'pending_cleaner',
          // The live amount on the table. Never the job price.
          currentOfferCents: r.current_offer_cents == null ? null : Number(r.current_offer_cents),
          jobLabel: firstOf(appt?.service_type)?.name ?? 'Cleaning',
          propertyLabel: property?.name ?? property?.address ?? null,
          scheduledDate: appt?.scheduled_date ?? null,
          updatedAt: r.updated_at as string,
          offers: offers.map((o) => ({
            id: o.id,
            actor: o.actor === 'org' ? ('org' as const) : ('cleaner' as const),
            amountCents: Number(o.amount_cents),
            note: o.note,
            createdAt: o.created_at,
          })),
        };
      })
      // A thread whose live amount never landed is malformed; omitting it keeps
      // the cleaner's view consistent with what the respond route would act on.
      .filter((t) => t.currentOfferCents != null);

    // Anchor: the cleaner's own approved history, property-first.
    let anchor: { amountCents: number; samePlace: boolean } | null = null;
    if (appointmentId) {
      const { data: apptRow } = await supabaseAdmin
        .from('appointments')
        .select('property_id, organization_id, cleaner_id')
        .eq('id', appointmentId)
        .maybeSingle();
      const appt = apptRow as {
        property_id: string | null;
        organization_id: string;
        cleaner_id: string | null;
      } | null;

      // Only anchor off a job that is actually theirs, in this org.
      if (appt && appt.organization_id === organizationId && appt.cleaner_id === auth.userId) {
        const { data: history } = await supabaseAdmin
          .from('pay_requests')
          .select('approved_amount_cents, approved_at, appointment:appointments!appointment_id(property_id)')
          .eq('organization_id', organizationId!)
          .eq('cleaner_id', auth.userId)
          .eq('status', 'approved')
          .not('approved_amount_cents', 'is', null)
          .order('approved_at', { ascending: false })
          .limit(25);

        const rowsH = ((history as unknown as Record<string, unknown>[]) ?? []).map((h) => ({
          amountCents: Number(h.approved_amount_cents),
          propertyId:
            firstOf(h.appointment as { property_id?: string } | { property_id?: string }[])
              ?.property_id ?? null,
        }));
        const samePlace = appt.property_id
          ? rowsH.find((h) => h.propertyId === appt.property_id)
          : undefined;
        const latest = rowsH[0];
        if (samePlace) anchor = { amountCents: samePlace.amountCents, samePlace: true };
        else if (latest) anchor = { amountCents: latest.amountCents, samePlace: false };
      }
    }

    return NextResponse.json({ threads, anchor });
  } catch (err) {
    console.error('pay-requests/mine failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
