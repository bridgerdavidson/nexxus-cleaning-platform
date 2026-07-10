import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  addManagerToOrg,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

interface Seeded {
  org: TestOrgFixture;
  org2: TestOrgFixture;
  appointmentId: string;
  feedbackId: string;
  suggestedTimeId: string;
}

async function seedCounterProposal(opts?: {
  suggestedDate?: string;
  suggestedTime?: string;
}): Promise<Seeded> {
  const org = await withTestOrg();
  const org2 = await withTestOrg();
  const { id: appointmentId } = await createTestAppointment({
    organizationId: org.organizationId,
    cleanerId: org.cleaner.userId,
    homeownerId: org.homeowner.userId,
    status: 'pending',
  });
  const admin = createTestSupabaseClient();
  // Flip into rejected + insert feedback + suggested time.
  await admin
    .from('appointments')
    .update({ cleaner_confirmation_status: 'rejected' })
    .eq('id', appointmentId);
  const { data: fb } = await admin
    .from('cleaner_availability_feedback')
    .insert({
      appointment_id: appointmentId,
      cleaner_id: org.cleaner.userId,
      reason: 'Out of town that day',
    })
    .select('id')
    .single();
  const feedbackId = (fb as { id: string }).id;
  const { data: st } = await admin
    .from('cleaner_suggested_times')
    .insert({
      feedback_id: feedbackId,
      suggested_date: opts?.suggestedDate ?? '2026-06-08',
      suggested_time: opts?.suggestedTime ?? '11:00',
    })
    .select('id')
    .single();
  const suggestedTimeId = (st as { id: string }).id;
  return { org, org2, appointmentId, feedbackId, suggestedTimeId };
}

describe('POST /api/appointments/accept-counter-proposal', () => {
  let seeded: Seeded;

  beforeEach(async () => {
    seeded = await seedCounterProposal();
  });

  afterEach(async () => {
    await Promise.all([seeded.org.cleanup(), seeded.org2.cleanup()]);
  });

  it('rejects request with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: {
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
        suggestedTimeId: seeded.suggestedTimeId,
      },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner trying to accept their own counter-proposal (admin-only)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org.cleaner.accessToken),
      body: {
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
        suggestedTimeId: seeded.suggestedTimeId,
      },
    });
    expect(status).toBe(403);
  });

  it('rejects an admin from a different org', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org2.admin.accessToken),
      body: {
        appointmentId: seeded.appointmentId,
        // Caller passes their own org id; org2 admin is a member of org2 but the appointment is in org1.
        organizationId: seeded.org2.organizationId,
      },
    });
    // org auth either 403s (no member of caller's stated org has appt) or 404s.
    expect([400, 403, 404]).toContain(status);
  });

  it('admin accepts → appointment scheduled at the picked time, status=confirmed, feedback cleared', async () => {
    const { status, body } = await callRoute<{ success: boolean; scheduled_date: string; scheduled_time: string }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(seeded.org.admin.accessToken),
        body: {
          appointmentId: seeded.appointmentId,
          organizationId: seeded.org.organizationId,
          suggestedTimeId: seeded.suggestedTimeId,
        },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.scheduled_date).toBe('2026-06-08');
    expect(body.scheduled_time).toBe('11:00:00');

    const admin = createTestSupabaseClient();
    const { data: appt } = await admin
      .from('appointments')
      .select('scheduled_date, scheduled_time, status, cleaner_confirmation_status')
      .eq('id', seeded.appointmentId)
      .single();
    expect((appt as { scheduled_date: string }).scheduled_date).toBe('2026-06-08');
    expect((appt as { status: string }).status).toBe('confirmed');
    expect((appt as { cleaner_confirmation_status: string }).cleaner_confirmation_status).toBe('approved');

    // Feedback row should be gone.
    const { data: fb } = await admin
      .from('cleaner_availability_feedback')
      .select('id')
      .eq('appointment_id', seeded.appointmentId)
      .maybeSingle();
    expect(fb).toBeNull();
  });

  it('returns 400 when neither suggestedTimeId nor suggestedWindowId is provided', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org.admin.accessToken),
      body: {
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
      },
    });
    expect(status).toBe(400);
  });

  it('returns 400 when both suggestedTimeId and suggestedWindowId are provided', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org.admin.accessToken),
      body: {
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
        suggestedTimeId: seeded.suggestedTimeId,
        suggestedWindowId: 'something',
      },
    });
    expect(status).toBe(400);
  });

  it('returns 404 when suggestedTimeId does not exist', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org.admin.accessToken),
      body: {
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
        suggestedTimeId: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(status).toBe(404);
  });

  it('returns 400 when suggestedTimeId belongs to a different appointment', async () => {
    // Seed a second appointment + suggestion in the SAME org.
    const otherAppt = await createTestAppointment({
      organizationId: seeded.org.organizationId,
      cleanerId: seeded.org.cleaner.userId,
      homeownerId: seeded.org.homeowner.userId,
      status: 'pending',
    });
    const admin = createTestSupabaseClient();
    await admin
      .from('appointments')
      .update({ cleaner_confirmation_status: 'rejected' })
      .eq('id', otherAppt.id);
    const { data: otherFb } = await admin
      .from('cleaner_availability_feedback')
      .insert({
        appointment_id: otherAppt.id,
        cleaner_id: seeded.org.cleaner.userId,
        reason: 'Different reason',
      })
      .select('id')
      .single();
    const { data: otherSt } = await admin
      .from('cleaner_suggested_times')
      .insert({
        feedback_id: (otherFb as { id: string }).id,
        suggested_date: '2026-07-01',
        suggested_time: '14:00',
      })
      .select('id')
      .single();

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org.admin.accessToken),
      body: {
        // Targeting our seeded appointment but with the OTHER appointment's suggestion.
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
        suggestedTimeId: (otherSt as { id: string }).id,
      },
    });
    expect(status).toBe(400);
  });

  it('returns 409 when appointment is not in rejected state', async () => {
    // Reset confirmation status to awaiting.
    const admin = createTestSupabaseClient();
    await admin
      .from('appointments')
      .update({ cleaner_confirmation_status: 'awaiting' })
      .eq('id', seeded.appointmentId);

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(seeded.org.admin.accessToken),
      body: {
        appointmentId: seeded.appointmentId,
        organizationId: seeded.org.organizationId,
        suggestedTimeId: seeded.suggestedTimeId,
      },
    });
    expect(status).toBe(409);
  });

  it('notifies the homeowner that the time is settled', async () => {
    const { org, appointmentId, suggestedTimeId } = seeded;
    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId,
        organizationId: org.organizationId,
        suggestedTimeId,
      },
    });
    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('notification_events')
      .select('event_type, recipient_user_id')
      .eq('appointment_id', appointmentId);
    expect((data ?? []).some((e) => e.event_type === 'appointment_time_changed' && e.recipient_user_id === org.homeowner.userId)).toBe(true);
  });

  // Manager permission gating (Task 5): this route requires can_handle_requests for a manager.
  describe('manager permission gating', () => {
    let mgr: ManagerMemberHandle;

    afterEach(async () => {
      if (mgr) await mgr.cleanup();
    });

    it('403s for a manager without can_handle_requests', async () => {
      mgr = await addManagerToOrg(seeded.org.organizationId, { can_handle_requests: false });
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: {
          appointmentId: seeded.appointmentId,
          organizationId: seeded.org.organizationId,
          suggestedTimeId: seeded.suggestedTimeId,
        },
      });
      expect(status).toBe(403);
    });

    it('passes auth for a manager WITH can_handle_requests', async () => {
      mgr = await addManagerToOrg(seeded.org.organizationId, { can_handle_requests: true });
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: {
          appointmentId: seeded.appointmentId,
          organizationId: seeded.org.organizationId,
          suggestedTimeId: seeded.suggestedTimeId,
        },
      });
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });
  });
});
