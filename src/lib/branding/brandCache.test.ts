import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readBrandCache, writeBrandCache, clearBrandCache } from "./brandCache";

// Minimal in-memory localStorage stand-in (unit tests run in the `node` env,
// which has no window). Same pattern as formDraft.test.ts.
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
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("brandCache", () => {
  it("returns null when empty", () => expect(readBrandCache()).toBeNull());

  it("round-trips vars", () => {
    writeBrandCache("org-1", { "--brand-600": "221 99% 50%" });
    expect(readBrandCache()).toEqual({ orgId: "org-1", vars: { "--brand-600": "221 99% 50%" } });
  });

  it("returns null for corrupt json", () => {
    storage.setItem("nexxus.brand.v1", "{not json");
    expect(readBrandCache()).toBeNull();
  });

  it("returns null for a well-formed but incomplete entry", () => {
    storage.setItem("nexxus.brand.v1", JSON.stringify({ orgId: "x" }));
    expect(readBrandCache()).toBeNull();
  });

  it("clears", () => {
    writeBrandCache("org-1", { "--brand-600": "0 0% 0%" });
    clearBrandCache();
    expect(readBrandCache()).toBeNull();
  });

  it("never throws when storage itself throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readBrandCache()).toBeNull();
    expect(() => writeBrandCache("org-1", {})).not.toThrow();
    expect(() => clearBrandCache()).not.toThrow();
  });
});

describe("brandCache without window (SSR)", () => {
  it("no-ops safely", () => {
    vi.unstubAllGlobals();
    expect(readBrandCache()).toBeNull();
    expect(() => writeBrandCache("org-1", {})).not.toThrow();
    expect(() => clearBrandCache()).not.toThrow();
  });
});
