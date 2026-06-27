# Cleaner Appointment Card Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the cleaner Today + Schedule card sort so overdue/never-completed jobs surface as a "Needs attention" zone instead of piling into Today, and every non-today card shows its date.

**Architecture:** Centralize the zone predicates (upcoming / needs-attention / past) in one pure `shared/zones.ts`; `deriveSchedule` and `deriveToday` consume it. The status badge becomes zone-aware (renders "Unfinished" for a stale confirmed/in-progress job). Display-derived only , no backend, no migration. Folds into the Slice-2 branch (`feat/redesign-cleaner-app-slice2`, PR #95).

**Tech Stack:** TypeScript, React 19, Vitest. Pure logic + presentational components under `src/components/redesign/cleaner/**`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-27-cleaner-appointment-sorting-design.md` (authoritative).
- All date math is LOCAL; `scheduled_date` is `YYYY-MM-DD` compared as strings.
- `NEEDS_ATTENTION_DAYS = 3` (one constant in `shared/zones.ts`).
- Zone rules: a job moves only when the local DAY rolls over (never the time-of-day). Past is the COMPLEMENT of Upcoming ∪ Needs-attention (nothing falls through).
- Design system only: brand `brand-*` tokens, `ui/badge` variants, no raw hex, no em dashes. Touch targets >= 44px.
- TDD on every pure fn; co-located `*.test.ts`. Run `npx vitest run <pattern>`. `npx tsc --noEmit` clean on touched files.

---

## Task 1: Zone predicates (`shared/zones.ts`)

**Files:**
- Create: `src/components/redesign/cleaner/shared/zones.ts`
- Test: `src/components/redesign/cleaner/shared/zones.test.ts`

**Produces:** `NEEDS_ATTENTION_DAYS`, `isUpcomingZone(a, todayStr)`, `isUnfinished(a, todayStr)`, `isNeedsAttention(a, todayStr, graceFloorStr)`, `isPastZone(a, todayStr, graceFloorStr)`.

- [ ] **Step 1: Write the failing test** `zones.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { isUpcomingZone, isUnfinished, isNeedsAttention, isPastZone } from "./zones";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-10", GRACE = "2026-06-07"; // today - 3 days
const a = (over: Partial<CleanerAppointment>) =>
  ({ status: "confirmed", cleaner_confirmation_status: "approved", scheduled_date: TODAY, scheduled_time: "09:00:00", ...over }) as CleanerAppointment;

describe("isUpcomingZone", () => {
  it("today/future committed-or-pending jobs", () => {
    expect(isUpcomingZone(a({ scheduled_date: TODAY }), TODAY)).toBe(true);
    expect(isUpcomingZone(a({ scheduled_date: "2026-06-20" }), TODAY)).toBe(true);
    expect(isUpcomingZone(a({ scheduled_date: "2026-06-09" }), TODAY)).toBe(false); // past
    expect(isUpcomingZone(a({ status: "completed" }), TODAY)).toBe(false);
  });
});

describe("isUnfinished / isNeedsAttention / isPastZone", () => {
  it("unfinished = confirmed|in_progress dated before today", () => {
    expect(isUnfinished(a({ scheduled_date: "2026-06-09" }), TODAY)).toBe(true);
    expect(isUnfinished(a({ status: "in_progress", scheduled_date: "2026-06-08" }), TODAY)).toBe(true);
    expect(isUnfinished(a({ scheduled_date: TODAY }), TODAY)).toBe(false);
    expect(isUnfinished(a({ status: "cancelled", scheduled_date: "2026-06-09" }), TODAY)).toBe(false);
  });
  it("needs-attention only within the grace window (boundary: 3 days in, 4 days out)", () => {
    expect(isNeedsAttention(a({ scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(true);  // yesterday
    expect(isNeedsAttention(a({ scheduled_date: "2026-06-07" }), TODAY, GRACE)).toBe(true);  // exactly 3 days
    expect(isNeedsAttention(a({ scheduled_date: "2026-06-06" }), TODAY, GRACE)).toBe(false); // 4 days -> aged out
  });
  it("past zone is the complement (catches done/cancelled/aged/expired, never upcoming/needs-attention)", () => {
    expect(isPastZone(a({ status: "completed" }), TODAY, GRACE)).toBe(true);
    expect(isPastZone(a({ status: "cancelled", scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(true);
    expect(isPastZone(a({ scheduled_date: "2026-06-06" }), TODAY, GRACE)).toBe(true);   // aged unfinished
    expect(isPastZone(a({ status: "pending", cleaner_confirmation_status: "awaiting", scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(true); // expired offer
    expect(isPastZone(a({ scheduled_date: TODAY }), TODAY, GRACE)).toBe(false);        // upcoming
    expect(isPastZone(a({ scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(false); // needs attention
  });
});
```

- [ ] **Step 2: Run, verify fail** , `npx vitest run zones` → FAIL.

- [ ] **Step 3: Write `zones.ts`**

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";

/** Days a never-completed job stays in "Needs attention" before settling into Past. */
export const NEEDS_ATTENTION_DAYS = 3;

const dateOf = (a: CleanerAppointment) => a.scheduled_date ?? "";

/** pending/confirmed/in_progress scheduled today or later. */
export function isUpcomingZone(a: CleanerAppointment, todayStr: string): boolean {
  const s = a.status;
  return (s === "pending" || s === "confirmed" || s === "in_progress") && dateOf(a) >= todayStr;
}

/** A committed job (confirmed or started) whose scheduled day is already past
 * and which never completed/cancelled. */
export function isUnfinished(a: CleanerAppointment, todayStr: string): boolean {
  return (a.status === "confirmed" || a.status === "in_progress") && dateOf(a) < todayStr;
}

/** Recent unfinished work , surfaced in the "Needs attention" zone. */
export function isNeedsAttention(a: CleanerAppointment, todayStr: string, graceFloorStr: string): boolean {
  return isUnfinished(a, todayStr) && dateOf(a) >= graceFloorStr;
}

/** Everything that is neither upcoming nor needs-attention , the Past complement
 * (completed, cancelled, aged-out unfinished, expired past-day offers). */
export function isPastZone(a: CleanerAppointment, todayStr: string, graceFloorStr: string): boolean {
  return !isUpcomingZone(a, todayStr) && !isNeedsAttention(a, todayStr, graceFloorStr);
}
```

- [ ] **Step 4: Run, verify pass; tsc.** Commit:

```bash
git add src/components/redesign/cleaner/shared/zones.ts src/components/redesign/cleaner/shared/zones.test.ts
git commit -m "feat(cleaner-redesign): zone predicates for appointment sorting"
```

---

## Task 2: `formatCardDate` presenter

**Files:** Modify `src/components/redesign/cleaner/shared/job-presenters.ts`; Test `job-presenters.test.ts`.

**Produces:** `formatCardDate(dateStr: string, todayStr: string): string | null`

- [ ] **Step 1: Add test cases** to `job-presenters.test.ts`:

```ts
import { formatCardDate } from "./job-presenters";

describe("formatCardDate", () => {
  it("returns null for today (date is implied)", () => {
    expect(formatCardDate("2026-06-10", "2026-06-10")).toBeNull();
  });
  it("formats a non-today date as weekday + month + day", () => {
    expect(formatCardDate("2026-07-01", "2026-06-10")).toBe("Wed, Jul 1");
  });
  it("includes the year only when different from today's year", () => {
    expect(formatCardDate("2027-01-05", "2026-06-10")).toBe("Tue, Jan 5, 2027");
  });
  it("null on empty/invalid", () => {
    expect(formatCardDate("", "2026-06-10")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add to `job-presenters.ts`** (after `formatDateLong`):

```ts
/** Compact card date ("Wed, Jul 1"), null when it is today (date implied) or
 * invalid. Year appears only when it differs from today's year. */
export function formatCardDate(dateStr: string, todayStr: string): string | null {
  if (!dateStr || dateStr === todayStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const sameYear = todayStr.slice(0, 4) === String(y);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
```

- [ ] **Step 4: Run, verify pass.** Commit `feat(cleaner-redesign): formatCardDate presenter`.

---

## Task 3: Zone-aware status badge

**Files:** Modify `src/components/redesign/cleaner/shared/jobBadge.ts`, `CleanerJobBadge.tsx`; Test `jobBadge.test.ts`.

**Consumes:** `isUnfinished` (Task 1).
**Produces:** badge keys add `"unfinished"` + `"expired"`; `jobBadgeKey(a, todayStr?)`; `<CleanerJobBadge appointment todayStr? />`.

- [ ] **Step 1: Update `jobBadge.test.ts`** , add:

```ts
const PAST = "2026-06-05";
describe("jobBadgeKey zone-awareness (todayStr given)", () => {
  it("stale confirmed/in_progress -> unfinished", () => {
    expect(jobBadgeKey(a({ status: "confirmed", scheduled_date: PAST }), "2026-06-10")).toBe("unfinished");
    expect(jobBadgeKey(a({ status: "in_progress", scheduled_date: PAST }), "2026-06-10")).toBe("unfinished");
  });
  it("stale pending -> expired", () => {
    expect(jobBadgeKey(a({ status: "pending", cleaner_confirmation_status: "awaiting", scheduled_date: PAST }), "2026-06-10")).toBe("expired");
  });
  it("without todayStr, falls back to status-only mapping", () => {
    expect(jobBadgeKey(a({ status: "confirmed", scheduled_date: PAST }))).toBe("upcoming");
  });
});
```
(`a` factory in that file already sets `scheduled_date`; if not, extend it to accept `scheduled_date`.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `jobBadge.ts`** , extend the key union + map + the function:

```ts
import type { ComponentType } from "react";
import { AlertTriangle, CalendarCheck, CalendarX, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { isUnfinished } from "./zones";

export type CleanerJobBadgeKey =
  | "needs_response" | "upcoming" | "in_progress" | "completed" | "cancelled" | "unfinished" | "expired";

export interface CleanerJobBadgeConfig {
  label: string;
  variant: BadgeProps["variant"];
  Icon: ComponentType<{ className?: string }>;
  spin?: boolean;
}

export const CLEANER_JOB_BADGE: Record<CleanerJobBadgeKey, CleanerJobBadgeConfig> = {
  needs_response: { label: "Needs response", variant: "caution", Icon: Clock },
  upcoming: { label: "Upcoming", variant: "secondary", Icon: CalendarCheck },
  in_progress: { label: "In progress", variant: "default", Icon: Loader2, spin: true },
  completed: { label: "Done", variant: "positive", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "critical", Icon: XCircle },
  unfinished: { label: "Unfinished", variant: "caution", Icon: AlertTriangle },
  expired: { label: "Expired", variant: "secondary", Icon: CalendarX },
};

/** Pass todayStr to make the badge zone-aware (a stale confirmed/in_progress job
 * reads "Unfinished", a stale pending offer reads "Expired"). Without todayStr,
 * maps from status alone. */
export function jobBadgeKey(a: CleanerAppointment, todayStr?: string): CleanerJobBadgeKey {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "completed") return "completed";
  if (todayStr != null && (a.scheduled_date ?? "") < todayStr) {
    if (isUnfinished(a, todayStr)) return "unfinished";
    if (a.status === "pending") return "expired";
  }
  if (a.status === "in_progress") return "in_progress";
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "needs_response";
  return "upcoming";
}
```

- [ ] **Step 4: Update `CleanerJobBadge.tsx`** to thread `todayStr`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { CLEANER_JOB_BADGE, jobBadgeKey } from "./jobBadge";

export function CleanerJobBadge({ appointment, todayStr }: { appointment: CleanerAppointment; todayStr?: string }) {
  const c = CLEANER_JOB_BADGE[jobBadgeKey(appointment, todayStr)];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}
```

- [ ] **Step 5: Run, verify pass; tsc.** Commit `feat(cleaner-redesign): zone-aware job badge (Unfinished/Expired)`.

---

## Task 4: `JobRow` shows date + zone badge

**Files:** Modify `src/components/redesign/cleaner/shared/JobRow.tsx`.
**Consumes:** `formatCardDate` (Task 2), `CleanerJobBadge todayStr` (Task 3).

- [ ] **Step 1: Update `JobRow.tsx`** , add optional `todayStr`, render a date line when non-today, pass `todayStr` to the badge:

```tsx
import { formatTimeParts, propertyTitle, jobSubtitle, formatCardDate } from "./job-presenters";
import { CleanerJobBadge } from "./CleanerJobBadge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export function JobRow({ appointment, onClick, todayStr }: { appointment: CleanerAppointment; onClick: () => void; todayStr?: string }) {
  const t = formatTimeParts(appointment.scheduled_time);
  const dateLabel = todayStr ? formatCardDate(appointment.scheduled_date, todayStr) : null;
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-3 text-left shadow-soft-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-14 flex-none text-center">
        <div className="text-sm font-extrabold tabular-nums">{t.h}</div>
        <div className="text-[10px] font-bold text-muted-foreground">{t.ap}</div>
      </div>
      <div className="self-stretch w-px bg-border" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{propertyTitle(appointment)}</div>
        <div className="truncate text-xs text-muted-foreground">{jobSubtitle(appointment)}</div>
        {dateLabel && <div className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{dateLabel}</div>}
      </div>
      <CleanerJobBadge appointment={appointment} todayStr={todayStr} />
    </button>
  );
}
```

- [ ] **Step 2: tsc clean** (all existing `JobRow` callers still compile , `todayStr` optional). Commit `feat(cleaner-redesign): JobRow shows date + zone badge`.

---

## Task 5: `deriveSchedule` , Needs attention + Upcoming(>=today) + Past complement

**Files:** Modify `src/components/redesign/cleaner/schedule/schedule-types.ts`, `deriveSchedule.ts`; Test `deriveSchedule.test.ts`.
**Consumes:** zones (Task 1).

- [ ] **Step 1: `schedule-types.ts`** , add `needsAttention` to `ScheduleData` and `graceFloorStr` to options:

```ts
export interface ScheduleData {
  needsAttention: CleanerAppointment[];
  groups: ScheduleGroup[];
  total: number;     // count for the active view (excludes needsAttention)
  isEmpty: boolean;  // true when the active view's groups are empty
}

export interface DeriveScheduleOptions {
  search: string;
  statusFilter: ScheduleStatusFilter;
  view: ScheduleView;
  todayStr: string;
  tomorrowStr: string;
  weekEndStr: string;
  graceFloorStr: string;
}
```

- [ ] **Step 2: Update `deriveSchedule.test.ts`** , the `appt` factory + new cases (keep existing ones, they still pass; add `graceFloorStr` to the opts in existing calls):

```ts
// add GRACE constant + graceFloorStr to every deriveSchedule(...) opts call:
const GRACE = "2026-06-07"; // TODAY(2026-06-10) - 3

describe("deriveSchedule needs-attention + zones", () => {
  it("recent unfinished -> needsAttention, NOT the Today group", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-09", status: "confirmed" }), appt({ scheduled_date: TODAY, status: "confirmed" })],
      { search: "", statusFilter: "all", view: "upcoming", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND, graceFloorStr: GRACE },
    );
    expect(data.needsAttention.map((j) => j.scheduled_date)).toEqual(["2026-06-09"]);
    expect(data.groups.flatMap((g) => g.jobs).map((j) => j.scheduled_date)).toEqual([TODAY]); // overdue NOT in Today
  });
  it("aged unfinished + completed/cancelled show in Past, not needsAttention", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-01", status: "confirmed" }), appt({ scheduled_date: "2026-06-08", status: "completed" })],
      { search: "", statusFilter: "all", view: "past", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND, graceFloorStr: GRACE },
    );
    expect(data.needsAttention).toEqual([]);
    expect(data.groups[0].jobs.length).toBe(2); // aged-unfinished + completed both in Past
  });
});
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Rewrite `deriveSchedule.ts`** body to use the zones. Keep `matchesScheduleSearch`/`matchesScheduleStatus`/`scheduleGroupOf`/`GROUP_LABEL`/sorters; replace `isUpcoming`/`isPast` with zone imports and add needsAttention:

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { isNeedsAttention, isPastZone, isUpcomingZone } from "../shared/zones";
import type { DeriveScheduleOptions, ScheduleData, ScheduleGroup, ScheduleGroupKey } from "./schedule-types";
// ...keep keyOf/byTimeAsc/byTimeDesc, matchesScheduleSearch, matchesScheduleStatus, scheduleGroupOf, GROUP_LABEL...

export function deriveSchedule(appointments: CleanerAppointment[], opts: DeriveScheduleOptions): ScheduleData {
  const { search, statusFilter, view, todayStr, tomorrowStr, weekEndStr, graceFloorStr } = opts;

  const needsAttention = appointments
    .filter((a) => matchesScheduleSearch(a, search) && isNeedsAttention(a, todayStr, graceFloorStr))
    .sort(byTimeDesc);

  const base = appointments.filter(
    (a) => matchesScheduleSearch(a, search) && matchesScheduleStatus(a, statusFilter)
      && (view === "upcoming" ? isUpcomingZone(a, todayStr) : isPastZone(a, todayStr, graceFloorStr)),
  );

  if (view === "past") {
    const jobs = [...base].sort(byTimeDesc);
    return {
      needsAttention,
      groups: jobs.length ? [{ key: "past", label: GROUP_LABEL.past, jobs }] : [],
      total: jobs.length,
      isEmpty: jobs.length === 0,
    };
  }

  const order: ScheduleGroupKey[] = ["today", "tomorrow", "this_week", "later"];
  const buckets: Record<string, CleanerAppointment[]> = { today: [], tomorrow: [], this_week: [], later: [] };
  for (const a of base) {
    buckets[scheduleGroupOf(a, todayStr, tomorrowStr, weekEndStr)].push(a);
  }
  const groups: ScheduleGroup[] = order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], jobs: buckets[k].sort(byTimeAsc) }));
  return { needsAttention, groups, total: base.length, isEmpty: base.length === 0 };
}
```
(Delete the now-unused local `isUpcoming`/`isPast` consts.)

- [ ] **Step 5: Run, verify pass; tsc.** Commit `feat(cleaner-redesign): deriveSchedule needs-attention zone + past complement`.

---

## Task 6: Schedule View + container render Needs attention + pass dates

**Files:** Modify `src/components/redesign/cleaner/schedule/CleanerScheduleView.tsx`, `CleanerSchedule.tsx`.
**Consumes:** Task 5 data, `JobRow todayStr` (Task 4), `NEEDS_ATTENTION_DAYS` (Task 1).

- [ ] **Step 1: `CleanerSchedule.tsx`** , compute `graceFloorStr`, pass it + `todayStr` down:

```tsx
import { NEEDS_ATTENTION_DAYS } from "../shared/zones";
// in dateStrs useMemo:
const dateStrs = useMemo(() => {
  const now = new Date();
  return {
    todayStr: ymd(now),
    tomorrowStr: ymd(new Date(now.getTime() + 864e5)),
    weekEndStr: ymd(new Date(now.getTime() + 6 * 864e5)),
    graceFloorStr: ymd(new Date(now.getTime() - NEEDS_ATTENTION_DAYS * 864e5)),
  };
}, []);
// data useMemo deps add graceFloorStr (it's inside dateStrs already)
// pass todayStr to the view:
return (
  <CleanerScheduleView
    data={data} loading={loading}
    search={search} onSearchChange={setSearch}
    view={view} onViewChange={(v) => { setView(v); setStatusFilter("all"); }}
    statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
    onOpenJob={openJob} todayStr={dateStrs.todayStr}
  />
);
```

- [ ] **Step 2: `CleanerScheduleView.tsx`** , add `todayStr` prop, render a "Needs attention" section above the count/groups, thread `todayStr` to every `JobRow`:

```tsx
import { AlertTriangle } from "lucide-react";
// props: add `todayStr: string;`
// after the filter row + before the count, when needsAttention is non-empty:
{data.needsAttention.length > 0 && (
  <section className="rounded-card border border-caution-200 bg-caution-50/60 p-3">
    <div className="mb-2 flex items-center gap-1.5 px-0.5">
      <AlertTriangle className="size-4 text-caution-700" aria-hidden />
      <h2 className="text-sm font-bold text-caution-700">Needs attention</h2>
      <span className="ml-auto text-xs font-medium text-caution-700">{data.needsAttention.length}</span>
    </div>
    <div className="space-y-2.5">
      {data.needsAttention.map((j) => <JobRow key={j.id} appointment={j} todayStr={todayStr} onClick={() => onOpenJob(j.id)} />)}
    </div>
  </section>
)}
// every other <JobRow .../> in this file also gets todayStr={todayStr}
```
(Confirm `caution-200`/`caution-50` token classes exist in the palette; if only `caution-50/700` are defined, use `border-border bg-caution-50` instead. Verify against `tailwind.config.js`/globals before finalizing.)

- [ ] **Step 3: tsc + unit green; visual check** (dev server): an overdue confirmed job appears under "Needs attention" with date + Unfinished badge, NOT in Today; non-today cards show their date. Commit `feat(cleaner-redesign): Schedule Needs-attention section + card dates`.

---

## Task 7: `deriveToday` , active=today-only, needs-attention, today=confirmed-only

**Files:** Modify `src/components/redesign/cleaner/today/today-types.ts`, `deriveToday.ts`; Test `deriveToday.test.ts`.
**Consumes:** zones (Task 1).

- [ ] **Step 1: `today-types.ts`** , add `needsAttention: CleanerAppointment[]` to `TodayData`.

- [ ] **Step 2: Update `deriveToday.test.ts`** , the signature gains `graceFloorStr`; add cases:

```ts
// existing deriveToday(appointments, todayStr, tomorrowStr, "percentage_contractor")
// becomes deriveToday(appointments, todayStr, tomorrowStr, graceFloorStr, "percentage_contractor")
const GRACE = ...; // todayStr - 3 days for the test's TODAY
it("stale in_progress -> needsAttention, not activeJob; overdue confirmed -> needsAttention; today confirmed -> todayJobs", () => {
  const data = deriveToday(
    [appt({ status: "in_progress", scheduled_date: yesterday }), appt({ status: "confirmed", scheduled_date: today }), appt({ status: "confirmed", scheduled_date: olderWithinGrace })],
    today, tomorrow, grace, "percentage_contractor",
  );
  expect(data.activeJob).toBeNull();
  expect(data.needsAttention.length).toBe(2);
  expect(data.todayJobs.length).toBe(1);
});
it("in_progress today still pins as activeJob and is NOT in todayJobs", () => { /* ... */ });
```
(Use concrete date strings consistent with the file's existing TODAY.)

- [ ] **Step 3: Rewrite `deriveToday.ts`**:

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { CleanerPayoutModel, TodayData } from "./today-types";
import { isNeedsAttention } from "../shared/zones";

const byTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");
const byTimeDesc = (a: CleanerAppointment, b: CleanerAppointment) =>
  `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`) * -1;

export function deriveToday(
  appointments: CleanerAppointment[],
  todayStr: string,
  tomorrowStr: string,
  graceFloorStr: string,
  payoutModel: CleanerPayoutModel,
): TodayData {
  // Active = today's (or future) in-progress work only; a stale in_progress is
  // unfinished, not "active".
  const activeJob =
    appointments.find((a) => a.status === "in_progress" && (a.scheduled_date ?? "") >= todayStr) ?? null;

  const needsAttention = appointments
    .filter((a) => isNeedsAttention(a, todayStr, graceFloorStr))
    .sort(byTimeDesc);

  const offers =
    payoutModel === "percentage_contractor"
      ? appointments
          .filter((a) => a.status === "pending" && a.cleaner_confirmation_status === "awaiting")
          .sort(byTime)
      : [];

  // Confirmed jobs scheduled exactly today (in_progress is the pinned active job
  // or, if stale, in needsAttention , never double-listed here).
  const todayJobs = appointments
    .filter((a) => a.scheduled_date === todayStr && a.status === "confirmed")
    .sort(byTime);

  const tomorrow = appointments
    .filter((a) => a.scheduled_date === tomorrowStr && (a.status === "confirmed" || a.status === "in_progress"))
    .sort(byTime);
  const tomorrowCount = tomorrow.length;
  const tomorrowFirstTime = tomorrow[0]?.scheduled_time ?? null;

  const isEmpty =
    !activeJob && needsAttention.length === 0 && offers.length === 0 && todayJobs.length === 0 && tomorrowCount === 0;

  return { activeJob, needsAttention, offers, todayJobs, tomorrowCount, tomorrowFirstTime, isEmpty };
}
```

- [ ] **Step 4: Run, verify pass; tsc.** Commit `feat(cleaner-redesign): deriveToday active-today-only + needs-attention`.

---

## Task 8: Today View + container render Needs attention

**Files:** Modify `src/components/redesign/cleaner/today/CleanerTodayView.tsx`, `CleanerToday.tsx`.
**Consumes:** Task 7 data, `JobRow todayStr` (Task 4), `NEEDS_ATTENTION_DAYS` (Task 1).

- [ ] **Step 1: `CleanerToday.tsx`** , compute `graceFloorStr` + `todayStr`, pass grace into `deriveToday`, pass `todayStr` to the view:

```tsx
import { NEEDS_ATTENTION_DAYS } from "../shared/zones";
// ...
const now = new Date();
const todayStr = ymd(now);
const graceFloorStr = ymd(new Date(now.getTime() - NEEDS_ATTENTION_DAYS * 864e5));
const data = deriveToday(appointments, todayStr, ymd(new Date(now.getTime() + 864e5)), graceFloorStr, "percentage_contractor");
// pass todayStr to the view (add prop)
```

- [ ] **Step 2: `CleanerTodayView.tsx`** , add `todayStr` prop; render the Needs attention section (below the active job, above offers); pass `todayStr` to the Today-list `JobRow`s:

```tsx
import { AlertTriangle } from "lucide-react";
// props: add `todayStr: string;`
// after the activeJob section, before offers:
{data.needsAttention.length > 0 && (
  <section>
    <SectionHeader
      title="Needs attention"
      trailing={<span className="rounded-pill bg-caution-50 px-2 py-0.5 text-[11px] font-extrabold text-caution-700">{data.needsAttention.length}</span>}
    />
    <div className="space-y-2.5">
      {data.needsAttention.map((j) => <JobRow key={j.id} appointment={j} todayStr={todayStr} onClick={() => onOpenJob(j.id)} />)}
    </div>
  </section>
)}
// the Today-list JobRow gets todayStr={todayStr} (formatCardDate returns null for today, so no date shows there , correct)
```
(The `isEmpty` early-return already covers the all-empty case via Task 7.)

- [ ] **Step 3: tsc + unit green; visual check** (dev server): the Today screen shows a "Needs attention" section for overdue jobs; a stale in_progress no longer pins as Active. Commit `feat(cleaner-redesign): Today Needs-attention section`.

---

## Final

- [ ] `npm run test:unit` all green; `npx tsc --noEmit` clean on touched files; `npm run lint` clean on touched files.
- [ ] Visual (390px) verify per the spec §10. Send screenshots (user is on mobile).
- [ ] Codex review of the new commits; apply valid findings; push to `feat/redesign-cleaner-app-slice2` (updates #95).

## Self-Review

- **Spec coverage:** zones (§3) → Task 1; Needs-attention surfacing + Past complement (§5) → Tasks 5/6; Today changes (§6) → Tasks 7/8; date display (§7) → Tasks 2/4; "Unfinished"/"Expired" badge (§8) → Task 3. All §4 matrix rows are covered by the zone predicates + badge.
- **Type consistency:** `graceFloorStr` is threaded through `DeriveScheduleOptions`, `deriveToday(...graceFloorStr, payoutModel)`, and both containers. `todayStr` flows container → View → `JobRow` → `CleanerJobBadge`/`formatCardDate`. `ScheduleData.needsAttention` + `TodayData.needsAttention` added. Badge key union extended consistently.
- **Open risk:** `caution-200`/`caution-50` token availability , verify in `tailwind.config.js`/`globals.css` at Task 6 step 2; fall back to `border-border bg-caution-50` if `caution-200` is absent. `byTimeDesc` is defined in both deriveSchedule (existing) and deriveToday (added) , acceptable small duplication (could later move to a shared sorter; not required).
