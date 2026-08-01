import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../../tests/helpers/fixtures';

/**
 * POST /api/cleaner/appointments/[appointmentId]/status: the cleaner's job
 * status/progress write path since migration 122 sealed their direct
 * appointments access (an UPDATE's WHERE needs SELECT rights, so the old
 * client write became a silent no-op).
 */

describe('POST /api/cleaner/appointments/[appointmentId]/status', () => {
  let org: TestOrgFixture;
  const admin = createTestSupabaseClient();

  const call = (appointmentId: string, token: string | null, body: Record<string, unknown>) =>
    callRoute(
      (req: NextRequest) => POST(req, { params: Promise.resolve({ appointmentId }) }),
      {
        method: 'POST',
        url: `http://test.local/api/cleaner/appointments/${appointmentId}/status`,
        headers: token ? bearerHeader(token) : undefined,
        body,
      },
    );

  async function seed(status: 'confirmed' | 'pending' = 'confirmed', assigned = true) {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: assigned ? org.cleaner.userId : null,
      homeownerId: org.homeowner.userId,
      status,
    });
    return appt.id;
  }

  beforeAll(async () => {
    org = await withTestOrg({});
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it('the assigned cleaner starts their job', async () => {
    const apptId = await seed('confirmed');
    const res = await call(apptId, org.cleaner.accessToken, {
      organization_id: org.organizationId,
      status: 'in_progress',
      job_progress: 'before_photos',
    });
    expect(res.status).toBe(200);
    const { data } = await admin
      .from('appointments')
      .select('status, job_progress')
      .eq('id', apptId)
      .single();
    expect(data).toMatchObject({ status: 'in_progress', job_progress: 'before_photos' });
  });

  it('updates job_progress alone', async () => {
    const apptId = await seed('confirmed');
    const res = await call(apptId, org.cleaner.accessToken, {
      organization_id: org.organizationId,
      job_progress: 'checklist',
    });
    expect(res.status).toBe(200);
    const { data } = await admin
      .from('appointments')
      .select('job_progress')
      .eq('id', apptId)
      .single();
    expect((data as { job_progress: string }).job_progress).toBe('checklist');
  });

  it('404s on a job the cleaner is not assigned to, without confirming it exists', async () => {
    const apptId = await seed('confirmed', false);
    const res = await call(apptId, org.cleaner.accessToken, {
      organization_id: org.organizationId,
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
  });

  it('rejects a status outside the cleaner vocabulary (400): no cancels, no column smuggling', async () => {
    const apptId = await seed('confirmed');
    const cancelled = await call(apptId, org.cleaner.accessToken, {
      organization_id: org.organizationId,
      status: 'cancelled',
    });
    expect(cancelled.status).toBe(400);
    const empty = await call(apptId, org.cleaner.accessToken, {
      organization_id: org.organizationId,
    });
    expect(empty.status).toBe(400);
  });

  it('rejects non-cleaner callers (403) and missing tokens (401)', async () => {
    const apptId = await seed('confirmed');
    const staff = await call(apptId, org.admin.accessToken, {
      organization_id: org.organizationId,
      status: 'in_progress',
    });
    expect(staff.status).toBe(403);
    const noToken = await call(apptId, null, {
      organization_id: org.organizationId,
      status: 'in_progress',
    });
    expect(noToken.status).toBe(401);
  });
});
