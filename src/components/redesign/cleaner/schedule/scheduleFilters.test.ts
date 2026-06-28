import { describe, expect, it } from "vitest";
import { scheduleStatusOptions } from "./schedule-types";

describe("scheduleStatusOptions", () => {
  it("includes 'needs_response' for contractors on the upcoming view", () => {
    const values = scheduleStatusOptions("upcoming", false).map((o) => o.value);
    expect(values).toContain("needs_response");
    expect(values).toContain("confirmed");
  });

  it("drops 'needs_response' for employees (they get assigned jobs, not offers)", () => {
    const values = scheduleStatusOptions("upcoming", true).map((o) => o.value);
    expect(values).not.toContain("needs_response");
    expect(values).toContain("confirmed");
  });

  it("leaves the past view unchanged regardless of model", () => {
    expect(scheduleStatusOptions("past", true)).toEqual(scheduleStatusOptions("past", false));
    expect(scheduleStatusOptions("past", false).map((o) => o.value)).toContain("completed");
  });
});
