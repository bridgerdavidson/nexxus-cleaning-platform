import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Off-session cancellation-fee charge. The real impl calls getStripe() (stubbed to throw by the
// global integration setup), so mock the charge primitive + PM-type lookup; the orchestration, fee
// math, and ledger run for real against the local DB.
vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(async () => ({ id: 'pi_cancelfee', status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'card'),
}));

import { POST } from './route';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  addHomeownerToOrg,
  addManagerToOrg,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

const today = () => new Date().toISOString().slice(0, 10);

describe('POST /api/appointments/:appointmentId/cancel', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    vi.mocked(createDestinationCharge).mockClear();
    vi.mocked(createDestinationCharge).mockResolvedValue({ id: 'pi_cancelfee', status: 'succeeded' } as never);
    vi.mocked(getPaymentMethodType).mockClear();
    vi.mocked(getPaymentMethodType).mockResolvedValue('card');
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  async function setPolicy(fields: {
    type: string;
    value: number;
    windowHours?: number;
    noShowType?: string;
    noShowValue?: number;
  }) {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        cancellation_fee_type: fields.type,
        cancellation_fee_value: fields.value,
        cancellation_window_hours: fields.windowHours ?? 24,
        // The no-show fee is a separate policy (T1-6); default it to mirror the late-cancel fee so the
        // existing no-show tests keep charging, and let independence tests override it.
        no_show_fee_type: fields.noShowType ?? fields.type,
        no_show_fee_value: fields.noShowValue ?? fields.value,
      })
      .eq('id', org.organizationId);
  }

  // A homeowner appointment whose org can accept charges and whose homeowner has a saved card.
  async function seedAppointment(
    opts: { scheduledDate?: string; scheduledTime?: string; withCard?: boolean } = {},
  ) {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_ready_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_test_homeowner' }).eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
      scheduledDate: opts.scheduledDate ?? today(),
      scheduledTime: opts.scheduledTime ?? '12:00:00',
    });
    if (opts.withCard !== false) {
      await db.from('appointments').update({ payment_method_id: 'pm_test_card' }).eq('id', appt.id);
    }
    return appt;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await seedAppointment();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organization_id: org.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const appt = await seedAppointment();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(403);
  });

  it('404 for an appointment in another org (no existence leak)', async () => {
    const appt = await seedAppointment();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organization_id: org2.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(404);
  });

  it('homeowner no-show: charges the flat fee off-session to the saved card', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number; fee_outcome: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
      },
    );
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(5000);
    expect(body.fee_outcome).toBe('charged');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createDestinationCharge).mock.calls[0][0];
    expect(arg.grossCents).toBe(5000);
    expect(arg.keyPrefix).toBe('cancelfee');

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');

    const { data: p } = await db.from('payments').select('status, amount').eq('appointment_id', appt.id).single();
    expect((p as { status: string }).status).toBe('paid');
    expect(Number((p as { amount: number }).amount)).toBe(50);

    const { data: events } = await db.from('payment_events').select('event_type').eq('appointment_id', appt.id);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'cancellation_fee_charged')).toBe(true);

    // T2-1: the homeowner is told, through the real route wiring. `reason` has to come from the
    // same no-show flag the fee was billed under, so an inversion between the route and the fee
    // helper would show up here and nowhere else.
    const { data: notes } = await db
      .from('notification_events')
      .select('recipient_user_id, payload')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cancellation_fee_charged');
    const noteRows = (notes ?? []) as Array<{
      recipient_user_id: string;
      payload: Record<string, unknown>;
    }>;
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0].recipient_user_id).toBe(org.homeowner.userId);
    expect(noteRows[0].payload.amount_cents).toBe(5000);
    expect(noteRows[0].payload.reason).toBe('no_show');
  });

  it('T1-6: a no-show is billed by the no-show policy, not the late-cancel policy (free cancels, $50 no-show)', async () => {
    // The exact prod misconfig T1-6 fixes: cancellations are free, but a no-show should cost $50.
    await setPolicy({ type: 'none', value: 0, noShowType: 'flat', noShowValue: 50 });
    const appt = await seedAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number; fee_outcome: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
      },
    );
    expect(status).toBe(200);
    // Charged from no_show_fee_*, NOT the $0 cancellation policy (was silently $0 before T1-6).
    expect(body.fee_captured_cents).toBe(5000);
    expect(body.fee_outcome).toBe('charged');
  });

  it('T1-6: a late (inside-window) cancel is NOT billed the no-show fee', async () => {
    // Inverse independence: free late-cancels, $50 no-show. A late cancel (not a no-show) charges $0.
    await setPolicy({ type: 'none', value: 0, noShowType: 'flat', noShowValue: 50, windowHours: 24 });
    const appt = await seedAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: false },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
  });

  it('homeowner late-cancel inside window: charges a percent fee', async () => {
    await setPolicy({ type: 'percent', value: 20, windowHours: 24 });
    const appt = await seedAppointment({ scheduledDate: today(), scheduledTime: '12:00:00' });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: false },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(2000); // 20% of $100
    expect(vi.mocked(createDestinationCharge).mock.calls[0][0].grossCents).toBe(2000);
  });

  it('cleaner-caused cancel: charges nothing', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'cleaner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
  });

  it('on-time homeowner cancel (outside window): no fee, no charge', async () => {
    await setPolicy({ type: 'percent', value: 20, windowHours: 24 });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const appt = await seedAppointment({ scheduledDate: future, scheduledTime: '12:00:00' });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: false },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('no saved card: cancels without charging (uncollectable)', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment({ withCard: false });

    const { status, body } = await callRoute<{ fee_captured_cents: number; fee_outcome: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
      },
    );
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(body.fee_outcome).toBe('uncollectable');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
  });

  it('a declined card never blocks the cancellation (failed outcome, still cancelled)', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('Your card was declined.'));

    const { status, body } = await callRoute<{ fee_captured_cents: number; fee_outcome: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
      },
    );
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(body.fee_outcome).toBe('failed');

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
    const { data: events } = await db.from('payment_events').select('event_type').eq('appointment_id', appt.id);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'cancellation_fee_failed')).toBe(true);
  });

  it('a bank (ACH) payer is not charged a small fee (uncollectable)', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();
    vi.mocked(getPaymentMethodType).mockResolvedValue('us_bank_account');

    const { status, body } = await callRoute<{ fee_captured_cents: number; fee_outcome: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
      },
    );
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(body.fee_outcome).toBe('uncollectable');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('idempotent: a second cancel does not double-charge the fee', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();

    const first = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(first.status).toBe(200);
    expect(first.body.fee_captured_cents).toBe(5000);
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);

    const second = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(second.status).toBe(200);
    expect(second.body.fee_captured_cents).toBe(5000);
    // The paid revenue row short-circuits a re-charge.
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
  });

  // Self-pay: cancellation never charges a fee (the org can't charge itself).
  async function seedSelfPayAppointment(opts: { scheduledDate?: string; scheduledTime?: string } = {}) {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
      scheduledDate: opts.scheduledDate ?? today(),
      scheduledTime: opts.scheduledTime ?? '12:00:00',
      orgOwnedProperty: true,
      selfPay: true,
    });
    return appt;
  }

  it('self-pay no-show inside window: cancels and charges $0 (no fee)', async () => {
    // Even with an aggressive cancellation-fee policy, self-pay never charges a fee.
    await setPolicy({ type: 'flat', value: 50, windowHours: 48 });
    const appt = await seedSelfPayAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
  });

  // ── Charge-at-completion guards (audit findings C3 / H6 / H7) ─────────────────

  async function insertRevenueRow(
    appointmentId: string,
    fields: { status: string; chargeKind: string; paymentMethod?: string },
  ) {
    const db = createTestSupabaseClient();
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appointmentId,
      amount: 100,
      status: fields.status,
      payment_method: fields.paymentMethod ?? 'card',
      payment_type: 'revenue',
      charge_kind: fields.chargeKind,
      stripe_payment_intent_id: `pi_guard_${appointmentId}`,
    });
  }

  it('a PAID completion charge blocks the cancel (409: refund instead)', async () => {
    const appt = await seedAppointment();
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ status: 'completed' }).eq('id', appt.id);
    await insertRevenueRow(appt.id, { status: 'paid', chargeKind: 'completion' });

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(409);

    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('completed');
  });

  it('an in-flight bank debit: cancel proceeds with NO fee and flags the refund-on-settle', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ status: 'completed' }).eq('id', appt.id);
    await insertRevenueRow(appt.id, { status: 'processing', chargeKind: 'completion', paymentMethod: 'ach' });

    const { status, body } = await callRoute<{
      fee_captured_cents: number;
      inflight_debit?: boolean;
    }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(body.inflight_debit).toBe(true);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');

    const { data: events } = await db.from('payment_events').select('event_type').eq('appointment_id', appt.id);
    expect(
      (events ?? []).some((e) => (e as { event_type: string }).event_type === 'cancelled_with_inflight_debit'),
    ).toBe(true);
  });

  it('cancelling a COMPLETED (uncharged) job is an administrative undo: no fee', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ status: 'completed' }).eq('id', appt.id);

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('a fee retry after a decline uses a fresh idempotency attempt (H6)', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('Your card was declined.'));

    const first = await callRoute<{ fee_outcome: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(first.status).toBe(200);
    expect(first.body.fee_outcome).toBe('failed');

    const second = await callRoute<{ fee_outcome: string; fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(second.status).toBe(200);
    expect(second.body.fee_outcome).toBe('charged');
    expect(second.body.fee_captured_cents).toBe(5000);

    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(2);
    const firstArg = vi.mocked(createDestinationCharge).mock.calls[0][0] as { reauthAttempt?: number };
    const secondArg = vi.mocked(createDestinationCharge).mock.calls[1][0] as { reauthAttempt?: number };
    expect(firstArg.reauthAttempt ?? 0).toBe(0);
    expect(secondArg.reauthAttempt).toBe(1);

    // The lost fee surfaced to admins (and is deduped per attempt).
    const db = createTestSupabaseClient();
    const { data: notifs } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cancellation_fee_failed');
    expect((notifs ?? []).length).toBeGreaterThan(0);
  });

  // ── Owning-homeowner self-cancel (Slice 2) ───────────────────────────────────
  // A homeowner caller may cancel only their OWN appointment, and the server forces
  // party='homeowner' + no_show=false so they can't dodge the fee by blaming the
  // cleaner or self-declaring a no-show. Org-staff behavior is unchanged.

  it('owning homeowner cannot dodge the fee by claiming a cleaner-caused cancel (party forced)', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment({ scheduledDate: today(), scheduledTime: '12:00:00' });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId, party: 'cleaner', no_show: false },
    });
    expect(status).toBe(200);
    // The homeowner flat fee IS charged despite party:'cleaner' — the override won.
    expect(body.fee_captured_cents).toBe(5000);
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createDestinationCharge).mock.calls[0][0].grossCents).toBe(5000);

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
  });

  it('an in-org homeowner who does NOT own the appointment is rejected (404, no charge)', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment(); // owned by org.homeowner
    const other = await addHomeownerToOrg(org.organizationId);
    try {
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(other.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner', no_show: false },
      });
      expect(status).toBe(404);
      expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

      const db = createTestSupabaseClient();
      const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
      expect((a as { status: string }).status).toBe('confirmed');
    } finally {
      await other.cleanup();
    }
  });

  it('owning homeowner cancels their own on-time appointment for free', async () => {
    await setPolicy({ type: 'percent', value: 20, windowHours: 24 });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const appt = await seedAppointment({ scheduledDate: future, scheduledTime: '12:00:00' });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
  });

  // ── Manager permission gating (Task 5) ────────────────────────────────────────
  // requireManagerPermission preserves the existing allowedRoles (owner/admin/manager/
  // homeowner) and only gates the 'manager' branch on can_edit_bookings; the homeowner
  // ownership branch above is untouched.

  describe('manager permission gating', () => {
    let mgr: ManagerMemberHandle;

    afterEach(async () => {
      if (mgr) await mgr.cleanup();
    });

    it('403s for a manager without can_edit_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
      const appt = await seedAppointment();
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organization_id: org.organizationId, party: 'org' },
      });
      expect(status).toBe(403);
    });

    it('passes auth for a manager WITH can_edit_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
      const appt = await seedAppointment();
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organization_id: org.organizationId, party: 'org' },
      });
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });

    it('does NOT block a homeowner cancelling their own appointment (they use their own branch)', async () => {
      const appt = await seedAppointment({ scheduledDate: today(), scheduledTime: '12:00:00' });
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.homeowner.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });
  });

  // T1-18(a): the previews compute the late-cancel window on the client clock; the route shifts
  // its own clock BACK by a 5-minute skew grace so a cancel previewed as "outside the window"
  // can never flip to a charged fee at submit purely from clock skew. The grace must not swallow
  // genuinely-late cancels beyond it.
  describe('window-boundary skew grace (T1-18a)', () => {
    function localParts(msFromNow: number) {
      const d = new Date(Date.now() + msFromNow);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      };
    }

    it('charges NO fee just inside the boundary (within the skew grace)', async () => {
      await setPolicy({ type: 'flat', value: 50, windowHours: 24 });
      // Scheduled 23h58m out: nominally 2 minutes inside the 24h window (a client clock 2 minutes
      // behind previewed this as outside → $0), within the 5-minute grace.
      const { date, time } = localParts(24 * 60 * 60_000 - 2 * 60_000);
      const appt = await seedAppointment({ scheduledDate: date, scheduledTime: time });
      const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner' },
      });
      expect(status).toBe(200);
      expect(body.fee_captured_cents).toBe(0);
      expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
    });

    it('still charges the fee for a late cancel beyond the grace', async () => {
      await setPolicy({ type: 'flat', value: 50, windowHours: 24 });
      // Scheduled 23h50m out: 10 minutes inside the window, beyond the 5-minute grace.
      const { date, time } = localParts(24 * 60 * 60_000 - 10 * 60_000);
      const appt = await seedAppointment({ scheduledDate: date, scheduledTime: time });
      const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, party: 'homeowner' },
      });
      expect(status).toBe(200);
      expect(body.fee_captured_cents).toBe(5000);
    });
  });
});
