import { describe, it, expect, afterEach } from 'vitest';
import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg, createTestAppointment, addManagerToOrg,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const admin = createTestSupabaseClient();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function seedOrg(opts: Parameters<typeof withTestOrg>[0] = {}) {
  const org = await withTestOrg(opts);
  cleanups.push(() => org.cleanup());
  return org;
}

function call(appointmentId: string, token: string, body: Record<string, unknown>) {
  return callRoute<Record<string, unknown>>((req) => PATCH(req, { params: Promise.resolve({ appointmentId }) }), {
    method: 'PATCH',
    body,
    headers: bearerHeader(token),
  });
}

async function getRow(id: string) {
  const { data } = await admin
    .from('appointments')
    .select('status, total_price, duration_minutes, special_requests, notes, checklist_id, price_override_enabled, price_override_total, service_type_id')
    .eq('id', id)
    .single();
  return data as Record<string, unknown>;
}

describe('PATCH /api/appointments/[appointmentId]/details', () => {
  it('a notes-only save never touches price or duration (change-driven recompute)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, totalPrice: 77 });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: 'Gate code 4482', notes: 'prefers mornings',
    });
    expect(res.status).toBe(200);
    const row = await getRow(appt.id);
    expect(row).toMatchObject({ total_price: 77, duration_minutes: 60, special_requests: 'Gate code 4482', notes: 'prefers mornings' });
  });

  it('a service change reprices (base + adder) and re-durations', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const { data: svc } = await admin.from('service_types').insert({
      organization_id: org.organizationId, name: 'Deep', base_price: 160, duration_minutes: 120, service_type: 'deep',
    }).select('id').single();
    const { data: cl } = await admin.from('checklists').insert({
      service_type_id: (svc as { id: string }).id, name: 'Standard deep', price_adder: 20,
    }).select('id').single();
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: (svc as { id: string }).id, checklistId: (cl as { id: string }).id,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: null,
    });
    expect(res.status).toBe(200);
    expect(await getRow(appt.id)).toMatchObject({ total_price: 180, duration_minutes: 120, checklist_id: (cl as { id: string }).id });
  });

  it('override wins during a service change (override total, new duration)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, totalPrice: 100 });
    const { data: svc } = await admin.from('service_types').insert({
      organization_id: org.organizationId, name: 'Deep', base_price: 160, duration_minutes: 120, service_type: 'deep',
    }).select('id').single();
    const { data: cl } = await admin.from('checklists').insert({
      service_type_id: (svc as { id: string }).id, name: 'Standard deep', price_adder: 20,
    }).select('id').single();

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: (svc as { id: string }).id, checklistId: (cl as { id: string }).id,
      priceOverrideEnabled: true, priceOverrideTotal: 333, specialRequests: null, notes: null,
    });
    expect(res.status).toBe(200);
    // Override beats base+adder (160+20=180); duration follows the NEW service.
    expect(await getRow(appt.id)).toMatchObject({
      total_price: 333, price_override_enabled: true, price_override_total: 333,
      duration_minutes: 120, service_type_id: (svc as { id: string }).id, checklist_id: (cl as { id: string }).id,
    });
  });

  it('rejects a checklist that belongs to a different service', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const { data: svc2 } = await admin.from('service_types').insert({
      organization_id: org.organizationId, name: 'Move-out', base_price: 200, duration_minutes: 180, service_type: 'move_out',
    }).select('id').single();
    const { data: otherSvc } = await admin.from('service_types').insert({
      organization_id: org.organizationId, name: 'Other', base_price: 90, duration_minutes: 60, service_type: 'regular',
    }).select('id').single();
    const { data: otherChecklist } = await admin.from('checklists').insert({
      service_type_id: (otherSvc as { id: string }).id, name: 'Belongs to other service', price_adder: 0,
    }).select('id').single();

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: (svc2 as { id: string }).id, checklistId: (otherChecklist as { id: string }).id,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: null,
    });
    expect(res.status).toBe(400);

    // appointment untouched
    const row = await getRow(appt.id);
    expect(row.service_type_id).toBe(appt.serviceTypeId);
  });

  it('override on requires a valid total; off nulls price_override_total', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, totalPrice: 100 });

    const missingTotal = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: true, priceOverrideTotal: null, specialRequests: null, notes: null,
    });
    expect(missingTotal.status).toBe(400);

    const enabled = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: true, priceOverrideTotal: 250, specialRequests: null, notes: null,
    });
    expect(enabled.status).toBe(200);
    expect(await getRow(appt.id)).toMatchObject({ total_price: 250, price_override_enabled: true, price_override_total: 250 });

    const disabled = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: null,
    });
    expect(disabled.status).toBe(200);
    const row = await getRow(appt.id);
    expect(row.price_override_enabled).toBe(false);
    expect(row.price_override_total).toBeNull();
    expect(row.total_price).toBe(100);
  });

  it('paid guard blocks price-affecting edits (legacy NULL charge_kind counts; cancellation_fee does not)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const { data: payRow } = await admin.from('payments').insert({
      organization_id: org.organizationId, appointment_id: appt.id, amount: 100,
      payment_method: 'manual', payment_type: 'revenue', status: 'paid',
    }).select('id').single();

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: true, priceOverrideTotal: 250, specialRequests: null, notes: null,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ paidGuard: true });

    // notes-only save still works with the paid row present:
    const notesOnly = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: 'ok',
    });
    expect(notesOnly.status).toBe(200);
    expect((await getRow(appt.id)).notes).toBe('ok');

    // a cancellation_fee row alone must NOT block: flip charge_kind and retry the price edit
    await admin.from('payments').update({ charge_kind: 'cancellation_fee' }).eq('id', (payRow as { id: string }).id);
    const retried = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: true, priceOverrideTotal: 250, specialRequests: null, notes: null,
    });
    expect(retried.status).toBe(200);
    expect((await getRow(appt.id)).total_price).toBe(250);
  });

  it('gates: manager needs can_edit_bookings; completed booking is 409 stale', async () => {
    const org = await seedOrg();
    const none = await addManagerToOrg(org.organizationId, { can_handle_requests: true });
    cleanups.push(() => none.cleanup());
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const denied = await call(appt.id, none.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: 'nope',
    });
    expect(denied.status).toBe(403);

    const completed = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'completed' });
    const staleRes = await call(completed.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: completed.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: 'nope',
    });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body).toMatchObject({ stale: true });
  });
});
