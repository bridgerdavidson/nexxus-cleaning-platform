import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();

describe('POST /api/properties', () => {
  let org: TestOrgFixture;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await db.from('properties').delete().eq('organization_id', org.organizationId);
    await org.cleanup();
  });

  const fields = (over: Record<string, unknown> = {}) => ({
    organization_id: org.organizationId,
    name: 'Lake House',
    address: '1 Shore Rd',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
    bedrooms: 3,
    bathrooms: 2,
    square_feet: 1800,
    special_instructions: null,
    access_instructions: 'Key under mat',
    ...over,
  });
  const post = (b: unknown, token?: string) =>
    callRoute<Body>(POST, { method: 'POST', url: 'http://test/api/properties', headers: token ? bearerHeader(token) : {}, body: b });

  it('returns 401 without a token and 400 on an invalid body', async () => {
    expect((await post(fields())).status).toBe(401);
    const res = await post(fields({ address: '' }), org.homeowner.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Address is required');
  });

  it('a homeowner adds their own home; any owner_id in the body is ignored', async () => {
    const res = await post(fields({ owner_id: org.admin.userId }), org.homeowner.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organization_id: org.organizationId,
      owner_id: org.homeowner.userId,
      name: 'Lake House',
      bedrooms: 3,
      access_instructions: 'Key under mat',
    });
  });

  it('an admin adds a home for a homeowner member', async () => {
    const res = await post(fields({ owner_id: org.homeowner.userId }), org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ owner_id: org.homeowner.userId });
  });

  it('an admin must name a homeowner of this org', async () => {
    const missing = await post(fields(), org.admin.accessToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('owner_id is required');
    const wrongRole = await post(fields({ owner_id: org.cleaner.userId }), org.admin.accessToken);
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.error).toBe('owner_id must be a homeowner in this organization');
  });

  it('rejects owner_id naming a homeowner of another org', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    const res = await post(fields({ owner_id: other.homeowner.userId }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('owner_id must be a homeowner in this organization');
  });

  it('returns 403 for a cleaner, a manager without can_edit_properties, and members of another org', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: false });
    cleanups.push(() => mgr.cleanup());
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await post(fields({ owner_id: org.homeowner.userId }), org.cleaner.accessToken)).status).toBe(403);
    expect((await post(fields({ owner_id: org.homeowner.userId }), mgr.accessToken)).status).toBe(403);
    expect((await post(fields({ owner_id: org.homeowner.userId }), other.admin.accessToken)).status).toBe(403);
    expect((await post(fields(), other.homeowner.accessToken)).status).toBe(403);
  });

  it('a manager with can_edit_properties adds a home for a homeowner member', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: true });
    cleanups.push(() => mgr.cleanup());
    expect((await post(fields({ owner_id: org.homeowner.userId }), mgr.accessToken)).status).toBe(201);
  });

  describe('billing enforcement', () => {
    afterEach(() => {
      delete process.env.BILLING_ENFORCEMENT_ENABLED;
    });

    async function freezeOrg(organizationId: string) {
      await db
        .from('organizations')
        .update({
          comped_at: null,
          subscription_status: 'trialing',
          trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
        })
        .eq('id', organizationId);
    }

    it('passes through when the flag is off, even for a frozen org', async () => {
      await freezeOrg(org.organizationId);

      const res = await post(fields(), org.homeowner.accessToken);
      expect(res.status).toBe(201);
    });

    it('returns 402 to a homeowner adding a home while the org is frozen', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      await freezeOrg(org.organizationId);

      const res = await post(fields(), org.homeowner.accessToken);
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('billing_frozen');
    });

    it('allows a comped org with the flag on', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      await db
        .from('organizations')
        .update({ comped_at: new Date().toISOString() })
        .eq('id', org.organizationId);

      const res = await post(fields(), org.homeowner.accessToken);
      expect(res.status).toBe(201);
    });

    it('still returns 403 to a non-member before it considers billing', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      const outsider = await withTestOrg();
      cleanups.push(() => outsider.cleanup());
      await freezeOrg(org.organizationId);

      const res = await post(fields(), outsider.homeowner.accessToken);
      expect(res.status).toBe(403);
    });
  });
});
