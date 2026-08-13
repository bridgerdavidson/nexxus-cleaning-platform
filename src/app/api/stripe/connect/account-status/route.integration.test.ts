import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The route only needs getConnectAccountStatus from @/lib/stripe; mock it so we can
// assert the pending-token guard never reaches Stripe (incident 2026-08-13: a status
// poll racing /start's claim→commit window sent the `pending:` slot token to Stripe,
// which 500s with account_invalid).
vi.mock('@/lib/stripe', () => ({
  getConnectAccountStatus: vi.fn(async () => ({
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  })),
}));

import { POST } from './route';
import { getConnectAccountStatus } from '@/lib/stripe';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

async function setStoredAccountId(cleanerId: string, value: string | null) {
  const db = createTestSupabaseClient();
  const { error } = await db
    .from('cleaner_profiles')
    .update({ stripe_connect_account_id: value })
    .eq('id', cleanerId);
  if (error) throw new Error(`fixture update failed: ${error.message}`);
}

describe('POST /api/stripe/connect/account-status', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(getConnectAccountStatus).mockClear();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalFlag;
    await org.cleanup();
  });

  it('treats a stored pending: slot token as no-account and never calls Stripe', async () => {
    await setStoredAccountId(org.cleaner.userId, 'pending:00000000-0000-0000-0000-000000000000');

    const { status, body } = await callRoute<{
      success: boolean;
      has_account: boolean;
      onboarding_complete: boolean;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cleaner_id: org.cleaner.userId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.has_account).toBe(false);
    expect(body.onboarding_complete).toBe(false);
    expect(getConnectAccountStatus).not.toHaveBeenCalled();
  });

  it('reports no account when nothing is stored', async () => {
    await setStoredAccountId(org.cleaner.userId, null);

    const { status, body } = await callRoute<{ has_account: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cleaner_id: org.cleaner.userId },
    });

    expect(status).toBe(200);
    expect(body.has_account).toBe(false);
    expect(getConnectAccountStatus).not.toHaveBeenCalled();
  });

  it('passes a real acct_ id through to Stripe for status', async () => {
    await setStoredAccountId(org.cleaner.userId, 'acct_test_status_1');

    const { status, body } = await callRoute<{ has_account: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cleaner_id: org.cleaner.userId },
    });

    expect(status).toBe(200);
    expect(body.has_account).toBe(true);
    expect(getConnectAccountStatus).toHaveBeenCalledWith('acct_test_status_1');
  });
});
