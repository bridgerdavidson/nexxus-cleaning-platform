import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T1-10: the dead-letter retry sweep must (1) pass the stored Connect account so Connect-delivered
 * events (payout.paid, payout.failed, account.updated, connected transfer.reversed) resolve instead
 * of 404ing on the platform, and (2) terminalize a permanently-failing row to 'dead' after
 * DEAD_LETTER_MAX_ATTEMPTS so it can't starve the ascending-FIFO batch, raising a critical alert when
 * it gives up.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));

vi.mock('@/lib/payments/dispatchStripeEvent', () => ({
  dispatchStripeEvent: vi.fn(async () => {}),
}));

import { retryDeadLetterWebhooks } from '@/lib/payments/reconcile';
import { retrieveStripeEvent } from '@/lib/stripe/reconcile';
import { dispatchStripeEvent } from '@/lib/payments/dispatchStripeEvent';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

const DEAD_LETTER_MAX_ATTEMPTS = 20;
const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe('retryDeadLetterWebhooks — Connect account passthrough + dead-letter terminalization (T1-10)', () => {
  const db = createTestSupabaseClient();
  const createdIds: string[] = [];

  async function seedEvent(row: {
    account_id?: string | null;
    status?: string;
    retry_count?: number;
    type?: string;
  }): Promise<string> {
    const id = `evt_t110_${crypto.randomUUID()}`;
    createdIds.push(id);
    const { error } = await db.from('webhook_events').insert({
      id,
      type: row.type ?? 'payout.paid',
      account_id: row.account_id ?? null,
      status: row.status ?? 'failed',
      retry_count: row.retry_count ?? 0,
      received_at: HOUR_AGO(),
    });
    if (error) throw new Error(`seed webhook_events failed: ${error.message}`);
    return id;
  }

  async function rowOf(id: string) {
    const { data } = await db.from('webhook_events').select('status, retry_count').eq('id', id).single();
    return data as { status: string; retry_count: number };
  }

  beforeEach(() => {
    vi.mocked(retrieveStripeEvent).mockReset();
    vi.mocked(dispatchStripeEvent).mockReset();
    vi.mocked(dispatchStripeEvent).mockResolvedValue(undefined as never);
  });

  afterEach(async () => {
    if (createdIds.length) {
      await db.from('webhook_events').delete().in('id', createdIds);
      for (const id of createdIds) {
        await db.from('platform_alerts').delete().eq('alert_type', `webhook_dead_letter:${id}`);
      }
      createdIds.length = 0;
    }
  });

  // Note: webhook_events is global (not org-scoped) and the sweep has no id filter, so it runs over
  // the whole shared local DB. Assertions are therefore STRICT on our own seeded row (by id) and
  // TOLERANT on aggregate counts; recover mocks resolve ONLY our id (rejecting any stray foreign row
  // rather than marking it 'processed'). CI runs against an isolated DB where only our rows exist.
  const resolveOnly = (id: string, type: string) =>
    vi.mocked(retrieveStripeEvent).mockImplementation(async (evId: string) => {
      if (evId === id) return { id, type } as Stripe.Event;
      throw new Error('unrelated dead-letter row (not under test)');
    });

  it('passes the stored Connect account_id as stripeAccount and recovers the event', async () => {
    const id = await seedEvent({ account_id: 'acct_connected_1', type: 'payout.paid' });
    resolveOnly(id, 'payout.paid');

    await retryDeadLetterWebhooks(db, { batch: 500 });

    expect(vi.mocked(retrieveStripeEvent)).toHaveBeenCalledWith(id, { stripeAccount: 'acct_connected_1' });
    expect((await rowOf(id)).status).toBe('processed');
  });

  it('passes stripeAccount: null for a platform event (no account_id)', async () => {
    const id = await seedEvent({ account_id: null, type: 'payment_intent.succeeded' });
    resolveOnly(id, 'payment_intent.succeeded');

    await retryDeadLetterWebhooks(db, { batch: 500 });

    expect(vi.mocked(retrieveStripeEvent)).toHaveBeenCalledWith(id, { stripeAccount: null });
    expect((await rowOf(id)).status).toBe('processed');
  });

  it('a still-recoverable failure increments retry_count and stays failed (not dead)', async () => {
    const id = await seedEvent({ retry_count: 0 });
    vi.mocked(retrieveStripeEvent).mockRejectedValue(new Error('stripe unreachable'));

    const res = await retryDeadLetterWebhooks(db, { batch: 500 });

    const row = await rowOf(id);
    expect(row.status).toBe('failed');
    expect(row.retry_count).toBe(1);
    expect(res.stillFailed).toBeGreaterThanOrEqual(1);
  });

  it('terminalizes to dead + raises a critical alert after the last attempt fails', async () => {
    const id = await seedEvent({
      account_id: 'acct_detached_9',
      retry_count: DEAD_LETTER_MAX_ATTEMPTS - 1,
      type: 'payout.failed',
    });
    vi.mocked(retrieveStripeEvent).mockRejectedValue(new Error('No such event'));

    const res = await retryDeadLetterWebhooks(db, { batch: 500 });

    const row = await rowOf(id);
    expect(row.status).toBe('dead');
    expect(row.retry_count).toBe(DEAD_LETTER_MAX_ATTEMPTS);
    expect(res.dead).toBeGreaterThanOrEqual(1);

    const { data: alerts } = await db
      .from('platform_alerts')
      .select('severity, details')
      .eq('alert_type', `webhook_dead_letter:${id}`);
    expect((alerts ?? []).length).toBe(1);
    expect((alerts![0] as { severity: string }).severity).toBe('critical');
  });

  it('excludes dead rows from the retry batch (no more starvation)', async () => {
    const id = await seedEvent({ status: 'dead', retry_count: DEAD_LETTER_MAX_ATTEMPTS });
    // Reject any row the sweep does pick up, so a stray foreign row is never marked 'processed'.
    vi.mocked(retrieveStripeEvent).mockRejectedValue(new Error('unrelated dead-letter row'));

    await retryDeadLetterWebhooks(db, { batch: 500 });

    // The dead row is not selected (sweep filters status IN ('received','failed')) → never re-fetched.
    expect(vi.mocked(retrieveStripeEvent)).not.toHaveBeenCalledWith(id, expect.anything());
    expect((await rowOf(id)).status).toBe('dead');
  });
});
