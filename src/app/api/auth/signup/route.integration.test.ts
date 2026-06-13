import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute } from '../../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/**
 * Security audit H1/F-AUTH-1: public self-service signup honored a client-supplied
 * `role`, letting any visitor self-assign admin/manager of a live org. Signup is now
 * homeowner-only; staff roles come exclusively through the invite flow.
 */
describe('POST /api/auth/signup (role restriction)', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    const db = createTestSupabaseClient();
    await Promise.all(createdUserIds.map((id) => db.auth.admin.deleteUser(id)));
    createdUserIds.length = 0;
  });

  const body = (role?: string) => ({
    email: `signup-${randomUUID().slice(0, 8)}@test.local`,
    password: 'TestPass123!',
    firstName: 'Sign',
    lastName: 'Up',
    ...(role ? { role } : {}),
  });

  it('rejects self-assigning the admin role (403) and creates no user', async () => {
    const reqBody = body('admin');
    const { status } = await callRoute(POST, { method: 'POST', body: reqBody });
    expect(status).toBe(403);

    const db = createTestSupabaseClient();
    const { data } = await db.from('user_profiles').select('id').eq('email', reqBody.email).maybeSingle();
    expect(data).toBeNull();
  });

  it('rejects self-assigning the manager role (403)', async () => {
    const { status } = await callRoute(POST, { method: 'POST', body: body('manager') });
    expect(status).toBe(403);
  });

  it('rejects self-assigning the cleaner role (403)', async () => {
    const { status } = await callRoute(POST, { method: 'POST', body: body('cleaner') });
    expect(status).toBe(403);
  });

  it('creates a homeowner when role is homeowner', async () => {
    const { status, body: res } = await callRoute<{ success: boolean; userId: string; role: string }>(POST, {
      method: 'POST',
      body: body('homeowner'),
    });
    expect(status).toBe(200);
    expect(res.success).toBe(true);
    expect(res.role).toBe('homeowner');
    createdUserIds.push(res.userId);
  });

  it('defaults to homeowner when no role is supplied', async () => {
    const { status, body: res } = await callRoute<{ success: boolean; userId: string; role: string }>(POST, {
      method: 'POST',
      body: body(),
    });
    expect(status).toBe(200);
    expect(res.role).toBe('homeowner');
    createdUserIds.push(res.userId);
  });
});
