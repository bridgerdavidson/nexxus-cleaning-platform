import { describe, it, expect } from "vitest";
import { pageRange, nextPageParam, PAYMENTS_PAGE_SIZE } from "./pagination";

describe("pageRange", () => {
  it("computes zero-based supabase range bounds", () => {
    expect(pageRange(0, 25)).toEqual({ from: 0, to: 24 });
    expect(pageRange(2, 25)).toEqual({ from: 50, to: 74 });
  });
});

describe("nextPageParam (count-aware, avoids a dead empty fetch)", () => {
  it("returns the next page index while loaded < total", () => {
    expect(nextPageParam(25, 57, 1)).toBe(1);
    expect(nextPageParam(50, 57, 2)).toBe(2);
  });
  it("returns undefined once all rows are loaded", () => {
    expect(nextPageParam(57, 57, 3)).toBeUndefined();
    expect(nextPageParam(0, 0, 0)).toBeUndefined();
    expect(nextPageParam(25, 25, 1)).toBeUndefined(); // exact multiple: no extra empty fetch
  });
});

describe("PAYMENTS_PAGE_SIZE", () => {
  it("is 25", () => expect(PAYMENTS_PAGE_SIZE).toBe(25));
});
