import { describe, it, expect, afterEach, vi } from "vitest";
import { BRAND_BOOTSTRAP_SCRIPT } from "./bootstrapScript";
import { BRAND_CACHE_KEY, REMEMBERED_ORG_KEY, BRAND_BOOTSTRAP_SHEET_GLOBAL } from "./tokens";

/**
 * Executes the inline <script> exactly as a browser would: as plain script
 * text resolving `localStorage` / `location` / `document` / `window` /
 * `CSSStyleSheet` off the global scope. The stubs below stand in for those
 * globals in the node env.
 */
function runBootstrap() {
  new Function(BRAND_BOOTSTRAP_SCRIPT)();
}

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
}

class FakeSheet {
  css = "";
  replaceSync(text: string): void {
    this.css = text;
  }
}

let storage: MemoryStorage;
let doc: { adoptedStyleSheets: FakeSheet[] };
let win: Record<string, unknown>;

function stubEnvironment(pathname: string) {
  storage = new MemoryStorage();
  doc = { adoptedStyleSheets: [] };
  win = {};
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("location", { pathname });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("CSSStyleSheet", FakeSheet);
}

function seedCache(orgId = "org-1", vars: Record<string, string> = { "--brand-600": "1 2% 3%" }) {
  storage.setItem(BRAND_CACHE_KEY, JSON.stringify({ orgId, vars }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BRAND_BOOTSTRAP_SCRIPT", () => {
  it("adopts a :root sheet with the cached --brand-* vars on a tenant app path", () => {
    stubEnvironment("/admin/settings");
    seedCache();
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    expect(doc.adoptedStyleSheets[0].css).toBe(":root{--brand-600:1 2% 3%;}");
    // Handle stored for BrandProvider's restoreDefaults to un-adopt.
    expect(win[BRAND_BOOTSTRAP_SHEET_GLOBAL]).toBe(doc.adoptedStyleSheets[0]);
  });

  it.each(["/", "/login", "/signup", "/owner", "/owner/tenants", "/billing/add-card", "/administrator"])(
    "adopts nothing on non-tenant path %s",
    (pathname) => {
      stubEnvironment(pathname);
      seedCache();
      runBootstrap();
      expect(doc.adoptedStyleSheets).toHaveLength(0);
      expect(win[BRAND_BOOTSTRAP_SHEET_GLOBAL]).toBeUndefined();
    },
  );

  it.each(["/admin", "/cleaner", "/homeowner", "/cleaner/messages", "/homeowner/account"])(
    "adopts on tenant path %s",
    (pathname) => {
      stubEnvironment(pathname);
      seedCache();
      runBootstrap();
      expect(doc.adoptedStyleSheets).toHaveLength(1);
    },
  );

  it("skips the replay when the remembered org differs from the cache's", () => {
    stubEnvironment("/admin");
    seedCache("org-1");
    storage.setItem(REMEMBERED_ORG_KEY, "org-2");
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(0);
  });

  it("replays when the remembered org matches", () => {
    stubEnvironment("/admin");
    seedCache("org-1");
    storage.setItem(REMEMBERED_ORG_KEY, "org-1");
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
  });

  it("preserves previously adopted sheets (concat, not replace)", () => {
    stubEnvironment("/admin");
    const existing = new FakeSheet();
    doc.adoptedStyleSheets = [existing];
    seedCache();
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(2);
    expect(doc.adoptedStyleSheets[0]).toBe(existing);
  });

  it("only includes variables namespaced --brand-", () => {
    stubEnvironment("/admin");
    seedCache("org-1", { "--brand-500": "1 2% 3%", "--evil": "url(x)", "background": "red" });
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    expect(doc.adoptedStyleSheets[0].css).toBe(":root{--brand-500:1 2% 3%;}");
  });

  it("strips CSS metacharacters from tampered values (no injection)", () => {
    stubEnvironment("/admin");
    seedCache("org-1", { "--brand-600": "red}body{display:none" });
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    expect(doc.adoptedStyleSheets[0].css).toBe(":root{--brand-600:redbodydisplaynone;}");
  });

  it("adopts nothing when no cached var survives the namespace filter", () => {
    stubEnvironment("/admin");
    seedCache("org-1", { "--evil": "x" });
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(0);
  });

  it("survives an empty or corrupt cache without adopting", () => {
    stubEnvironment("/admin");
    runBootstrap(); // no cache at all
    storage.setItem(BRAND_CACHE_KEY, "{not json");
    runBootstrap();
    storage.setItem(BRAND_CACHE_KEY, JSON.stringify({ orgId: "x" })); // no vars
    runBootstrap();
    expect(doc.adoptedStyleSheets).toHaveLength(0);
  });

  it("degrades silently when CSSStyleSheet is unavailable (old Safari)", () => {
    stubEnvironment("/admin");
    seedCache();
    vi.stubGlobal("CSSStyleSheet", undefined);
    expect(runBootstrap).not.toThrow();
    expect(doc.adoptedStyleSheets).toHaveLength(0);
  });
});
