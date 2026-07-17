import { describe, expect, it } from "vitest";
import {
  deriveTransactions,
  derivePayouts,
  matchesPayoutStatus,
  type TxnLike,
  type PayoutLike,
} from "./derivePayments";

const txn = (o: Partial<TxnLike> = {}): TxnLike => ({
  amount: 120,
  status: "paid",
  created_at: "2026-06-01T00:00:00Z",
  appointment: {
    homeowner: { first_name: "Alice", last_name: "Jones" },
    service_type: { name: "Deep Clean" },
  },
  ...o,
});
const payout = (o: Partial<PayoutLike> = {}): PayoutLike => ({
  amount: 80,
  status: "pending",
  created_at: "2026-06-01T00:00:00Z",
  cleaner: { first_name: "Wanda", last_name: "Cole" },
  ...o,
});

describe("deriveTransactions", () => {
  it("empty query keeps all; filters by payer, reference, self-pay org name", () => {
    expect(
      deriveTransactions([txn()], { search: "", statusFilter: "all", sort: "recent", orgName: "Acme" }),
    ).toHaveLength(1);
    expect(
      deriveTransactions([txn()], { search: "alice", statusFilter: "all", sort: "recent", orgName: "Acme" }),
    ).toHaveLength(1);
    expect(
      deriveTransactions([txn({ reference: "AP-9" })], {
        search: "ap-9",
        statusFilter: "all",
        sort: "recent",
        orgName: "Acme",
      }),
    ).toHaveLength(1);
    const sp = txn({ is_self_pay: true, appointment: { homeowner: null, service_type: { name: "Clean" } } });
    expect(
      deriveTransactions([sp], { search: "acme", statusFilter: "all", sort: "recent", orgName: "Acme" }),
    ).toHaveLength(1);
  });
  it("status filter + sort", () => {
    const a = txn({ created_at: "2026-01-01T00:00:00Z", amount: 50 });
    const b = txn({ created_at: "2026-03-01T00:00:00Z", amount: 300, status: "failed" });
    expect(
      deriveTransactions([a, b], { search: "", statusFilter: "failed", sort: "recent", orgName: "x" }),
    ).toHaveLength(1);
    expect(
      deriveTransactions([a, b], { search: "", statusFilter: "all", sort: "recent", orgName: "x" }).map(
        (t) => t.amount,
      ),
    ).toEqual([300, 50]);
    expect(
      deriveTransactions([a, b], { search: "", statusFilter: "all", sort: "amount", orgName: "x" }).map(
        (t) => t.amount,
      ),
    ).toEqual([300, 50]);
  });
  it("does not mutate input", () => {
    const input = [txn({ amount: 1 }), txn({ amount: 2 })];
    deriveTransactions(input, { search: "", statusFilter: "all", sort: "amount", orgName: "x" });
    expect(input[0].amount).toBe(1);
  });
});

describe("matchesPayoutStatus", () => {
  it("queued maps to pending; paid includes bank_paid", () => {
    expect(matchesPayoutStatus(payout({ status: "pending" }), "queued")).toBe(true);
    expect(matchesPayoutStatus(payout({ status: "bank_paid" }), "paid")).toBe(true);
    expect(matchesPayoutStatus(payout({ status: "failed" }), "paid")).toBe(false);
  });
  it("approved filters legacy approved-but-unpaid rows (T2-16)", () => {
    expect(matchesPayoutStatus(payout({ status: "approved" }), "approved")).toBe(true);
    expect(matchesPayoutStatus(payout({ status: "paid" }), "approved")).toBe(false);
    // approved must NOT leak into the 'paid' bucket
    expect(matchesPayoutStatus(payout({ status: "approved" }), "paid")).toBe(false);
  });
});

describe("derivePayouts", () => {
  it("search by cleaner + sort by amount", () => {
    const a = payout({ amount: 10 });
    const b = payout({ amount: 90, cleaner: { first_name: "Bob", last_name: "Lee" } });
    expect(derivePayouts([a, b], { search: "bob", statusFilter: "all", sort: "recent" })).toHaveLength(1);
    expect(
      derivePayouts([a, b], { search: "", statusFilter: "all", sort: "amount" }).map((p) => p.amount),
    ).toEqual([90, 10]);
  });
});
