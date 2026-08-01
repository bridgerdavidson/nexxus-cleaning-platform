import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { replaceSearchShallow } from "./shallowSearch";

// Unit tests run in the `node` env: stand up a minimal window with the two
// pieces the helper touches (history.replaceState + location).
const replaceState = vi.fn();

beforeEach(() => {
  replaceState.mockClear();
  vi.stubGlobal("window", {
    history: { replaceState },
    location: { pathname: "/admin/payments", origin: "http://localhost" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("replaceSearchShallow", () => {
  it("passes through path?qs URLs on the current pathname unchanged", () => {
    replaceSearchShallow("/admin/payments?ledger=payouts");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin/payments?ledger=payouts");
  });

  it("drops a URL whose pathname differs from the current one (stale-closure guard)", () => {
    replaceSearchShallow("/cleaner/messages?to=abc");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("passes through relative ?qs URLs unchanged", () => {
    replaceSearchShallow("?ledger=payouts");
    expect(replaceState).toHaveBeenCalledWith(null, "", "?ledger=payouts");
  });

  it("passes through a bare current pathname (clears the query string)", () => {
    replaceSearchShallow("/admin/payments");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin/payments");
  });

  it("resolves a lone '?' to the current pathname (empty URL would be a no-op)", () => {
    replaceSearchShallow("?");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin/payments");
  });

  it("strips a trailing '?' from path? URLs", () => {
    replaceSearchShallow("/admin/payments?");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin/payments");
  });
});
