import { describe, it, expect } from "vitest";
import { chunk } from "./chunk";

describe("chunk", () => {
  it("returns an empty array for empty input", () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it("splits evenly divisible input into full chunks", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("puts the remainder in a final smaller chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size exceeds length", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("handles a size of 1 (one item per chunk)", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("preserves order and does not mutate the input", () => {
    const input = [5, 4, 3, 2, 1];
    const copy = [...input];
    const result = chunk(input, 2);
    expect(result.flat()).toEqual(copy);
    expect(input).toEqual(copy);
  });

  it("throws on a non-positive or non-integer size", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
    expect(() => chunk([1], 1.5)).toThrow();
  });

  it("chunks a realistic 64-item bulk selection into batches of <=25", () => {
    const ids = Array.from({ length: 64 }, (_, i) => i);
    const batches = chunk(ids, 25);
    expect(batches.map((b) => b.length)).toEqual([25, 25, 14]);
  });
});
