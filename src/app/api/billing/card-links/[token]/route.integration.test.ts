import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/setup-intents', () => ({
  retrieveSetupIntent: vi.fn(async () => ({ client_secret: 'seti_secret_xyz' })),
}));

import { GET } from './route';
import { callRoute } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (token: string) => (req: NextRequest) =>
  GET(req, { params: Promise.resolve({ token }) });

describe('GET /api/billing/card-links/:token', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function seedLink(token: string, opts: { expired?: boolean; status?: string } = {}) {
    const db = createTestSupabaseClient();
    const expiresAt = new Date(Date.now() + (opts.expired ? -1000 : 7 * 24 * 60 * 60 * 1000)).toISOString();
    await db.from('homeowner_payment_links').insert({
      homeowner_id: org.homeowner.userId,
      organization_id: org.organizationId,
      token,
      setup_intent_id: 'seti_seed',
      status: opts.status ?? 'pending',
      created_by: org.admin.userId,
      expires_at: expiresAt,
    });
  }

  it('404 for an unknown token', async () => {
    const { status } = await callRoute(handlerFor('tok_unknown'), { method: 'GET' });
    expect(status).toBe(404);
  });

  it('410 for an expired link (and lazily marks it expired)', async () => {
    await seedLink('tok_expired', { expired: true });
    const { status } = await callRoute(handlerFor('tok_expired'), { method: 'GET' });
    expect(status).toBe(410);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('homeowner_payment_links')
      .select('status')
      .eq('token', 'tok_expired')
      .single();
    expect((data as { status: string }).status).toBe('expired');
  });

  it('410 for an already-completed link', async () => {
    await seedLink('tok_done', { status: 'completed' });
    const { status } = await callRoute(handlerFor('tok_done'), { method: 'GET' });
    expect(status).toBe(410);
  });

  it('returns the SetupIntent client secret + homeowner first name for a valid link', async () => {
    await seedLink('tok_valid');
    const { status, body } = await callRoute<{ client_secret: string; homeowner_first_name: string; status: string }>(
      handlerFor('tok_valid'),
      { method: 'GET' },
    );
    expect(status).toBe(200);
    expect(body.client_secret).toBe('seti_secret_xyz');
    expect(body.homeowner_first_name).toBe('Homeowner');
    expect(body.status).toBe('pending');
  });

  it('returns null branding for an org that set none', async () => {
    await seedLink('tok_plain');
    const { status, body } = await callRoute<{ brand_color: string | null; logo_icon_url: string | null }>(
      handlerFor('tok_plain'),
      { method: 'GET' },
    );
    expect(status).toBe(200);
    expect(body.brand_color).toBeNull();
    expect(body.logo_icon_url).toBeNull();
  });

  it('does not leak branding on inactive links (the 410 body carries no org fields)', async () => {
    const db = createTestSupabaseClient();
    await db.from('organizations').update({ brand_color: '#B5179E' }).eq('id', org.organizationId);
    await seedLink('tok_expired_branded', { expired: true });
    const { status, body } = await callRoute<Record<string, unknown>>(
      handlerFor('tok_expired_branded'),
      { method: 'GET' },
    );
    expect(status).toBe(410);
    expect(body.brand_color).toBeUndefined();
    expect(body.org_name).toBeUndefined();
  });

  it("returns the link org's branding so the page can theme itself (white-label PR 5)", async () => {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ brand_color: '#B5179E' })
      .eq('id', org.organizationId);
    await seedLink('tok_branded');
    const { status, body } = await callRoute<{
      org_name: string | null;
      brand_color: string | null;
      logo_icon_url: string | null;
    }>(handlerFor('tok_branded'), { method: 'GET' });
    expect(status).toBe(200);
    expect(body.brand_color).toBe('#B5179E');
    expect(typeof body.org_name).toBe('string');
    expect(body.org_name!.length).toBeGreaterThan(0);
    expect(body.logo_icon_url).toBeNull();
  });
});
