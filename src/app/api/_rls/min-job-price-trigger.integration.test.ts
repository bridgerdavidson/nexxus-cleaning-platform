import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { MIN_JOB_PRICE_MESSAGE } from '@/lib/pricing/minJobPrice';

// Migration require_min_price: BEFORE triggers on appointments, recurring_appointment_series,
// and service_types reject a new or changed price under $1.00 with SQLSTATE 23514 and the
// same copy as src/lib/pricing/minJobPrice.ts.
//
// The operator booking form and the services screen write straight from the browser
// through the RLS client, so these tests drive the same path: an org admin's
// user-scoped client (createUserClient). The service-role client is used only for setup
// and for proving the guard is not an RLS artifact (triggers fire for service role too).
//
// Legacy under-$1 rows (production has one $0 service and one $0 appointment) cannot be
// created through PostgREST any more, so "an unrelated update on a legacy $0 row still
// works" was verified directly in SQL with the trigger disabled inside a rolled-back
// transaction. Here the unchanged-price rule is proven on $1 rows instead.

const admin = createTestSupabaseClient();

function expectMinPriceViolation(error: { code?: string; message?: string } | null) {
  expect(error).not.toBeNull();
  expect(error?.code).toBe('23514');
  expect(error?.message).toBe(MIN_JOB_PRICE_MESSAGE);
}

describe('require_min_price DB triggers', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** A $100 appointment on a fresh property + service (fixture), with the service base set to `basePrice`. */
  async function seedPropertyAndService(basePrice = 100) {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
    });
    const { error } = await admin.from('service_types').update({ base_price: basePrice }).eq('id', appt.serviceTypeId);
    expect(error).toBeNull();
    return appt;
  }

  function appointmentRow(propertyId: string, serviceTypeId: string, totalPrice: number) {
    return {
      organization_id: org.organizationId,
      homeowner_id: org.homeowner.userId,
      cleaner_id: org.cleaner.userId,
      property_id: propertyId,
      service_type_id: serviceTypeId,
      scheduled_date: '2026-10-01',
      scheduled_time: '10:00',
      duration_minutes: 60,
      total_price: totalPrice,
      status: 'pending',
    };
  }

  describe('service_types.base_price', () => {
    function serviceRow(basePrice: number) {
      return {
        organization_id: org.organizationId,
        name: `Svc ${basePrice}`,
        base_price: basePrice,
        duration_minutes: 60,
        service_type: 'custom',
      };
    }

    it('rejects a $0 service insert from the browser (org admin RLS client)', async () => {
      const db = createUserClient(org.admin.accessToken);
      const { data, error } = await db.from('service_types').insert(serviceRow(0)).select('id');
      expectMinPriceViolation(error);
      expect(data).toBeNull();
    });

    it('rejects $0.99, and the service role is not exempt', async () => {
      const { error } = await admin.from('service_types').insert(serviceRow(0.99)).select('id');
      expectMinPriceViolation(error);
    });

    it('accepts exactly $1', async () => {
      const db = createUserClient(org.admin.accessToken);
      const { data, error } = await db.from('service_types').insert(serviceRow(1)).select('id, base_price').single();
      expect(error).toBeNull();
      expect(Number((data as { base_price: number }).base_price)).toBe(1);
    });

    it('rejects re-pricing a service under $1, but an update that resends the same price passes', async () => {
      const db = createUserClient(org.admin.accessToken);
      const { data: svc } = await db.from('service_types').insert(serviceRow(1)).select('id').single();
      const id = (svc as { id: string }).id;

      const lowered = await db.from('service_types').update({ base_price: 0.5 }).eq('id', id).select('id');
      expectMinPriceViolation(lowered.error);

      // updateService sends every form field, base_price included, on an unrelated edit.
      const renamed = await db
        .from('service_types')
        .update({ name: 'Renamed', base_price: 1, is_active: false })
        .eq('id', id)
        .select('name')
        .single();
      expect(renamed.error).toBeNull();
      expect((renamed.data as { name: string }).name).toBe('Renamed');
    });
  });

  describe('appointments.total_price', () => {
    it('rejects a $0 one-time booking insert from the browser (the operator booking form path)', async () => {
      const { propertyId, serviceTypeId } = await seedPropertyAndService();
      const db = createUserClient(org.admin.accessToken);
      const { data, error } = await db
        .from('appointments')
        .insert(appointmentRow(propertyId, serviceTypeId, 0))
        .select('id');
      expectMinPriceViolation(error);
      expect(data).toBeNull();
    });

    it('rejects $0.50 even with a price override flagged', async () => {
      const { propertyId, serviceTypeId } = await seedPropertyAndService();
      const db = createUserClient(org.admin.accessToken);
      const { error } = await db
        .from('appointments')
        .insert({
          ...appointmentRow(propertyId, serviceTypeId, 0.5),
          price_override_enabled: true,
          price_override_total: 0.5,
        })
        .select('id');
      expectMinPriceViolation(error);
    });

    it('accepts a $1 booking', async () => {
      const { propertyId, serviceTypeId } = await seedPropertyAndService();
      const db = createUserClient(org.admin.accessToken);
      const { data, error } = await db
        .from('appointments')
        .insert(appointmentRow(propertyId, serviceTypeId, 1))
        .select('total_price')
        .single();
      expect(error).toBeNull();
      expect(Number((data as { total_price: number }).total_price)).toBe(1);
    });

    it('rejects re-pricing a booking under $1; unrelated and same-price updates still work', async () => {
      const appt = await seedPropertyAndService();
      const db = createUserClient(org.admin.accessToken);

      const lowered = await db.from('appointments').update({ total_price: 0 }).eq('id', appt.id).select('id');
      expectMinPriceViolation(lowered.error);

      const unrelated = await db
        .from('appointments')
        .update({ notes: 'gate code 4482', status: 'confirmed' })
        .eq('id', appt.id)
        .select('notes, total_price')
        .single();
      expect(unrelated.error).toBeNull();
      expect(unrelated.data).toMatchObject({ notes: 'gate code 4482' });
      expect(Number((unrelated.data as { total_price: number }).total_price)).toBe(100);

      // Price column written with its current value: not a change, so not checked.
      const same = await admin.from('appointments').update({ total_price: 100, notes: 'same' }).eq('id', appt.id);
      expect(same.error).toBeNull();
    });
  });

  describe('recurring_appointment_series.total_price', () => {
    function seriesRow(propertyId: string, serviceTypeId: string, totalPrice: number) {
      return {
        organization_id: org.organizationId,
        homeowner_id: org.homeowner.userId,
        property_id: propertyId,
        service_type_id: serviceTypeId,
        start_date: '2026-10-01',
        start_time: '10:00',
        duration_minutes: 60,
        total_price: totalPrice,
        recurrence_type: 'weekly',
      };
    }

    it('rejects a $0 series and accepts a $1 series', async () => {
      const { propertyId, serviceTypeId } = await seedPropertyAndService();
      const zero = await admin.from('recurring_appointment_series').insert(seriesRow(propertyId, serviceTypeId, 0)).select('id');
      expectMinPriceViolation(zero.error);

      const one = await admin
        .from('recurring_appointment_series')
        .insert(seriesRow(propertyId, serviceTypeId, 1))
        .select('id')
        .single();
      expect(one.error).toBeNull();

      const lowered = await admin
        .from('recurring_appointment_series')
        .update({ total_price: 0.5 })
        .eq('id', (one.data as { id: string }).id);
      expectMinPriceViolation(lowered.error);
    });
  });

  describe('checklist price_adder recalculation (trigger_checklist_price_adder_recalc)', () => {
    it('keeps working: raising and lowering an adder re-prices rows that stay at or above $1', async () => {
      // A $1 service: the lowest base the platform allows, so dropping the adder back to 0
      // lands exactly on the minimum.
      const { propertyId, serviceTypeId } = await seedPropertyAndService(1);
      const { data: cl } = await admin
        .from('checklists')
        .insert({ service_type_id: serviceTypeId, name: 'Priced tier', price_adder: 0 })
        .select('id')
        .single();
      const checklistId = (cl as { id: string }).id;
      const { data: appt, error: apptErr } = await admin
        .from('appointments')
        .insert({ ...appointmentRow(propertyId, serviceTypeId, 1), checklist_id: checklistId })
        .select('id')
        .single();
      expect(apptErr).toBeNull();
      const apptId = (appt as { id: string }).id;

      const db = createUserClient(org.admin.accessToken);
      const raised = await db.from('checklists').update({ price_adder: 5 }).eq('id', checklistId);
      expect(raised.error).toBeNull();
      const afterRaise = await admin.from('appointments').select('total_price').eq('id', apptId).single();
      expect(Number((afterRaise.data as { total_price: number }).total_price)).toBe(6);

      const lowered = await db.from('checklists').update({ price_adder: 0 }).eq('id', checklistId);
      expect(lowered.error).toBeNull();
      const afterLower = await admin.from('appointments').select('total_price').eq('id', apptId).single();
      expect(Number((afterLower.data as { total_price: number }).total_price)).toBe(1);

      // A checklist rename (no adder change) never touches prices at all.
      const renamed = await db.from('checklists').update({ name: 'Renamed tier' }).eq('id', checklistId);
      expect(renamed.error).toBeNull();
    });
  });
});
