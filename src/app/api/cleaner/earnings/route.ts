import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { resolveCleanerShareCents } from '@/lib/payments/payMode';

export const runtime = 'nodejs';

/**
 * GET /api/cleaner/earnings?organization_id=...
 *
 * The cleaner's in-flight money, shaped server-side and price-free:
 * - awaiting: customer payments still clearing ("Hop 1"), with the CLEANER'S
 *   cut computed here per their pay mode. Before migration 122 the client read
 *   `payments.amount` (the full customer charge) and multiplied by
 *   payout_percent itself; that both leaked the sealed job price to
 *   request-mode cleaners and showed flat/request cleaners a percent-derived
 *   number that is not their pay. The share math mirrors settlement
 *   (resolveCleanerShareCents), so what is promised here is what settlement
 *   will move.
 * - held: the cleaner's own payout rows not yet in their bank ("Hop 2").
 *   payouts.amount is already the cleaner's cut, safe to return as-is; only
 *   the appointment labels need the service role now.
 *
 * The customer charge amount never appears in the response.
 */

type Embed<T> = T | T[] | null;

function firstOf<T>(v: Embed<T> | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

type ApptEmbed = {
  id?: string;
  scheduled_date?: string;
  cleaner_id?: string;
  homeowner?: Embed<{ first_name?: string; last_name?: string }>;
  service_type?: Embed<{ name?: string }>;
} | null;

function apptLabel(appt: ApptEmbed, isSelfPay: boolean) {
  if (!appt?.id) return null;
  const ho = firstOf(appt.homeowner);
  const svc = firstOf(appt.service_type);
  return {
    id: appt.id,
    scheduledDate: appt.scheduled_date ?? null,
    homeownerName: isSelfPay
      ? 'Company-paid'
      : ho
        ? `${ho.first_name ?? ''} ${ho.last_name ?? ''}`.trim() || 'Customer'
        : 'Customer',
    serviceName: svc?.name ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const organizationId = request.nextUrl.searchParams.get('organization_id') ?? undefined;

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['cleaner'],
    });
    if (!auth.ok) return auth.response;

    const { data: profile } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('payout_percent, payout_model, flat_rate_cents')
      .eq('id', auth.userId)
      .eq('organization_id', organizationId!)
      .maybeSingle();
    const rawModel = (profile as { payout_model?: string | null } | null)?.payout_model ?? 'percentage';
    const payoutModel = rawModel === 'percentage_contractor' ? 'percentage' : rawModel;
    const payoutPercent = Number(
      (profile as { payout_percent?: number | string | null } | null)?.payout_percent ?? 0,
    );
    const flatRateCents = (profile as { flat_rate_cents?: number | null } | null)?.flat_rate_cents ?? null;

    // ── Hop 1: customer payments still clearing ─────────────────────────────
    const { data: processing, error: processingError } = await supabaseAdmin
      .from('payments')
      .select(
        `id, amount, processing_fee_cents, payment_method, is_self_pay, created_at, appointment_id,
         appointment:appointments!inner(
           id, scheduled_date, cleaner_id,
           homeowner:user_profiles!homeowner_id(first_name, last_name),
           service_type:service_types(name)
         )`,
      )
      .eq('organization_id', organizationId!)
      .eq('status', 'processing')
      .eq('payment_type', 'revenue')
      .eq('appointment.cleaner_id', auth.userId)
      .order('created_at', { ascending: false });
    if (processingError) {
      console.error('cleaner/earnings awaiting load failed:', processingError);
      return NextResponse.json({ error: 'Could not load your earnings' }, { status: 500 });
    }

    const processingRows = (processing ?? []) as unknown as Record<string, unknown>[];

    // A request-mode cleaner's cut exists only once a thread is approved.
    const approvedByAppt = new Map<string, number>();
    if (payoutModel === 'request' && processingRows.length > 0) {
      const apptIds = processingRows.map((p) => p.appointment_id as string).filter(Boolean);
      const { data: threads } = await supabaseAdmin
        .from('pay_requests')
        .select('appointment_id, approved_amount_cents')
        .eq('organization_id', organizationId!)
        .eq('cleaner_id', auth.userId)
        .eq('status', 'approved')
        .in('appointment_id', apptIds);
      for (const t of (threads ?? []) as { appointment_id: string; approved_amount_cents: number | null }[]) {
        if (t.approved_amount_cents != null) approvedByAppt.set(t.appointment_id, Number(t.approved_amount_cents));
      }
    }

    const awaiting = processingRows
      .map((p) => {
        const appt = firstOf(p.appointment as Embed<ApptEmbed>);
        const isSelfPay = Boolean(p.is_self_pay);
        const chargeCents = Math.round(Number(p.amount) * 100);
        const feeCents = Number(p.processing_fee_cents ?? 0);
        const baseCents = Math.max(0, chargeCents - feeCents);

        let cleanerCutCents: number | null;
        if (isSelfPay) {
          // Self-pay: the charge IS the cleaner's cut grossed up for the fee.
          cleanerCutCents = baseCents;
        } else if (payoutModel === 'request') {
          const approved = approvedByAppt.get(p.appointment_id as string);
          // Nothing agreed yet: promise no number. The negotiation itself is
          // visible in the pay-request threads on the same screen.
          cleanerCutCents = approved == null ? null : Math.min(approved, baseCents);
        } else if (payoutModel === 'hourly_external') {
          // Paid outside the app; no platform money is coming.
          cleanerCutCents = null;
        } else {
          cleanerCutCents = resolveCleanerShareCents({
            payoutModel,
            payoutPercent,
            flatRateCents,
            approvedRequestCents: null,
            grossCents: baseCents,
          }).cents;
        }
        if (cleanerCutCents == null) return null;

        return {
          id: p.id as string,
          cleanerCut: cleanerCutCents / 100,
          createdAt: p.created_at as string,
          paymentMethod: (p.payment_method as string | null) ?? null,
          appointment: apptLabel(appt, isSelfPay),
        };
      })
      .filter(Boolean);

    // ── Hop 2: the cleaner's own held / failed payout rows ──────────────────
    const { data: held, error: heldError } = await supabaseAdmin
      .from('payouts')
      .select(
        `id, amount, status, is_self_pay, created_at,
         appointment:appointments(
           id, scheduled_date,
           homeowner:user_profiles!homeowner_id(first_name, last_name),
           service_type:service_types(name)
         )`,
      )
      .eq('cleaner_id', auth.userId)
      .eq('organization_id', organizationId!)
      .in('status', ['pending', 'approved', 'failed'])
      .order('created_at', { ascending: false });
    if (heldError) {
      console.error('cleaner/earnings held load failed:', heldError);
      return NextResponse.json({ error: 'Could not load your earnings' }, { status: 500 });
    }

    const heldRows = ((held ?? []) as unknown as Record<string, unknown>[]).map((p) => {
      const appt = firstOf(p.appointment as Embed<ApptEmbed>);
      const isSelfPay = Boolean(p.is_self_pay);
      return {
        id: p.id as string,
        amount: Number(p.amount ?? 0),
        status: p.status as 'pending' | 'approved' | 'failed',
        createdAt: p.created_at as string,
        appointment: apptLabel(appt, isSelfPay),
      };
    });

    return NextResponse.json({ awaiting, held: heldRows });
  } catch (err) {
    console.error('cleaner/earnings failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
