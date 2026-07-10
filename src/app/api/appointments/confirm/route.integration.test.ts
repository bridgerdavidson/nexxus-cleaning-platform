import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { POST as requestRoute } from '../request/route';
import { POST as assignRoute } from '../assign-cleaner/route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

async function seedPropertyAndService(orgId: string, ownerId: string) {
  const admin = createTestSupabaseClient();
  const { data: prop } = await admin
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: ownerId,
      name: 'P',
      address: '1 Lane',
      city: 'C',
      state: 'S',
      zip_code: '12345',
    })
    .select('id')
    .single();
  const { data: svc } = await admin
    .from('service_types')
    .insert({
      organization_id: orgId,
      name: 'Std',
      base_price: 200,
      duration_minutes: 90,
      service_type: 'regular',
    })
    .select('id')
    .single();
  return { propertyId: (prop as { id: string }).id, serviceTypeId: (svc as { id: string }).id };
}

async function createHomeownerRequestAndAssign(
  org: TestOrgFixture,
  slots: Array<{ scheduled_date: string; scheduled_time: string }>,
): Promise<string> {
  const { propertyId, serviceTypeId } = await seedPropertyAndService(org.organizationId, org.homeowner.userId);
  const { body: reqBody } = await callRoute<{ appointmentId: string }>(requestRoute, {
    method: 'POST',
    headers: bearerHeader(org.homeowner.accessToken),
    body: {
      organizationId: org.organizationId,
      propertyId,
      serviceTypeId,
      slots,
    },
  });
  await callRoute(assignRoute, {
    method: 'POST',
    headers: bearerHeader(org.admin.accessToken),
    body: {
      appointmentId: reqBody.appointmentId,
      cleanerId: org.cleaner.userId,
      organizationId: org.organizationId,
    },
  });
  return reqBody.appointmentId;
}

describe('POST /api/appointments/confirm', () => {
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
      status: 'pending',
    });
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects an org2 cleaner trying to confirm an org1 appointment (proves the bug)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        confirmed: true,
        organizationId: org2.organizationId, // caller's own org, but appointment isn't in it
      },
    });
    // Either 403 (org auth refuses non-member) or 404 (appointment scoped to org).
    expect([403, 404]).toContain(status);
  });

  it('rejects request with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: {
        appointmentId: appointmentInOrg1.id,
        confirmed: true,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(401);
  });

  it('cleaner confirms own appointment via legacy `confirmed: true` → status=confirmed', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        confirmed: true,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('appointments')
      .select('status, cleaner_confirmation_status')
      .eq('id', appointmentInOrg1.id)
      .single();
    expect((data as { status: string }).status).toBe('confirmed');
    expect((data as { cleaner_confirmation_status: string }).cleaner_confirmation_status).toBe('approved');
  });

  it('cleaner counter-proposes via legacy `confirmed: false` → feedback + suggested time created', async () => {
    const { status, body } = await callRoute<{ success: boolean; feedbackId: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        confirmed: false,
        organizationId: org.organizationId,
        feedback: {
          reason: 'Out of town that day',
          suggestedTimes: [{ date: '2026-06-08', time: '10:00' }],
        },
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.feedbackId).toBeTruthy();

    const admin = createTestSupabaseClient();
    const { data: fb } = await admin
      .from('cleaner_availability_feedback')
      .select('id, reason, cleaner_suggested_times(suggested_date)')
      .eq('appointment_id', appointmentInOrg1.id)
      .single();
    expect((fb as { reason: string }).reason).toBe('Out of town that day');
  });

  it('counter_propose without feedback.reason → 200 (reason is optional; null persisted)', async () => {
    const { status, body } = await callRoute<{ success: boolean; feedbackId: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'counter_propose',
        organizationId: org.organizationId,
        feedback: {
          reason: '',
          suggestedTimes: [{ date: '2026-06-10', time: '09:00' }],
        },
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data: fb } = await admin
      .from('cleaner_availability_feedback')
      .select('reason')
      .eq('appointment_id', appointmentInOrg1.id)
      .single();
    // Empty/whitespace reason is normalized to null so the admin UI can hide
    // the "Reason" sub-section cleanly.
    expect((fb as { reason: string | null }).reason).toBeNull();
  });

  it('cleaner declines via new `action: "decline"` with canned reason → feedback row stores the label', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'decline',
        organizationId: org.organizationId,
        declineReason: 'sick',
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data: fb } = await admin
      .from('cleaner_availability_feedback')
      .select('reason, cleaner_suggested_times(id)')
      .eq('appointment_id', appointmentInOrg1.id)
      .single();
    expect((fb as { reason: string }).reason).toBe('Sick');
    // Decline must NOT write suggested times.
    expect((fb as { cleaner_suggested_times: unknown[] }).cleaner_suggested_times).toEqual([]);
  });

  it('decline with reason "other" + free text → reason becomes "Other: <text>"', async () => {
    const { status } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'decline',
        organizationId: org.organizationId,
        declineReason: 'other',
        declineReasonOther: 'car broke down',
      },
    });
    expect(status).toBe(200);

    const admin = createTestSupabaseClient();
    const { data: fb } = await admin
      .from('cleaner_availability_feedback')
      .select('reason')
      .eq('appointment_id', appointmentInOrg1.id)
      .single();
    expect((fb as { reason: string }).reason).toBe('Other: car broke down');
  });

  it('decline without declineReason → 400', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'decline',
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(400);
  });

  it('decline with invalid declineReason → 400', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'decline',
        organizationId: org.organizationId,
        declineReason: 'made_it_up',
      },
    });
    expect(status).toBe(400);
  });

  it('missing both `action` and `confirmed` → 400', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(400);
  });

  it('409s an accept whose slotIndex no longer matches any offered slot', async () => {
    // appointmentInOrg1 has zero appointment_requested_slots rows (admin-direct,
    // single scheduled time). Models an operator reschedule that deleted the
    // slot rows mid-flight while the cleaner's stale accept was in transit.
    const { status, body } = await callRoute<{ stale: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'accept',
        organizationId: org.organizationId,
        slotIndex: 2,
      },
    });
    expect(status).toBe(409);
    expect(body).toMatchObject({ stale: true });
  });

  it('still accepts a synthesized single-slot offer with slotIndex 0 and no slot rows', async () => {
    // The redesign cleaner client always sends slotIndex; for a booking with
    // zero appointment_requested_slots rows it synthesizes index 0. That must
    // still accept using the appointment's own scheduled date/time.
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        appointmentId: appointmentInOrg1.id,
        action: 'accept',
        organizationId: org.organizationId,
        slotIndex: 0,
      },
    });
    expect(status).toBe(200);
  });

  describe('homeowner-initiated requests', () => {
    it('accept with slotIndex copies the chosen slot into the appointment row', async () => {
      const appointmentId = await createHomeownerRequestAndAssign(org, [
        { scheduled_date: '2026-10-01', scheduled_time: '09:00' },
        { scheduled_date: '2026-10-02', scheduled_time: '11:00' },
      ]);
      const { status } = await callRoute<{ success: boolean }>(POST, {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: {
          appointmentId,
          action: 'accept',
          organizationId: org.organizationId,
          slotIndex: 1,
        },
      });
      expect(status).toBe(200);

      const admin = createTestSupabaseClient();
      const { data: appt } = await admin
        .from('appointments')
        .select('scheduled_date, scheduled_time, status, request_state, cleaner_confirmation_status')
        .eq('id', appointmentId)
        .single();
      expect((appt as { scheduled_date: string }).scheduled_date).toBe('2026-10-02');
      expect((appt as { scheduled_time: string }).scheduled_time).toMatch(/^11:00/);
      expect((appt as { status: string }).status).toBe('confirmed');
      expect((appt as { request_state: string }).request_state).toBe('completed');
      expect((appt as { cleaner_confirmation_status: string }).cleaner_confirmation_status).toBe('approved');

      const { data: log } = await admin
        .from('appointment_routing_log')
        .select('response, slot_index_chosen')
        .eq('appointment_id', appointmentId)
        .single();
      expect((log as { response: string }).response).toBe('accepted');
      expect((log as { slot_index_chosen: number }).slot_index_chosen).toBe(1);
    });

    it('accept without slotIndex on a multi-slot request → 400', async () => {
      const appointmentId = await createHomeownerRequestAndAssign(org, [
        { scheduled_date: '2026-10-01', scheduled_time: '09:00' },
        { scheduled_date: '2026-10-02', scheduled_time: '11:00' },
      ]);
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: {
          appointmentId,
          action: 'accept',
          organizationId: org.organizationId,
        },
      });
      expect(status).toBe(400);
    });

    it('counter_propose on a homeowner-initiated request → 400', async () => {
      const appointmentId = await createHomeownerRequestAndAssign(org, [
        { scheduled_date: '2026-10-01', scheduled_time: '09:00' },
      ]);
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: {
          appointmentId,
          action: 'counter_propose',
          organizationId: org.organizationId,
          feedback: { reason: 'nope' },
        },
      });
      expect(status).toBe(400);
    });

    it('decline → routing chain advances or escalates; admin direct-book decline does NOT auto-defer', async () => {
      // (a) homeowner-initiated: only one cleaner in the org, so decline escalates.
      const appointmentId = await createHomeownerRequestAndAssign(org, [
        { scheduled_date: '2026-10-05', scheduled_time: '09:00' },
      ]);
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: {
          appointmentId,
          action: 'decline',
          organizationId: org.organizationId,
          declineReason: 'sick',
        },
      });
      expect(status).toBe(200);
      const admin = createTestSupabaseClient();
      const { data: appt } = await admin
        .from('appointments')
        .select('request_state, cleaner_id')
        .eq('id', appointmentId)
        .single();
      expect((appt as { request_state: string }).request_state).toBe('needs_admin_attention');
      expect((appt as { cleaner_id: string | null }).cleaner_id).toBeNull();

      const { data: log } = await admin
        .from('appointment_routing_log')
        .select('response')
        .eq('appointment_id', appointmentId);
      expect((log as Array<{ response: string }>)[0].response).toBe('declined');

      // (b) admin direct-book decline: now also runs the auto-defer chain so
      //     a declining cleaner triggers the same reassign logic as the
      //     homeowner-initiated flow. With only one cleaner in this test org
      //     the chain immediately escalates; the routing_log gets one declined
      //     row for the declining cleaner so future force-assigns skip them.
      const { status: directStatus } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: {
          appointmentId: appointmentInOrg1.id,
          action: 'decline',
          organizationId: org.organizationId,
          declineReason: 'not_my_service',
        },
      });
      expect(directStatus).toBe(200);
      const { data: directAppt } = await admin
        .from('appointments')
        .select('request_state, cleaner_id, homeowner_initiated, cleaner_confirmation_status')
        .eq('id', appointmentInOrg1.id)
        .single();
      expect((directAppt as { homeowner_initiated: boolean }).homeowner_initiated).toBe(false);
      // Escalated: surfaces in the unified ActionRequiredSection as
      // "All cleaners declined" (cleaner_id=null, ccs='rejected').
      expect((directAppt as { request_state: string | null }).request_state).toBe('needs_admin_attention');
      expect((directAppt as { cleaner_confirmation_status: string }).cleaner_confirmation_status).toBe('rejected');
      expect((directAppt as { cleaner_id: string | null }).cleaner_id).toBeNull();
      // Auto-defer chain inserts one declined row for the declining cleaner.
      const { data: directLog } = await admin
        .from('appointment_routing_log')
        .select('cleaner_id, response')
        .eq('appointment_id', appointmentInOrg1.id);
      expect(directLog).toHaveLength(1);
      expect((directLog as Array<{ response: string }>)[0].response).toBe('declined');
    });

    it('admin-direct accept closes the pending routing_log row so auto-defer does not re-route it', async () => {
      // Simulates the post-decline reassignment state for an admin-direct
      // appointment: the cleaner has a pending routing_log row with an
      // already-elapsed deadline. If the accept handler skips closing this
      // row, the auto-defer sweep flips it to expired and reassigns the
      // appointment — silently re-routing an already-accepted job. Regression
      // guard for the codex review on PR #14.
      const admin = createTestSupabaseClient();
      await admin
        .from('appointment_routing_log')
        .insert({
          appointment_id: appointmentInOrg1.id,
          cleaner_id: org.cleaner.userId,
          attempt_index: 1,
          response: 'pending',
          // Deadline already in the past — proves the pending row would be
          // swept by auto-defer if we didn't close it on accept.
          deadline_at: '2020-01-01T00:00:00Z',
        });

      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: {
          appointmentId: appointmentInOrg1.id,
          action: 'accept',
          organizationId: org.organizationId,
        },
      });
      expect(status).toBe(200);

      const { data: log } = await admin
        .from('appointment_routing_log')
        .select('response, responded_at')
        .eq('appointment_id', appointmentInOrg1.id)
        .single();
      expect((log as { response: string }).response).toBe('accepted');
      expect((log as { responded_at: string | null }).responded_at).not.toBeNull();
    });
  });
});
