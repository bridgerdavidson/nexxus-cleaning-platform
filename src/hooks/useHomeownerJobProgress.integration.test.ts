import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../tests/helpers/fixtures';
import { createTestSupabaseClient, createUserClient } from '../../tests/helpers/supabase';

describe('checklist_item_completions homeowner RLS (migration 097)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let appointmentId: string;

  // Track IDs for explicit cleanup if cascade doesn't cover the checklist chain.
  let checklistId: string | null = null;
  let lineItemId: string | null = null;

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

    const { data: lineItem, error: liErr } = await admin
      .from('checklist_line_items')
      .insert({ checklist_id: checklist.id, task: 'Wipe counters', position: 0 })
      .select('id')
      .single();
    if (liErr || !lineItem) throw new Error(`line item insert failed: ${liErr?.message}`);
    lineItemId = lineItem.id as string;

    const { error: cicErr } = await admin.from('checklist_item_completions').insert({
      appointment_id: appointmentId,
      checklist_line_item_id: lineItem.id,
      organization_id: org.organizationId,
    });
    if (cicErr) throw new Error(`completion insert failed: ${cicErr.message}`);
  });

  afterEach(async () => {
    const admin = createTestSupabaseClient();

    // Explicit cleanup of the checklist chain before org deletion,
    // in case foreign-key constraints are not cascaded from org delete.
    if (lineItemId) {
      await admin
        .from('checklist_item_completions')
        .delete()
        .eq('checklist_line_item_id', lineItemId);
      await admin.from('checklist_line_items').delete().eq('id', lineItemId);
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
    expect(data).toHaveLength(1);
  });

  it('does NOT let a different homeowner read those completions', async () => {
    const client = createUserClient(org2.homeowner.accessToken); // RLS-enforced, not a participant
    const { data } = await client
      .from('checklist_item_completions')
      .select('*')
      .eq('appointment_id', appointmentId);
    expect(data ?? []).toHaveLength(0);
  });
});
