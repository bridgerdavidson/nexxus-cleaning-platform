import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimWebhookEvent, markWebhookProcessed } from './webhookIdempotency';

/**
 * Lightweight inline fake covering the three call shapes these helpers use:
 *   - insert(...)                          → { error }
 *   - select(...).eq(...).maybeSingle()    → { data }
 *   - update(...).eq(...)                  → { error }
 */
function makeSupabase(opts: {
  insertError?: { code?: string; message: string } | null;
  existingStatus?: string | null;
  existingReceivedAt?: string;
  updateError?: { code?: string; message: string } | null;
}): SupabaseClient {
  const maybeSingle = vi.fn(async () => ({
    data: opts.existingStatus
      ? { status: opts.existingStatus, received_at: opts.existingReceivedAt ?? new Date().toISOString() }
      : null,
  }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
  const insert = vi.fn(async () => ({ error: opts.insertError ?? null }));
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: opts.updateError ?? null })) }));
  const from = vi.fn(() => ({ insert, select, update }));
  return { from } as unknown as SupabaseClient;
}

const ev = { id: 'evt_1', type: 'payment_intent.succeeded', accountId: null };

describe('claimWebhookEvent', () => {
  it('claims a brand-new event (no insert error)', async () => {
    const supabase = makeSupabase({ insertError: null });
    expect(await claimWebhookEvent(supabase, ev)).toBe('claimed');
  });

  it('treats a unique-conflict on an already-processed row as a duplicate', async () => {
    const supabase = makeSupabase({ insertError: { code: '23505', message: 'dup' }, existingStatus: 'processed' });
    expect(await claimWebhookEvent(supabase, ev)).toBe('duplicate');
  });

  it('reclaims a unique-conflict on a failed row (a prior attempt finished with an error)', async () => {
    const failed = makeSupabase({ insertError: { code: '23505', message: 'dup' }, existingStatus: 'failed' });
    expect(await claimWebhookEvent(failed, ev)).toBe('claimed');
  });

  it('treats a RECENT received row as a duplicate (a concurrent delivery is in-flight)', async () => {
    const recent = makeSupabase({
      insertError: { code: '23505', message: 'dup' },
      existingStatus: 'received',
      existingReceivedAt: new Date().toISOString(),
    });
    expect(await claimWebhookEvent(recent, ev)).toBe('duplicate');
  });

  it('reclaims a STALE received row (the prior worker likely crashed mid-process)', async () => {
    const stale = makeSupabase({
      insertError: { code: '23505', message: 'dup' },
      existingStatus: 'received',
      existingReceivedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    expect(await claimWebhookEvent(stale, ev)).toBe('claimed');
  });

  it('throws on a NON-conflict insert error instead of silently claiming', async () => {
    // A transient DB/connection error must not let the event process without a persisted claim.
    const supabase = makeSupabase({ insertError: { code: '08006', message: 'connection failure' } });
    await expect(claimWebhookEvent(supabase, ev)).rejects.toThrow(/failed to claim/i);
  });

  it('throws on an error with no code (treated as non-conflict)', async () => {
    const supabase = makeSupabase({ insertError: { message: 'mystery' } });
    await expect(claimWebhookEvent(supabase, ev)).rejects.toThrow();
  });
});

describe('markWebhookProcessed', () => {
  it('resolves when the processed-state write succeeds', async () => {
    const supabase = makeSupabase({ updateError: null });
    await expect(markWebhookProcessed(supabase, 'evt_1')).resolves.toBeUndefined();
  });

  it('throws when the processed-state write fails (so the route returns 5xx, not a false 200)', async () => {
    const supabase = makeSupabase({ updateError: { code: '08006', message: 'connection failure' } });
    await expect(markWebhookProcessed(supabase, 'evt_1')).rejects.toThrow(/failed to mark/i);
  });
});
