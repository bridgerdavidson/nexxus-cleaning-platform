import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import {
  EMPTY_MEMBER_COUNTS,
  type PlatformOrgDetail,
  type PlatformOrgMember,
  type PlatformOrgMemberCounts,
} from '@/types/platform';

const ROLE_KEYS: (keyof PlatformOrgMemberCounts)[] = [
  'owner',
  'admin',
  'manager',
  'cleaner',
  'homeowner',
];

/**
 * GET /api/platform/organizations/:id
 *
 * Platform-owner tenant drill-in: the org's billing + Connect config, its member
 * roster (with profile email/name), and a high-level appointment count. Service
 * role behind requirePlatformAdmin.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, billing_email, subscription_status, subscription_id, subscription_current_period_end, platform_fee_bps, default_payout_model, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due, created_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (orgError) {
    return NextResponse.json(
      { error: 'Failed to load organization', details: orgError.message },
      { status: 500 },
    );
  }
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const { data: memberRows, error: membersError } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', id);

  if (membersError) {
    return NextResponse.json(
      { error: 'Failed to load members', details: membersError.message },
      { status: 500 },
    );
  }

  const rows = (memberRows ?? []) as { user_id: string; role: string }[];
  const userIds = rows.map((m) => m.user_id);

  const profilesById = new Map<
    string,
    { email: string | null; first_name: string | null; last_name: string | null }
  >();
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, first_name, last_name')
      .in('id', userIds);
    for (const p of (profiles ?? []) as {
      id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }[]) {
      profilesById.set(p.id, { email: p.email, first_name: p.first_name, last_name: p.last_name });
    }
  }

  const counts: PlatformOrgMemberCounts = { ...EMPTY_MEMBER_COUNTS };
  const members: PlatformOrgMember[] = rows.map((m) => {
    if ((ROLE_KEYS as string[]).includes(m.role)) {
      counts[m.role as keyof PlatformOrgMemberCounts] += 1;
    }
    counts.total += 1;
    const profile = profilesById.get(m.user_id);
    return {
      user_id: m.user_id,
      role: m.role,
      email: profile?.email ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
    };
  });

  const { count: appointmentCount } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', id);

  const orgRow = org as Record<string, unknown>;
  const detail: PlatformOrgDetail = {
    id: orgRow.id as string,
    name: orgRow.name as string,
    billing_email: (orgRow.billing_email as string | null) ?? null,
    subscription_status: (orgRow.subscription_status as string) ?? 'none',
    subscription_id: (orgRow.subscription_id as string | null) ?? null,
    subscription_current_period_end:
      (orgRow.subscription_current_period_end as string | null) ?? null,
    platform_fee_bps: (orgRow.platform_fee_bps as number) ?? 0,
    default_payout_model: (orgRow.default_payout_model as string) ?? 'percentage_contractor',
    stripe_connect_account_id: (orgRow.stripe_connect_account_id as string | null) ?? null,
    stripe_connect_charges_enabled: !!orgRow.stripe_connect_charges_enabled,
    stripe_connect_payouts_enabled: !!orgRow.stripe_connect_payouts_enabled,
    stripe_connect_details_submitted: !!orgRow.stripe_connect_details_submitted,
    stripe_connect_requirements_due: (orgRow.stripe_connect_requirements_due as string[]) ?? [],
    created_at: orgRow.created_at as string,
    member_counts: counts,
    members,
    counts: { appointments: appointmentCount ?? 0 },
  };

  return NextResponse.json({ organization: detail });
}
