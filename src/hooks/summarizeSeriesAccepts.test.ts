import { describe, it, expect } from "vitest";
import { summarizeSeriesAccepts } from "./useCleanerData";

describe("summarizeSeriesAccepts", () => {
  it("counts all-ok", () => {
    expect(summarizeSeriesAccepts([{ ok: true }, { ok: true }, { ok: true }])).toEqual({
      total: 3, accepted: 3, failed: 0,
    });
  });
  it("counts partial failure", () => {
    expect(summarizeSeriesAccepts([{ ok: true }, { ok: false }, { ok: true }])).toEqual({
      total: 3, accepted: 2, failed: 1,
    });
  });
  it("handles empty", () => {
    expect(summarizeSeriesAccepts([])).toEqual({ total: 0, accepted: 0, failed: 0 });
  });
});
