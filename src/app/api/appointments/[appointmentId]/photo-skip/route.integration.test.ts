import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

const db = createTestSupabaseClient();

async function readAppt(id: string) {
  const { data } = await db
    .from('appointments')
    .select('photos_skipped, photo_skip_reason')
    .eq('id', id)
    .single();
  return data as { photos_skipped: boolean | null; photo_skip_reason: string | null } | null;
}

describe('POST /api/appointments/:appointmentId/photo-skip', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  // --- (a) assigned cleaner happy path ---

  it('assigned cleaner records photo skip and row is updated', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status, body } = await callRoute<{ ok: boolean }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, reason: 'no signal' },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const row = await readAppt(apptId);
    expect(row?.photos_skipped).toBe(true);
    expect(row?.photo_skip_reason).toBe('no signal');
  });

  it('org admin can also record a photo skip', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status, body } = await callRoute<{ ok: boolean }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId, reason: 'camera broken' },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const row = await readAppt(apptId);
    expect(row?.photos_skipped).toBe(true);
    expect(row?.photo_skip_reason).toBe('camera broken');
  });

  // --- (b) validation: empty / missing reason ---

  it('returns 400 when reason is an empty string', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, reason: '' },
    });

    expect(status).toBe(400);
  });

  it('returns 400 when reason is whitespace only', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, reason: '   ' },
    });

    expect(status).toBe(400);
  });

  it('returns 400 when reason is missing from body', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId },
    });

    expect(status).toBe(400);
  });

  // --- (c) auth: non-member and cross-org rejections ---

  it('returns 403 for a caller who is not a member of the organization', async () => {
    const other = await withTestOrg();
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    try {
      const { status } = await callRoute(handlerFor(apptId), {
        method: 'POST',
        // other org's admin is not a member of org
        headers: bearerHeader(other.admin.accessToken),
        body: { organizationId: org.organizationId, reason: 'no signal' },
      });

      expect(status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it('returns 403 for a cleaner who is not assigned to the appointment', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    // Unassign the cleaner so the bearer user no longer owns the appointment.
    await db.from('appointments').update({ cleaner_id: null }).eq('id', apptId);

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, reason: 'no signal' },
    });

    expect(status).toBe(403);
  });

  it('returns 401 with no Authorization header', async () => {
    const { id: apptId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      body: { organizationId: org.organizationId, reason: 'no signal' },
    });

    expect(status).toBe(401);
  });
});
