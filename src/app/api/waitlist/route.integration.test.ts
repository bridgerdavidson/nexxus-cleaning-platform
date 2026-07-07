import { describe, it, expect, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute } from '../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

const RUN = `wl-${Date.now()}`;
const emailFor = (tag: string) => `${RUN}-${tag}@test.local`;

describe('POST /api/waitlist', () => {
  afterEach(async () => {
    const admin = createTestSupabaseClient();
    await admin.from('waitlist_signups').delete().like('email', `${RUN}-%`);
  });

  it('inserts a signup with all fields', async () => {
    const { status, body } = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: emailFor('full'), companyName: 'Brightside Cleaning Co', teamSize: '2-5' },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('waitlist_signups')
      .select('email, company_name, team_size, source')
      .eq('email', emailFor('full'))
      .single();
    expect(data).toMatchObject({
      email: emailFor('full'),
      company_name: 'Brightside Cleaning Co',
      team_size: '2-5',
      source: 'landing',
    });
  });

  it('accepts email only and normalizes case', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: emailFor('CASE').toUpperCase() },
    });
    expect(status).toBe(200);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('waitlist_signups')
      .select('email, company_name, team_size')
      .eq('email', emailFor('case'))
      .single();
    expect(data?.company_name).toBeNull();
    expect(data?.team_size).toBeNull();
  });

  it('treats a duplicate email as success without a second row', async () => {
    const email = emailFor('dupe');
    const first = await callRoute<{ ok: boolean }>(POST, { method: 'POST', body: { email } });
    const second = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: email.toUpperCase(), companyName: 'Second Try LLC' },
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin.from('waitlist_signups').select('id').eq('email', email);
    expect(data).toHaveLength(1);
  });

  it('rejects a missing or malformed email', async () => {
    const missing = await callRoute(POST, { method: 'POST', body: {} });
    expect(missing.status).toBe(400);
    const malformed = await callRoute(POST, { method: 'POST', body: { email: 'not-an-email' } });
    expect(malformed.status).toBe(400);
  });

  it('rejects an unknown team size', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: emailFor('teamsize'), teamSize: 'a-billion' },
    });
    expect(status).toBe(400);
  });

  it('rejects an oversize company name', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: emailFor('oversize'), companyName: 'x'.repeat(201) },
    });
    expect(status).toBe(400);
  });
});
