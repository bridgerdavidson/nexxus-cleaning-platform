import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/payments/record', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let appointmentInOrg1: { id: string };

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
    appointmentInOrg1 = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects mismatch between body.organization_id and appointment.organization_id (proves the bug)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: {
        organization_id: org2.organizationId,
        appointment_id: appointmentInOrg1.id,
        amount: 100,
        payment_method: 'manual',
      },
    });
    // 400 (org mismatch) or 404 (not found in caller's org) both acceptable.
    expect([400, 404]).toContain(status);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: {
        organization_id: org.organizationId,
        amount: 100,
        payment_method: 'manual',
      },
    });
    expect(status).toBe(401);
  });

  it('records a payment for an appointment', async () => {
    const { status, body } = await callRoute<{ success: boolean; payment: { id: string }; error?: string; details?: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        organization_id: org.organizationId,
        appointment_id: appointmentInOrg1.id,
        amount: 200,
        payment_method: 'manual',
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.payment.id).toBeTruthy();
  });

  it('rejects non-admin caller (e.g. cleaner)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        organization_id: org.organizationId,
        amount: 50,
        payment_method: 'manual',
      },
    });
    expect(status).toBe(403);
  });
});

describe('POST /api/payments/record manager gate (can_manage_payments)', () => {
  let mgrOrg: TestOrgFixture | null = null;
  let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

  afterEach(async () => {
    if (mgr) { await mgr.cleanup(); mgr = null; }
    if (mgrOrg) { await mgrOrg.cleanup(); mgrOrg = null; }
  });

  it('403 for a manager without can_manage_payments', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: false });
    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: mgrOrg.organizationId, appointment_id: crypto.randomUUID(), amount: 100, payment_method: 'card' },
    });
    expect(res.status).toBe(403);
  });

  it('lets a manager WITH can_manage_payments past the auth gate', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: true });
    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: mgrOrg.organizationId, appointment_id: crypto.randomUUID(), amount: 100, payment_method: 'card' },
    });
    // Past auth: not a 401/403. (May 400/404/500 on the fake appointment id — that's fine, we only assert the gate.)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// T1-5: recording money out-of-band must drop the job out of card-charge triage so the operator
// "Retry charge" / homeowner "Pay now" surfaces, the card-recovery link, and the
// setup_intent.succeeded self-heal can't charge the card a second time for money already collected.
describe('POST /api/payments/record — clears card-charge triage after recording money (T1-5)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedAppt(authStatus: string | null) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
    await db.from('appointments').update({ authorization_status: authStatus }).eq('id', appt.id);
    return { db, apptId: appt.id };
  }

  async function record(apptId: string, extra: Record<string, unknown> = {}) {
    return callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        organization_id: org.organizationId,
        appointment_id: apptId,
        amount: 120,
        payment_method: 'manual',
        ...extra,
      },
    });
  }

  async function authStatusOf(db: ReturnType<typeof createTestSupabaseClient>, apptId: string) {
    const { data } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    return (data as { authorization_status: string | null }).authorization_status;
  }

  it('flips a failed appointment to captured', async () => {
    const { db, apptId } = await seedAppt('failed');
    const { status } = await record(apptId);
    expect(status).toBe(200);
    expect(await authStatusOf(db, apptId)).toBe('captured');
  });

  it('flips a requires_action appointment to captured', async () => {
    const { db, apptId } = await seedAppt('requires_action');
    const { status } = await record(apptId);
    expect(status).toBe(200);
    expect(await authStatusOf(db, apptId)).toBe('captured');
  });

  it('leaves a NULL (never-charged) authorization_status untouched', async () => {
    const { db, apptId } = await seedAppt(null);
    const { status } = await record(apptId);
    expect(status).toBe(200);
    expect(await authStatusOf(db, apptId)).toBeNull();
  });

  it('does not touch a real Stripe capture (captured stays captured)', async () => {
    const { db, apptId } = await seedAppt('captured');
    const { status } = await record(apptId);
    expect(status).toBe(200);
    expect(await authStatusOf(db, apptId)).toBe('captured');
  });

  it('does not flip triage for a non-revenue record (e.g. a manual refund)', async () => {
    const { db, apptId } = await seedAppt('failed');
    const { status } = await record(apptId, { payment_type: 'refund' });
    expect(status).toBe(200);
    expect(await authStatusOf(db, apptId)).toBe('failed');
  });
});

// T1-5 (in-flight guard): recording revenue must NOT stack on top of a card charge that is already
// collecting or has collected — that is the concurrent-ordering half of the double-collection bug.
describe('POST /api/payments/record — refuses to double-collect a live card charge (T1-5)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedAppt(authStatus: string | null) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
    await db.from('appointments').update({ authorization_status: authStatus }).eq('id', appt.id);
    return { db, apptId: appt.id };
  }

  async function seedStripeRevenueRow(db: ReturnType<typeof createTestSupabaseClient>, apptId: string, status: string) {
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 120,
      status,
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_${status}_${apptId}`,
    });
  }

  async function record(apptId: string, extra: Record<string, unknown> = {}) {
    return callRoute<{ error?: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        organization_id: org.organizationId,
        appointment_id: apptId,
        amount: 120,
        payment_method: 'manual',
        ...extra,
      },
    });
  }

  async function revenueRowCount(db: ReturnType<typeof createTestSupabaseClient>, apptId: string) {
    const { data } = await db.from('payments').select('id').eq('appointment_id', apptId).eq('payment_type', 'revenue');
    return (data ?? []).length;
  }

  it('409 while a card charge is in-flight (authorization_status=charging)', async () => {
    const { db, apptId } = await seedAppt('charging');
    const { status } = await record(apptId);
    expect(status).toBe(409);
    // No cash row was written.
    expect(await revenueRowCount(db, apptId)).toBe(0);
  });

  it('409 when a Stripe card charge is already paid', async () => {
    const { db, apptId } = await seedAppt('captured');
    await seedStripeRevenueRow(db, apptId, 'paid');
    const { status } = await record(apptId);
    expect(status).toBe(409);
    // Still just the one (Stripe) revenue row.
    expect(await revenueRowCount(db, apptId)).toBe(1);
  });

  it('409 when an ACH card charge is still processing', async () => {
    const { db, apptId } = await seedAppt(null);
    await seedStripeRevenueRow(db, apptId, 'processing');
    const { status } = await record(apptId);
    expect(status).toBe(409);
    expect(await revenueRowCount(db, apptId)).toBe(1);
  });

  it('ALLOWS recording cash after the card DECLINED (failed Stripe row does not block)', async () => {
    const { db, apptId } = await seedAppt('failed');
    await seedStripeRevenueRow(db, apptId, 'failed');
    const { status } = await record(apptId);
    expect(status).toBe(200);
    // The cash row is added alongside the failed Stripe row, and triage is cleared.
    expect(await revenueRowCount(db, apptId)).toBe(2);
    expect(await authStatusOf(db, apptId)).toBe('captured');
  });

  it('does not block a non-revenue record even when a card charge is paid', async () => {
    const { db, apptId } = await seedAppt('captured');
    await seedStripeRevenueRow(db, apptId, 'paid');
    const { status } = await record(apptId, { payment_type: 'refund' });
    expect(status).toBe(200);
  });

  async function authStatusOf(db: ReturnType<typeof createTestSupabaseClient>, apptId: string) {
    const { data } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    return (data as { authorization_status: string | null }).authorization_status;
  }
});

// T1-17: per-form-session idempotency. A double-submit / network retry of the SAME session
// replays the first row (no duplicate revenue in reporting); a deliberate second record with a
// fresh key (split/partial cash — product decision 2026-07-26) still inserts.
describe('POST /api/payments/record — idempotency key (T1-17)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedAppt() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
    return { db, apptId: appt.id };
  }

  async function record(apptId: string, extra: Record<string, unknown> = {}) {
    return callRoute<{
      success?: boolean;
      duplicate?: boolean;
      payment?: { id: string };
      error?: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        organization_id: org.organizationId,
        appointment_id: apptId,
        amount: 120,
        payment_method: 'manual',
        ...extra,
      },
    });
  }

  async function revenueRows(db: ReturnType<typeof createTestSupabaseClient>, apptId: string) {
    const { data } = await db
      .from('payments')
      .select('id, manual_record_key')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue');
    return data ?? [];
  }

  it('a same-key resubmit replays the first row instead of inserting a duplicate', async () => {
    const { db, apptId } = await seedAppt();
    const key = crypto.randomUUID();

    const first = await record(apptId, { idempotency_key: key });
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const second = await record(apptId, { idempotency_key: key });
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.payment?.id).toBe(first.body.payment?.id);

    expect(await revenueRows(db, apptId)).toHaveLength(1);
  });

  it('fresh keys still allow a deliberate second (split) record', async () => {
    const { db, apptId } = await seedAppt();
    const first = await record(apptId, { idempotency_key: crypto.randomUUID(), amount: 80 });
    const second = await record(apptId, { idempotency_key: crypto.randomUUID(), amount: 40 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBeUndefined();
    expect(await revenueRows(db, apptId)).toHaveLength(2);
  });

  it('a keyless record still works (backward compatibility)', async () => {
    const { db, apptId } = await seedAppt();
    const { status } = await record(apptId);
    expect(status).toBe(200);
    const rows = await revenueRows(db, apptId);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { manual_record_key: string | null }).manual_record_key).toBeNull();
  });

  it('400 on a malformed idempotency_key (never a Postgres cast 500)', async () => {
    const { db, apptId } = await seedAppt();
    const { status } = await record(apptId, { idempotency_key: 'not-a-uuid' });
    expect(status).toBe(400);
    expect(await revenueRows(db, apptId)).toHaveLength(0);
  });
});
