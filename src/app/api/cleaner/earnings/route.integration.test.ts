import { describe, it, expect, afterAll } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import {
  withTestOrg,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';

/**
 * GET /api/cleaner/earnings: mode-aware Hop-1 (clearing) + Hop-2 (held) money,
 * computed server-side since the price-seal migration removed the cleaner's payments
 * SELECT arm. The cut math must mirror settlement (resolveCleanerShareCents),
 * and the customer charge amount must never serialize.
 */

type EarningsBody = {
  awaiting: Array<{
    id: string;
    cleanerCut: number;
    appointment: { id: string; homeownerName: string; serviceName: string | null } | null;
  }>;
  held: Array<{ id: string; amount: number; status: string; appointment: { id: string } | null }>;
};

const admin = createTestSupabaseClient();
const cleanups: Array<() => Promise<void>> = [];

const url = (orgId: string) => `http://test.local/api/cleaner/earnings?organization_id=${orgId}`;

async function seedProcessingPayment(org: TestOrgFixture, opts: {
  amount: number;
  processingFeeCents?: number;
  status?: string;
}) {
  const appt = await createTestAppointment({
    organizationId: org.organizationId,
    cleanerId: org.cleaner.userId,
    homeownerId: org.homeowner.userId,
    totalPrice: opts.amount,
    status: 'completed',
  });
  const { data, error } = await admin
    .from('payments')
    .insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: opts.amount,
      processing_fee_cents: opts.processingFeeCents ?? 0,
      status: opts.status ?? 'processing',
      payment_method: 'card',
      payment_type: 'revenue',
    })
    .select('id')
    .single();
  if (error) throw new Error(`payment seed failed: ${error.message}`);
  return { apptId: appt.id, paymentId: (data as { id: string }).id };
}

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

describe('GET /api/cleaner/earnings', () => {
  it('percentage: cut = (charge - fee) x percent, and the charge never serializes', async () => {
    const org = await withTestOrg({ payoutPercent: 50 });
    cleanups.push(org.cleanup);
    await seedProcessingPayment(org, { amount: 137.53, processingFeeCents: 753 });

    const res = await callRoute<EarningsBody>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(res.status).toBe(200);
    expect(res.body.awaiting).toHaveLength(1);
    // (13753 - 753) = 13000 cents base; 50% = 6500 cents.
    expect(res.body.awaiting[0].cleanerCut).toBe(65);
    expect(res.body.awaiting[0].appointment?.homeownerName).toBe('Homeowner Test');

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('137.53');
    expect(raw).not.toContain('total_price');
  });

  it('flat: cut = min(flat rate, base)', async () => {
    const org = await withTestOrg({ cleanerPayoutModel: 'flat', flatRateCents: 4000 });
    cleanups.push(org.cleanup);
    const below = await seedProcessingPayment(org, { amount: 100 });
    const above = await seedProcessingPayment(org, { amount: 30 });

    const res = await callRoute<EarningsBody>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(res.status).toBe(200);
    const byAppt = new Map(res.body.awaiting.map((r) => [r.appointment?.id, r.cleanerCut]));
    expect(byAppt.get(below.apptId)).toBe(40); // min(4000, 10000)
    expect(byAppt.get(above.apptId)).toBe(30); // capped at the base
  });

  it('request: no row until a thread is approved, then the approved amount', async () => {
    const org = await withTestOrg({ cleanerPayoutModel: 'request' });
    cleanups.push(org.cleanup);
    const { apptId } = await seedProcessingPayment(org, { amount: 100 });

    const before = await callRoute<EarningsBody>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(before.status).toBe(200);
    // Nothing agreed yet: promise no number (the negotiation lives in the
    // pay-request threads on the same screen).
    expect(before.body.awaiting).toEqual([]);

    await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: apptId,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 10000,
      approvedAmountCents: 7500,
    });

    const after = await callRoute<EarningsBody>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(after.body.awaiting).toHaveLength(1);
    expect(after.body.awaiting[0].cleanerCut).toBe(75);
  });

  it('held: the cleaner sees their own payout rows with labels', async () => {
    const org = await withTestOrg({ payoutPercent: 50 });
    cleanups.push(org.cleanup);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
    const { error } = await admin.from('payouts').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      cleaner_id: org.cleaner.userId,
      amount: 33,
      status: 'pending',
    });
    expect(error).toBeNull();

    const res = await callRoute<EarningsBody>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(res.status).toBe(200);
    expect(res.body.held).toHaveLength(1);
    expect(res.body.held[0].amount).toBe(33);
    expect(res.body.held[0].status).toBe('pending');
    expect(res.body.held[0].appointment?.id).toBe(appt.id);
  });

  it('rejects org staff (403) and a missing token (401)', async () => {
    const org = await withTestOrg({});
    cleanups.push(org.cleanup);
    const staff = await callRoute(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(staff.status).toBe(403);
    const noToken = await callRoute(GET, { method: 'GET', url: url(org.organizationId) });
    expect(noToken.status).toBe(401);
  });
});
