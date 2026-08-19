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
    await owner.cleanup();
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
      .select('brand_color, logo_icon_url, logo_full_url, logo_icon_dark_url, logo_full_dark_url, brand_updated_at')
      .eq('id', org.organizationId)
      .single();
    return data as {
      brand_color: string | null;
      logo_icon_url: string | null;
      logo_full_url: string | null;
      logo_icon_dark_url: string | null;
      logo_full_dark_url: string | null;
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

  it('any successful save stamps branding_confirmed_at (completes the setup step) without bumping brand_updated_at on a name-only save', async () => {
    const res = await patch({ name: 'Sparkle Cleaning Co' }, owner.accessToken);
    expect(res.status).toBe(200);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organizations')
      .select('branding_confirmed_at, brand_updated_at')
      .eq('id', org.organizationId)
      .single();
    const row = data as { branding_confirmed_at: string | null; brand_updated_at: string | null };
    expect(row.branding_confirmed_at).not.toBeNull();
    expect(row.brand_updated_at).toBeNull();
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

  it('rejects dot-segment traversal out of the org prefix', async () => {
    const attacks = [
      // Resolves to another org's folder despite passing a naive startsWith.
      `${BUCKET_PREFIX}/${'{ORG}'}/../00000000-0000-0000-0000-000000000000/icon-x.png`,
      // Resolves out of the storage API entirely.
      `${BUCKET_PREFIX}/${'{ORG}'}/../../../../../../auth/v1/whatever`,
      // Encoded dot segments and nested paths must not survive the filename pin.
      `${BUCKET_PREFIX}/${'{ORG}'}/%2e%2e/icon-x.png`,
      `${BUCKET_PREFIX}/${'{ORG}'}/sub/icon-x.png`,
      `${BUCKET_PREFIX}/${'{ORG}'}/icon-x.png?d=evil`,
      `${BUCKET_PREFIX}/${'{ORG}'}/icon-x.svg`,
    ].map((u) => u.replace('{ORG}', org.organizationId));
    for (const url of attacks) {
      const res = await patch({ logo_icon_url: url }, owner.accessToken);
      expect(res.status, url).toBe(400);
    }
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

  describe('dark-mode logo variants', () => {
    it('accepts and pins dark logo URLs and stamps brand_updated_at', async () => {
      const icon = `${BUCKET_PREFIX}/${org.organizationId}/icon-dark-abc123.png`;
      const full = `${BUCKET_PREFIX}/${org.organizationId}/full-dark-def456.webp`;
      const res = await patch(
        { logo_icon_dark_url: icon, logo_full_dark_url: full },
        owner.accessToken,
      );
      expect(res.status).toBe(200);
      const after = await readBranding();
      expect(after.logo_icon_dark_url).toContain(`/${org.organizationId}/icon-dark-abc123.png`);
      expect(after.logo_full_dark_url).toContain(`/${org.organizationId}/full-dark-def456.webp`);
      expect(after.brand_updated_at).not.toBeNull();
    });

    it('rejects a dark logo URL outside the org-branding bucket', async () => {
      const res = await patch(
        { logo_icon_dark_url: 'https://evil.example.com/icon-dark-x.png' },
        owner.accessToken,
      );
      expect(res.status).toBe(400);
    });

    it("rejects a dark logo URL under another org's prefix", async () => {
      const res = await patch(
        { logo_icon_dark_url: `${BUCKET_PREFIX}/00000000-0000-0000-0000-000000000000/icon-dark-x.png` },
        owner.accessToken,
      );
      expect(res.status).toBe(400);
    });

    it('clears dark logo URLs with null', async () => {
      const seed = await patch(
        { logo_icon_dark_url: `${BUCKET_PREFIX}/${org.organizationId}/icon-dark-seed.png` },
        owner.accessToken,
      );
      expect(seed.status).toBe(200);
      const res = await patch(
        { logo_icon_dark_url: null, logo_full_dark_url: null },
        owner.accessToken,
      );
      expect(res.status).toBe(200);
      const after = await readBranding();
      expect(after.logo_icon_dark_url).toBeNull();
      expect(after.logo_full_dark_url).toBeNull();
    });
  });

  describe('name (moved here from the owner-only profile route)', () => {
    async function readName() {
      const admin = createTestSupabaseClient();
      const { data } = await admin
        .from('organizations')
        .select('name')
        .eq('id', org.organizationId)
        .single();
      return (data as { name: string }).name;
    }

    it('lets an ADMIN rename the org (branding is owner+admin by design)', async () => {
      const res = await patch({ name: '  Sparkle Squad  ' }, org.admin.accessToken);
      expect(res.status).toBe(200);
      expect(await readName()).toBe('Sparkle Squad');
    });

    it('lets the owner rename the org', async () => {
      const res = await patch({ name: 'BrightNest Cleaning' }, owner.accessToken);
      expect(res.status).toBe(200);
      expect(await readName()).toBe('BrightNest Cleaning');
    });

    it('rejects an empty or whitespace-only name', async () => {
      for (const bad of ['', '   ']) {
        const res = await patch({ name: bad }, owner.accessToken);
        expect(res.status, `name ${JSON.stringify(bad)}`).toBe(400);
      }
    });

    it('rejects a name over 200 characters', async () => {
      const res = await patch({ name: 'x'.repeat(201) }, owner.accessToken);
      expect(res.status).toBe(400);
    });

    it('does NOT advance brand_updated_at on a name-only save (would cache-bust unchanged logos)', async () => {
      // Establish a non-null brand_updated_at first.
      await patch({ brand_color: '#16A34A' }, owner.accessToken);
      const before = await readBranding();
      expect(before.brand_updated_at).not.toBeNull();

      const res = await patch({ name: 'Rename Only Co' }, owner.accessToken);
      expect(res.status).toBe(200);
      const after = await readBranding();
      expect(after.brand_updated_at).toBe(before.brand_updated_at);
      expect(await readName()).toBe('Rename Only Co');
    });
  });
});
