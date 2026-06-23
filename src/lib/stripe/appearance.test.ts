import { describe, expect, it } from "vitest";
import { getRedesignConnectAppearance } from "./appearance";

describe("getRedesignConnectAppearance", () => {
  it("uses brand-600 in light, lifted brand in dark", () => {
    expect(getRedesignConnectAppearance(false).variables.colorPrimary).toBe("#0150FC");
    expect(getRedesignConnectAppearance(true).variables.colorPrimary).toBe("#2E62FF");
  });
  it("keeps font + radius constant", () => {
    const a = getRedesignConnectAppearance(false).variables;
    expect(a.fontFamily).toContain("Plus Jakarta Sans");
    expect(a.borderRadius).toBe("14px");
  });
});
