import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const admin = createTestSupabaseClient();

async function seedNotification(
  orgId: string,
  recipientUserId: string,
  eventType = 'homeowner_request_submitted',
): Promise<string> {
  const { data, error } = await admin
    .from('notification_events')
    .insert({
      organization_id: orgId,
      recipient_user_id: recipientUserId,
      event_type: eventType,
      payload: {},
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function readDispatched(id: string): Promise<string | null> {
  const { data } = await admin
    .from('notification_events')
    .select('in_app_dispatched_at')
    .eq('id', id)
    .single();
  return (data as { in_app_dispatched_at: string | null } | null)?.in_app_dispatched_at ?? null;
}

describe('POST /api/notifications/mark-read', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await admin.from('notification_events').delete().eq('organization_id', org.organizationId);
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, { method: 'POST', body: {} });
    expect(status).toBe(401);
  });

  it('returns 401 for an invalid token', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader('not-a-real-token'),
      body: {},
    });
    expect(status).toBe(401);
  });

  it("marks ALL the caller's unread notifications read when no ids are given", async () => {
    const a = await seedNotification(org.organizationId, org.admin.userId);
    const b = await seedNotification(org.organizationId, org.admin.userId);

    const { status, body } = await callRoute<{ success: boolean; updated: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {},
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated).toBe(2);
    expect(await readDispatched(a)).not.toBeNull();
    expect(await readDispatched(b)).not.toBeNull();
  });

  it('marks only the given ids when ids[] is provided', async () => {
    const a = await seedNotification(org.organizationId, org.admin.userId);
    const b = await seedNotification(org.organizationId, org.admin.userId);

    const { status, body } = await callRoute<{ updated: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { ids: [a] },
    });

    expect(status).toBe(200);
    expect(body.updated).toBe(1);
    expect(await readDispatched(a)).not.toBeNull();
    expect(await readDispatched(b)).toBeNull();
  });

  it("cannot mark another user's notifications (recipient scoping)", async () => {
    const homeownerNote = await seedNotification(org.organizationId, org.homeowner.userId);

    const { status, body } = await callRoute<{ updated: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken), // bearer is the admin, not the recipient
      body: { ids: [homeownerNote] },
    });

    expect(status).toBe(200);
    expect(body.updated).toBe(0); // route scopes the UPDATE to recipient_user_id = caller
    expect(await readDispatched(homeownerNote)).toBeNull(); // still unread
  });

  it('returns updated:0 for an empty ids array', async () => {
    await seedNotification(org.organizationId, org.admin.userId);
    const { status, body } = await callRoute<{ updated: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { ids: [] },
    });
    expect(status).toBe(200);
    expect(body.updated).toBe(0);
  });

  it('rejects a malformed ids (bare string, not array) with 400 and does NOT mark all read', async () => {
    const a = await seedNotification(org.organizationId, org.admin.userId);
    const b = await seedNotification(org.organizationId, org.admin.userId);

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { ids: a }, // a bare string instead of [a] -- a client serialization bug
    });

    expect(status).toBe(400);
    // The whole feed must NOT be cleared by a malformed request.
    expect(await readDispatched(a)).toBeNull();
    expect(await readDispatched(b)).toBeNull();
  });

  it('rejects an ids array containing a non-string with 400', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { ids: ['ok', 123] },
    });
    expect(status).toBe(400);
  });
});
