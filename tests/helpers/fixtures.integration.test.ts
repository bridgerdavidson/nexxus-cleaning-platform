import { describe, expect, it } from 'vitest';
import { withTestOrg } from './fixtures';
import { createTestSupabaseClient } from './supabase';

// Proves withTestOrg()'s billing default explicitly rather than relying on it.
// This is the load-bearing assertion behind Task 11: after the Phase 1b
// migration, a fresh organizations row defaults subscription_status to 'none',
// which deriveBillingAccess treats as an expired trial (frozen). Every
// integration test that creates an org via withTestOrg() and then writes
// something depends on this fixture instead stamping a live trial.
const supabase = createTestSupabaseClient();

describe('withTestOrg billing defaults', () => {
  it('creates organizations in a live trial, never frozen', async () => {
    const org = await withTestOrg();
    try {
      const { data } = await supabase
        .from('organizations')
        .select('subscription_status, trial_ends_at, comped_at')
        .eq('id', org.organizationId)
        .single();

      expect(data?.subscription_status).toBe('trialing');
      expect(data?.comped_at).toBeNull();
      expect(new Date(data!.trial_ends_at!).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await org.cleanup();
    }
  });

  it('lets an explicit billing override win over the default', async () => {
    const compedAt = new Date().toISOString();
    const org = await withTestOrg({ billing: { comped_at: compedAt, subscription_status: 'active' } });
    try {
      const { data } = await supabase
        .from('organizations')
        .select('subscription_status, comped_at')
        .eq('id', org.organizationId)
        .single();

      expect(data?.subscription_status).toBe('active');
      expect(data?.comped_at).not.toBeNull();
    } finally {
      await org.cleanup();
    }
  });
});
