import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../tests/helpers/fixtures';
import { createTestSupabaseClient, createUserClient } from '../../tests/helpers/supabase';

/**
 * RLS coverage for the live job-progress read paths (useJobChecklistProgress):
 * homeowner via their own appointment (migration 097) and org staff via the
 * appointment's organization (cic_org_read, re-keyed off appointments by
 * migration 20260813165943 so a NULL client-stamped organization_id can no
 * longer hide rows from the operator).
 *
 * Two completions are seeded: one with organization_id stamped, one with NULL,
 * mirroring what older cleaner clients may have written.
 */
describe('checklist_item_completions read RLS (homeowner + org staff)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let appointmentId: string;

  // Track IDs for explicit cleanup if cascade doesn't cover the checklist chain.
  let checklistId: string | null = null;
  let lineItemIds: string[] = [];

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'in_progress',
    });
    appointmentId = appt.id;

    const admin = createTestSupabaseClient();

    const { data: checklist, error: clErr } = await admin
      .from('checklists')
      .insert({ service_type_id: appt.serviceTypeId, name: 'Test Checklist', price_adder: 0 })
      .select('id')
      .single();
    if (clErr || !checklist) throw new Error(`checklist insert failed: ${clErr?.message}`);
    checklistId = checklist.id as string;

    const { data: lineItems, error: liErr } = await admin
      .from('checklist_line_items')
      .insert([
        { checklist_id: checklist.id, task: 'Wipe counters', position: 0 },
        { checklist_id: checklist.id, task: 'Mop floors', position: 1 },
      ])
      .select('id');
    if (liErr || !lineItems || lineItems.length !== 2) {
      throw new Error(`line item insert failed: ${liErr?.message}`);
    }
    lineItemIds = lineItems.map((li) => li.id as string);

    const { error: cicErr } = await admin.from('checklist_item_completions').insert([
      {
        appointment_id: appointmentId,
        checklist_line_item_id: lineItemIds[0],
        organization_id: org.organizationId,
      },
      {
        // Older cleaner clients could stamp NULL here; org staff must still see it.
        appointment_id: appointmentId,
        checklist_line_item_id: lineItemIds[1],
        organization_id: null,
      },
    ]);
    if (cicErr) throw new Error(`completion insert failed: ${cicErr.message}`);
  });

  afterEach(async () => {
    const admin = createTestSupabaseClient();

    // Explicit cleanup of the checklist chain before org deletion,
    // in case foreign-key constraints are not cascaded from org delete.
    if (lineItemIds.length > 0) {
      await admin
        .from('checklist_item_completions')
        .delete()
        .in('checklist_line_item_id', lineItemIds);
      await admin.from('checklist_line_items').delete().in('id', lineItemIds);
      lineItemIds = [];
    }
    if (checklistId) {
      await admin.from('checklists').delete().eq('id', checklistId);
    }

    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('lets the owning homeowner read their appointment completions', async () => {
    const client = createUserClient(org.homeowner.accessToken); // RLS-enforced
    const { data, error } = await client
      .from('checklist_item_completions')
      .select('*')
      .eq('appointment_id', appointmentId);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it('does NOT let a different homeowner read those completions', async () => {
    const client = createUserClient(org2.homeowner.accessToken); // RLS-enforced, not a participant
    const { data } = await client
      .from('checklist_item_completions')
      .select('*')
      .eq('appointment_id', appointmentId);
    expect(data ?? []).toHaveLength(0);
  });

  it('lets org staff read ALL completions, including NULL organization_id rows', async () => {
    const client = createUserClient(org.admin.accessToken); // RLS-enforced org admin
    const { data, error } = await client
      .from('checklist_item_completions')
      .select('*')
      .eq('appointment_id', appointmentId);
    expect(error).toBeNull();
    // The old organization_id-keyed policy hid the NULL-stamped row (1 of 2);
    // the appointments-join policy must return both.
    expect(data).toHaveLength(2);
  });

  it('does NOT let staff of another org read those completions', async () => {
    const client = createUserClient(org2.admin.accessToken); // RLS-enforced, wrong org
    const { data } = await client
      .from('checklist_item_completions')
      .select('*')
      .eq('appointment_id', appointmentId);
    expect(data ?? []).toHaveLength(0);
  });
});
