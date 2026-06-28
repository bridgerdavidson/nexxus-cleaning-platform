import { describe, it, expect } from "vitest";
import {
  cleanerApptToInlineBookingVM,
  cleanerApptToContactBookingVM,
} from "./messages-cleaner-presenters";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

function appt(over: Partial<CleanerAppointment> = {}): CleanerAppointment {
  return {
    id: "appt_1",
    scheduled_date: "2026-06-27",
    scheduled_time: "14:00",
    status: "confirmed",
    total_price: 120,
    cleaner_confirmation_status: "approved",
    homeowner: null,
    property: { name: "Maple House", address: "1 Maple St", city: "Boise", state: "ID", zip_code: "83702" },
    service_type: { name: "Deep clean", description: "", duration_minutes: 120 },
    ...over,
  } as CleanerAppointment;
}

describe("cleanerApptToInlineBookingVM", () => {
  it("maps a found appointment with service, date, time, address, status", () => {
    const vm = cleanerApptToInlineBookingVM(appt(), "appt_1");
    expect(vm).toMatchObject({
      appointmentId: "appt_1",
      found: true,
      service: "Deep clean",
      address: "Maple House",
      status: "confirmed",
    });
    expect(vm.timeLabel).toMatch(/2:00/);
    expect(vm.dateLabel).toMatch(/Jun/);
  });

  it("falls back when the appointment is missing", () => {
    const vm = cleanerApptToInlineBookingVM(undefined, "x");
    expect(vm).toMatchObject({ appointmentId: "x", found: false, service: "Booking", status: "confirmed" });
  });

  it("falls back service to checklist name then 'Cleaning'", () => {
    expect(cleanerApptToInlineBookingVM(appt({ service_type: null, checklist: { name: "Move-out", price_adder: 0 } }), "a").service).toBe("Move-out");
    expect(cleanerApptToInlineBookingVM(appt({ service_type: null, checklist: null }), "a").service).toBe("Cleaning");
  });
});

describe("cleanerApptToContactBookingVM", () => {
  it("maps the staged chip fields including day/month pills", () => {
    const vm = cleanerApptToContactBookingVM(appt());
    expect(vm).toMatchObject({ appointmentId: "appt_1", service: "Deep clean", dayNum: "27", monthLabel: "Jun" });
    expect(vm.timeLabel).toMatch(/2:00/);
  });
});
