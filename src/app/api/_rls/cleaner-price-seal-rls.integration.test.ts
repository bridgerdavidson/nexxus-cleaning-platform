import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

/**
 * The price-seal migration (cleaner_price_readpath_seal): the cleaner price seal at the data layer.
 *
 * RLS is row-level, so before the seal the assigned cleaner could read
 * appointments.total_price (and payments.amount, and
 * recurring_appointment_series.total_price) directly with their own session
 * token, which let a request-mode cleaner compute the auto-approve cap and made
 * the 119 price-seal cosmetic. These tests prove:
 *   1. the cleaner's direct SELECT paths to the price are gone,
 *   2. every dependent cleaner surface that used to piggyback on that SELECT
 *      (photos, checklist completions, requested slots, properties, homeowner
 *      profiles, reviews, status updates) still works via the SECURITY DEFINER
 *      helpers,
 *   3. the other roles' access is unchanged, and
 *   4. cleaner_stats still works for the cleaner (it is DEFINER now) without
 *      leaking a price-derived number for request/flat cleaners.
 *
 * RLS denial is `error === null` + zero rows, not a thrown error.
 */

describe('cleaner price seal (cleaner_price_readpath_seal)', () => {
  let org: TestOrgFixture;
  let apptId: string;
  let propertyId: string;
  let serviceTypeId: string;
  const admin = createTestSupabaseClient();

  beforeAll(async () => {
    org = await withTestOrg({ cleanerPayoutModel: 'request', payoutPercent: 60 });
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 137.53,
      status: 'confirmed',
    });
    apptId = appt.id;
    propertyId = appt.propertyId;
    serviceTypeId = appt.serviceTypeId;
    const { error } = await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 137.53,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
    });
    if (error) throw new Error(`payment seed failed: ${error.message}`);
  });

  afterAll(async () => {
    await org.cleanup();
  });

  describe('sealed: the cleaner cannot reach the price', () => {
    it('appointments are invisible to the assigned cleaner', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner
        .from('appointments')
        .select('id, total_price')
        .eq('cleaner_id', org.cleaner.userId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('payments rows for their own job are invisible to the cleaner', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner
        .from('payments')
        .select('id, amount')
        .eq('appointment_id', apptId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('recurring series rows assigned to the cleaner are invisible to them', async () => {
      const { data: series, error: seedError } = await admin
        .from('recurring_appointment_series')
        .insert({
          organization_id: org.organizationId,
          homeowner_id: org.homeowner.userId,
          cleaner_id: org.cleaner.userId,
          property_id: propertyId,
          service_type_id: serviceTypeId,
          start_date: '2026-08-03',
          start_time: '10:00',
          duration_minutes: 60,
          total_price: 137.53,
          recurrence_type: 'weekly',
        })
        .select('id')
        .single();
      expect(seedError).toBeNull();

      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner
        .from('recurring_appointment_series')
        .select('id, total_price')
        .eq('id', (series as { id: string }).id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe('unchanged: the other roles', () => {
    it('the homeowner still reads their own appointment (price included)', async () => {
      const homeowner = createUserClient(org.homeowner.accessToken);
      const { data, error } = await homeowner
        .from('appointments')
        .select('id, total_price')
        .eq('id', apptId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(Number((data![0] as { total_price: number }).total_price)).toBeCloseTo(137.53);
    });

    it('org staff still read the appointment and the payment', async () => {
      const staff = createUserClient(org.admin.accessToken);
      const { data: appts } = await staff.from('appointments').select('id').eq('id', apptId);
      expect(appts).toHaveLength(1);
      const { data: pays } = await staff.from('payments').select('id').eq('appointment_id', apptId);
      expect(pays).toHaveLength(1);
    });
  });

  describe('surviving cleaner surfaces (SECURITY DEFINER helpers)', () => {
    it('job photos: insert, select and delete still work for the assigned cleaner', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data: inserted, error: insertError } = await cleaner
        .from('job_photos')
        .insert({ appointment_id: apptId, photo_url: 'https://x.test/p.jpg', photo_type: 'before' })
        .select('id')
        .single();
      expect(insertError).toBeNull();

      const { data: photos, error: selectError } = await cleaner
        .from('job_photos')
        .select('id, photo_type')
        .eq('appointment_id', apptId);
      expect(selectError).toBeNull();
      expect(photos).toHaveLength(1);

      const { error: deleteError } = await cleaner
        .from('job_photos')
        .delete()
        .eq('id', (inserted as { id: string }).id);
      expect(deleteError).toBeNull();
    });

    it('checklist completions: the cleaner can still check off and read items', async () => {
      const { data: checklist, error: clErr } = await admin
        .from('checklists')
        .insert({ service_type_id: serviceTypeId, name: 'Seal Test Checklist' })
        .select('id')
        .single();
      expect(clErr).toBeNull();
      const { data: lineItem, error: liErr } = await admin
        .from('checklist_line_items')
        .insert({ checklist_id: (checklist as { id: string }).id, task: 'Dust', position: 1 })
        .select('id')
        .single();
      expect(liErr).toBeNull();

      const cleaner = createUserClient(org.cleaner.accessToken);
      const { error: upsertError } = await cleaner.from('checklist_item_completions').upsert(
        {
          appointment_id: apptId,
          checklist_line_item_id: (lineItem as { id: string }).id,
          organization_id: org.organizationId,
        },
        { onConflict: 'appointment_id,checklist_line_item_id' },
      );
      expect(upsertError).toBeNull();

      const { data: completions, error: readError } = await cleaner
        .from('checklist_item_completions')
        .select('checklist_line_item_id')
        .eq('appointment_id', apptId);
      expect(readError).toBeNull();
      expect(completions).toHaveLength(1);
    });

    it('requested slots: the cleaner still sees offered slots for their job', async () => {
      const { error: slotError } = await admin.from('appointment_requested_slots').insert({
        appointment_id: apptId,
        slot_index: 0,
        scheduled_date: '2026-08-04',
        scheduled_time: '09:00',
      });
      expect(slotError).toBeNull();

      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner
        .from('appointment_requested_slots')
        .select('slot_index')
        .eq('appointment_id', apptId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('properties and the homeowner profile still resolve for the cleaner', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data: props, error: propError } = await cleaner
        .from('properties')
        .select('id, address')
        .eq('id', propertyId);
      expect(propError).toBeNull();
      expect(props).toHaveLength(1);

      const { data: profiles, error: profileError } = await cleaner
        .from('user_profiles')
        .select('id, first_name')
        .eq('id', org.homeowner.userId);
      expect(profileError).toBeNull();
      expect(profiles).toHaveLength(1);
    });

    it('reviews: the cleaner can still review their appointment', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { error } = await cleaner.from('reviews').insert({
        appointment_id: apptId,
        reviewer_id: org.cleaner.userId,
        reviewee_id: org.homeowner.userId,
        rating: 5,
        organization_id: org.organizationId,
      });
      expect(error).toBeNull();
    });

    it('status updates: a direct cleaner UPDATE is a silent no-op (writes go through the status route)', async () => {
      // A Postgres UPDATE's WHERE clause needs SELECT rights on the row, so
      // with the SELECT arm sealed a direct cleaner update matches zero rows.
      // The seal also removed the (now dead) cleaner arm from appointments_update;
      // the real write path is POST /api/cleaner/appointments/[id]/status,
      // covered in that route's own test file.
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { error } = await cleaner
        .from('appointments')
        .update({ status: 'in_progress', job_progress: 'before_photos' })
        .eq('id', apptId);
      expect(error).toBeNull();

      const { data: after } = await admin
        .from('appointments')
        .select('status')
        .eq('id', apptId)
        .single();
      expect((after as { status: string }).status).toBe('confirmed');
    });
  });

  describe('cleaner_stats (DEFINER + mode-aware since the price-seal migration)', () => {
    it('request mode: earnings come from payout rows, never price x percent', async () => {
      const { error: payoutError } = await admin.from('payouts').insert([
        {
          organization_id: org.organizationId,
          appointment_id: apptId,
          cleaner_id: org.cleaner.userId,
          amount: 75,
          status: 'paid',
        },
      ]);
      expect(payoutError).toBeNull();

      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner.rpc('cleaner_stats', {
        p_cleaner_id: org.cleaner.userId,
        p_org_id: org.organizationId,
      });
      expect(error).toBeNull();
      const stats = data as Record<string, number>;
      expect(Number(stats.totalJobs)).toBe(1);
      // The real money (payout row), NOT round(137.53 * 60%) = 83.
      expect(Number(stats.totalEarnings)).toBe(75);
      expect(Number(stats.pendingPayouts)).toBe(0);
    });

    it('percentage mode: the legacy estimate is unchanged', async () => {
      await admin
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', apptId);
      await admin
        .from('cleaner_profiles')
        .update({ payout_model: 'percentage' })
        .eq('id', org.cleaner.userId);

      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner.rpc('cleaner_stats', {
        p_cleaner_id: org.cleaner.userId,
        p_org_id: org.organizationId,
      });
      expect(error).toBeNull();
      // round(137.53 * 60%) = round(82.518) = 83
      expect(Number((data as Record<string, number>).totalEarnings)).toBe(83);

      await admin
        .from('cleaner_profiles')
        .update({ payout_model: 'request' })
        .eq('id', org.cleaner.userId);
    });

    it('rejects a caller who is neither the cleaner nor org staff', async () => {
      const homeowner = createUserClient(org.homeowner.accessToken);
      const { error } = await homeowner.rpc('cleaner_stats', {
        p_cleaner_id: org.cleaner.userId,
        p_org_id: org.organizationId,
      });
      expect(error).not.toBeNull();
    });

    it('still works for org staff', async () => {
      const staff = createUserClient(org.admin.accessToken);
      const { error } = await staff.rpc('cleaner_stats', {
        p_cleaner_id: org.cleaner.userId,
        p_org_id: org.organizationId,
      });
      expect(error).toBeNull();
    });
  });
});
