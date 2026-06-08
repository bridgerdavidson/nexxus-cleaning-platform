import { describe, it, expect } from "vitest";
import { describeBulkAppointmentResult } from "./bulkAppointmentMessages";

describe("describeBulkAppointmentResult", () => {
  it("reports full success (plural) for delete", () => {
    expect(
      describeBulkAppointmentResult("delete", {
        requested: 3,
        succeeded: 3,
        failed: 0,
      }),
    ).toEqual({ message: "Deleted 3 appointments.", variant: "success" });
  });

  it("uses the singular noun for a single success", () => {
    expect(
      describeBulkAppointmentResult("cancel", {
        requested: 1,
        succeeded: 1,
        failed: 0,
      }),
    ).toEqual({ message: "Cancelled 1 appointment.", variant: "success" });
  });

  it("reports a partial result with no hard error as skipped", () => {
    const { message, variant } = describeBulkAppointmentResult("delete", {
      requested: 5,
      succeeded: 3,
      failed: 2,
    });
    expect(variant).toBe("error");
    expect(message).toBe(
      "Deleted 3 of 5. 2 were skipped (no permission or already removed).",
    );
  });

  it("surfaces the error message on a partial failure", () => {
    const { message, variant } = describeBulkAppointmentResult("delete", {
      requested: 5,
      succeeded: 3,
      failed: 2,
      error: "statement timeout",
    });
    expect(variant).toBe("error");
    expect(message).toBe("Deleted 3 of 5. 2 failed: statement timeout");
  });

  it("reports a total failure with an error", () => {
    expect(
      describeBulkAppointmentResult("cancel", {
        requested: 4,
        succeeded: 0,
        failed: 4,
        error: "network down",
      }),
    ).toEqual({
      message: "Could not cancel appointments: network down",
      variant: "error",
    });
  });

  it("reports a total no-op (all RLS-blocked) without an error", () => {
    const { message, variant } = describeBulkAppointmentResult("delete", {
      requested: 4,
      succeeded: 0,
      failed: 4,
    });
    expect(variant).toBe("error");
    expect(message).toContain("No appointments were deleted");
  });

  it("never emits an em dash in user-facing copy", () => {
    const samples = [
      describeBulkAppointmentResult("delete", { requested: 2, succeeded: 2, failed: 0 }),
      describeBulkAppointmentResult("delete", { requested: 2, succeeded: 1, failed: 1 }),
      describeBulkAppointmentResult("cancel", { requested: 2, succeeded: 0, failed: 2, error: "x" }),
    ];
    for (const s of samples) {
      expect(s.message).not.toContain("—");
    }
  });
});
