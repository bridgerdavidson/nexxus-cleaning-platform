import { describe, expect, it } from "vitest";
import { deriveTransactionBadge, derivePayoutBadge } from "./derivePaymentsBadges";

describe("deriveTransactionBadge", () => {
  it("maps each status, defaulting unknown to pending", () => {
    expect(deriveTransactionBadge("paid")).toBe("paid");
    expect(deriveTransactionBadge("processing")).toBe("processing");
    expect(deriveTransactionBadge("failed")).toBe("failed");
    expect(deriveTransactionBadge("refunded")).toBe("refunded");
    expect(deriveTransactionBadge("pending")).toBe("pending");
    expect(deriveTransactionBadge("weird")).toBe("pending");
  });
});

describe("derivePayoutBadge", () => {
  it("maps statuses incl. bank_paid->paid and pending->held", () => {
    expect(derivePayoutBadge("paid")).toBe("paid");
    expect(derivePayoutBadge("bank_paid")).toBe("paid");
    expect(derivePayoutBadge("failed")).toBe("failed");
    expect(derivePayoutBadge("reversed")).toBe("reversed");
    expect(derivePayoutBadge("approved")).toBe("approved");
    expect(derivePayoutBadge("pending")).toBe("held");
    expect(derivePayoutBadge("weird")).toBe("held");
  });
});
