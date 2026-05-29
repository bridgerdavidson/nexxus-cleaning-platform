import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock @/lib/stripe so the reset route can call stripe.accounts.del() without
// touching the real Stripe API. We intercept the dynamic import inside the route.
const mockAccountsDel = vi.fn(async () => ({ id: 'acct_deleted', deleted: true }));
vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...actual,
    getStripe: () => ({
      accounts: { del: mockAccountsDel },
    }),
  };
});

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  createTestAppointment,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../../tests/helpers/supabase';

const postHandler = (id: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ id }) });

describe('POST /api/platform/cleaners/:id/connect/reset', () => {
  let org: TestOrgFixture;
  let platformAdmin: PlatformAdminFixture;
  let originalFlag: string | undefined;
  let seededAccountId: string;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    mockAccountsDel.mockReset();
    mockAccountsDel.mockResolvedValue({ id: 'acct_deleted', deleted: true } as never);

    [org, platformAdmin] = await Promise.all([withTestOrg(), withPlatformAdmin()]);

    // Seed the cleaner with a real-looking Connect account. Per-test unique ID
    // so any unique constraints on cleaner_profiles.stripe_connect_account_id
    // never collide across the suite.
    seededAccountId = `acct_test_stuck_${randomUUID().slice(0, 8)}`;
    const db = createTestSupabaseClient();
    const { error: seedErr } = await db
      .from('cleaner_profiles')
      .update({
        stripe_connect_account_id: seededAccountId,
        stripe_connect_charges_enabled: true,
        stripe_connect_payouts_enabled: true,
        stripe_connect_details_submitted: true,
        stripe_connect_requirements_due: ['individual.id_number'],
        stripe_connect_onboarded_at: new Date().toISOString(),
        stripe_connect_onboarding_complete: true,
      })
      .eq('id', org.cleaner.userId);
    if (seedErr) throw new Error(`seed UPDATE failed: ${seedErr.message}`);
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), platformAdmin.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(postHandler(org.cleaner.userId), {
      method: 'POST',
      body: { confirm: true },
    });
    expect(status).toBe(401);
  });

  it('returns 403 for a non-platform-admin caller', async () => {
    const { status } = await callRoute(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken), // org admin, not platform admin
      body: { confirm: true },
    });
    expect(status).toBe(403);
  });

  it('returns 400 without confirm:true in body', async () => {
    const { status } = await callRoute(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });

  it('returns 404 for an unknown cleaner', async () => {
    const { status } = await callRoute(postHandler('00000000-0000-0000-0000-000000000000'), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });
    expect(status).toBe(404);
  });

  it('returns 409 in_flight_payouts when there are pending/approved payouts and force is omitted', async () => {
    // Seed an appointment + a pending payout linked to this cleaner.
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const db = createTestSupabaseClient();
    const { error: payoutErr } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'pending',
    });
    if (payoutErr) throw new Error(`payout seed failed: ${payoutErr.message}`);

    const { status, body } = await callRoute<{
      error: string;
      payout_count: number;
      before_account_id: string;
    }>(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    expect(status).toBe(409);
    expect(body.error).toBe('in_flight_payouts');
    expect(body.payout_count).toBe(1);
    expect(body.before_account_id).toBe(seededAccountId);
    // Critically: Stripe must NOT have been called when we block.
    expect(mockAccountsDel).not.toHaveBeenCalled();

    // And the cleaner row must be unchanged.
    const { data: row } = await db
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_attempt_number')
      .eq('id', org.cleaner.userId)
      .single();
    const r = row as { stripe_connect_account_id: string | null; stripe_connect_attempt_number: number };
    expect(r.stripe_connect_account_id).toBe(seededAccountId);
    expect(r.stripe_connect_attempt_number).toBe(0);
  });

  it('proceeds when force:true even with in-flight payouts (records the count in audit)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const db = createTestSupabaseClient();
    const { error: payoutErr } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'approved',
    });
    if (payoutErr) throw new Error(`payout seed failed: ${payoutErr.message}`);

    const { status, body } = await callRoute<{
      success: boolean;
      stripe_delete_status: string;
      payout_count: number;
    }>(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true, force: true },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stripe_delete_status).toBe('deleted');
    expect(body.payout_count).toBe(1);
    expect(mockAccountsDel).toHaveBeenCalledWith(seededAccountId);

    const { data: audit } = await db
      .from('platform_audit_log')
      .select('action, target_org_id, metadata')
      .eq('action', 'reset_cleaner_connect')
      .eq('target_org_id', org.organizationId)
      .single();
    const a = audit as { action: string; target_org_id: string; metadata: Record<string, unknown> };
    expect(a.action).toBe('reset_cleaner_connect');
    expect(a.metadata.cleaner_id).toBe(org.cleaner.userId);
    expect(a.metadata.in_flight_payout_count).toBe(1);
    expect(a.metadata.force).toBe(true);
  });

  it('successfully clears Connect state, calls stripe.accounts.del, writes audit', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      before_account_id: string;
      stripe_delete_status: string;
      payout_count: number;
    }>(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.before_account_id).toBe(seededAccountId);
    expect(body.stripe_delete_status).toBe('deleted');
    expect(body.payout_count).toBe(0);
    expect(mockAccountsDel).toHaveBeenCalledWith(seededAccountId);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('cleaner_profiles')
      .select(
        'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due, stripe_connect_onboarded_at, stripe_connect_onboarding_complete, stripe_connect_attempt_number',
      )
      .eq('id', org.cleaner.userId)
      .single();
    const r = row as Record<string, unknown>;
    expect(r.stripe_connect_account_id).toBeNull();
    expect(r.stripe_connect_charges_enabled).toBe(false);
    expect(r.stripe_connect_payouts_enabled).toBe(false);
    expect(r.stripe_connect_details_submitted).toBe(false);
    expect(r.stripe_connect_requirements_due).toEqual([]);
    expect(r.stripe_connect_onboarded_at).toBeNull();
    expect(r.stripe_connect_onboarding_complete).toBe(false);
    // Counter bumped from 0 → 1 so the next /start uses a fresh Stripe
    // idempotency key — Stripe's 24h dedup cache can't replay the just-deleted
    // account.
    expect(r.stripe_connect_attempt_number).toBe(1);

    const { data: audit } = await db
      .from('platform_audit_log')
      .select('action, target_org_id, metadata')
      .eq('action', 'reset_cleaner_connect')
      .eq('target_org_id', org.organizationId)
      .single();
    const a = audit as { action: string; target_org_id: string; metadata: Record<string, unknown> };
    expect(a.action).toBe('reset_cleaner_connect');
    expect(a.metadata.cleaner_id).toBe(org.cleaner.userId);
    expect(a.metadata.organization_id).toBe(org.organizationId);
    expect(a.metadata.before_account_id).toBe(seededAccountId);
    expect(a.metadata.stripe_delete_status).toBe('deleted');
    expect(a.metadata.previous_attempt_number).toBe(0);
    expect(a.metadata.new_attempt_number).toBe(1);
    expect(a.metadata.in_flight_payout_count).toBe(0);
    expect(a.metadata.force).toBe(false);
  });

  it('still clears local state when stripe.accounts.del throws', async () => {
    mockAccountsDel.mockRejectedValueOnce(new Error('Account has balance'));

    const { status, body } = await callRoute<{
      success: boolean;
      stripe_delete_status: string;
      stripe_delete_error: string | null;
    }>(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stripe_delete_status).toBe('error');
    expect(body.stripe_delete_error).toContain('Account has balance');

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('cleaner_profiles')
      .select('stripe_connect_account_id')
      .eq('id', org.cleaner.userId)
      .single();
    expect((row as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBeNull();
  });

  it('skips stripe.accounts.del when the stored value is a pending: placeholder', async () => {
    const db = createTestSupabaseClient();
    const placeholder = `pending:${randomUUID()}`;
    const { error: seedErr } = await db
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: placeholder })
      .eq('id', org.cleaner.userId);
    if (seedErr) throw new Error(`pending seed failed: ${seedErr.message}`);

    const { status, body } = await callRoute<{
      success: boolean;
      stripe_delete_status: string;
      before_account_id: string;
    }>(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.before_account_id).toBe(placeholder);
    expect(body.stripe_delete_status).toBe('skipped');
    expect(mockAccountsDel).not.toHaveBeenCalled();
  });

  it('resolves open drift events for the cleaner', async () => {
    const db = createTestSupabaseClient();
    const { data: drift } = await db
      .from('connect_account_drift_events')
      .insert({
        organization_id: null,
        cleaner_id: org.cleaner.userId,
        expected_account_id: seededAccountId,
        observed_account_id: 'acct_other_real',
        source: 'webhook',
        metadata: {},
      })
      .select('id')
      .single();
    const driftId = (drift as { id: string }).id;

    await callRoute(postHandler(org.cleaner.userId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    const { data: resolved } = await db
      .from('connect_account_drift_events')
      .select('resolved_at')
      .eq('id', driftId)
      .single();
    expect((resolved as { resolved_at: string | null }).resolved_at).not.toBeNull();
  });
});
