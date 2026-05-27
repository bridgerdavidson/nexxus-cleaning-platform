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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * POST /api/platform/organizations
 *
 * Provision a new tenant: create the org (trialing) + send an OWNER-role invite
 * to the founder. Platform-admin only. We replicate the proven send-invite body
 * inline rather than calling that route — send-invite re-auths as an org member
 * and intentionally rejects the 'owner' role. accept-invite already attaches the
 * owner membership to this pre-existing org with no change.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    billing_email?: string;
    owner_email?: string;
  };

  const name = body.name?.trim();
  const ownerEmail = body.owner_email?.trim().toLowerCase();
  const billingEmail = body.billing_email?.trim().toLowerCase() || ownerEmail || null;

  if (!name) {
    return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
  }
  if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
    return NextResponse.json({ error: 'A valid owner email is required' }, { status: 400 });
  }

  // Ensure the platform admin has a user_profiles row. Both organizations.created_by
  // and invites.invited_by are FKs to user_profiles(id) (not auth.users); a platform
  // admin seeded only into platform_admins (no profile, e.g. an env without the
  // auth->profile trigger) would otherwise hit an FK error here. Insert-if-missing
  // so an existing profile (name/role) is never clobbered.
  await supabaseAdmin.from('user_profiles').upsert(
    { id: auth.userId, email: auth.email ?? `platform-admin-${auth.userId}@nexxus.local` },
    { onConflict: 'id', ignoreDuplicates: true },
  );

  // 1. Create the org, trialing (no card, no enforcement yet).
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({
      name,
      billing_email: billingEmail,
      subscription_status: 'trialing',
      created_by: auth.userId,
    })
    .select(
      'id, name, billing_email, subscription_status, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, created_at',
    )
    .single();

  if (orgError || !org) {
    return NextResponse.json(
      { error: 'Failed to create organization', details: orgError?.message },
      { status: 500 },
    );
  }
  const organizationId = (org as { id: string }).id;

  // 2. Insert the owner invite as 'creating' (locks the slot before the email send).
  const { data: invite, error: inviteInsertError } = await supabaseAdmin
    .from('invites')
    .insert({
      organization_id: organizationId,
      email: ownerEmail,
      role: 'owner',
      status: 'creating',
      accepted_at: null,
      invited_by: auth.userId,
    })
    .select()
    .single();

  if (inviteInsertError || !invite) {
    return NextResponse.json(
      { error: 'Organization created but invite failed', details: inviteInsertError?.message },
      { status: 500 },
    );
  }
  const inviteId = (invite as { id: string }).id;

  // 3. Send the Supabase invite email. redirectTo MUST use APP_URL (same as
  //    send-invite) so the founder lands on /accept-invite for this invite.
  const { error: sendError } = await supabaseAdmin.auth.admin.inviteUserByEmail(ownerEmail, {
    redirectTo: `${process.env.APP_URL}/accept-invite?invite_id=${inviteId}`,
  });

  if (sendError) {
    await supabaseAdmin.from('invites').update({ status: 'failed' }).eq('id', inviteId);
    return NextResponse.json(
      { error: 'Organization created but invite email failed', details: sendError.message },
      { status: 500 },
    );
  }

  // 4. Promote to 'pending'.
  await supabaseAdmin
    .from('invites')
    .update({ status: 'pending', sent_at: new Date().toISOString() })
    .eq('id', inviteId);

  return NextResponse.json(
    {
      success: true,
      organization: { ...(org as object), member_counts: { ...EMPTY_MEMBER_COUNTS } },
      invite: { ...(invite as object), status: 'pending' },
    },
    { status: 201 },
  );
}
