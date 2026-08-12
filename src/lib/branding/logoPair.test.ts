import { describe, it, expect } from "vitest";
import { resolveLogoPair } from "./logoPair";

describe("resolveLogoPair", () => {
  it("falls back dark to light", () => {
    expect(resolveLogoPair("L", null)).toEqual({ light: "L", dark: "L", distinct: false });
  });

  it("is distinct when both differ", () => {
    expect(resolveLogoPair("L", "D")).toEqual({ light: "L", dark: "D", distinct: true });
  });

  it("dark-only still renders dark", () => {
    expect(resolveLogoPair(null, "D")).toEqual({ light: null, dark: "D", distinct: true });
  });

  it("both null", () => {
    expect(resolveLogoPair(null, null)).toEqual({ light: null, dark: null, distinct: false });
  });

  it("identical URLs are not distinct", () => {
    expect(resolveLogoPair("L", "L")).toEqual({ light: "L", dark: "L", distinct: false });
  });
});
