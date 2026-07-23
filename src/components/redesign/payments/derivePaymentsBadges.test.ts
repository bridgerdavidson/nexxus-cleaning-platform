import { describe, expect, it } from "vitest";
import { deriveTransactionBadge, derivePayoutBadge, deriveDisputeBadge } from "./derivePaymentsBadges";

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

describe("deriveDisputeBadge", () => {
  it("maps every Stripe dispute status to a badge key", () => {
    expect(deriveDisputeBadge("needs_response")).toBe("needs_response");
    expect(deriveDisputeBadge("warning_needs_response")).toBe("warning");
    expect(deriveDisputeBadge("under_review")).toBe("under_review");
    expect(deriveDisputeBadge("warning_under_review")).toBe("under_review");
    expect(deriveDisputeBadge("won")).toBe("won");
    expect(deriveDisputeBadge("prevented")).toBe("won");
    expect(deriveDisputeBadge("lost")).toBe("lost");
    expect(deriveDisputeBadge("warning_closed")).toBe("closed");
  });
  it("treats an unknown status as still-open (needs_response) so it never hides", () => {
    expect(deriveDisputeBadge("brand_new_stripe_status")).toBe("needs_response");
  });
});
