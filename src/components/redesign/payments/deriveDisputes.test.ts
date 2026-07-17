import { describe, expect, it } from "vitest";
import {
  isDisputeOpen,
  disputeDeadlineUrgency,
  reasonLabel,
  openDisputes,
  openDisputedPaymentIds,
  toDisputeRow,
  toDisputeDetail,
  type DisputeLike,
} from "./deriveDisputes";

const NOW = Date.parse("2026-07-17T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function dispute(over: Partial<DisputeLike> = {}): DisputeLike {
  return {
    id: over.id ?? "d1",
    amount: over.amount ?? 12000, // cents
    status: over.status ?? "needs_response",
    reason: over.reason ?? "fraudulent",
    evidence_due_by: over.evidence_due_by ?? null,
    created_at: over.created_at ?? "2026-07-10T00:00:00Z",
    payment_id: over.payment_id ?? "p1",
    stripe_dispute_id: over.stripe_dispute_id ?? "dp_1",
    payment:
      over.payment !== undefined
        ? over.payment
        : {
            payment_method: "card",
            is_self_pay: false,
            appointment: {
              scheduled_date: "2026-07-09",
              homeowner_id: "u_home",
              homeowner: { first_name: "Ada", last_name: "Byron" },
              service_type: { name: "Deep clean" },
            },
          },
  };
}

describe("isDisputeOpen", () => {
  it("open for actionable/unknown states", () => {
    for (const s of ["needs_response", "warning_needs_response", "under_review", "warning_under_review", "??"]) {
      expect(isDisputeOpen(s)).toBe(true);
    }
  });
  it("closed for terminal states", () => {
    for (const s of ["won", "lost", "warning_closed", "prevented"]) {
      expect(isDisputeOpen(s)).toBe(false);
    }
  });
});

describe("disputeDeadlineUrgency", () => {
  it("returns none when no deadline or an unparseable one", () => {
    expect(disputeDeadlineUrgency(null, NOW)).toBe("none");
    expect(disputeDeadlineUrgency("not-a-date", NOW)).toBe("none");
  });
  it("overdue when the deadline has passed", () => {
    expect(disputeDeadlineUrgency(new Date(NOW - HOUR).toISOString(), NOW)).toBe("overdue");
  });
  it("soon within 72h (inclusive of the boundary)", () => {
    expect(disputeDeadlineUrgency(new Date(NOW + HOUR).toISOString(), NOW)).toBe("soon");
    expect(disputeDeadlineUrgency(new Date(NOW + 72 * HOUR).toISOString(), NOW)).toBe("soon");
  });
  it("later beyond 72h", () => {
    expect(disputeDeadlineUrgency(new Date(NOW + 73 * HOUR).toISOString(), NOW)).toBe("later");
  });
});

describe("reasonLabel", () => {
  it("humanizes known reasons", () => {
    expect(reasonLabel("fraudulent")).toBe("Fraudulent");
    expect(reasonLabel("product_not_received")).toBe("Product not received");
  });
  it("title-cases unknown snake_case reasons", () => {
    expect(reasonLabel("some_new_reason")).toBe("Some New Reason");
  });
  it("falls back to 'Not specified' for null", () => {
    expect(reasonLabel(null)).toBe("Not specified");
  });
});

describe("openDisputes / openDisputedPaymentIds", () => {
  it("keeps only open disputes", () => {
    const list = [dispute({ id: "a", status: "needs_response" }), dispute({ id: "b", status: "won" })];
    expect(openDisputes(list).map((d) => d.id)).toEqual(["a"]);
  });
  it("collects payment_ids of open disputes only, skipping nulls and terminal", () => {
    const list = [
      dispute({ id: "a", status: "needs_response", payment_id: "p1" }),
      dispute({ id: "b", status: "lost", payment_id: "p2" }),
      dispute({ id: "c", status: "under_review", payment_id: null }),
      dispute({ id: "d", status: "under_review", payment_id: "p4" }),
    ];
    const ids = openDisputedPaymentIds(list);
    expect(ids.has("p1")).toBe(true);
    expect(ids.has("p2")).toBe(false); // terminal
    expect(ids.has("p4")).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe("toDisputeRow", () => {
  it("formats cents amount, resolves payer, and derives badge", () => {
    const row = toDisputeRow(dispute({ amount: 12000 }), "Acme Cleaning", NOW);
    expect(row.amountLabel).toBe("$120.00");
    expect(row.payer).toBe("Ada Byron");
    expect(row.badge).toBe("needs_response");
    expect(row.isOpen).toBe(true);
    expect(row.reason).toBe("Fraudulent");
  });
  it("uses the org name for a self-pay dispute with no homeowner", () => {
    const d = dispute({
      payment: {
        payment_method: "card",
        is_self_pay: true,
        appointment: {
          scheduled_date: "2026-07-09",
          homeowner_id: null,
          homeowner: null,
          service_type: { name: "Move-out" },
        },
      },
    });
    expect(toDisputeRow(d, "Acme Cleaning", NOW).payer).toBe("Acme Cleaning");
  });
  it("falls back to 'Customer' when there is neither a homeowner nor self-pay", () => {
    const d = dispute({ payment: null });
    const row = toDisputeRow(d, "Acme Cleaning", NOW);
    expect(row.payer).toBe("Customer");
    expect(row.service).toBe("Cleaning");
  });
  it("suppresses deadline urgency once the dispute is terminal", () => {
    const d = dispute({ status: "lost", evidence_due_by: new Date(NOW - HOUR).toISOString() });
    const row = toDisputeRow(d, "Acme Cleaning", NOW);
    expect(row.isOpen).toBe(false);
    expect(row.urgency).toBe("none");
  });
});

describe("toDisputeDetail", () => {
  it("adds the charged method, job date, and homeowner id for messaging", () => {
    const detail = toDisputeDetail(dispute(), "Acme Cleaning", NOW);
    expect(detail.method).toBe("Card");
    expect(detail.paymentDateLabel).not.toBeNull();
    expect(detail.homeownerId).toBe("u_home");
    expect(detail.stripeDisputeId).toBe("dp_1");
  });
});
