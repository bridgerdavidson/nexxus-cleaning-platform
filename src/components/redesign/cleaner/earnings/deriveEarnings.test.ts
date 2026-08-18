// src/components/redesign/cleaner/earnings/deriveEarnings.test.ts
import { describe, it, expect } from "vitest";
import { deriveEarnings, shouldReveal } from "./deriveEarnings";
import type { DeriveEarningsInput } from "./earnings-types";
import type {
  AwaitingPaymentRow,
  CleanerHeldPayoutRow,
  CleanerPaidPayoutRow,
  CleanerStats,
} from "@/hooks/useCleanerData";

function awaiting(over: Partial<AwaitingPaymentRow> = {}): AwaitingPaymentRow {
  return {
    id: "pay_1",
    cleanerCut: 84,
    createdAt: "2026-06-26T10:00:00.000Z",
    paymentMethod: "ach",
    appointment: {
      id: "appt_1",
      scheduledDate: "2026-06-27",
      homeownerName: "Sarah M.",
      serviceName: "Deep clean",
    },
    ...over,
  };
}

function held(over: Partial<CleanerHeldPayoutRow> = {}): CleanerHeldPayoutRow {
  return {
    id: "pyt_1",
    amount: 120,
    status: "pending",
    createdAt: "2026-06-20T10:00:00.000Z",
    appointment: {
      id: "appt_2",
      scheduledDate: "2026-06-21",
      homeownerName: "A. Nguyen",
      serviceName: "Standard clean",
    },
    ...over,
  };
}

function paid(over: Partial<CleanerPaidPayoutRow> = {}): CleanerPaidPayoutRow {
  return {
    id: "pyt_paid_1",
    amount: 65,
    status: "paid",
    createdAt: "2026-06-15T10:00:00.000Z",
    paidAt: "2026-06-16T09:00:00.000Z",
    appointment: {
      id: "appt_3",
      scheduledDate: "2026-06-14",
      homeownerName: "R. Patel",
      serviceName: "Move-out clean",
    },
    ...over,
  };
}

function stats(over: Partial<CleanerStats> = {}): CleanerStats {
  return {
    totalJobs: 150,
    completedThisWeek: 6,
    totalEarnings: 5240,
    pendingPayouts: 420,
    completedJobs: 142,
    upcomingJobs: 3,
    ...over,
  };
}

function input(over: Partial<DeriveEarningsInput> = {}): DeriveEarningsInput {
  return {
    stripeEnabled: true,
    payoutModel: "percentage",
    connectKind: "active",
    awaiting: [awaiting()],
    heldPayouts: [],
    paidPayouts: [],
    stats: stats(),
    ...over,
  };
}

describe("deriveEarnings", () => {
  it("resolves employee mode for hourly_external even when Stripe is enabled", () => {
    expect(deriveEarnings(input({ payoutModel: "hourly_external" })).mode).toBe("employee");
  });

  it("resolves stripe-disabled when Stripe is off (and not employee)", () => {
    expect(deriveEarnings(input({ stripeEnabled: false })).mode).toBe("stripe-disabled");
  });

  it("resolves connect mode otherwise and passes connectKind through", () => {
    expect(deriveEarnings(input({ connectKind: "pending" }))).toMatchObject({
      mode: "connect",
      connectKind: "pending",
    });
  });

  it("maps a clearing row with ACH settle kind and prefers scheduledDate", () => {
    const row = deriveEarnings(input()).clearing[0];
    expect(row).toEqual({
      id: "pay_1",
      appointmentId: "appt_1",
      serviceLabel: "Deep clean",
      customerLabel: "Sarah M.",
      dateRaw: "2026-06-27",
      cutDollars: 84,
      settleKind: "ach",
    });
  });

  it("classifies card and unknown settle kinds and falls back to createdAt + labels", () => {
    const cardRow = deriveEarnings(
      input({ awaiting: [awaiting({ paymentMethod: "card" })] }),
    ).clearing[0];
    expect(cardRow.settleKind).toBe("card");

    const bare = deriveEarnings(
      input({
        awaiting: [awaiting({ paymentMethod: null, appointment: null })],
      }),
    ).clearing[0];
    expect(bare.settleKind).toBe("unknown");
    expect(bare.serviceLabel).toBe("Cleaning");
    expect(bare.customerLabel).toBe("Customer");
    expect(bare.dateRaw).toBe("2026-06-26T10:00:00.000Z");
  });

  it("reads activity counts from stats and zeroes them when stats is undefined", () => {
    expect(deriveEarnings(input()).counts).toEqual({ thisWeek: 6, completed: 142, upcoming: 3 });
    expect(deriveEarnings(input({ stats: undefined })).counts).toEqual({
      thisWeek: 0,
      completed: 0,
      upcoming: 0,
    });
  });

  it("never leaks the org-derived stats aggregates into the view-model", () => {
    // owedDollars is allowed (it's summed from the cleaner's OWN cut rows), but the coarse
    // org-derived stats money (totalEarnings/pendingPayouts) must never reach the view-model.
    const result = deriveEarnings(input());
    expect(Object.keys(result).sort()).toEqual([
      "clearing",
      "connectKind",
      "counts",
      "held",
      "mode",
      "owedDollars",
      "paid",
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("totalEarnings");
    expect(json).not.toContain("pendingPayouts");
    expect(json).not.toContain("5240");
    expect(json).not.toContain("420");
  });
});

describe("deriveEarnings held payouts (T2-15)", () => {
  it("maps pending/approved/failed payout statuses to held/approved/failed kinds", () => {
    const rows = deriveEarnings(
      input({
        heldPayouts: [
          held({ id: "a", status: "pending" }),
          held({ id: "b", status: "approved" }),
          held({ id: "c", status: "failed" }),
        ],
      }),
    ).held;
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      ["a", "held"],
      ["b", "approved"],
      ["c", "failed"],
    ]);
  });

  it("maps a held row's amount + labels and prefers scheduledDate", () => {
    const row = deriveEarnings(input({ heldPayouts: [held()] })).held[0];
    expect(row).toEqual({
      id: "pyt_1",
      appointmentId: "appt_2",
      serviceLabel: "Standard clean",
      customerLabel: "A. Nguyen",
      dateRaw: "2026-06-21",
      amountDollars: 120,
      kind: "held",
    });
  });

  it("falls back to createdAt + default labels when the appointment is missing", () => {
    const row = deriveEarnings(
      input({ heldPayouts: [held({ appointment: null })] }),
    ).held[0];
    expect(row.serviceLabel).toBe("Cleaning");
    expect(row.customerLabel).toBe("Customer");
    expect(row.dateRaw).toBe("2026-06-20T10:00:00.000Z");
    expect(row.appointmentId).toBeNull();
  });

  it("is empty when there are no held payouts", () => {
    expect(deriveEarnings(input({ heldPayouts: [] })).held).toEqual([]);
    expect(deriveEarnings(input({ heldPayouts: undefined })).held).toEqual([]);
  });
});

describe("deriveEarnings paid history", () => {
  it("maps paid and bank_paid rows with labels, preferring scheduledDate", () => {
    const rows = deriveEarnings(
      input({ paidPayouts: [paid(), paid({ id: "b", status: "bank_paid", amount: 80 })] }),
    ).paid;
    expect(rows[0]).toEqual({
      id: "pyt_paid_1",
      appointmentId: "appt_3",
      serviceLabel: "Move-out clean",
      customerLabel: "R. Patel",
      dateRaw: "2026-06-14",
      amountDollars: 65,
      kind: "paid",
    });
    expect(rows[1].kind).toBe("bank_paid");
    expect(rows[1].amountDollars).toBe(80);
  });

  it("falls back to paidAt then createdAt when the appointment is missing", () => {
    const noAppt = deriveEarnings(
      input({ paidPayouts: [paid({ appointment: null })] }),
    ).paid[0];
    expect(noAppt.dateRaw).toBe("2026-06-16T09:00:00.000Z");
    expect(noAppt.serviceLabel).toBe("Cleaning");
    expect(noAppt.customerLabel).toBe("Customer");

    const bare = deriveEarnings(
      input({ paidPayouts: [paid({ appointment: null, paidAt: null })] }),
    ).paid[0];
    expect(bare.dateRaw).toBe("2026-06-15T10:00:00.000Z");
  });

  it("is empty when there is no paid history", () => {
    expect(deriveEarnings(input({ paidPayouts: [] })).paid).toEqual([]);
    expect(deriveEarnings(input({ paidPayouts: undefined })).paid).toEqual([]);
  });

  it("never counts paid history toward owedDollars", () => {
    const result = deriveEarnings(
      input({
        awaiting: [awaiting({ cleanerCut: 84 })],
        heldPayouts: [held({ amount: 120 })],
        paidPayouts: [paid({ amount: 500 })],
      }),
    );
    expect(result.owedDollars).toBe(204);
  });
});

describe("deriveEarnings owedDollars (You're owed $X)", () => {
  it("sums the cleaner's clearing cuts and held/failed payout amounts", () => {
    // clearing cut 84 + held 120 + failed 30 = 234 (never touches stats' 420/5240)
    const result = deriveEarnings(
      input({
        awaiting: [awaiting({ cleanerCut: 84 })],
        heldPayouts: [held({ amount: 120, status: "pending" }), held({ id: "f", amount: 30, status: "failed" })],
      }),
    );
    expect(result.owedDollars).toBe(234);
  });

  it("is zero when nothing is clearing or held", () => {
    expect(deriveEarnings(input({ awaiting: [], heldPayouts: [] })).owedDollars).toBe(0);
  });

  it("derives owed from cut rows, not from the org stats pendingPayouts", () => {
    const result = deriveEarnings(
      input({ awaiting: [awaiting({ cleanerCut: 84 })], heldPayouts: [], stats: stats({ pendingPayouts: 999 }) }),
    );
    expect(result.owedDollars).toBe(84);
  });
});

describe("shouldReveal (latching reveal)", () => {
  it("latches true on active and never returns to false", () => {
    expect(shouldReveal(false, "active")).toBe(true);
    expect(shouldReveal(true, "inactive")).toBe(true);
    expect(shouldReveal(true, "pending")).toBe(true);
  });

  it("stays false for non-active kinds until the user reveals it", () => {
    expect(shouldReveal(false, "inactive")).toBe(false);
    expect(shouldReveal(false, "pending")).toBe(false);
    expect(shouldReveal(false, "loading")).toBe(false);
  });
});
