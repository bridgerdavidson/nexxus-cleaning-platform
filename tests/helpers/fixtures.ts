import { randomUUID } from 'node:crypto';
import { createTestSupabaseClient } from './supabase';

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

async function createAuthUser(
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
    .insert({ name: orgName })
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

/**
 * Insert a minimal appointment row for use in route tests.
 */
export async function createTestAppointment(args: {
  organizationId: string;
  cleanerId: string;
  homeownerId: string;
  totalPrice?: number;
  status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  scheduledDate?: string;
  scheduledTime?: string;
}): Promise<{ id: string }> {
  const admin = createTestSupabaseClient();

  // Need a property and service_type first.
  const { data: prop, error: propErr } = await admin
    .from('properties')
    .insert({
      organization_id: args.organizationId,
      owner_id: args.homeownerId,
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

  const { data: appt, error: apptErr } = await admin
    .from('appointments')
    .insert({
      organization_id: args.organizationId,
      cleaner_id: args.cleanerId,
      homeowner_id: args.homeownerId,
      property_id: prop.id,
      service_type_id: svc.id,
      scheduled_date: args.scheduledDate ?? '2026-06-01',
      scheduled_time: args.scheduledTime ?? '10:00',
      duration_minutes: 60,
      total_price: args.totalPrice ?? 100,
      status: args.status ?? 'pending',
    })
    .select('id')
    .single();
  if (apptErr || !appt) throw new Error(`appointment insert failed: ${apptErr?.message}`);
  return { id: appt.id };
}

/**
 * Build a synthetic Stripe payment_intent.succeeded event payload for webhook tests.
 * The amount is in dollars; converted to cents internally.
 */
export function buildPaymentIntentSucceededEvent(args: {
  appointmentId: string;
  amountDollars: number;
  eventId?: string;
}): Record<string, unknown> {
  const eventId = args.eventId ?? `evt_test_${randomUUID()}`;
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
        currency: 'usd',
        status: 'succeeded',
        latest_charge: `ch_test_${args.appointmentId}`,
        metadata: { appointment_id: args.appointmentId },
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  };
}
