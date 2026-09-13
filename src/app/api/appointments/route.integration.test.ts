import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: { id: string }; error?: string };

const db = createTestSupabaseClient();

async function seedService(orgId: string) {
  const { data, error } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedProperty(orgId: string, ownerId: string | null) {
  const { data, error } = await db
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: ownerId,
      name: 'Test Property',
      address: '1 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function defaultChecklistOf(serviceId: string) {
  const { data, error } = await db.from('checklists').select('id').eq('service_type_id', serviceId).limit(1).single();
  if (error) throw error;
  return data.id as string;
}

async function purgeOrg(orgId: string) {
  await db.from('appointments').delete().eq('organization_id', orgId);
  await db.from('properties').delete().eq('organization_id', orgId);
}

describe('POST /api/appointments', () => {
  let org: TestOrgFixture;
  let serviceId: string;
  let propertyId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    serviceId = await seedService(org.organizationId);
    propertyId = await seedProperty(org.organizationId, org.homeowner.userId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await purgeOrg(org.organizationId);
    await org.cleanup();
  });

  const appointment = (over: Record<string, unknown> = {}) => ({
    homeowner_id: org.homeowner.userId,
    cleaner_id: null,
    property_id: propertyId,
    service_type_id: serviceId,
    checklist_id: null,
    scheduled_date: '2026-10-01',
    scheduled_time: '10:00',
    duration_minutes: 60,
    total_price: 100,
    price_override_enabled: false,
    price_override_total: null,
    special_requests: null,
    payment_method_id: null,
    is_self_pay: false,
    ...over,
  });
  const primary = { slot_index: 0, scheduled_date: '2026-10-01', scheduled_time: '10:00' };
  const body = (over: Record<string, unknown> = {}, slots: unknown[] = [primary]) => ({
    organization_id: org.organizationId,
    appointment: appointment(over),
    slots,
  });
  const post = (b: unknown, token?: string) =>
    callRoute<Body>(POST, { method: 'POST', url: 'http://test/api/appointments', headers: token ? bearerHeader(token) : {}, body: b });

  it('returns 401 without a token and 400 on an invalid body', async () => {
    expect((await post(body())).status).toBe(401);
    const res = await post(body({ property_id: null }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A property is required');
  });

  it('returns 403 for a cleaner, a manager without can_edit_bookings, and another org\'s admin', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
    cleanups.push(() => mgr.cleanup());
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await post(body(), org.cleaner.accessToken)).status).toBe(403);
    expect((await post(body(), mgr.accessToken)).status).toBe(403);
    expect((await post(body(), other.admin.accessToken)).status).toBe(403);
  });

  it('admin creates a pending booking with a server-side deadline and no slot rows for a single slot', async () => {
    const res = await post(body(), org.admin.accessToken);
    expect(res.status).toBe(201);
    const id = res.body.data!.id;
    const { data: row } = await db
      .from('appointments')
      .select('organization_id, status, cleaner_confirmation_status, response_deadline, homeowner_id, total_price, is_self_pay')
      .eq('id', id)
      .single();
    expect(row).toMatchObject({
      organization_id: org.organizationId,
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      homeowner_id: org.homeowner.userId,
      is_self_pay: false,
    });
    expect(row!.response_deadline).not.toBeNull();
    expect(Number(row!.total_price)).toBe(100);
    const { count } = await db.from('appointment_requested_slots').select('id', { count: 'exact', head: true }).eq('appointment_id', id);
    expect(count).toBe(0);
  });

  it('manager with can_edit_bookings creates a booking', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    cleanups.push(() => mgr.cleanup());
    expect((await post(body(), mgr.accessToken)).status).toBe(201);
  });

  it('records offered slots when more than one is given', async () => {
    const slots = [
      primary,
      { slot_index: 1, scheduled_date: '2026-10-02', scheduled_time: '13:00' },
      { slot_index: 2, scheduled_date: '2026-10-03', scheduled_time: '09:30' },
    ];
    const res = await post(body({}, slots), org.admin.accessToken);
    expect(res.status).toBe(201);
    const { data } = await db
      .from('appointment_requested_slots')
      .select('slot_index, scheduled_date')
      .eq('appointment_id', res.body.data!.id)
      .order('slot_index', { ascending: true });
    expect(data).toEqual([
      { slot_index: 0, scheduled_date: '2026-10-01' },
      { slot_index: 1, scheduled_date: '2026-10-02' },
      { slot_index: 2, scheduled_date: '2026-10-03' },
    ]);
  });

  it('rejects a property from another org (403) and a property that is not the customer\'s (400)', async () => {
    const other = await withTestOrg();
    cleanups.push(async () => {
      await purgeOrg(other.organizationId);
      await other.cleanup();
    });
    const foreignProperty = await seedProperty(other.organizationId, other.homeowner.userId);
    const r1 = await post(body({ property_id: foreignProperty }), org.admin.accessToken);
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('Property is in a different organization');

    const orgOwned = await seedProperty(org.organizationId, null);
    const r2 = await post(body({ property_id: orgOwned }), org.admin.accessToken);
    expect(r2.status).toBe(400);
    expect(r2.body.error).toBe('Property does not belong to the selected customer');
  });

  it('rejects a customer who is not a homeowner in the org', async () => {
    const res = await post(body({ homeowner_id: org.cleaner.userId }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Customer is not a homeowner in this organization');
  });

  it('rejects a service type from another org', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    const foreignService = await seedService(other.organizationId);
    const res = await post(body({ service_type_id: foreignService }), org.admin.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Service type is in a different organization');
  });

  it('rejects a checklist that belongs to another service', async () => {
    const otherService = await seedService(org.organizationId);
    const wrongChecklist = await defaultChecklistOf(otherService);
    const res = await post(body({ checklist_id: wrongChecklist }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Checklist does not match the selected service type');
  });

  it('rejects a cleaner from another org', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    const res = await post(body({ cleaner_id: other.cleaner.userId }), org.admin.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Cleaner is in a different organization');
  });

  it('refuses a company-paid job for a cleaner settlement could not pay', async () => {
    // The default fixture cleaner has pay configured but no Connect account.
    const res = await post(body({ is_self_pay: true, cleaner_id: org.cleaner.userId }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cleaner cannot be offered a company-paid job: No Stripe payout account yet');
  });

  it('creates a company-paid booking on an org-owned property with a payable cleaner and no customer', async () => {
    const payable = await withTestOrg({ stripeConnectOnboardingComplete: true, stripeConnectAccountId: 'acct_test123' });
    cleanups.push(async () => {
      await purgeOrg(payable.organizationId);
      await payable.cleanup();
    });
    const svc = await seedService(payable.organizationId);
    const prop = await seedProperty(payable.organizationId, null);
    const res = await post(
      {
        organization_id: payable.organizationId,
        appointment: appointment({
          homeowner_id: null,
          is_self_pay: true,
          cleaner_id: payable.cleaner.userId,
          property_id: prop,
          service_type_id: svc,
          payment_method_id: 'ignored',
        }),
        slots: [primary],
      },
      payable.admin.accessToken,
    );
    expect(res.status).toBe(201);
    const { data: row } = await db
      .from('appointments')
      .select('homeowner_id, is_self_pay, payment_method_id, cleaner_id')
      .eq('id', res.body.data!.id)
      .single();
    expect(row).toEqual({ homeowner_id: null, is_self_pay: true, payment_method_id: null, cleaner_id: payable.cleaner.userId });
  });

  describe('billing enforcement', () => {
    afterEach(() => {
      delete process.env.BILLING_ENFORCEMENT_ENABLED;
    });

    async function freezeOrg(organizationId: string) {
      await db
        .from('organizations')
        .update({
          comped_at: null,
          subscription_status: 'trialing',
          trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
        })
        .eq('id', organizationId);
    }

    it('passes through when the flag is off, even for a frozen org', async () => {
      await freezeOrg(org.organizationId);

      const res = await post(body(), org.admin.accessToken);
      expect(res.status).toBe(201);
    });

    it('returns 402 billing_frozen when the flag is on and the trial has expired', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      await freezeOrg(org.organizationId);

      const res = await post(body(), org.admin.accessToken);
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('billing_frozen');
    });

    it('allows a comped org with the flag on', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      await db
        .from('organizations')
        .update({ comped_at: new Date().toISOString() })
        .eq('id', org.organizationId);

      const res = await post(body(), org.admin.accessToken);
      expect(res.status).toBe(201);
    });

    it('still returns 403 to a non-member before it considers billing', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      const outsider = await withTestOrg();
      cleanups.push(() => outsider.cleanup());
      await freezeOrg(org.organizationId);

      const res = await post(body(), outsider.admin.accessToken);
      expect(res.status).toBe(403);
    });
  });
});
