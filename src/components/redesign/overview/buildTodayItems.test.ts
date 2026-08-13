import { describe, expect, it } from "vitest";
import { buildTodayItems, type TodayItemSource } from "./buildTodayItems";

const TODAY = "2026-06-19";
const NOW = Date.parse("2026-06-19T12:00:00Z");

const appt = (over: Partial<TodayItemSource> = {}): TodayItemSource => ({
  id: "a1",
  status: "confirmed",
  scheduled_date: TODAY,
  scheduled_time: "09:00",
  cleaner_id: "c1",
  ...over,
});

const opts = {
  todayISO: TODAY,
  nowMs: NOW,
  title: (a: TodayItemSource) => `title-${a.id}`,
  cleaner: () => "Marco D.",
};

describe("buildTodayItems", () => {
  it("dedups a job present in both today and activeNow", () => {
    const a = appt({ status: "in_progress" });
    const r = buildTodayItems([a], [a], opts);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("live");
  });

  it("keeps a still-running job from a previous day visible, sorted first, with a date hint", () => {
    const stale = appt({
      id: "old",
      status: "in_progress",
      scheduled_date: "2026-06-18",
      scheduled_time: "15:00",
    });
    const r = buildTodayItems([appt()], [stale], opts);
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe("old");
    expect(r[0].subtitle).toBe("Thu, Jun 18 · Marco D.");
  });

  it("maps statuses: completed→done, in_progress→live, null cleaner→unassigned, else upcoming", () => {
    const r = buildTodayItems(
      [
        appt({ id: "d", status: "completed", scheduled_time: "08:00" }),
        appt({ id: "l", status: "in_progress", scheduled_time: "09:00" }),
        appt({ id: "u", status: "pending", cleaner_id: null, scheduled_time: "10:00" }),
        appt({ id: "n", status: "confirmed", scheduled_time: "11:00" }),
      ],
      [],
      opts
    );
    expect(r.map((i) => i.status)).toEqual(["done", "live", "unassigned", "upcoming"]);
  });

  it("live outranks a missing cleaner (precedence)", () => {
    const r = buildTodayItems([appt({ status: "in_progress", cleaner_id: null })], [], opts);
    expect(r[0].status).toBe("live");
  });

  it("formats elapsed from started_at for live rows and omits it when unknown", () => {
    const r = buildTodayItems(
      [
        appt({ id: "l1", status: "in_progress", started_at: "2026-06-19T11:30:00Z", scheduled_time: "09:00" }),
        appt({ id: "l2", status: "in_progress", started_at: null, scheduled_time: "10:00" }),
        appt({ id: "up", status: "confirmed", started_at: "2026-06-19T11:30:00Z", scheduled_time: "11:00" }),
      ],
      [],
      opts
    );
    expect(r[0].elapsed).toBe("30 min");
    expect(r[1].elapsed).toBeNull();
    expect(r[2].elapsed).toBeUndefined();
  });

  it("passes checklist ids through on live rows only (for the progress bar)", () => {
    const r = buildTodayItems(
      [
        appt({ id: "l", status: "in_progress", checklist_id: "cl-1", service_type_id: "st-1", scheduled_time: "09:00" }),
        appt({ id: "up", status: "confirmed", checklist_id: "cl-2", service_type_id: "st-2", scheduled_time: "10:00" }),
      ],
      [],
      opts
    );
    expect(r[0].checklistId).toBe("cl-1");
    expect(r[0].serviceTypeId).toBe("st-1");
    expect(r[1].checklistId).toBeUndefined();
    expect(r[1].serviceTypeId).toBeUndefined();
  });

  it("sorts by date then time and formats the display time", () => {
    const r = buildTodayItems(
      [
        appt({ id: "b", scheduled_time: "13:00" }),
        appt({ id: "a", scheduled_time: "08:00" }),
      ],
      [],
      opts
    );
    expect(r.map((i) => i.id)).toEqual(["a", "b"]);
    expect(r[0].time).toBe("8:00am");
    expect(r[1].time).toBe("1:00pm");
  });

  it("replaces the cleaner label with 'No cleaner yet' on unassigned rows", () => {
    const r = buildTodayItems([appt({ cleaner_id: null, status: "pending" })], [], opts);
    expect(r[0].subtitle).toBe("No cleaner yet");
  });
});
