import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDraftStore } from "./formDraft";

// Minimal in-memory sessionStorage stand-in (unit tests run in the `node` env, which has none).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

interface SampleDraft {
  step: number;
  name: string;
  selectedId: string | null;
}

const INITIAL: SampleDraft = { step: 1, name: "", selectedId: null };

function makeStore(maxAgeMs?: number) {
  return createDraftStore<SampleDraft>({
    key: "test.draft.v1",
    version: 1,
    initial: INITIAL,
    maxAgeMs,
  });
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("sessionStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createDraftStore.isDirty", () => {
  it("is false for the initial body", () => {
    expect(makeStore().isDirty({ ...INITIAL })).toBe(false);
  });

  it("is true when any field differs from initial", () => {
    const store = makeStore();
    expect(store.isDirty({ ...INITIAL, name: "Ada" })).toBe(true);
    expect(store.isDirty({ ...INITIAL, step: 2 })).toBe(true);
    expect(store.isDirty({ ...INITIAL, selectedId: "abc" })).toBe(true);
  });
});

describe("createDraftStore.save/load", () => {
  it("round-trips a draft for the same org", () => {
    const store = makeStore();
    const body: SampleDraft = { step: 3, name: "Ada", selectedId: "p1" };
    store.save("org-1", body);
    expect(store.load("org-1")).toEqual(body);
  });

  it("returns null for a different org", () => {
    const store = makeStore();
    store.save("org-1", { step: 2, name: "x", selectedId: null });
    expect(store.load("org-2")).toBeNull();
  });

  it("returns null when absent", () => {
    expect(makeStore().load("org-1")).toBeNull();
  });

  it("returns null on a schema version mismatch", () => {
    makeStore().save("org-1", { step: 2, name: "x", selectedId: null });
    // A store with a bumped version must reject the older envelope.
    const v2 = createDraftStore<SampleDraft>({
      key: "test.draft.v1",
      version: 2,
      initial: INITIAL,
    });
    expect(v2.load("org-1")).toBeNull();
  });

  it("returns null and clears when older than maxAgeMs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = makeStore(1000 * 60 * 60); // 1h
    store.save("org-1", { step: 2, name: "x", selectedId: null });

    vi.setSystemTime(new Date("2026-01-01T02:00:00Z")); // +2h > 1h
    expect(store.load("org-1")).toBeNull();
    // load() should have evicted the stale entry.
    expect(storage.getItem("test.draft.v1")).toBeNull();
  });

  it("still loads when within maxAgeMs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = makeStore(1000 * 60 * 60); // 1h
    const body: SampleDraft = { step: 2, name: "x", selectedId: null };
    store.save("org-1", body);

    vi.setSystemTime(new Date("2026-01-01T00:30:00Z")); // +30m < 1h
    expect(store.load("org-1")).toEqual(body);
  });
});

describe("createDraftStore.clear", () => {
  it("removes the stored draft", () => {
    const store = makeStore();
    store.save("org-1", { step: 2, name: "x", selectedId: null });
    store.clear();
    expect(store.load("org-1")).toBeNull();
    expect(storage.getItem("test.draft.v1")).toBeNull();
  });
});

describe("createDraftStore without storage", () => {
  it("no-ops safely when sessionStorage is unavailable", () => {
    vi.unstubAllGlobals(); // remove the in-memory stand-in -> node has no sessionStorage
    const store = makeStore();
    expect(() => store.save("org-1", { step: 2, name: "x", selectedId: null })).not.toThrow();
    expect(store.load("org-1")).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });
});
