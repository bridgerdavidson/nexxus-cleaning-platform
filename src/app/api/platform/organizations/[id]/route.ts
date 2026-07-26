import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { stripeEnabled } from '@/lib/stripe/flags';
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
    default_payout_model: (orgRow.default_payout_model as string) ?? 'percentage',
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

/**
 * DELETE /api/platform/organizations/:id
 *
 * Permanently wipes a tenant org and everything tied to it. The platform admin
 * UI guards this with a name-match + secondary confirm, but server-side we
 * still validate ownership (requirePlatformAdmin) and snapshot what was
 * deleted into platform_audit_log so the action is auditable after the fact.
 *
 * Order matters because six FKs from app data → organizations have NO CASCADE
 * (appointments, cleaner_profiles, messages, payments, properties, reviews,
 * service_types) plus five Stripe-era tables (refunds, payment_events,
 * application_fees, disputes, tenant_subscription_events). We delete those
 * explicitly, then drop the org row — at which point the CASCADE-defined
 * tables (invites, invoices, manager_permissions, organization_members,
 * payouts, recurring_appointment_series, notification_events,
 * homeowner_payment_links) clear automatically.
 *
 * Users that ONLY belong to the deleted org are removed (user_profiles +
 * auth.users). Users that belong to another org survive, and platform admins
 * are never auth-deleted through this flow.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { id: orgId } = await params;

  // ── 1. Load org (404 fast if it doesn't exist) ─────────────────────────
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, stripe_connect_account_id')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr) {
    return NextResponse.json(
      { error: 'Failed to load organization', details: orgErr.message },
      { status: 500 },
    );
  }
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  const orgRow = org as { id: string; name: string; stripe_connect_account_id: string | null };

  // ── 2. Snapshot counts for the audit entry ─────────────────────────────
  const counts: Record<string, number> = {};
  async function snapshot(table: string): Promise<void> {
    const { count } = await supabaseAdmin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    counts[table] = count ?? 0;
  }
  await Promise.all([
    snapshot('organization_members'),
    snapshot('appointments'),
    snapshot('properties'),
    snapshot('service_types'),
    snapshot('payments'),
    snapshot('cleaner_profiles'),
  ]);

  // ── 3. Identify members + classify users for delete vs. detach ─────────
  // Done BEFORE the cascade so we can compute which users are org-orphans
  // (only belong to this org) and exclude platform admins.
  const { data: memberRows, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId);
  if (memErr) {
    return NextResponse.json(
      { error: 'Failed to load members for cascade', details: memErr.message },
      { status: 500 },
    );
  }
  const memberUserIds = ((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id);

  let orphanUserIds: string[] = [];
  if (memberUserIds.length > 0) {
    const { data: otherMemberships } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .neq('organization_id', orgId)
      .in('user_id', memberUserIds);
    const usersWithOtherOrgs = new Set(
      ((otherMemberships ?? []) as { user_id: string }[]).map((r) => r.user_id),
    );

    const { data: platformAdmins } = await supabaseAdmin
      .from('platform_admins')
      .select('user_id')
      .in('user_id', memberUserIds);
    const platformAdminIds = new Set(
      ((platformAdmins ?? []) as { user_id: string }[]).map((r) => r.user_id),
    );

    orphanUserIds = memberUserIds.filter(
      (id) => !usersWithOtherOrgs.has(id) && !platformAdminIds.has(id),
    );
  }

  // ── 4. Best-effort Stripe Connect account cleanup ──────────────────────
  // If Stripe is disabled or the account is already gone, log and continue —
  // never block the local delete on a remote API call.
  let stripeStatus: 'skipped' | 'deleted' | 'error' = 'skipped';
  let stripeError: string | null = null;
  if (orgRow.stripe_connect_account_id && stripeEnabled()) {
    try {
      const { getStripe } = await import('@/lib/stripe');
      const stripe = getStripe();
      await stripe.accounts.del(orgRow.stripe_connect_account_id);
      stripeStatus = 'deleted';
    } catch (e) {
      stripeStatus = 'error';
      stripeError = e instanceof Error ? e.message : String(e);
      console.error('[delete-org] Stripe Connect del failed:', stripeError);
    }
  }

  // ── 5. Wipe blocking-FK rows (NO CASCADE on these) ─────────────────────
  // Order matters: refunds + payment_events FK to both appointments AND
  // payments — must clear them before either parent. payments must be cleared
  // before appointments (payments FK to appointments but doesn't CASCADE from
  // org). cleaner_profiles + properties + service_types FK from appointments,
  // so they must outlive appointments to satisfy appointments' FKs going the
  // other way.
  async function wipe(table: string): Promise<void> {
    const { error } = await supabaseAdmin.from(table).delete().eq('organization_id', orgId);
    if (error) {
      throw new Error(`Failed to wipe ${table}: ${error.message}`);
    }
  }

  try {
    // Stripe-era ledger tables that FK to payments/appointments + org.
    await wipe('refunds');
    await wipe('payment_events');
    await wipe('application_fees');
    await wipe('disputes');
    await wipe('tenant_subscription_events');

    // Baseline non-CASCADE tables.
    await wipe('messages');
    await wipe('reviews');
    await wipe('payments');
    await wipe('appointments'); // CASCADE-drops job_photos, cleaner_availability_feedback, appointment_requests, etc.
    await wipe('cleaner_profiles');
    await wipe('properties');
    await wipe('service_types');
  } catch (e) {
    return NextResponse.json(
      { error: 'Cascade failed', details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // ── 6. Drop the org row — CASCADE handles the rest ─────────────────────
  // (invites, invoices, manager_permissions, organization_members, payouts,
  // recurring_appointment_series, notification_events, homeowner_payment_links).
  const { error: dropErr } = await supabaseAdmin.from('organizations').delete().eq('id', orgId);
  if (dropErr) {
    return NextResponse.json(
      { error: 'Failed to delete organization row', details: dropErr.message },
      { status: 500 },
    );
  }

  // ── 7. Delete orphan users (profile + auth.users) ──────────────────────
  const userDeleteFailures: { user_id: string; error: string }[] = [];
  for (const userId of orphanUserIds) {
    const { error: profErr } = await supabaseAdmin.from('user_profiles').delete().eq('id', userId);
    if (profErr) {
      userDeleteFailures.push({ user_id: userId, error: `profile: ${profErr.message}` });
    }
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) {
      userDeleteFailures.push({ user_id: userId, error: `auth: ${authErr.message}` });
    }
  }

  // ── 8. Audit log (best-effort — failure shouldn't undo the delete) ─────
  const auditMetadata = {
    org_id: orgId,
    org_name: orgRow.name,
    counts,
    stripe_account_id: orgRow.stripe_connect_account_id,
    stripe_status: stripeStatus,
    stripe_error: stripeError,
    deleted_user_count: orphanUserIds.length,
    user_delete_failures: userDeleteFailures,
  };
  const { error: auditErr } = await supabaseAdmin.from('platform_audit_log').insert({
    actor_user_id: auth.userId,
    action: 'delete_tenant',
    target_org_id: null, // org is gone; FK was ON DELETE SET NULL anyway.
    metadata: auditMetadata,
  });
  if (auditErr) {
    console.error('[delete-org] audit insert failed:', auditErr.message);
  }

  return NextResponse.json({
    success: true,
    counts,
    deleted_user_count: orphanUserIds.length,
    stripe_status: stripeStatus,
  });
}
