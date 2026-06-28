// src/components/redesign/cleaner/earnings/deriveEarnings.test.ts
import { describe, it, expect } from "vitest";
import { deriveEarnings, shouldReveal } from "./deriveEarnings";
import type { DeriveEarningsInput } from "./earnings-types";
import type { AwaitingPaymentRow, CleanerStats } from "@/hooks/useCleanerData";

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
    payoutModel: "percentage_contractor",
    connectKind: "active",
    awaiting: [awaiting()],
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

  it("never leaks a money aggregate into the view-model", () => {
    const result = deriveEarnings(input());
    expect(Object.keys(result).sort()).toEqual(["clearing", "connectKind", "counts", "mode"]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("totalEarnings");
    expect(json).not.toContain("pendingPayouts");
    expect(json).not.toContain("5240");
    expect(json).not.toContain("420");
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
