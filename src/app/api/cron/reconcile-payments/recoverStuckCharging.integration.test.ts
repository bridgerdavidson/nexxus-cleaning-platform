import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * recoverStuckCharging: the reconcile step that releases appointments orphaned in the transient
 * 'charging' claim sentinel (a function timeout/kill between the charge claim and finishCharge).
 * Sibling of chargeUncollected.integration.test.ts. There is a BEFORE UPDATE trigger on appointments
 * that forces updated_at=NOW(), so a freshly-seeded row can't be aged directly; instead the two
 * branches of the `updated_at <= cutoff` filter are exercised via the staleMinutes knob (0 = cutoff
 * at call time, which is AFTER the seed, so the row is "stale"; 10 = cutoff 10 min before the seed,
 * so the row is "fresh"). This mirrors the proven staleMinutes:0 pattern in the sibling test.
 */
import { recoverStuckCharging } from '@/lib/payments/reconcile';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('recoverStuckCharging (reconcile sweep)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedCharging(): Promise<string> {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    await db
      .from('appointments')
      .update({ payment_method_id: 'pm_stuck', authorization_status: 'charging' })
      .eq('id', appt.id);
    return appt.id;
  }

  it('resets a stale charging appointment back to NULL', async () => {
    const db = createTestSupabaseClient();
    const apptId = await seedCharging();

    // staleMinutes:0 => cutoff is computed at call time, AFTER the seed UPDATE, so updated_at<=cutoff.
    const result = await recoverStuckCharging(db, { staleMinutes: 0 });
    expect(result.reset).toBe(1);

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBeNull();

    // A drift_repaired forensic event was written for the release.
    const { data: events } = await db
      .from('payment_events')
      .select('event_type, payload')
      .eq('appointment_id', apptId);
    expect(
      (events ?? []).some(
        (e) =>
          (e as { event_type: string }).event_type === 'drift_repaired' &&
          (e as { payload: { source?: string } }).payload?.source === 'recover-stuck-charging',
      ),
    ).toBe(true);
  });

  it('leaves a fresh charging appointment untouched (updated_at newer than the cutoff)', async () => {
    const db = createTestSupabaseClient();
    const apptId = await seedCharging();

    // staleMinutes:10 => cutoff is 10 min before the just-seeded row, so it is NOT stale yet.
    const result = await recoverStuckCharging(db, { staleMinutes: 10 });
    expect(result.reset).toBe(0);

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBe('charging');
  });

  it('does not re-arm a stuck charging row whose completion charge is already in flight (processing)', async () => {
    const db = createTestSupabaseClient();
    const apptId = await seedCharging();
    // Crash between finishCharge writing the processing payment row and clearing 'charging'.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 100,
      status: 'processing',
      payment_type: 'revenue',
      payment_method: 'ach',
      charge_kind: 'completion',
      stripe_payment_intent_id: `pi_inflight_${apptId}`,
    });

    const result = await recoverStuckCharging(db, { staleMinutes: 0 });
    expect(result.reset).toBe(0);

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBe('charging');
  });
});
