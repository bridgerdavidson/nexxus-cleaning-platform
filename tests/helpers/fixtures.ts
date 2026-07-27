import { randomUUID } from 'node:crypto';
import { createTestSupabaseClient } from './supabase';
import {
  emptyManagerPermissions,
  type ManagerPermissionKey,
} from '../../src/lib/permissions/managerFlags';

export interface TestUserHandle {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
}

export interface TestOrgFixture {
  organizationId: string;
  admin: TestUserHandle;
  cleaner: TestUserHandle;
  homeowner: TestUserHandle;
  cleanup(): Promise<void>;
}

const PASSWORD = 'TestPass123!';

export async function createAuthUser(
  email: string,
  role: 'admin' | 'cleaner' | 'homeowner' | 'manager',
  firstName: string,
): Promise<{ id: string; email: string; accessToken: string }> {
  const admin = createTestSupabaseClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { first_name: firstName, last_name: 'Test' },
  });
  if (error || !data.user) {
    throw new Error(`createUser failed for ${email}: ${error?.message ?? 'unknown'}`);
  }
  const userId = data.user.id;

  // Sign in to get an access token. `auth.admin.createUser` doesn't return one.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const signInRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!signInRes.ok) {
    throw new Error(`sign-in failed for ${email}: ${signInRes.status} ${await signInRes.text()}`);
  }
  const signInBody = (await signInRes.json()) as { access_token?: string };
  if (!signInBody.access_token) {
    throw new Error(`no access_token returned for ${email}`);
  }
  return { id: userId, email, accessToken: signInBody.access_token };
}

export interface WithTestOrgOptions {
  payoutPercent?: number;
  stripeConnectOnboardingComplete?: boolean;
  stripeConnectAccountId?: string;
  /** organizations.default_payout_model (default 'percentage'). */
  defaultPayoutModel?: 'percentage' | 'flat' | 'request' | 'hourly_external';
  /**
   * organizations.platform_fee_bps. Tests that assert split/charge amounts should PIN this
   * explicitly (0 for pure-split mechanics, 100 for fee behavior) instead of inheriting the
   * DB default, which changed from 0 to 100 in migration 111 and may differ between a local
   * database and CI.
   */
  platformFeeBps?: number;
  /** cleaner_profiles.payout_model for the fixture cleaner (default 'percentage'). */
  cleanerPayoutModel?: 'percentage' | 'flat' | 'request' | 'hourly_external';
  /** cleaner_profiles.flat_rate_cents (only meaningful with cleanerPayoutModel 'flat'). */
  flatRateCents?: number;
  /**
   * organizations.min_margin_bps (request-mode auto-approve threshold, migration 117).
   * Tests asserting auto-approve vs escalate should PIN this instead of inheriting
   * the DB default (2000).
   */
  minMarginBps?: number;
}

/**
 * Creates an isolated test tenant: one organization plus admin/cleaner/homeowner users
 * bound to it via `organization_members`. The cleaner gets a `cleaner_profiles` row
 * with sensible defaults (override via opts).
 *
 * Cleanup deletes the org (cascading to most child rows) and then deletes the auth users.
 */
export async function withTestOrg(opts: WithTestOrgOptions = {}): Promise<TestOrgFixture> {
  const admin = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);
  const orgName = `Test Org ${uniq}`;

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: orgName,
      ...(opts.defaultPayoutModel ? { default_payout_model: opts.defaultPayoutModel } : {}),
      ...(opts.platformFeeBps !== undefined ? { platform_fee_bps: opts.platformFeeBps } : {}),
      ...(opts.minMarginBps !== undefined ? { min_margin_bps: opts.minMarginBps } : {}),
    })
    .select('id')
    .single();
  if (orgError || !org) {
    throw new Error(`failed to create org: ${orgError?.message ?? 'unknown'}`);
  }
  const organizationId = org.id as string;

  const [adminUser, cleanerUser, homeownerUser] = await Promise.all([
    createAuthUser(`admin-${uniq}@test.local`, 'admin', 'Admin'),
    createAuthUser(`cleaner-${uniq}@test.local`, 'cleaner', 'Cleaner'),
    createAuthUser(`homeowner-${uniq}@test.local`, 'homeowner', 'Homeowner'),
  ]);

  // user_profiles. Prod has an auth-schema trigger that auto-inserts these on
  // auth.users insert; local Supabase doesn't have that trigger (the schema
  // dump only includes `public`). Insert explicitly so FKs from
  // organization_members.user_id → user_profiles.id resolve.
  // Use `upsert` in case the trigger is present (it would be a no-op then).
  const { error: profilesError } = await admin.from('user_profiles').upsert(
    [
      { id: adminUser.id, email: adminUser.email, first_name: 'Admin', last_name: 'Test', role: 'admin' },
      { id: cleanerUser.id, email: cleanerUser.email, first_name: 'Cleaner', last_name: 'Test', role: 'cleaner' },
      { id: homeownerUser.id, email: homeownerUser.email, first_name: 'Homeowner', last_name: 'Test', role: 'homeowner' },
    ],
    { onConflict: 'id' },
  );
  if (profilesError) {
    throw new Error(`failed to insert user_profiles: ${profilesError.message}`);
  }

  // organization_members
  const { error: memError } = await admin.from('organization_members').insert([
    { user_id: adminUser.id, organization_id: organizationId, role: 'admin' },
    { user_id: cleanerUser.id, organization_id: organizationId, role: 'cleaner' },
    { user_id: homeownerUser.id, organization_id: organizationId, role: 'homeowner' },
  ]);
  if (memError) {
    throw new Error(`failed to insert org members: ${memError.message}`);
  }

  // cleaner_profiles (id = user.id, scoped by org)
  const { error: cleanerProfileError } = await admin.from('cleaner_profiles').insert({
    id: cleanerUser.id,
    organization_id: organizationId,
    payout_percent: opts.payoutPercent ?? 60,
    stripe_connect_account_id: opts.stripeConnectAccountId ?? null,
    stripe_connect_onboarding_complete: opts.stripeConnectOnboardingComplete ?? false,
    payout_model: opts.cleanerPayoutModel ?? 'percentage',
    flat_rate_cents: opts.flatRateCents ?? null,
  });
  if (cleanerProfileError) {
    throw new Error(`failed to insert cleaner_profile: ${cleanerProfileError.message}`);
  }

  return {
    organizationId,
    admin: { userId: adminUser.id, email: adminUser.email, password: PASSWORD, accessToken: adminUser.accessToken },
    cleaner: { userId: cleanerUser.id, email: cleanerUser.email, password: PASSWORD, accessToken: cleanerUser.accessToken },
    homeowner: { userId: homeownerUser.id, email: homeownerUser.email, password: PASSWORD, accessToken: homeownerUser.accessToken },
    async cleanup() {
      // Delete org first — cascades remove most child rows.
      await admin.from('organizations').delete().eq('id', organizationId);
      // Then auth users (auth.users isn't cascaded by org deletion).
      await Promise.all([
        admin.auth.admin.deleteUser(adminUser.id),
        admin.auth.admin.deleteUser(cleanerUser.id),
        admin.auth.admin.deleteUser(homeownerUser.id),
      ]);
    },
  };
}

export interface OwnerMemberHandle extends TestUserHandle {
  cleanup(): Promise<void>;
}

/**
 * Adds an OrgRole 'owner' member to an existing org. `withTestOrg` only seeds
 * admin/cleaner/homeowner, but an org founder is OrgRole 'owner'. The owner's
 * UserRole is 'admin', mirroring the accept-invite mapping (OrgRole 'owner' ->
 * UserRole 'admin'). Returns a handle with its own cleanup that deletes the auth
 * user (the org-delete cascade in withTestOrg removes the membership row).
 */
export async function addOwnerToOrg(organizationId: string): Promise<OwnerMemberHandle> {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);
  const email = `owner-${uniq}@test.local`;
  const owner = await createAuthUser(email, 'admin', 'Owner');

  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: owner.id, email, first_name: 'Olive', last_name: 'Owner', role: 'admin' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed owner profile failed: ${profileErr.message}`);

  const { error: memErr } = await db
    .from('organization_members')
    .insert({ user_id: owner.id, organization_id: organizationId, role: 'owner' });
  if (memErr) throw new Error(`seed owner member failed: ${memErr.message}`);

  return {
    userId: owner.id,
    email,
    password: PASSWORD,
    accessToken: owner.accessToken,
    async cleanup() {
      await db.auth.admin.deleteUser(owner.id);
    },
  };
}

export interface ManagerMemberHandle extends TestUserHandle {
  cleanup(): Promise<void>;
}

/**
 * Adds an OrgRole 'manager' member (UserRole 'manager') to an existing org plus a
 * `manager_permissions` row. All flags default false; pass the ones you want true.
 * Returns a handle whose cleanup deletes the auth user (the org-delete cascade in
 * withTestOrg removes the membership + permissions rows).
 */
export async function addManagerToOrg(
  organizationId: string,
  permissions: Partial<Record<ManagerPermissionKey, boolean>> = {},
): Promise<ManagerMemberHandle> {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);
  const email = `manager-${uniq}@test.local`;
  const manager = await createAuthUser(email, 'manager', 'Manager');

  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: manager.id, email, first_name: 'Mara', last_name: 'Manager', role: 'manager' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed manager profile failed: ${profileErr.message}`);

  const { error: memErr } = await db
    .from('organization_members')
    .insert({ user_id: manager.id, organization_id: organizationId, role: 'manager' });
  if (memErr) throw new Error(`seed manager member failed: ${memErr.message}`);

  const { error: permErr } = await db
    .from('manager_permissions')
    .insert({
      manager_id: manager.id,
      organization_id: organizationId,
      ...emptyManagerPermissions(),
      ...permissions,
    });
  if (permErr) throw new Error(`seed manager_permissions failed: ${permErr.message}`);

  return {
    userId: manager.id,
    email,
    password: PASSWORD,
    accessToken: manager.accessToken,
    async cleanup() {
      await db.auth.admin.deleteUser(manager.id);
    },
  };
}

export interface HomeownerMemberHandle extends TestUserHandle {
  cleanup(): Promise<void>;
}

/**
 * Adds a second OrgRole 'homeowner' member to an existing org (withTestOrg only
 * seeds one). Returns a handle whose cleanup deletes the auth user (the
 * org-delete cascade in withTestOrg removes the membership row). Useful for the
 * customer-deletion tests that need more than one homeowner.
 */
export async function addHomeownerToOrg(organizationId: string): Promise<HomeownerMemberHandle> {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);
  const email = `homeowner2-${uniq}@test.local`;
  const homeowner = await createAuthUser(email, 'homeowner', 'Homeowner');

  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: homeowner.id, email, first_name: 'Hugo', last_name: 'Homeowner', role: 'homeowner' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed homeowner profile failed: ${profileErr.message}`);

  const { error: memErr } = await db
    .from('organization_members')
    .insert({ user_id: homeowner.id, organization_id: organizationId, role: 'homeowner' });
  if (memErr) throw new Error(`seed homeowner member failed: ${memErr.message}`);

  return {
    userId: homeowner.id,
    email,
    password: PASSWORD,
    accessToken: homeowner.accessToken,
    async cleanup() {
      await db.auth.admin.deleteUser(homeowner.id);
    },
  };
}

export interface PlatformAdminFixture {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  cleanup(): Promise<void>;
}

/**
 * Creates a platform admin: an auth user with a row in `platform_admins`. The
 * user's UserRole is deliberately 'homeowner' (not 'admin') so tests prove that
 * platform-admin status is orthogonal to org roles — and so the cross-org RLS
 * tests in 069 can't accidentally pass via the pre-existing admin god-mode
 * policies.
 */
export async function withPlatformAdmin(): Promise<PlatformAdminFixture> {
  const admin = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);
  const user = await createAuthUser(`platform-${uniq}@test.local`, 'homeowner', 'Platform');

  const { error: profileError } = await admin.from('user_profiles').upsert(
    { id: user.id, email: user.email, first_name: 'Platform', last_name: 'Admin', role: 'homeowner' },
    { onConflict: 'id' },
  );
  if (profileError) {
    throw new Error(`failed to insert platform admin profile: ${profileError.message}`);
  }

  const { error } = await admin.from('platform_admins').insert({ user_id: user.id });
  if (error) {
    throw new Error(`failed to insert platform_admin: ${error.message}`);
  }

  return {
    userId: user.id,
    email: user.email,
    password: PASSWORD,
    accessToken: user.accessToken,
    async cleanup() {
      // ON DELETE CASCADE on platform_admins.user_id clears the row, but delete
      // explicitly first in case the auth user delete is what's flaky.
      await admin.from('platform_admins').delete().eq('user_id', user.id);
      await admin.auth.admin.deleteUser(user.id);
    },
  };
}

/**
 * Insert a minimal appointment row for use in route tests.
 *
 * Self-pay (migration 077) options:
 *   - `orgOwnedProperty: true` → the property is org-owned (owner_id = null) instead of
 *     belonging to the homeowner. Models a property the org cleans for itself.
 *   - `selfPay: true` → the appointment is self-pay (is_self_pay = true). When combined with
 *     `orgOwnedProperty`, homeowner_id is set to null too (the org pays, there is no homeowner).
 *     The DB CHECK `is_self_pay = true OR homeowner_id IS NOT NULL` stays satisfied either way.
 */

/**
 * Seeds a pay-request thread (migration 114) directly, bypassing the submit
 * route, so route/settlement tests can start from any thread state. Offers get
 * explicit second-spaced created_at values so "latest offer" ordering is
 * deterministic. Status 'approved' requires approvedAmountCents (the DB
 * approved_shape CHECK enforces the full approval triple).
 */
export async function createTestPayRequest(args: {
  organizationId: string;
  appointmentId: string;
  cleanerId: string;
  status: 'pending_org' | 'pending_cleaner' | 'approved';
  jobPriceCents: number;
  offers?: Array<{
    actor: 'cleaner' | 'org';
    actorUserId: string;
    amountCents: number;
    autoApproved?: boolean;
    minMarginBpsSnapshot?: number | null;
    note?: string | null;
  }>;
  approvedAmountCents?: number;
  approvedVia?: 'auto' | 'org' | 'cleaner_accept';
  approvedBy?: string | null;
  /** The live offer riding the row (migration 116). Defaults to the last offer's amount, else approvedAmountCents. */
  currentOfferCents?: number;
}): Promise<{ id: string }> {
  const admin = createTestSupabaseClient();
  const currentOffer =
    args.currentOfferCents ?? args.offers?.at(-1)?.amountCents ?? args.approvedAmountCents ?? null;
  const { data: pr, error } = await admin
    .from('pay_requests')
    .insert({
      organization_id: args.organizationId,
      appointment_id: args.appointmentId,
      cleaner_id: args.cleanerId,
      status: args.status,
      job_price_cents_snapshot: args.jobPriceCents,
      current_offer_cents: currentOffer,
      ...(args.status === 'approved'
        ? {
            approved_amount_cents: args.approvedAmountCents,
            approved_via: args.approvedVia ?? 'org',
            approved_by: args.approvedBy ?? null,
            approved_at: new Date().toISOString(),
          }
        : {}),
    })
    .select('id')
    .single();
  if (error || !pr) throw new Error(`pay_requests insert failed: ${error?.message}`);
  const payRequestId = (pr as { id: string }).id;

  const base = Date.now() - (args.offers?.length ?? 0) * 1000;
  for (const [i, offer] of (args.offers ?? []).entries()) {
    const { error: offerErr } = await admin.from('pay_request_offers').insert({
      pay_request_id: payRequestId,
      actor: offer.actor,
      actor_user_id: offer.actorUserId,
      amount_cents: offer.amountCents,
      note: offer.note ?? null,
      min_margin_bps_snapshot: offer.minMarginBpsSnapshot ?? null,
      auto_approved: offer.autoApproved ?? false,
      created_at: new Date(base + i * 1000).toISOString(),
    });
    if (offerErr) throw new Error(`pay_request_offers insert failed: ${offerErr.message}`);
  }
  return { id: payRequestId };
}

export async function createTestAppointment(args: {
  organizationId: string;
  cleanerId: string | null;
  homeownerId: string;
  totalPrice?: number;
  status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  scheduledDate?: string;
  scheduledTime?: string;
  /** Insert the property as org-owned (owner_id = null) instead of homeowner-owned. */
  orgOwnedProperty?: boolean;
  /** Mark the appointment self-pay; with orgOwnedProperty, also nulls homeowner_id. */
  selfPay?: boolean;
}): Promise<{ id: string; propertyId: string; serviceTypeId: string }> {
  const admin = createTestSupabaseClient();

  // Need a property and service_type first. owner_id is null for org-owned properties.
  const { data: prop, error: propErr } = await admin
    .from('properties')
    .insert({
      organization_id: args.organizationId,
      owner_id: args.orgOwnedProperty ? null : args.homeownerId,
      name: 'Test Property',
      address: '1 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (propErr || !prop) throw new Error(`property insert failed: ${propErr?.message}`);

  const { data: svc, error: svcErr } = await admin
    .from('service_types')
    .insert({
      organization_id: args.organizationId,
      name: 'Test Service',
      base_price: 100,
      duration_minutes: 60,
      service_type: 'regular',
    })
    .select('id')
    .single();
  if (svcErr || !svc) throw new Error(`service_type insert failed: ${svcErr?.message}`);

  // Self-pay + org-owned ⇒ no homeowner. Self-pay on a homeowner-owned property keeps the
  // homeowner_id (it's still self-pay; the org is footing the bill for a homeowner property).
  const homeownerId = args.selfPay && args.orgOwnedProperty ? null : args.homeownerId;

  const { data: appt, error: apptErr } = await admin
    .from('appointments')
    .insert({
      organization_id: args.organizationId,
      cleaner_id: args.cleanerId,
      homeowner_id: homeownerId,
      property_id: prop.id,
      service_type_id: svc.id,
      scheduled_date: args.scheduledDate ?? '2026-06-01',
      scheduled_time: args.scheduledTime ?? '10:00',
      duration_minutes: 60,
      total_price: args.totalPrice ?? 100,
      status: args.status ?? 'pending',
      is_self_pay: args.selfPay ?? false,
    })
    .select('id')
    .single();
  if (apptErr || !appt) throw new Error(`appointment insert failed: ${apptErr?.message}`);
  return { id: appt.id, propertyId: prop.id as string, serviceTypeId: svc.id as string };
}

/**
 * Build a synthetic Stripe payment_intent.succeeded event payload for webhook tests.
 * The amount is in dollars; converted to cents internally.
 *
 * Optional knobs for the new charge flows:
 *   - `selfPay: true`         → adds `metadata.self_pay = 'true'` (routes the handler to
 *                               settleSelfPay) and forces `on_behalf_of: null`.
 *   - `onBehalfOf`            → sets `on_behalf_of` (separate-charges/tenant settlement path).
 *   - `latestCharge`          → override `latest_charge` (default `ch_test_<appt>`); pass null
 *                               to omit it.
 *   - `extraMetadata`         → merge additional metadata keys (e.g. organization_id).
 */
export function buildPaymentIntentSucceededEvent(args: {
  appointmentId: string;
  amountDollars: number;
  eventId?: string;
  selfPay?: boolean;
  onBehalfOf?: string | null;
  latestCharge?: string | null;
  extraMetadata?: Record<string, string>;
}): Record<string, unknown> {
  const eventId = args.eventId ?? `evt_test_${randomUUID()}`;
  const latestCharge =
    args.latestCharge === undefined ? `ch_test_${args.appointmentId}` : args.latestCharge;
  const metadata: Record<string, string> = {
    appointment_id: args.appointmentId,
    ...(args.selfPay ? { self_pay: 'true' } : {}),
    ...(args.extraMetadata ?? {}),
  };
  return {
    id: eventId,
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2025-12-15.clover',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `pi_test_${args.appointmentId}`,
        object: 'payment_intent',
        amount: Math.round(args.amountDollars * 100),
        amount_received: Math.round(args.amountDollars * 100),
        currency: 'usd',
        status: 'succeeded',
        latest_charge: latestCharge,
        // self-pay PIs carry no on_behalf_of (the org pays for its own cleaning); the handler
        // checks self_pay BEFORE on_behalf_of, so this null is the load-bearing branch guard.
        on_behalf_of: args.selfPay ? null : args.onBehalfOf ?? null,
        metadata,
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  };
}
