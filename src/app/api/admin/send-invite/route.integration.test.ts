import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addOwnerToOrg,
  type TestOrgFixture,
  type OwnerMemberHandle,
} from '../../../../../tests/helpers/fixtures';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Regression: an org OWNER (organization_members.role = 'owner') must be able to
 * send invites. The route gated on role === 'admin', which excluded owners and
 * produced the "Not authorized to send invites" 401 the founder hit when
 * inviting their first cleaner. The Supabase invite email is mocked so the test
 * is deterministic and leaves no stray auth users.
 */
describe('POST /api/admin/send-invite (owner authorization)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await owner?.cleanup();
    await org?.cleanup();
    owner = null;
    org = null;
  });

  it('401 without a token', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: 'x@y.local', role: 'cleaner', organizationId: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('lets an org owner send a cleaner invite (200)', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    const inviteSpy = vi
      .spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `newhire-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; invite: { status: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { email, role: 'cleaner', organizationId: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invite.status).toBe('pending');
    expect(inviteSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a cleaner trying to send invites (401)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { email: 'someone@test.local', role: 'cleaner', organizationId: org.organizationId },
    });
    expect(status).toBe(401);
  });
});
