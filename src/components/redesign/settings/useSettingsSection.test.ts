import { describe, expect, it } from "vitest";
import { isFormDirty } from "./useSettingsSection";

describe("isFormDirty", () => {
  it("is false when values are structurally equal", () => {
    expect(isFormDirty({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(false);
  });
  it("is true when a field differs", () => {
    expect(isFormDirty({ a: 1 }, { a: 2 })).toBe(true);
  });
  it("treats nested objects by value", () => {
    expect(isFormDirty({ h: { mon: "08:00" } }, { h: { mon: "08:00" } })).toBe(false);
    expect(isFormDirty({ h: { mon: "08:00" } }, { h: { mon: "09:00" } })).toBe(true);
  });
});
