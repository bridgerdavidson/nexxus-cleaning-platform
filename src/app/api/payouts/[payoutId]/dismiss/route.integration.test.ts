import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (payoutId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ payoutId }) });

describe('POST /api/payouts/:payoutId/dismiss', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({ payoutPercent: 60 });
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function makeAppt() {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
  }

  async function seedPayout(appointmentId: string, status: string): Promise<string> {
    const db = createTestSupabaseClient();
    const { data, error } = await db
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appointmentId,
        amount: 60,
        payout_percent_snapshot: 60,
        status,
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed payout failed: ${error.message}`);
    return (data as { id: string }).id;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner caller (insufficient role)', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('returns 404 for a payout id that does not exist in the org', async () => {
    const { status } = await callRoute(handlerFor(randomUUID()), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(404);
  });

  it('dismisses a failed payout: sets attention_dismissed_at and writes a ledger row', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');

    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('payouts')
      .select('status, attention_dismissed_at')
      .eq('id', payoutId)
      .single();
    const payout = row as { status: string; attention_dismissed_at: string | null };
    // Status is unchanged (still owed); only the panel-visibility flag is set.
    expect(payout.status).toBe('failed');
    expect(payout.attention_dismissed_at).not.toBeNull();

    const { data: events } = await db
      .from('payment_events')
      .select('event_type, actor')
      .eq('appointment_id', appt.id);
    const dismissed = (events ?? []).find(
      (e) => (e as { event_type: string }).event_type === 'payout_attention_dismissed',
    ) as { actor: string } | undefined;
    expect(dismissed).toBeTruthy();
    expect(dismissed!.actor).toBe(`user:${org.admin.userId}`);
  });

  it('409 when trying to dismiss a non-failed payout (paid)', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'paid');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
  });

  it('403 for a manager WITHOUT can_manage_payments', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const db = createTestSupabaseClient();
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: false,
    });

    const { status, body } = await callRoute<{ error: string }>(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(body.error).toBe('Requires the Manage Payments permission');
  });
});
