import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimWebhookEvent } from './webhookIdempotency';

/**
 * Lightweight inline fake: webhook_events.insert resolves { error }, and the follow-up
 * select(...).eq(...).maybeSingle() resolves { data } with the existing row's status.
 */
function makeSupabase(opts: {
  insertError?: { code?: string; message: string } | null;
  existingStatus?: string | null;
}): SupabaseClient {
  const maybeSingle = vi.fn(async () => ({
    data: opts.existingStatus ? { status: opts.existingStatus } : null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn(async () => ({ error: opts.insertError ?? null }));
  const from = vi.fn(() => ({ insert, select }));
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

  it('re-claims a unique-conflict on a not-yet-finished row (received/failed)', async () => {
    const received = makeSupabase({ insertError: { code: '23505', message: 'dup' }, existingStatus: 'received' });
    expect(await claimWebhookEvent(received, ev)).toBe('claimed');
    const failed = makeSupabase({ insertError: { code: '23505', message: 'dup' }, existingStatus: 'failed' });
    expect(await claimWebhookEvent(failed, ev)).toBe('claimed');
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
