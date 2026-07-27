import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordPlatformAlert } from './platformAlert';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

/**
 * T1-14: open-incident dedupe for platform_alerts. One OPEN row per alert_type (unique partial
 * index, migration 115); occurrences fold into it, resolving lets the next occurrence open a
 * fresh row. platform_alerts is a global table on the shared local DB, so every test uses a
 * unique alert_type and cleans up after itself.
 */
describe('recordPlatformAlert — open-incident dedupe (T1-14)', () => {
  const db = createTestSupabaseClient();
  let alertType: string;

  beforeEach(() => {
    alertType = `test_t114_${crypto.randomUUID()}`;
    delete process.env.ALERT_WEBHOOK_URL; // no external sink in tests
  });

  afterEach(async () => {
    await db.from('platform_alerts').delete().eq('alert_type', alertType);
  });

  async function rows() {
    const { data, error } = await db
      .from('platform_alerts')
      .select('id, alert_type, severity, summary, occurrences, resolved_at')
      .eq('alert_type', alertType)
      .order('first_seen_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  it('folds repeat occurrences into one open row and bumps occurrences + summary', async () => {
    await recordPlatformAlert(db, { alert_type: alertType, summary: 'first', severity: 'warning' });
    await recordPlatformAlert(db, { alert_type: alertType, summary: 'second', severity: 'warning' });
    await recordPlatformAlert(db, { alert_type: alertType, summary: 'third', severity: 'warning' });

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ occurrences: 3, summary: 'third', resolved_at: null });
  });

  it('a RESOLVED incident stops deduping: the next occurrence opens a fresh row', async () => {
    await recordPlatformAlert(db, { alert_type: alertType, summary: 'incident one' });
    const [first] = await rows();
    await db
      .from('platform_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', first.id);

    await recordPlatformAlert(db, { alert_type: alertType, summary: 'incident two' });

    const all = await rows();
    expect(all).toHaveLength(2);
    const open = all.filter((r) => r.resolved_at === null);
    expect(open).toHaveLength(1);
    expect(open[0].summary).toBe('incident two');
    expect(open[0].occurrences).toBe(1);
  });

  it('the unique open-incident index rejects a second open row inserted around the dedupe', async () => {
    await recordPlatformAlert(db, { alert_type: alertType, summary: 'open incident' });
    // Simulate a concurrent writer that skipped the select-then-bump path entirely.
    const { error } = await db.from('platform_alerts').insert({
      alert_type: alertType,
      severity: 'critical',
      summary: 'racing duplicate',
      details: {},
    });
    expect(error?.code).toBe('23505');
    expect(await rows()).toHaveLength(1);
  });

  it('webhook fires on a NEW incident, then re-notifies only at power-of-two occurrences', async () => {
    const HOOK_URL = 'http://alert-sink.test.local/hook';
    const realFetch = globalThis.fetch;
    const hookCalls: number[] = [];
    // Intercept only the sink URL; Supabase traffic passes through untouched.
    vi.stubGlobal('fetch', ((url: unknown, init?: unknown) => {
      if (String(url) === HOOK_URL) {
        hookCalls.push(1);
        return Promise.resolve(new Response('ok'));
      }
      return realFetch(url as never, init as never);
    }) as typeof fetch);
    process.env.ALERT_WEBHOOK_URL = HOOK_URL;

    try {
      for (let i = 0; i < 5; i++) {
        await recordPlatformAlert(db, { alert_type: alertType, summary: `occ ${i + 1}` });
      }
      // occurrence 1 (new incident) + occurrences 2 and 4 (power-of-two re-notify heals a lost
      // initial dispatch); occurrences 3 and 5 stay silent.
      expect(hookCalls).toHaveLength(3);
      const [row] = await rows();
      expect(row).toMatchObject({ occurrences: 5 });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.ALERT_WEBHOOK_URL;
    }
  });

  it('different alert_types stay distinct incidents', async () => {
    const other = `${alertType}_other`;
    try {
      await recordPlatformAlert(db, { alert_type: alertType, summary: 'a' });
      await recordPlatformAlert(db, { alert_type: other, summary: 'b' });
      expect(await rows()).toHaveLength(1);
      const { data } = await db.from('platform_alerts').select('id').eq('alert_type', other);
      expect(data).toHaveLength(1);
    } finally {
      await db.from('platform_alerts').delete().eq('alert_type', other);
    }
  });
});
