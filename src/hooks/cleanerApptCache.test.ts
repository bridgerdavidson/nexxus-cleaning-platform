import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readCleanerApptCache, writeCleanerApptCache } from './cleanerApptCache';

// The module only touches window.localStorage; stub it in-memory so the test
// needs no DOM environment (the repo installs neither jsdom nor happy-dom).
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

beforeEach(() => stubStorage());
afterEach(() => vi.unstubAllGlobals());

describe('cleanerApptCache', () => {
  it('round-trips a snapshot for a user', () => {
    writeCleanerApptCache('u1', [{ id: 'a1' }], Date.now());
    expect(readCleanerApptCache<{ id: string }>('u1')?.data).toEqual([{ id: 'a1' }]);
  });

  it('is scoped per user (no cross-account leak on a shared device)', () => {
    writeCleanerApptCache('u1', [{ id: 'a1' }], Date.now());
    expect(readCleanerApptCache('u2')).toBeNull();
  });

  it('returns null for an empty user id or an empty store', () => {
    expect(readCleanerApptCache('')).toBeNull();
    expect(readCleanerApptCache('nobody')).toBeNull();
  });

  it('drops a snapshot older than the max age', () => {
    writeCleanerApptCache('u1', [{ id: 'a1' }], Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 days
    expect(readCleanerApptCache('u1')).toBeNull();
  });

  it('returns null on corrupt JSON instead of throwing', () => {
    window.localStorage.setItem('nexxus.cleanerAppointments.v1.u1', '{not json');
    expect(readCleanerApptCache('u1')).toBeNull();
  });

  it('stamps the given ts (so re-persisting the seed never extends its life)', () => {
    const ts = Date.now() - 1000;
    writeCleanerApptCache('u1', [{ id: 'a1' }], ts);
    expect(readCleanerApptCache('u1')?.ts).toBe(ts);
  });
});
