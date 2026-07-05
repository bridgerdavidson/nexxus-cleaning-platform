import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (orgId: string) => (req: NextRequest) =>
  PATCH(req, { params: Promise.resolve({ orgId }) });

describe('PATCH /api/organizations/:orgId/onboarding', () => {
  let org: TestOrgFixture;

  beforeEach(async () => { org = await withTestOrg(); });
  afterEach(async () => { await org.cleanup(); });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      body: { dismiss_setup_checklist: true },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { dismiss_setup_checklist: true },
    });
    expect(status).toBe(403);
  });

  it('admin dismissal stamps setup_checklist_dismissed_at', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { dismiss_setup_checklist: true },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organizations')
      .select('setup_checklist_dismissed_at')
      .eq('id', org.organizationId)
      .single();
    expect((data as { setup_checklist_dismissed_at: string | null }).setup_checklist_dismissed_at).not.toBeNull();
  });

  it('returns 400 without dismiss_setup_checklist true', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });
});
