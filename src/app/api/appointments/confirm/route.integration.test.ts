import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

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
});
