import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import {
  EMPTY_MEMBER_COUNTS,
  type PlatformOrgMemberCounts,
  type PlatformOrgSummary,
} from '@/types/platform';

const ROLE_KEYS: (keyof PlatformOrgMemberCounts)[] = [
  'owner',
  'admin',
  'manager',
  'cleaner',
  'homeowner',
];

/**
 * GET /api/platform/organizations
 *
 * Platform-owner oversight: every tenant org with member counts. Reads via the
 * service role (the platform admin isn't a member of these orgs, so client RLS
 * can't serve it) behind requirePlatformAdmin. Two queries + JS aggregation —
 * no per-org member query (avoids N+1).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { data: orgs, error: orgsError } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, billing_email, subscription_status, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, created_at',
    )
    .order('created_at', { ascending: false });

  if (orgsError) {
    return NextResponse.json(
      { error: 'Failed to load organizations', details: orgsError.message },
      { status: 500 },
    );
  }

  const { data: members, error: membersError } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role');

  if (membersError) {
    return NextResponse.json(
      { error: 'Failed to load members', details: membersError.message },
      { status: 500 },
    );
  }

  const countsByOrg = new Map<string, PlatformOrgMemberCounts>();
  for (const m of (members ?? []) as { organization_id: string; role: string }[]) {
    const c = countsByOrg.get(m.organization_id) ?? { ...EMPTY_MEMBER_COUNTS };
    if ((ROLE_KEYS as string[]).includes(m.role)) {
      c[m.role as keyof PlatformOrgMemberCounts] += 1;
    }
    c.total += 1;
    countsByOrg.set(m.organization_id, c);
  }

  const organizations: PlatformOrgSummary[] = (
    (orgs ?? []) as Omit<PlatformOrgSummary, 'member_counts'>[]
  ).map((o) => ({
    ...o,
    member_counts: countsByOrg.get(o.id) ?? { ...EMPTY_MEMBER_COUNTS },
  }));

  return NextResponse.json({ organizations });
}
