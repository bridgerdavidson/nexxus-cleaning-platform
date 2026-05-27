import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The global integration setup mocks @/lib/stripe so getStripe() throws. The cleaner
// Connect helpers live in their own module and call getStripe()/Stripe internally, so we
// mock that module here — keeping real Stripe out while still exercising the route's auth,
// self-scoping, and DB-persistence behavior.
vi.mock('@/lib/stripe/connect/cleaner', () => ({
  createCleanerConnectAccount: vi.fn(async () => ({ id: 'acct_test_cleaner' })),
  createCleanerAccountSession: vi.fn(async (acctId: string) => ({
    client_secret: `accs_secret_${acctId}`,
  })),
}));

import { POST } from './route';
import { createCleanerConnectAccount } from '@/lib/stripe/connect/cleaner';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/connect/cleaner/start', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalFlag;
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { cleaner_id: org.cleaner.userId },
    });
    expect(status).toBe(401);
  });

  it('returns 404 when STRIPE_ENABLED is false', async () => {
    process.env.STRIPE_ENABLED = 'false';
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cleaner_id: org.cleaner.userId },
    });
    expect(status).toBe(404);
  });

  it('rejects a caller acting on a different cleaner (self-only)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleaner_id: org.cleaner.userId },
    });
    expect(status).toBe(403);
  });

  it('creates a connected account and persists it, returning a client secret', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      account_id: string;
      client_secret: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cleaner_id: org.cleaner.userId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.account_id).toBe('acct_test_cleaner');
    expect(body.client_secret).toMatch(/^accs_secret_/);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('cleaner_profiles')
      .select('stripe_connect_account_id')
      .eq('id', org.cleaner.userId)
      .single();
    expect((row as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBe(
      body.account_id,
    );
  });

  it('is idempotent: a second call reuses the existing account (no new account created)', async () => {
    const headers = bearerHeader(org.cleaner.accessToken);
    const reqBody = { cleaner_id: org.cleaner.userId };

    const first = await callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody });
    const second = await callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody });

    expect(first.body.account_id).toBe(second.body.account_id);
    expect(vi.mocked(createCleanerConnectAccount)).toHaveBeenCalledTimes(1);
  });
});
