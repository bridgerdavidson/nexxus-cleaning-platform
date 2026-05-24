import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/charges/authorize', () => ({
  createDestinationAuthorization: vi.fn(async () => ({ id: 'pi_test_auth', status: 'requires_capture' })),
}));
vi.mock('@/lib/stripe/charges/cancel', () => ({
  cancelAuthorization: vi.fn(async () => ({ id: 'pi_old', status: 'canceled' })),
}));

import { POST } from './route';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const CRON_SECRET = 'test-cron-secret';
const cronHeaders = { Authorization: `Bearer ${CRON_SECRET}` };

describe('POST /api/cron/authorize-due', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;
  let originalSecret: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    originalSecret = process.env.CRON_SECRET;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    process.env.CRON_SECRET = CRON_SECRET;
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    process.env.CRON_SECRET = originalSecret;
    await org.cleanup();
  });

  async function makeTenantReady(prefix: string) {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_${prefix}_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: `cus_${prefix}` })
      .eq('id', org.homeowner.userId);
  }

  it('returns 401 with a wrong/missing CRON secret', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: {},
    });
    expect(status).toBe(401);
  });

  it('returns 404 when the new charge flow is disabled', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(404);
  });

  it('authorizes appointments whose authorize_at window has arrived', async () => {
    await makeTenantReady('due');
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
    });
    await db
      .from('appointments')
      .update({
        payment_method_id: 'pm_cron',
        authorize_at: new Date(Date.now() - 60_000).toISOString(),
        authorization_status: 'scheduled',
      })
      .eq('id', appt.id);

    const { status, body } = await callRoute<{ success: boolean; authorized: number }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.authorized).toBeGreaterThanOrEqual(1);

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('authorized');
  });

  it('re-authorizes a hold nearing expiry and bumps reauth_count', async () => {
    await makeTenantReady('reauth');
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
    });
    await db
      .from('appointments')
      .update({ payment_method_id: 'pm_reauth', authorization_status: 'authorized', reauth_count: 0 })
      .eq('id', appt.id);
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_type: 'revenue',
      payment_method: 'card',
      stripe_payment_intent_id: 'pi_old',
      payment_intent_status: 'requires_capture',
      authorized_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { status, body } = await callRoute<{ success: boolean; reauthorized: number }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.reauthorized).toBeGreaterThanOrEqual(1);

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status, reauth_count')
      .eq('id', appt.id)
      .single();
    const row = apptRow as { authorization_status: string; reauth_count: number };
    expect(row.authorization_status).toBe('authorized');
    expect(row.reauth_count).toBe(1);
  });
});
