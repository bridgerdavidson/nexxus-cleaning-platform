import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addOwnerToOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const BUCKET_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-branding`;

describe('PATCH /api/organizations/[orgId]/branding', () => {
  let org: TestOrgFixture;
  let owner: Awaited<ReturnType<typeof addOwnerToOrg>>;

  beforeEach(async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  function patch(body: Record<string, unknown>, token?: string) {
    return callRoute(
      (req: NextRequest) => PATCH(req, { params: Promise.resolve({ orgId: org.organizationId }) }),
      {
        method: 'PATCH',
        url: `http://test/api/organizations/${org.organizationId}/branding`,
        headers: token ? bearerHeader(token) : {},
        body,
      },
    );
  }

  async function readBranding() {
    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organizations')
      .select('brand_color, logo_icon_url, logo_full_url, brand_updated_at')
      .eq('id', org.organizationId)
      .single();
    return data as {
      brand_color: string | null;
      logo_icon_url: string | null;
      logo_full_url: string | null;
      brand_updated_at: string | null;
    };
  }

  it('rejects an unauthenticated request', async () => {
    const res = await patch({ brand_color: '#B5179E' });
    expect(res.status).toBe(401);
  });

  it('rejects a cleaner member', async () => {
    const res = await patch({ brand_color: '#B5179E' }, org.cleaner.accessToken);
    expect(res.status).toBe(403);
  });

  it('accepts an admin member (branding is owner AND admin, unlike the owner-only profile route)', async () => {
    const res = await patch({ brand_color: '#B5179E' }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect((await readBranding()).brand_color).toBe('#B5179E');
  });

  it('accepts the owner', async () => {
    const res = await patch({ brand_color: '#0150FC' }, owner.accessToken);
    expect(res.status).toBe(200);
  });

  it('rejects a non-hex brand color', async () => {
    for (const bad of ['blue', '#12345', '#B5179E00', 'B5179E']) {
      const res = await patch({ brand_color: bad }, owner.accessToken);
      expect(res.status, `brand_color ${bad}`).toBe(400);
    }
  });

  it('rejects a logo URL outside the org-branding bucket', async () => {
    const res = await patch(
      { logo_icon_url: 'https://evil.example.com/logo.png' },
      owner.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a logo URL inside the bucket but under another org's prefix", async () => {
    const res = await patch(
      { logo_icon_url: `${BUCKET_PREFIX}/00000000-0000-0000-0000-000000000000/icon-x.png` },
      owner.accessToken,
    );
    expect(res.status).toBe(400);
  });

  it('accepts a valid patch and advances brand_updated_at', async () => {
    const before = await readBranding();
    const res = await patch(
      {
        brand_color: '#16A34A',
        logo_icon_url: `${BUCKET_PREFIX}/${org.organizationId}/icon-abc.png`,
        logo_full_url: `${BUCKET_PREFIX}/${org.organizationId}/full-abc.webp`,
      },
      owner.accessToken,
    );
    expect(res.status).toBe(200);
    const after = await readBranding();
    expect(after.brand_color).toBe('#16A34A');
    expect(after.logo_icon_url).toContain(`/${org.organizationId}/icon-abc.png`);
    expect(after.logo_full_url).toContain(`/${org.organizationId}/full-abc.webp`);
    expect(after.brand_updated_at).not.toBeNull();
    if (before.brand_updated_at) {
      expect(Date.parse(after.brand_updated_at!)).toBeGreaterThan(Date.parse(before.brand_updated_at));
    }
  });

  it('clears fields with null', async () => {
    await patch({ brand_color: '#16A34A' }, owner.accessToken);
    const res = await patch(
      { brand_color: null, logo_icon_url: null, logo_full_url: null },
      owner.accessToken,
    );
    expect(res.status).toBe(200);
    const after = await readBranding();
    expect(after.brand_color).toBeNull();
    expect(after.logo_icon_url).toBeNull();
    expect(after.logo_full_url).toBeNull();
  });

  it('rejects an empty body', async () => {
    const res = await patch({}, owner.accessToken);
    expect(res.status).toBe(400);
  });
});
