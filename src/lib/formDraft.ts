/**
 * Generic, client-side draft persistence for modal/wizard forms.
 *
 * Backed by sessionStorage: zero server/database cost, a few KB per browser tab, and wiped
 * when the tab closes. The point is to survive a full page reload (or an accidental navigation
 * and return) so a half-filled form is not lost. It is NOT a server-side save.
 *
 * Each draft is stored under its own key with a small envelope: a schema `version`, the
 * owning `orgId`, and a `savedAt` timestamp. `load` rejects drafts from a different org, a
 * different schema version, or older than `maxAgeMs`, so a stale or cross-tenant draft never
 * resurrects.
 */

const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6 hours

interface DraftEnvelope<T> {
  v: number;
  orgId: string;
  savedAt: number;
  body: T;
}

export interface DraftStore<T> {
  /** The sessionStorage key (exposed for tests/debugging). */
  readonly key: string;
  /** The canonical "empty" body; `isDirty` compares against this. */
  readonly initial: T;
  /** Persist a draft for the given org. No-op if storage is unavailable. */
  save: (orgId: string, body: T) => void;
  /** Load a valid draft for the given org, or null (wrong org / version / too old / absent). */
  load: (orgId: string) => T | null;
  /** Remove any persisted draft. */
  clear: () => void;
  /** Whether a body differs from `initial` (i.e. the user has entered something). */
  isDirty: (body: T) => boolean;
}

/** Safely resolve sessionStorage. Returns null under SSR/node or when access throws. */
function getStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    // Access can throw in some privacy modes.
  }
  return null;
}

export function createDraftStore<T>(opts: {
  key: string;
  version: number;
  initial: T;
  maxAgeMs?: number;
}): DraftStore<T> {
  const { key, version, initial } = opts;
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const initialJson = JSON.stringify(initial);

  const clear = () => {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  };

  const save = (orgId: string, body: T) => {
    const storage = getStorage();
    if (!storage) return;
    try {
      const envelope: DraftEnvelope<T> = {
        v: version,
        orgId,
        savedAt: Date.now(),
        body,
      };
      storage.setItem(key, JSON.stringify(envelope));
    } catch {
      // Quota or serialization failure: a lost draft is acceptable, never throw.
    }
  };

  const load = (orgId: string): T | null => {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const env = JSON.parse(raw) as DraftEnvelope<T>;
      if (!env || env.v !== version || env.orgId !== orgId) return null;
      if (typeof env.savedAt !== "number" || Date.now() - env.savedAt > maxAgeMs) {
        clear();
        return null;
      }
      return env.body;
    } catch {
      return null;
    }
  };

  const isDirty = (body: T) => JSON.stringify(body) !== initialJson;

  return { key, initial, save, load, clear, isDirty };
}
