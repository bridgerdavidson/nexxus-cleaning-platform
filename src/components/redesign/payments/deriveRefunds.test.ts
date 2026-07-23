import { describe, expect, it } from "vitest";
import { sumRefundedCents, refundMath } from "./deriveRefunds";

describe("sumRefundedCents", () => {
  it("counts succeeded + pending, ignores failed/canceled", () => {
    expect(
      sumRefundedCents([
        { amount: 5000, status: "succeeded" },
        { amount: 2000, status: "pending" },
        { amount: 9999, status: "failed" },
        { amount: 1234, status: "canceled" },
      ]),
    ).toBe(7000);
  });
  it("handles null/empty", () => {
    expect(sumRefundedCents(null)).toBe(0);
    expect(sumRefundedCents([])).toBe(0);
  });
});

describe("refundMath", () => {
  it("no refunds -> full remaining, not partial", () => {
    const m = refundMath(200, []);
    expect(m).toEqual({ grossCents: 20000, refundedCents: 0, remainingCents: 20000, partiallyRefunded: false });
  });
  it("partial refund -> remaining reduced, flagged partial", () => {
    const m = refundMath(200, [{ amount: 8000, status: "succeeded" }]);
    expect(m.remainingCents).toBe(12000);
    expect(m.partiallyRefunded).toBe(true);
  });
  it("fully refunded -> zero remaining, NOT partial", () => {
    const m = refundMath(200, [{ amount: 20000, status: "succeeded" }]);
    expect(m.remainingCents).toBe(0);
    expect(m.partiallyRefunded).toBe(false);
  });
  it("clamps over-refund (never negative remaining)", () => {
    const m = refundMath(100, [{ amount: 999999, status: "succeeded" }]);
    expect(m.refundedCents).toBe(10000);
    expect(m.remainingCents).toBe(0);
    expect(m.partiallyRefunded).toBe(false);
  });
});
