import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readBrandCache, writeBrandCache, clearBrandCache, readCachedIconUrls } from "./brandCache";

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
    expect(readBrandCache()).toEqual({
      orgId: "org-1",
      vars: { "--brand-600": "221 99% 50%" },
      iconUrl: null,
      iconDarkUrl: null,
    });
  });

  it("round-trips the icon url", () => {
    writeBrandCache("org-1", {}, "https://x/icon.png?v=1");
    expect(readBrandCache()?.iconUrl).toBe("https://x/icon.png?v=1");
  });

  it("round-trips the dark icon url", () => {
    writeBrandCache("org-1", {}, "https://x/icon.png?v=1", "https://x/icon-dark.png?v=1");
    expect(readCachedIconUrls()).toEqual({
      iconUrl: "https://x/icon.png?v=1",
      iconDarkUrl: "https://x/icon-dark.png?v=1",
    });
  });

  it("reads a pre-iconUrl cache entry (legacy shape)", () => {
    storage.setItem("nexxus.brand.v1", JSON.stringify({ orgId: "org-1", vars: { "--brand-600": "x" } }));
    expect(readBrandCache()?.vars).toEqual({ "--brand-600": "x" });
    expect(readCachedIconUrls()).toEqual({ iconUrl: null, iconDarkUrl: null });
  });

  it("reads a pre-iconDarkUrl cache entry (light icon only)", () => {
    storage.setItem(
      "nexxus.brand.v1",
      JSON.stringify({ orgId: "org-1", vars: { "--brand-600": "x" }, iconUrl: "https://x/i.png" }),
    );
    expect(readCachedIconUrls()).toEqual({ iconUrl: "https://x/i.png", iconDarkUrl: null });
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

  it("readCachedIconUrls honors the remembered-org guard", () => {
    writeBrandCache("org-1", {}, "https://x/icon.png", "https://x/icon-dark.png");
    // No remembered org: trust the cache (same rule as the bootstrap replay).
    expect(readCachedIconUrls().iconUrl).toBe("https://x/icon.png");
    storage.setItem("nexxus.currentOrg", "org-1");
    expect(readCachedIconUrls()).toEqual({
      iconUrl: "https://x/icon.png",
      iconDarkUrl: "https://x/icon-dark.png",
    });
    // Org switch: the stale entry must not surface the OLD company's mark.
    storage.setItem("nexxus.currentOrg", "org-2");
    expect(readCachedIconUrls()).toEqual({ iconUrl: null, iconDarkUrl: null });
  });

  it("readCachedIconUrls is all-null when no icon was cached", () => {
    writeBrandCache("org-1", { "--brand-600": "x" });
    expect(readCachedIconUrls()).toEqual({ iconUrl: null, iconDarkUrl: null });
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
