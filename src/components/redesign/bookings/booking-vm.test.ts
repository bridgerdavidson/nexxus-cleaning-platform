import { describe, it, expect } from "vitest";
import { toDetailVM, toRowVM } from "./booking-vm";
import type { AdminAppointment } from "@/hooks/useAdminData";

function appt(over: Partial<AdminAppointment> = {}): AdminAppointment {
  return {
    id: "a1",
    scheduled_date: "2026-03-05",
    scheduled_time: "14:30",
    status: "confirmed",
    homeowner_id: "ho-1",
    cleaner_id: "cl-1",
    duration_minutes: 90,
    total_price: 120,
    is_self_pay: false,
    payment_status: "paid",
    homeowner: { first_name: "Sarah", last_name: "Miller", email: "s@x.com" },
    cleaner_profile: { user_profile: { first_name: "Jo", last_name: "Lee" } },
    property: { address: "12 Oak St" },
    service_type: { name: "Deep clean" },
    special_requests: null,
    notes: null,
    cleaner_availability_feedback: [],
    ...over,
  } as unknown as AdminAppointment;
}

describe("toDetailVM", () => {
  it("maps an appointment to the detail view-model", () => {
    const vm = toDetailVM(appt(), true);
    expect(vm.id).toBe("a1");
    expect(vm.title).toBe("12 Oak St");
    expect(vm.service).toBe("Deep clean");
    expect(vm.timeLabel).toBe("2:30pm");
    expect(vm.durationLabel).toBe("1h 30m");
    expect(vm.customer).toBe("Sarah Miller");
    expect(vm.cleaner).toBe("Jo Lee");
    expect(vm.payment).toEqual({ tone: "paid", label: "Paid" });
    expect(vm.priceLabel).toBe("$120.00");
    expect(vm.isUnassigned).toBe(false);
  });

  it("hides payment data when canViewPayments is false", () => {
    const vm = toDetailVM(appt(), false);
    expect(vm.payment).toBeNull();
    expect(vm.priceLabel).toBeNull();
  });

  it("surfaces counter-proposed times with readable labels and raw fields", () => {
    const vm = toDetailVM(
      appt({
        cleaner_availability_feedback: [
          {
            reason: "conflict",
            cleaner_suggested_times: [
              { id: "st1", suggested_date: "2026-03-06", suggested_time: "09:00:00" },
            ],
            cleaner_suggested_windows: [],
          },
        ],
      } as unknown as Partial<AdminAppointment>),
      true,
    );
    expect(vm.counterProposals).toEqual([
      { id: "st1", label: "Mar 6 at 9:00am", date: "2026-03-06", time: "09:00:00" },
    ]);
    expect(vm.declinedReason).toBe("conflict");
  });

  it("surfaces counter windows with readable labels and raw fields", () => {
    const vm = toDetailVM(
      appt({
        cleaner_availability_feedback: [
          {
            reason: "unavailable",
            cleaner_suggested_times: [],
            cleaner_suggested_windows: [
              { id: "w1", window_date: "2026-03-06", start_time: "09:00:00", end_time: "12:00:00" },
            ],
          },
        ],
      } as unknown as Partial<AdminAppointment>),
      true,
    );
    expect(vm.counterWindows).toEqual([
      {
        id: "w1",
        label: "Mar 6, 9:00am to 12:00pm",
        date: "2026-03-06",
        startTime: "09:00:00",
        endTime: "12:00:00",
      },
    ]);
    expect(vm.declinedReason).toBe("unavailable");
  });
});

describe("toRowVM", () => {
  it("maps an appointment to a row view-model with today flag and avatar", () => {
    const vm = toRowVM(appt(), "2026-03-05", true, new Map([["cl-1", "http://a/x.png"]]));
    expect(vm.id).toBe("a1");
    expect(vm.isToday).toBe(true);
    expect(vm.cleanerAvatarUrl).toBe("http://a/x.png");
    expect(vm.dateLabel).toBe("Mar 5");
    expect(vm.payment).toEqual({ tone: "paid", label: "Paid" });
  });
});
