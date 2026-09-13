import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertOrgWritable } from './guard';

const ORG = '11111111-1111-4111-8111-111111111111';

/** Minimal stub with the `.from().select().eq().maybeSingle()` chain the guard uses. */
function stubDb(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, eq, maybeSingle };
}

const trialingRow = (trialEndsAt: string) => ({
  data: {
    subscription_status: 'trialing',
    trial_ends_at: trialEndsAt,
    trial_extended_at: null,
    comped_at: null,
    plan_tier: null,
    billing_period: null,
    seat_count: null,
    subscription_cancel_at: null,
    billing_paused_at: null,
    billing_pause_resumes_at: null,
  },
  error: null,
});

describe('assertOrgWritable with the flag off', () => {
  beforeEach(() => { delete process.env.BILLING_ENFORCEMENT_ENABLED; });

  it('returns ok without touching the database', async () => {
    const db = stubDb(trialingRow(new Date(Date.now() - 86_400_000).toISOString()));
    const result = await assertOrgWritable(db.client, ORG);
    expect(result.ok).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('assertOrgWritable with the flag on', () => {
  beforeEach(() => { process.env.BILLING_ENFORCEMENT_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILLING_ENFORCEMENT_ENABLED; });

  it('allows a live trial', async () => {
    const db = stubDb(trialingRow(new Date(Date.now() + 7 * 86_400_000).toISOString()));
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('refuses an expired trial with 402 and the documented body', async () => {
    const endedAt = new Date(Date.now() - 86_400_000).toISOString();
    const db = stubDb(trialingRow(endedAt));
    const result = await assertOrgWritable(db.client, ORG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(402);
    await expect(result.response.json()).resolves.toEqual({
      error: 'billing_frozen',
      state: 'trial_expired',
      trial_ends_at: endedAt,
      can_extend_trial: true,
    });
  });

  it('allows a comped org whose trial ended long ago', async () => {
    const db = stubDb({
      data: { ...trialingRow('2020-01-01T00:00:00Z').data, comped_at: '2020-01-01T00:00:00Z' },
      error: null,
    });
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('refuses a paused org', async () => {
    const db = stubDb({
      data: {
        ...trialingRow(new Date(Date.now() + 86_400_000).toISOString()).data,
        subscription_status: 'active',
        billing_paused_at: '2026-09-01T00:00:00Z',
      },
      error: null,
    });
    const result = await assertOrgWritable(db.client, ORG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(402);
  });

  it('fails open when the organization row is missing', async () => {
    const db = stubDb({ data: null, error: null });
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('fails open when the query errors, so a database blip cannot freeze every tenant', async () => {
    const db = stubDb({ data: null, error: { message: 'connection reset' } });
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('returns ok for a null organization id rather than guessing', async () => {
    const db = stubDb(trialingRow(new Date().toISOString()));
    expect((await assertOrgWritable(db.client, null)).ok).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('the service-role invariant', () => {
  // A cron job, a webhook, or a settlement path must never be gated by billing.
  // Freezing an org must stop new work, never stop money already in flight.
  const roots = ['src/lib/payments', 'src/app/api/cron', 'src/app/api/stripe/webhook'];

  it('is not imported by any service-role path', () => {
    const offenders: string[] = [];
    // Per-root, not aggregated: the roots are wildly uneven in size (payments is
    // dozens of files, the webhook root is a single file), so a single combined
    // total would stay well above zero even if one root got renamed out from
    // under this test and `walk` silently returned [] for it. Checking each
    // root's count individually means a renamed/missing root fails loudly no
    // matter how small it is, which matters most for the webhook root: it is
    // the money-in-flight case the header comment on guard.ts calls out by name.
    for (const root of roots) {
      const files = walk(join(process.cwd(), root));
      expect(files.length, `expected to find files under ${root}`).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (/from\s+['"](@\/lib\/billing\/guard|.*\/billing\/guard)['"]/.test(source)) {
          offenders.push(file.replace(process.cwd() + '/', ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry: string) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}
