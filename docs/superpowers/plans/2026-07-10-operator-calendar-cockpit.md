# Operator Calendar Cockpit (R1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a redesign-shell Calendar cockpit (Month/Week/Day/Agenda) to see and manage cleanings, with drag-to-reschedule, click-to-open, and empty-slot-to-create, built from our design system on the same appointment data and pure logic as legacy.

**Architecture:** A new view layer under `src/components/redesign/calendar/` renders four views from the design system, consuming the already-tested pure logic in `src/lib/calendar/*` and `src/lib/appointmentConflicts.ts` plus the realtime hook `useAdminAppointments`. Every mutating interaction reuses a shipped surface: a drag pre-seeds `RescheduleDialog`, a click opens the `?booking=` detail host, an empty-slot click opens the `?newbooking=` sheet. Per-cleaner dispatch lanes / availability shading are documented dormant seams keyed on `organizations.default_payout_model`, not built.

**Tech Stack:** Next.js 16 App Router (redesign route group), React 19, TypeScript, Tailwind v3 (redesign tokens), `@dnd-kit/core` (already a dependency), TanStack Query via `useAdminAppointments`, `date-fns`. No new dependencies, no new API routes, no migrations.

## Global Constraints

- **Design system only.** Implement from `src/components/ui/*` primitives and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC` = `brand-600` on warm canvas, Inter with tabular numerals, `shadow-soft-*`, `rounded-card`/`rounded-control`/`rounded-pill`). No raw hex in components. The companion mockups (`.superpowers/brainstorm/52210-1783707329/content/calendar-all-views.html`) are UX/structure reference ONLY.
- **Status via the badge vocabulary** (`src/components/ui/badge.tsx` variants), never decorative accent bars/stripes.
- **Now-indicator uses brand blue** (`bg-brand-600`), never red. Red is reserved for `critical`/Overdue.
- **No em dashes** in any user-facing copy (labels, empty states, toasts). Use periods, commas, parentheses, or "to" for ranges.
- **Reuse mutating surfaces.** Never write a new reschedule/create path; drive `RescheduleDialog`, `?booking=`, `?newbooking=`.
- **Reuse pure logic.** Use `src/lib/calendar/*` and `src/lib/appointmentConflicts.ts` rather than re-deriving business hours, overlap packing, geometry, date ranges, or conflicts.
- **Model seam is `organizations.default_payout_model`.** First cut supports `percentage_contractor` (offer-based) only. `hourly_external` dispatch behaviors (lanes, drag-assign, availability) are dormant TODO seams, not built.
- **Weeks/month start on Monday** (approved mockup). The reused `dateRange.ts` defaults to Sunday for legacy; Task 3 adds an optional `weekStartsOn` param (default Sunday, preserving legacy) that the redesign passes as Monday.
- Commit-message trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  https://claude.ai/code/session_01VREQVVDjhUtvYbz8jjDeBj
  ```

## File Structure

**New (redesign view layer), all under `src/components/redesign/calendar/`:**
- `deriveCalendar.ts` — `AdminAppointment[]` → `CalendarEvent[]` (mapper + dedupe). **Pure, tested.**
- `calendarStatus.ts` — `CalendarEvent` + nowMs → badge variant / label / dot class / overdue. **Pure, tested.**
- `useCalendarNavigation.ts` — view + focused-date + `stepDate` (pure). **stepDate tested.**
- `calendarDrop.ts` — encode/decode drop ids + drop → `RescheduleInit`. **Pure, tested.**
- `nowLine.ts` — `nowLineY` pure geometry. **Tested.**
- `EventBlock.tsx`, `NowIndicator.tsx`, `MonthEventPill.tsx`, `AgendaRow.tsx` — presentational atoms.
- `WeekView.tsx`, `DayView.tsx`, `MonthView.tsx`, `AgendaView.tsx` — the four views.
- `CalendarToolbar.tsx` — nav + view switch + filters + New-booking.
- `OperatorCalendar.tsx` — hook-backed container (DndContext, RescheduleDialog, `?booking=`, `?newbooking=`, filters).

**New route:** `src/app/(redesign)/app/admin-dashboard/calendar/page.tsx`.

**Modified (shared, additive):**
- `src/lib/appointments/isResponseOverdue.ts` (new) + `src/components/redesign/overview/deriveOverview.ts` (call it).
- `src/lib/calendar/types.ts` (add optional `responseDeadline` to `CalendarEvent`).
- `src/lib/calendar/dateRange.ts` (optional `weekStartsOn` param).
- `src/components/redesign/bookings/new-booking/useOpenOperatorBooking.ts`, `OperatorBookingHost.tsx`, `OperatorBookingForm.tsx` (slot-create prefill).
- `src/components/redesign/shell/nav-items.ts` (Calendar nav item).

**Untouched:** legacy `src/components/calendar/*` and `src/hooks/useCalendarEvents.ts` (still used by legacy dashboards until cutover).

---

### Task 1: Shared `isResponseOverdue` predicate

**Files:**
- Create: `src/lib/appointments/isResponseOverdue.ts`
- Test: `src/lib/appointments/isResponseOverdue.test.ts`
- Modify: `src/components/redesign/overview/deriveOverview.ts`

**Interfaces:**
- Produces: `isResponseOverdue(appt: OverdueInput, nowMs: number): boolean` where `OverdueInput = { status: string; cleaner_id?: string | null; cleaner_confirmation_status?: string | null; response_deadline?: string | null }`.

**Context:** The Overview "Response overdue" bucket (R10) uses a strict predicate: pending + assigned + awaiting + deadline passed. The calendar must flag Overdue on exactly the same jobs. There is a separate, looser legacy `src/lib/isAppointmentOverdue.ts` (allows confirmed/in_progress) — do NOT reuse it here; the Overview bucket's own test excludes a confirmed+awaiting row, so the predicates are deliberately different.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/appointments/isResponseOverdue.test.ts
import { describe, expect, it } from 'vitest';
import { isResponseOverdue } from './isResponseOverdue';

const NOW = Date.parse('2026-06-19T12:00:00Z');
const base = {
  status: 'pending',
  cleaner_id: 'c1',
  cleaner_confirmation_status: 'awaiting',
  response_deadline: '2026-06-19T10:00:00Z',
};

describe('isResponseOverdue', () => {
  it('true for pending + assigned + awaiting + deadline passed', () => {
    expect(isResponseOverdue(base, NOW)).toBe(true);
  });
  it('false when the deadline is still in the future', () => {
    expect(isResponseOverdue({ ...base, response_deadline: '2026-06-19T14:00:00Z' }, NOW)).toBe(false);
  });
  it('false with no deadline', () => {
    expect(isResponseOverdue({ ...base, response_deadline: null }, NOW)).toBe(false);
  });
  it('false when not pending (confirmed/in_progress excluded)', () => {
    expect(isResponseOverdue({ ...base, status: 'confirmed' }, NOW)).toBe(false);
  });
  it('false when unassigned', () => {
    expect(isResponseOverdue({ ...base, cleaner_id: null }, NOW)).toBe(false);
  });
  it('false when the cleaner already answered (approved/rejected)', () => {
    expect(isResponseOverdue({ ...base, cleaner_confirmation_status: 'approved' }, NOW)).toBe(false);
    expect(isResponseOverdue({ ...base, cleaner_confirmation_status: 'rejected' }, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/appointments/isResponseOverdue.test.ts`
Expected: FAIL ("Failed to resolve import ... isResponseOverdue").

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/appointments/isResponseOverdue.ts
/**
 * The Overview "Response overdue" predicate (R10): a pending, cleaner-assigned
 * booking whose asked cleaner blew the response deadline with no answer. Kept
 * as one shared helper so the Overview queue and the calendar's Overdue badge
 * always agree. Distinct from (and stricter than) the legacy
 * `src/lib/isAppointmentOverdue.ts`, which also flags confirmed/in_progress
 * rows; this one is pending-only by design.
 */
export interface OverdueInput {
  status: string;
  cleaner_id?: string | null;
  cleaner_confirmation_status?: string | null;
  response_deadline?: string | null;
}

export function isResponseOverdue(appt: OverdueInput, nowMs: number): boolean {
  return (
    appt.status === 'pending' &&
    appt.cleaner_id != null &&
    appt.cleaner_confirmation_status === 'awaiting' &&
    !!appt.response_deadline &&
    Date.parse(appt.response_deadline) < nowMs
  );
}
```

- [ ] **Step 4: Refactor `deriveOverview.ts` to call the shared helper**

In `src/components/redesign/overview/deriveOverview.ts`, add the import at the top:

```ts
import { isResponseOverdue } from '@/lib/appointments/isResponseOverdue';
```

Replace the inline `overdue` filter body with:

```ts
    overdue: appts.filter((a) => isResponseOverdue(a, nowMs)),
```

(Leave the surrounding comment; delete only the inline boolean chain.)

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run src/lib/appointments/isResponseOverdue.test.ts src/components/redesign/overview/deriveOverview.test.ts`
Expected: PASS (6 new + the existing 9 overview tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/appointments/isResponseOverdue.ts src/lib/appointments/isResponseOverdue.test.ts src/components/redesign/overview/deriveOverview.ts
git commit -m "refactor(overview): extract shared isResponseOverdue predicate"
```

---

### Task 2: Calendar data layer (`deriveCalendar` + `calendarStatus`)

**Files:**
- Modify: `src/lib/calendar/types.ts` (add `responseDeadline?: string | null` to `CalendarEvent`)
- Create: `src/components/redesign/calendar/deriveCalendar.ts`
- Test: `src/components/redesign/calendar/deriveCalendar.test.ts`
- Create: `src/components/redesign/calendar/calendarStatus.ts`
- Test: `src/components/redesign/calendar/calendarStatus.test.ts`

**Interfaces:**
- Consumes: `isResponseOverdue` (Task 1); `resolveCustomerLabel` from `@/lib/calendar/resolveDisplayName`; `CalendarEvent` from `@/lib/calendar/types`; `AdminAppointment` from `@/hooks/useAdminData`.
- Produces:
  - `toCalendarEvent(a: AdminAppointment): CalendarEvent`
  - `deriveCalendarEvents(appts: AdminAppointment[]): CalendarEvent[]` (deduped by id)
  - `calendarStatus(ev: CalendarEvent, nowMs: number): { variant: 'caution'|'secondary'|'info'|'positive'|'critical'; label: string; dotClass: string; overdue: boolean; terminal: boolean }`

- [ ] **Step 1: Add the optional field to the shared `CalendarEvent` type**

In `src/lib/calendar/types.ts`, inside `interface CalendarEvent`, after the `seriesId?: string | null;` line add:

```ts
  /** ISO deadline the asked cleaner must respond by; drives the Overdue badge. Null once answered. */
  responseDeadline?: string | null;
```

- [ ] **Step 2: Write the failing test for the mapper**

```ts
// src/components/redesign/calendar/deriveCalendar.test.ts
import { describe, expect, it } from 'vitest';
import type { AdminAppointment } from '@/hooks/useAdminData';
import { toCalendarEvent, deriveCalendarEvents } from './deriveCalendar';

function appt(over: Partial<AdminAppointment> = {}): AdminAppointment {
  return {
    id: 'a1',
    scheduled_date: '2026-07-10',
    scheduled_time: '13:00:00',
    duration_minutes: 90,
    status: 'confirmed',
    total_price: 120,
    homeowner: { first_name: 'Hank', last_name: 'Homeowner', email: 'h@x.com' },
    property: { name: '12 Maple St', address: '12 Maple St', city: 'X', state: 'YZ' },
    service_type: { name: 'Standard clean', description: '' },
    cleaner_id: 'cl1',
    cleaner_profile: { user_profile: { id: 'cl1', first_name: 'Cleo', last_name: 'Cleaner' } },
    cleaner_confirmation_status: 'approved',
    series_id: null,
    ...over,
  } as AdminAppointment;
}

describe('toCalendarEvent', () => {
  it('parses time to minutes and builds end/label fields', () => {
    const ev = toCalendarEvent(appt());
    expect(ev.startMin).toBe(780);          // 13:00
    expect(ev.durationMin).toBe(90);
    expect(ev.endMin).toBe(870);
    expect(ev.customerLabel).toBe('Hank Homeowner');
    expect(ev.serviceLabel).toBe('Standard clean');
    expect(ev.cleanerName).toBe('Cleo Cleaner');
    expect(ev.cleanerId).toBe('cl1');
  });
  it('defaults a missing/zero duration to 60', () => {
    expect(toCalendarEvent(appt({ duration_minutes: undefined })).durationMin).toBe(60);
    expect(toCalendarEvent(appt({ duration_minutes: 0 })).durationMin).toBe(60);
  });
  it('appends the checklist name to the service label when present', () => {
    const ev = toCalendarEvent(appt({ checklist: { name: 'Deep', price_adder: 20 } }));
    expect(ev.serviceLabel).toBe('Standard clean (Deep)');
  });
  it('carries responseDeadline through', () => {
    expect(toCalendarEvent(appt({ response_deadline: '2026-07-10T10:00:00Z' })).responseDeadline)
      .toBe('2026-07-10T10:00:00Z');
  });
});

describe('deriveCalendarEvents', () => {
  it('dedupes by id', () => {
    expect(deriveCalendarEvents([appt(), appt(), appt({ id: 'a2' })])).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/components/redesign/calendar/deriveCalendar.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `deriveCalendar.ts`**

```ts
// src/components/redesign/calendar/deriveCalendar.ts
/**
 * Maps the redesign's AdminAppointment rows into the shared CalendarEvent shape
 * (times pre-parsed to minutes, customer label resolved, duration defaulted),
 * mirroring the legacy toCalendarEvent but reading AdminAppointment. Pure so it
 * unit-tests without hooks; the container memoizes deriveCalendarEvents.
 */
import type { AdminAppointment } from '@/hooks/useAdminData';
import type { CalendarEvent } from '@/lib/calendar/types';
import { resolveCustomerLabel } from '@/lib/calendar/resolveDisplayName';

export function toCalendarEvent(a: AdminAppointment): CalendarEvent {
  const [y, m, d] = a.scheduled_date.split('-').map(Number);
  const [hh = 0, mm = 0] = (a.scheduled_time || '00:00').split(':').map(Number);
  const startMin = hh * 60 + mm;
  const durationMin = a.duration_minutes && a.duration_minutes > 0 ? a.duration_minutes : 60;

  const up = a.cleaner_profile?.user_profile;
  const cleanerName = up ? `${up.first_name ?? ''} ${up.last_name ?? ''}`.trim() || null : null;

  const serviceLabel = a.service_type?.name
    ? a.checklist?.name
      ? `${a.service_type.name} (${a.checklist.name})`
      : a.service_type.name
    : 'Service';

  const hasSuggestedTimes = (a.cleaner_availability_feedback ?? []).some(
    (f) => (f.cleaner_suggested_times?.length ?? 0) > 0,
  );

  return {
    id: a.id,
    date: a.scheduled_date,
    startMin,
    durationMin,
    endMin: startMin + durationMin,
    start: new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm),
    status: a.status,
    cleanerConfirmationStatus: a.cleaner_confirmation_status ?? null,
    hasSuggestedTimes,
    customerLabel: resolveCustomerLabel(a),
    serviceLabel,
    cleanerId: a.cleaner_id ?? null,
    cleanerName,
    paymentStatus: a.payment_status ?? null,
    seriesId: a.series_id ?? null,
    totalPrice: a.total_price,
    responseDeadline: a.response_deadline ?? null,
  };
}

export function deriveCalendarEvents(appts: AdminAppointment[]): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const a of appts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(toCalendarEvent(a));
  }
  return out;
}
```

- [ ] **Step 5: Write the failing test for `calendarStatus`**

```ts
// src/components/redesign/calendar/calendarStatus.test.ts
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/calendar/types';
import { calendarStatus } from './calendarStatus';

const NOW = Date.parse('2026-07-10T12:00:00Z');
function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'a1', date: '2026-07-10', startMin: 780, durationMin: 90, endMin: 870,
    start: new Date(2026, 6, 10, 13, 0), status: 'pending',
    cleanerConfirmationStatus: 'awaiting', customerLabel: '12 Maple St',
    serviceLabel: 'Standard clean', cleanerId: 'cl1', cleanerName: 'Cleo C.',
    responseDeadline: null, ...over,
  };
}

describe('calendarStatus', () => {
  it('maps each status to the right badge variant + label', () => {
    expect(calendarStatus(ev({ status: 'pending' }), NOW)).toMatchObject({ variant: 'caution', label: 'Pending' });
    expect(calendarStatus(ev({ status: 'confirmed' }), NOW)).toMatchObject({ variant: 'secondary', label: 'Confirmed' });
    expect(calendarStatus(ev({ status: 'in_progress' }), NOW)).toMatchObject({ variant: 'info', label: 'In progress' });
    expect(calendarStatus(ev({ status: 'completed' }), NOW)).toMatchObject({ variant: 'positive', label: 'Completed', terminal: true });
    expect(calendarStatus(ev({ status: 'cancelled' }), NOW)).toMatchObject({ variant: 'secondary', label: 'Cancelled', terminal: true });
  });
  it('overrides a pending row to Overdue when the deadline passed', () => {
    const s = calendarStatus(ev({ status: 'pending', responseDeadline: '2026-07-10T10:00:00Z' }), NOW);
    expect(s).toMatchObject({ variant: 'critical', label: 'Overdue', overdue: true });
  });
  it('does not mark a future-deadline pending row overdue', () => {
    expect(calendarStatus(ev({ responseDeadline: '2026-07-10T14:00:00Z' }), NOW).overdue).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/components/redesign/calendar/calendarStatus.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `calendarStatus.ts`**

```ts
// src/components/redesign/calendar/calendarStatus.ts
/**
 * Maps a CalendarEvent to our badge vocabulary. The hierarchy mirrors the rest
 * of the redesign: amber = needs you, gray = settled, blue = live, green = done,
 * red = problem. A pending row whose response deadline passed is overridden to
 * Overdue (critical), using the same predicate as the Overview queue so the two
 * never disagree.
 */
import type { CalendarEvent } from '@/lib/calendar/types';
import { isResponseOverdue } from '@/lib/appointments/isResponseOverdue';

export type CalendarBadgeVariant = 'caution' | 'secondary' | 'info' | 'positive' | 'critical';

export interface CalendarStatus {
  variant: CalendarBadgeVariant;
  label: string;
  /** Tailwind bg class for the compact dot (design-system status colors). */
  dotClass: string;
  overdue: boolean;
  /** Completed/cancelled: read-only (not draggable), de-emphasized. */
  terminal: boolean;
}

const MAP: Record<string, { variant: CalendarBadgeVariant; label: string; dotClass: string; terminal: boolean }> = {
  pending:     { variant: 'caution',   label: 'Pending',     dotClass: 'bg-caution',  terminal: false },
  confirmed:   { variant: 'secondary', label: 'Confirmed',   dotClass: 'bg-warm-400', terminal: false },
  in_progress: { variant: 'info',      label: 'In progress', dotClass: 'bg-info',     terminal: false },
  completed:   { variant: 'positive',  label: 'Completed',   dotClass: 'bg-positive', terminal: true  },
  cancelled:   { variant: 'secondary', label: 'Cancelled',   dotClass: 'bg-warm-400', terminal: true  },
};

export function calendarStatus(ev: CalendarEvent, nowMs: number): CalendarStatus {
  if (
    isResponseOverdue(
      {
        status: ev.status,
        cleaner_id: ev.cleanerId,
        cleaner_confirmation_status: ev.cleanerConfirmationStatus ?? null,
        response_deadline: ev.responseDeadline ?? null,
      },
      nowMs,
    )
  ) {
    return { variant: 'critical', label: 'Overdue', dotClass: 'bg-critical', overdue: true, terminal: false };
  }
  const base = MAP[ev.status] ?? MAP.pending;
  return { ...base, overdue: false };
}
```

- [ ] **Step 8: Run the tests and make sure they pass**

Run: `npx vitest run src/components/redesign/calendar/deriveCalendar.test.ts src/components/redesign/calendar/calendarStatus.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/calendar/types.ts src/components/redesign/calendar/deriveCalendar.ts src/components/redesign/calendar/deriveCalendar.test.ts src/components/redesign/calendar/calendarStatus.ts src/components/redesign/calendar/calendarStatus.test.ts
git commit -m "feat(calendar): appointment->event mapper and status->badge mapping"
```

---

### Task 3: Navigation, drop, now-line, and Monday-start helpers

**Files:**
- Modify: `src/lib/calendar/dateRange.ts` (optional `weekStartsOn`)
- Test: `src/lib/calendar/dateRange.test.ts` (add Monday cases)
- Create: `src/components/redesign/calendar/useCalendarNavigation.ts`
- Test: `src/components/redesign/calendar/stepDate.test.ts`
- Create: `src/components/redesign/calendar/calendarDrop.ts`
- Test: `src/components/redesign/calendar/calendarDrop.test.ts`
- Create: `src/components/redesign/calendar/nowLine.ts`
- Test: `src/components/redesign/calendar/nowLine.test.ts`

**Interfaces:**
- Consumes: `ViewMode`, `BusinessHours` from `@/lib/calendar/types`; `minutesToTimeString`, `minutesToY` from `@/lib/calendar/timeGrid`; `toDateKey` from `@/lib/calendar/dateRange`; `RescheduleInit` from `@/components/redesign/bookings/reschedule/RescheduleDialog`.
- Produces:
  - `weekDays(date, weekStartsOn?)`, `monthMatrix(date, weekStartsOn?)`, `gridDaysFor(view, date, weekStartsOn?)` (extended)
  - `stepDate(view: ViewMode, date: Date, dir: -1 | 1): Date` and `useCalendarNavigation()` returning `{ view, focusedDate, setView, next, prev, today, goToDate }`
  - `encodeSlot(date, min)`, `encodeDay(date)`, `decodeDropId(id): { date: string; min?: number } | null`, `dropToInit(decoded): RescheduleInit`
  - `nowLineY(nowMs, focusedDateKey, hours): number | null`

- [ ] **Step 1: Extend `dateRange.ts` with an optional `weekStartsOn` (default 0 = Sunday, preserving legacy)**

Replace the `WEEK_OPTS` constant and the three functions `weekDays`, `monthMatrix`, `gridDaysFor` in `src/lib/calendar/dateRange.ts` with:

```ts
type WeekStart = 0 | 1;

/** The 7 days of the week containing `date` (weekStartsOn: 0 = Sunday, 1 = Monday). */
export function weekDays(date: Date, weekStartsOn: WeekStart = 0): Date[] {
  const start = startOfWeek(date, { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** A fixed 6-week (42-cell) month grid containing `date`. */
export function monthMatrix(date: Date, weekStartsOn: WeekStart = 0): Date[] {
  const gridStart = startOfWeek(startOfMonth(date), { weekStartsOn });
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** The day list a given view renders for `date`. */
export function gridDaysFor(view: ViewMode, date: Date, weekStartsOn: WeekStart = 0): Date[] {
  switch (view) {
    case 'month':
      return monthMatrix(date, weekStartsOn);
    case 'week':
      return weekDays(date, weekStartsOn);
    case 'day':
    case 'agenda':
    default:
      return [date];
  }
}
```

(Delete the old `const WEEK_OPTS = { weekStartsOn: 0 as const };`. Leave `toDateKey`, `fromDateKey`, `isSameDayLocal` unchanged.)

- [ ] **Step 2: Add Monday-start cases to `dateRange.test.ts`**

Append inside the existing describe block (the existing Sunday tests stay green because the default is unchanged):

```ts
  it('weekDays with weekStartsOn=1 starts on Monday', () => {
    // 2026-07-10 is a Friday; the Monday-start week begins 2026-07-06.
    const days = weekDays(new Date(2026, 6, 10), 1);
    expect(toDateKey(days[0])).toBe('2026-07-06');
    expect(toDateKey(days[6])).toBe('2026-07-12');
  });
  it('monthMatrix with weekStartsOn=1 begins on a Monday', () => {
    const cells = monthMatrix(new Date(2026, 6, 10), 1);
    expect(cells[0].getDay()).toBe(1); // Monday
    expect(cells).toHaveLength(42);
  });
```

Add `weekDays, monthMatrix` to the file's existing import from `./dateRange` if not already imported.

- [ ] **Step 3: Run the dateRange tests**

Run: `npx vitest run src/lib/calendar/dateRange.test.ts`
Expected: PASS (existing Sunday tests + 2 new Monday tests).

- [ ] **Step 4: Write failing tests for `stepDate`, `calendarDrop`, and `nowLineY`**

```ts
// src/components/redesign/calendar/stepDate.test.ts
import { describe, expect, it } from 'vitest';
import { toDateKey } from '@/lib/calendar/dateRange';
import { stepDate } from './useCalendarNavigation';

describe('stepDate', () => {
  const d = new Date(2026, 6, 10); // Fri Jul 10
  it('month steps by whole months', () => {
    expect(toDateKey(stepDate('month', d, 1))).toBe('2026-08-10');
    expect(toDateKey(stepDate('month', d, -1))).toBe('2026-06-10');
  });
  it('week steps by 7 days', () => {
    expect(toDateKey(stepDate('week', d, 1))).toBe('2026-07-17');
  });
  it('day steps by 1 day', () => {
    expect(toDateKey(stepDate('day', d, -1))).toBe('2026-07-09');
  });
  it('agenda steps by 7 days', () => {
    expect(toDateKey(stepDate('agenda', d, 1))).toBe('2026-07-17');
  });
});
```

```ts
// src/components/redesign/calendar/calendarDrop.test.ts
import { describe, expect, it } from 'vitest';
import { encodeSlot, encodeDay, decodeDropId, dropToInit } from './calendarDrop';

describe('calendarDrop', () => {
  it('round-trips a time slot', () => {
    expect(decodeDropId(encodeSlot('2026-07-10', 780))).toEqual({ date: '2026-07-10', min: 780 });
  });
  it('round-trips a whole-day target', () => {
    expect(decodeDropId(encodeDay('2026-07-10'))).toEqual({ date: '2026-07-10' });
  });
  it('returns null for a foreign id', () => {
    expect(decodeDropId('event:abc')).toBeNull();
    expect(decodeDropId(undefined)).toBeNull();
  });
  it('maps a slot drop to a reschedule init with HH:MM time', () => {
    expect(dropToInit({ date: '2026-07-10', min: 780 })).toEqual({ date: '2026-07-10', time: '13:00' });
  });
  it('maps a day drop to a date-only init (dialog keeps the current time)', () => {
    expect(dropToInit({ date: '2026-07-10' })).toEqual({ date: '2026-07-10' });
  });
});
```

```ts
// src/components/redesign/calendar/nowLine.test.ts
import { describe, expect, it } from 'vitest';
import { nowLineY } from './nowLine';

const hours = { startMin: 420, endMin: 1140 }; // 7:00-19:00
// A fixed instant at local 13:00 on 2026-07-10.
const noon13 = new Date(2026, 6, 10, 13, 0).getTime();

describe('nowLineY', () => {
  it('returns a positive offset when now is today and inside the window', () => {
    // 13:00 = 780min; (780-420)*0.8 = 288
    expect(nowLineY(noon13, '2026-07-10', hours)).toBeCloseTo(288);
  });
  it('returns null when the focused day is not today', () => {
    expect(nowLineY(noon13, '2026-07-11', hours)).toBeNull();
  });
  it('returns null when now is outside the window', () => {
    const t6am = new Date(2026, 6, 10, 6, 0).getTime();
    expect(nowLineY(t6am, '2026-07-10', hours)).toBeNull();
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx vitest run src/components/redesign/calendar/stepDate.test.ts src/components/redesign/calendar/calendarDrop.test.ts src/components/redesign/calendar/nowLine.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 6: Implement `useCalendarNavigation.ts`**

```ts
// src/components/redesign/calendar/useCalendarNavigation.ts
'use client';

import { useCallback, useState } from 'react';
import { addDays, addMonths } from 'date-fns';
import type { ViewMode } from '@/lib/calendar/types';

/** Pure date stepping per view (month by month, week/agenda by 7 days, day by 1). */
export function stepDate(view: ViewMode, date: Date, dir: -1 | 1): Date {
  switch (view) {
    case 'month':
      return addMonths(date, dir);
    case 'week':
    case 'agenda':
      return addDays(date, dir * 7);
    case 'day':
    default:
      return addDays(date, dir);
  }
}

export function useCalendarNavigation(initialView: ViewMode = 'week') {
  const [view, setView] = useState<ViewMode>(initialView);
  const [focusedDate, setFocusedDate] = useState<Date>(() => new Date());

  const next = useCallback(() => setFocusedDate((d) => stepDate(view, d, 1)), [view]);
  const prev = useCallback(() => setFocusedDate((d) => stepDate(view, d, -1)), [view]);
  const today = useCallback(() => setFocusedDate(new Date()), []);
  const goToDate = useCallback((d: Date) => setFocusedDate(d), []);

  return { view, focusedDate, setView, next, prev, today, goToDate };
}
```

- [ ] **Step 7: Implement `calendarDrop.ts`**

```ts
// src/components/redesign/calendar/calendarDrop.ts
/**
 * Encodes/decodes @dnd-kit droppable ids for the calendar and maps a decoded
 * drop to a RescheduleInit that pre-seeds the shipped RescheduleDialog. Week/Day
 * grids drop onto a 15-min slot (date + minute); Month drops onto a whole day
 * (date only, the dialog keeps the job's current time).
 */
import { minutesToTimeString } from '@/lib/calendar/timeGrid';
import type { RescheduleInit } from '@/components/redesign/bookings/reschedule/RescheduleDialog';

export function encodeSlot(date: string, min: number): string {
  return `slot:${date}:${min}`;
}
export function encodeDay(date: string): string {
  return `day:${date}`;
}

export function decodeDropId(id: string | number | undefined | null): { date: string; min?: number } | null {
  if (typeof id !== 'string') return null;
  const parts = id.split(':');
  if (parts[0] === 'slot' && parts.length === 3) {
    const min = Number(parts[2]);
    if (!Number.isFinite(min)) return null;
    return { date: parts[1], min };
  }
  if (parts[0] === 'day' && parts.length === 2) {
    return { date: parts[1] };
  }
  return null;
}

export function dropToInit(decoded: { date: string; min?: number }): RescheduleInit {
  if (decoded.min == null) return { date: decoded.date };
  // minutesToTimeString gives "HH:MM:SS"; the dialog normalizes, and the tests
  // expect "HH:MM", so trim the seconds for a clean seed value.
  return { date: decoded.date, time: minutesToTimeString(decoded.min).slice(0, 5) };
}
```

- [ ] **Step 8: Implement `nowLine.ts`**

```ts
// src/components/redesign/calendar/nowLine.ts
/**
 * Vertical pixel offset for the "now" indicator within a time-grid, or null when
 * the indicator should not render (the focused day is not today, or the current
 * time is outside the visible window). Brand-blue rendering lives in NowIndicator.
 */
import type { BusinessHours } from '@/lib/calendar/types';
import { minutesToY } from '@/lib/calendar/timeGrid';
import { toDateKey } from '@/lib/calendar/dateRange';

export function nowLineY(nowMs: number, focusedDateKey: string, hours: BusinessHours): number | null {
  const now = new Date(nowMs);
  if (toDateKey(now) !== focusedDateKey) return null;
  const min = now.getHours() * 60 + now.getMinutes();
  if (min < hours.startMin || min > hours.endMin) return null;
  return minutesToY(min, hours.startMin);
}
```

- [ ] **Step 9: Run the tests and make sure they pass**

Run: `npx vitest run src/components/redesign/calendar/stepDate.test.ts src/components/redesign/calendar/calendarDrop.test.ts src/components/redesign/calendar/nowLine.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/calendar/dateRange.ts src/lib/calendar/dateRange.test.ts src/components/redesign/calendar/useCalendarNavigation.ts src/components/redesign/calendar/stepDate.test.ts src/components/redesign/calendar/calendarDrop.ts src/components/redesign/calendar/calendarDrop.test.ts src/components/redesign/calendar/nowLine.ts src/components/redesign/calendar/nowLine.test.ts
git commit -m "feat(calendar): navigation, drop-id, now-line, and Monday-start helpers"
```

---

### Task 4: Shared render atoms (`EventBlock` + `NowIndicator`)

**Files:**
- Create: `src/components/redesign/calendar/EventBlock.tsx`
- Create: `src/components/redesign/calendar/NowIndicator.tsx`
- Test: `src/components/redesign/calendar/eventBlock.test.tsx`

**Interfaces:**
- Consumes: `CalendarEvent`, `LaidOutEvent` from `@/lib/calendar/types`; `calendarStatus` (Task 2); `fmtTime` from `@/components/redesign/bookings/booking-vm`; `Badge` from `@/components/ui/badge`; `useDraggable` from `@dnd-kit/core`.
- Produces:
  - `isCompactHeight(px: number): boolean` (threshold 64)
  - `<EventBlock event nowMs top height widthPct leftPct draggable onOpen />`
  - `<NowIndicator y />`

- [ ] **Step 1: Write the failing test (pure threshold + label render)**

```tsx
// src/components/redesign/calendar/eventBlock.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { EventBlock, isCompactHeight } from './EventBlock';

const NOW = Date.parse('2026-07-10T12:00:00Z');
const ev: CalendarEvent = {
  id: 'a1', date: '2026-07-10', startMin: 780, durationMin: 90, endMin: 870,
  start: new Date(2026, 6, 10, 13, 0), status: 'in_progress',
  cleanerConfirmationStatus: 'approved', customerLabel: '12 Maple St',
  serviceLabel: 'Deep clean', cleanerId: 'cl1', cleanerName: 'Cleo C.', responseDeadline: null,
};

describe('isCompactHeight', () => {
  it('is compact below 64px, full at or above', () => {
    expect(isCompactHeight(44)).toBe(true);
    expect(isCompactHeight(64)).toBe(false);
  });
});

describe('EventBlock', () => {
  it('renders the customer label and status badge', () => {
    render(
      <DndContext>
        <EventBlock event={ev} nowMs={NOW} top={0} height={90} widthPct={100} leftPct={0} draggable onOpen={() => {}} />
      </DndContext>,
    );
    expect(screen.getByText('12 Maple St')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/redesign/calendar/eventBlock.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `NowIndicator.tsx`**

```tsx
// src/components/redesign/calendar/NowIndicator.tsx
/** Brand-blue "now" line + dot across a time-grid column. `y` is the pixel offset from nowLineY(). */
export function NowIndicator({ y }: { y: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: y }} aria-hidden>
      <div className="relative h-0.5 bg-brand-600">
        <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-brand-600" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `EventBlock.tsx`**

```tsx
// src/components/redesign/calendar/EventBlock.tsx
'use client';

import { Repeat } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import type { CalendarEvent } from '@/lib/calendar/types';
import { fmtTime } from '@/components/redesign/bookings/booking-vm';
import { calendarStatus } from './calendarStatus';

/** Below this rendered height a job shows the compact single-row layout. */
export function isCompactHeight(px: number): boolean {
  return px < 64;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function EventBlock({
  event,
  nowMs,
  top,
  height,
  widthPct,
  leftPct,
  draggable,
  onOpen,
}: {
  event: CalendarEvent;
  nowMs: number;
  top: number;
  height: number;
  widthPct: number;
  leftPct: number;
  draggable: boolean;
  onOpen: (id: string) => void;
}) {
  const status = calendarStatus(event, nowMs);
  const compact = isCompactHeight(height);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `event:${event.id}`,
    disabled: !draggable || status.terminal,
    data: { eventId: event.id },
  });

  const timeLabel = `${fmtTime(event.start.toTimeString().slice(0, 5))}`;

  return (
    <div
      ref={setNodeRef}
      {...(draggable && !status.terminal ? { ...listeners, ...attributes } : {})}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(event.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen(event.id);
        }
      }}
      className={
        'absolute flex flex-col overflow-hidden rounded-control border border-border bg-card px-2 py-1.5 text-left shadow-soft-sm ' +
        'transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
        (draggable && !status.terminal ? 'cursor-grab ' : 'cursor-pointer ') +
        (status.terminal ? 'opacity-70 ' : '') +
        (isDragging ? 'opacity-40 ' : '')
      }
      style={{ top, height, left: `${leftPct}%`, width: `calc(${widthPct}% - 6px)`, minHeight: 42 }}
    >
      {compact ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`size-2 shrink-0 rounded-full ${status.dotClass}`} />
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">{event.customerLabel}</span>
            <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-brand-600 text-[9px] font-extrabold text-white">
              {initials(event.cleanerName)}
            </span>
          </div>
          <div className="truncate text-[10.5px] font-semibold tabular-nums text-muted-foreground">{timeLabel}</div>
        </>
      ) : (
        <>
          <div className="truncate text-[10.5px] font-semibold tabular-nums text-muted-foreground">{timeLabel}</div>
          <div className="flex min-w-0 items-center gap-1 text-[12.5px] font-bold leading-tight">
            <span className="min-w-0 truncate">{event.customerLabel}</span>
            {event.seriesId ? <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
          </div>
          {height >= 78 ? <div className="truncate text-[11px] text-muted-foreground">{event.serviceLabel}</div> : null}
          <div className="mt-auto flex items-center gap-1.5 pt-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            <span className="ml-auto grid size-[18px] shrink-0 place-items-center rounded-full bg-brand-600 text-[9px] font-extrabold text-white">
              {initials(event.cleanerName)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test and make sure it passes**

Run: `npx vitest run src/components/redesign/calendar/eventBlock.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/calendar/EventBlock.tsx src/components/redesign/calendar/NowIndicator.tsx src/components/redesign/calendar/eventBlock.test.tsx
git commit -m "feat(calendar): EventBlock (full+compact) and brand-blue NowIndicator"
```

---

### Task 5: Week view

**Files:**
- Create: `src/components/redesign/calendar/WeekView.tsx`

**Interfaces:**
- Consumes: `CalendarEvent`, `BusinessHours` from `@/lib/calendar/types`; `deriveBusinessHours` from `@/lib/calendar/businessHours`; `packEventsIntoLanes` from `@/lib/calendar/overlapLayout`; `groupEventsByDate` from `@/lib/calendar/groupEvents`; `buildHourTicks`, `buildSlots`, `minutesToY`, `eventHeightPx`, `PX_PER_MIN` from `@/lib/calendar/timeGrid`; `weekDays`, `toDateKey`, `isSameDayLocal` from `@/lib/calendar/dateRange`; `encodeSlot` (Task 3); `nowLineY` (Task 3); `EventBlock`, `NowIndicator` (Task 4); `useDroppable` from `@dnd-kit/core`.
- Produces: `<WeekView events focusedDate nowMs canEdit onOpen onCreate />` where `onCreate(date: string, time: string)`.

**Notes:** No test (presentational; its pure inputs are already tested). Verified in the browser smoke at Task 11. Weeks are Monday-start (`weekDays(date, 1)`). Business-hours window is derived from the whole week's events. Droppable slots are only rendered when a drag is active is NOT required here (dnd-kit droppables are cheap enough as a static 15-min lattice per day for the first cut); render them always but pointer-through so they never block event clicks.

- [ ] **Step 1: Implement `WeekView.tsx`**

```tsx
// src/components/redesign/calendar/WeekView.tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { deriveBusinessHours } from '@/lib/calendar/businessHours';
import { packEventsIntoLanes } from '@/lib/calendar/overlapLayout';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import {
  buildHourTicks, buildSlots, minutesToY, eventHeightPx, PX_PER_MIN, minutesToTimeString,
} from '@/lib/calendar/timeGrid';
import { weekDays, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { encodeSlot } from './calendarDrop';
import { nowLineY } from './nowLine';
import { EventBlock } from './EventBlock';
import { NowIndicator } from './NowIndicator';

const HOUR_LABEL = (min: number) => {
  const h = Math.floor(min / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
};

function DropSlot({ date, min, top }: { date: string; min: number; top: number }) {
  const { setNodeRef } = useDroppable({ id: encodeSlot(date, min) });
  return <div ref={setNodeRef} className="absolute inset-x-0" style={{ top, height: 15 * PX_PER_MIN }} />;
}

export function WeekView({
  events, focusedDate, nowMs, canEdit, onOpen, onCreate,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string, time: string) => void;
}) {
  const days = weekDays(focusedDate, 1);
  const hours = deriveBusinessHours(events);
  const ticks = buildHourTicks(hours);
  const slots = buildSlots(hours);
  const gridHeight = minutesToY(hours.endMin, hours.startMin);
  const byDate = groupEventsByDate(events);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      {/* headers */}
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
        <div className="border-b border-r border-border" />
        {days.map((d) => {
          const today = isSameDayLocal(d, new Date(nowMs));
          return (
            <div key={toDateKey(d)} className="border-b border-border px-2 py-2 text-center [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border/60">
              <div className={'text-[11px] font-bold uppercase tracking-wide ' + (today ? 'text-brand-700' : 'text-muted-foreground')}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className={'mt-0.5 text-base font-bold tabular-nums ' + (today ? 'mx-auto grid size-6 place-items-center rounded-full bg-brand-600 text-white' : '')}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      {/* body */}
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
        {/* time gutter */}
        <div className="relative border-r border-border/60" style={{ height: gridHeight }}>
          {ticks.map((m) => (
            <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: minutesToY(m, hours.startMin) }}>
              {HOUR_LABEL(m)}
            </div>
          ))}
        </div>
        {/* day columns */}
        {days.map((d) => {
          const key = toDateKey(d);
          const today = isSameDayLocal(d, new Date(nowMs));
          const laid = packEventsIntoLanes(byDate.get(key) ?? []);
          const y = nowLineY(nowMs, key, hours);
          return (
            <div key={key} className={'relative [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border/60 ' + (today ? 'bg-brand-600/[0.03]' : '')} style={{ height: gridHeight }}>
              {/* hour lines */}
              {ticks.map((m) => (
                <div key={m} className="absolute inset-x-0 border-b border-border/40" style={{ top: minutesToY(m, hours.startMin) }} />
              ))}
              {/* droppable slots + click-to-create */}
              {slots.map((m) => (
                <div key={m} className="absolute inset-x-0" style={{ top: minutesToY(m, hours.startMin), height: 15 * PX_PER_MIN }}>
                  {canEdit ? <DropSlot date={key} min={m} top={0} /> : null}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Create a booking at ${HOUR_LABEL(m)}`}
                      onClick={() => onCreate(key, minutesToTimeString(m).slice(0, 5))}
                      className="absolute inset-0 opacity-0"
                    />
                  ) : null}
                </div>
              ))}
              {/* events */}
              {laid.map((ev) => (
                <EventBlock
                  key={ev.id}
                  event={ev}
                  nowMs={nowMs}
                  top={minutesToY(ev.startMin, hours.startMin)}
                  height={eventHeightPx(ev.durationMin)}
                  widthPct={100 / ev.laneCount}
                  leftPct={(100 / ev.laneCount) * ev.lane}
                  draggable={canEdit}
                  onOpen={onOpen}
                />
              ))}
              {y != null ? <NowIndicator y={y} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit 2>&1 | grep WeekView`
Expected: no output (no new type errors in WeekView).

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/calendar/WeekView.tsx
git commit -m "feat(calendar): Week view time-grid (drag slots, now-line, lane packing)"
```

---

### Task 6: Day view

**Files:**
- Create: `src/components/redesign/calendar/DayView.tsx`

**Interfaces:**
- Consumes: same time-grid + drop helpers as Task 5; `EventBlock`, `NowIndicator`; `useDroppable`.
- Produces: `<DayView events focusedDate nowMs canEdit onOpen onCreate />` (same signature as WeekView).

**Notes:** Single-day time grid, wider single column so full cards show the service line. **Dormant seam:** when `default_payout_model === 'hourly_external'` this view will render one lane per cleaner (via `src/lib/calendar/dispatchColumns.ts`) with availability shading; leave a `// DISPATCH SEAM (hourly_external):` comment at the column render site. No test (presentational).

- [ ] **Step 1: Implement `DayView.tsx`**

```tsx
// src/components/redesign/calendar/DayView.tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { deriveBusinessHours } from '@/lib/calendar/businessHours';
import { packEventsIntoLanes } from '@/lib/calendar/overlapLayout';
import { buildHourTicks, buildSlots, minutesToY, eventHeightPx, PX_PER_MIN, minutesToTimeString } from '@/lib/calendar/timeGrid';
import { toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { encodeSlot } from './calendarDrop';
import { nowLineY } from './nowLine';
import { EventBlock } from './EventBlock';
import { NowIndicator } from './NowIndicator';

const HOUR_LABEL = (min: number) => {
  const h = Math.floor(min / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
};

function DropSlot({ date, min }: { date: string; min: number }) {
  const { setNodeRef } = useDroppable({ id: encodeSlot(date, min) });
  return <div ref={setNodeRef} className="absolute inset-0" />;
}

export function DayView({
  events, focusedDate, nowMs, canEdit, onOpen, onCreate,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string, time: string) => void;
}) {
  const key = toDateKey(focusedDate);
  const dayEvents = events.filter((e) => e.date === key);
  const hours = deriveBusinessHours(dayEvents);
  const ticks = buildHourTicks(hours);
  const slots = buildSlots(hours);
  const gridHeight = minutesToY(hours.endMin, hours.startMin);
  const laid = packEventsIntoLanes(dayEvents);
  const today = isSameDayLocal(focusedDate, new Date(nowMs));
  const y = today ? nowLineY(nowMs, key, hours) : null;

  return (
    <div className="grid overflow-hidden rounded-card border border-border bg-card" style={{ gridTemplateColumns: '64px 1fr' }}>
      <div className="relative border-r border-border/60" style={{ height: gridHeight }}>
        {ticks.map((m) => (
          <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: minutesToY(m, hours.startMin) }}>
            {HOUR_LABEL(m)}
          </div>
        ))}
      </div>
      {/* DISPATCH SEAM (hourly_external): render one lane per cleaner here via dispatchColumns.ts */}
      <div className="relative" style={{ height: gridHeight }}>
        {ticks.map((m) => (
          <div key={m} className="absolute inset-x-0 border-b border-border/40" style={{ top: minutesToY(m, hours.startMin) }} />
        ))}
        {slots.map((m) => (
          <div key={m} className="absolute inset-x-0" style={{ top: minutesToY(m, hours.startMin), height: 15 * PX_PER_MIN }}>
            {canEdit ? <DropSlot date={key} min={m} /> : null}
            {canEdit ? (
              <button type="button" aria-label={`Create a booking at ${HOUR_LABEL(m)}`} onClick={() => onCreate(key, minutesToTimeString(m).slice(0, 5))} className="absolute inset-0 opacity-0" />
            ) : null}
          </div>
        ))}
        {laid.map((ev) => (
          <EventBlock
            key={ev.id}
            event={ev}
            nowMs={nowMs}
            top={minutesToY(ev.startMin, hours.startMin)}
            height={eventHeightPx(ev.durationMin)}
            widthPct={100 / ev.laneCount}
            leftPct={(100 / ev.laneCount) * ev.lane}
            draggable={canEdit}
            onOpen={onOpen}
          />
        ))}
        {y != null ? <NowIndicator y={y} /> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep DayView`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/calendar/DayView.tsx
git commit -m "feat(calendar): Day view single-column time-grid (dispatch-lane seam noted)"
```

---

### Task 7: Month view

**Files:**
- Create: `src/components/redesign/calendar/MonthEventPill.tsx`
- Create: `src/components/redesign/calendar/MonthView.tsx`

**Interfaces:**
- Consumes: `CalendarEvent` from `@/lib/calendar/types`; `calendarStatus` (Task 2); `monthMatrix`, `toDateKey`, `isSameDayLocal` from `@/lib/calendar/dateRange`; `groupEventsByDate` from `@/lib/calendar/groupEvents`; `fmtTime` from `@/components/redesign/bookings/booking-vm`; `useDroppable` from `@dnd-kit/core`; `encodeDay` (Task 3).
- Produces: `<MonthView events focusedDate nowMs canEdit onOpen onCreate onPickDay />` where `onCreate(date)` (no time) and `onPickDay(date: Date)` switches to Day view.

**Notes:** Monday-start (`monthMatrix(date, 1)`). Up to 3 pills per cell + "+N more" (which calls `onPickDay`). Other-month cells dimmed. A whole-day droppable per cell (Month drops reschedule to that day, keeping the current time). No test (presentational; pill tint mapping is exercised via calendarStatus).

- [ ] **Step 1: Implement `MonthEventPill.tsx`**

```tsx
// src/components/redesign/calendar/MonthEventPill.tsx
'use client';

import type { CalendarEvent } from '@/lib/calendar/types';
import { calendarStatus } from './calendarStatus';
import { fmtTime } from '@/components/redesign/bookings/booking-vm';

const PILL_TINT: Record<string, string> = {
  caution: 'bg-caution-50 text-caution-700',
  secondary: 'bg-muted text-warm-700',
  info: 'bg-info-50 text-info-700',
  positive: 'bg-positive-50 text-positive-700',
  critical: 'bg-critical-50 text-critical-700',
};

export function MonthEventPill({ event, nowMs, onOpen }: { event: CalendarEvent; nowMs: number; onOpen: (id: string) => void }) {
  const s = calendarStatus(event, nowMs);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(event.id); }}
      className={`flex h-[19px] min-w-0 items-center gap-1.5 rounded-pill px-1.5 text-[10.5px] font-semibold ${PILL_TINT[s.variant] ?? PILL_TINT.secondary}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${s.dotClass}`} />
      <span className="min-w-0 truncate">{fmtTime(event.start.toTimeString().slice(0, 5))} {event.customerLabel}</span>
    </button>
  );
}
```

- [ ] **Step 2: Implement `MonthView.tsx`**

```tsx
// src/components/redesign/calendar/MonthView.tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { monthMatrix, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import { encodeDay } from './calendarDrop';
import { MonthEventPill } from './MonthEventPill';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PILLS = 3;

function DayCell({
  date, events, inMonth, today, nowMs, canEdit, onOpen, onCreate, onPickDay,
}: {
  date: Date; events: CalendarEvent[]; inMonth: boolean; today: boolean; nowMs: number; canEdit: boolean;
  onOpen: (id: string) => void; onCreate: (date: string) => void; onPickDay: (date: Date) => void;
}) {
  const key = toDateKey(date);
  const { setNodeRef } = useDroppable({ id: encodeDay(key), disabled: !canEdit });
  const shown = events.slice(0, MAX_PILLS);
  const extra = events.length - shown.length;
  return (
    <div
      ref={setNodeRef}
      onClick={() => canEdit && onCreate(key)}
      className={'flex min-h-[104px] flex-col gap-1 border-b border-r border-border/60 p-1.5 [&:nth-child(7n)]:border-r-0 ' + (inMonth ? '' : 'bg-muted/30 ') + (canEdit ? 'cursor-pointer' : '')}
    >
      <span className={'self-start text-[12.5px] font-bold tabular-nums ' + (today ? 'grid size-[22px] place-items-center rounded-full bg-brand-600 text-white' : inMonth ? 'text-foreground' : 'text-muted-foreground/60')}>
        {date.getDate()}
      </span>
      {shown.map((ev) => <MonthEventPill key={ev.id} event={ev} nowMs={nowMs} onOpen={onOpen} />)}
      {extra > 0 ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onPickDay(date); }} className="px-1.5 text-left text-[10.5px] font-bold text-brand-700">
          +{extra} more
        </button>
      ) : null}
    </div>
  );
}

export function MonthView({
  events, focusedDate, nowMs, canEdit, onOpen, onCreate, onPickDay,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string) => void;
  onPickDay: (date: Date) => void;
}) {
  const cells = monthMatrix(focusedDate, 1);
  const byDate = groupEventsByDate(events);
  const month = focusedDate.getMonth();
  const now = new Date(nowMs);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      <div className="grid grid-cols-7">
        {DOW.map((d) => (
          <div key={d} className="border-b border-r border-border/60 py-2 text-center text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground [&:nth-child(7)]:border-r-0">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => (
          <DayCell
            key={toDateKey(d)}
            date={d}
            events={byDate.get(toDateKey(d)) ?? []}
            inMonth={d.getMonth() === month}
            today={isSameDayLocal(d, now)}
            nowMs={nowMs}
            canEdit={canEdit}
            onOpen={onOpen}
            onCreate={onCreate}
            onPickDay={onPickDay}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "MonthView|MonthEventPill"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/calendar/MonthEventPill.tsx src/components/redesign/calendar/MonthView.tsx
git commit -m "feat(calendar): Month view (status pills, +N more, day droppables)"
```

---

### Task 8: Agenda view

**Files:**
- Create: `src/components/redesign/calendar/AgendaRow.tsx`
- Create: `src/components/redesign/calendar/AgendaView.tsx`

**Interfaces:**
- Consumes: `CalendarEvent` from `@/lib/calendar/types`; `calendarStatus` (Task 2); `groupEventsByDate` from `@/lib/calendar/groupEvents`; `fmtTime` from `@/components/redesign/bookings/booking-vm`; `Badge` from `@/components/ui/badge`; `fromDateKey`, `isSameDayLocal` from `@/lib/calendar/dateRange`; `addDays` from `date-fns`.
- Produces: `<AgendaView events focusedDate nowMs onOpen />` (no drag/create in agenda).

**Notes:** Flat list grouped by day (chronological), starting at `focusedDate`, showing days that have events. Date headers read "Today"/"Tomorrow"/weekday+date. No test (presentational).

- [ ] **Step 1: Implement `AgendaRow.tsx`**

```tsx
// src/components/redesign/calendar/AgendaRow.tsx
'use client';

import { Repeat } from 'lucide-react';
import type { CalendarEvent } from '@/lib/calendar/types';
import { Badge } from '@/components/ui/badge';
import { calendarStatus } from './calendarStatus';
import { fmtTime } from '@/components/redesign/bookings/booking-vm';

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function AgendaRow({ event, nowMs, onOpen }: { event: CalendarEvent; nowMs: number; onOpen: (id: string) => void }) {
  const s = calendarStatus(event, nowMs);
  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      className="mb-2 flex w-full items-center gap-3.5 rounded-control border border-border bg-card px-3.5 py-2.5 text-left shadow-soft-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-28 shrink-0">
        <div className="text-[12.5px] font-bold tabular-nums text-foreground">{fmtTime(event.start.toTimeString().slice(0, 5))}</div>
        <div className="text-[11px] text-muted-foreground">{durationLabel(event.durationMin)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-sm font-bold">
          <span className="min-w-0 truncate">{event.customerLabel}</span>
          {event.seriesId ? <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        </div>
        <div className="truncate text-[12.5px] text-muted-foreground">{event.serviceLabel}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Badge variant={s.variant}>{s.label}</Badge>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-warm-700">
          <span className="grid size-[22px] place-items-center rounded-full bg-brand-600 text-[10px] font-extrabold text-white">{initials(event.cleanerName)}</span>
          {event.cleanerName ?? 'Unassigned'}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Implement `AgendaView.tsx`**

```tsx
// src/components/redesign/calendar/AgendaView.tsx
'use client';

import { addDays } from 'date-fns';
import type { CalendarEvent } from '@/lib/calendar/types';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import { toDateKey, fromDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { AgendaRow } from './AgendaRow';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarDays } from 'lucide-react';

const DAYS_AHEAD = 30;

function headerLabel(d: Date, now: Date): string {
  if (isSameDayLocal(d, now)) return 'Today';
  if (isSameDayLocal(d, addDays(now, 1))) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function AgendaView({
  events, focusedDate, nowMs, onOpen,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  onOpen: (id: string) => void;
}) {
  const byDate = groupEventsByDate(events);
  const now = new Date(nowMs);
  const start = focusedDate;
  const groups: Array<{ key: string; date: Date; items: CalendarEvent[] }> = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const items = byDate.get(key);
    if (items && items.length) groups.push({ key, date: d, items });
  }

  if (groups.length === 0) {
    return <EmptyState icon={<CalendarDays />} title="Nothing scheduled" description="No cleanings in the next 30 days from this date." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-2 text-[12.5px] font-extrabold text-foreground">{headerLabel(g.date, now)}</div>
          {g.items.map((ev) => <AgendaRow key={ev.id} event={ev} nowMs={nowMs} onOpen={onOpen} />)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "AgendaView|AgendaRow"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/calendar/AgendaRow.tsx src/components/redesign/calendar/AgendaView.tsx
git commit -m "feat(calendar): Agenda view (grouped-by-day list)"
```

---

### Task 9: Calendar toolbar

**Files:**
- Create: `src/components/redesign/calendar/CalendarToolbar.tsx`

**Interfaces:**
- Consumes: `ViewMode` from `@/lib/calendar/types`; `SegmentedControl` from `@/components/ui/segmented-control`; `Button` from `@/components/ui/button`; `Select*` from `@/components/ui/select`; `ChevronLeft`, `ChevronRight`, `Plus` from `lucide-react`; `CleanerOption` from `@/components/redesign/bookings/bookings-types`.
- Produces: `<CalendarToolbar view rangeLabel cleaners statusFilter cleanerFilter onView onPrev onNext onToday onCleanerFilter onStatusFilter onNewBooking />`.

**Notes:** `rangeLabel` is a formatted string the container computes per view (e.g. "Jul 6 to 12, 2026", "July 2026", "Thursday, Jul 10", "Upcoming"). Status filter options: All, Pending, Confirmed, In progress, Completed, Cancelled. Cleaner filter: All cleaners + one per roster cleaner. No test (presentational).

- [ ] **Step 1: Implement `CalendarToolbar.tsx`**

```tsx
// src/components/redesign/calendar/CalendarToolbar.tsx
'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { ViewMode } from '@/lib/calendar/types';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function CalendarToolbar({
  view, rangeLabel, cleaners, cleanerFilter, statusFilter, canCreate,
  onView, onPrev, onNext, onToday, onCleanerFilter, onStatusFilter, onNewBooking,
}: {
  view: ViewMode;
  rangeLabel: string;
  cleaners: CleanerOption[];
  cleanerFilter: string;
  statusFilter: string;
  canCreate: boolean;
  onView: (v: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCleanerFilter: (v: string) => void;
  onStatusFilter: (v: string) => void;
  onNewBooking: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" aria-label="Previous" onClick={onPrev}><ChevronLeft className="size-4" /></Button>
        <Button variant="outline" size="sm" onClick={onToday}>Today</Button>
        <Button variant="outline" size="icon" aria-label="Next" onClick={onNext}><ChevronRight className="size-4" /></Button>
      </div>
      <span className="text-[15px] font-bold tabular-nums">{rangeLabel}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={onView} />
        <Select value={cleanerFilter} onValueChange={onCleanerFilter}>
          <SelectTrigger className="h-9 w-auto gap-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cleaners</SelectItem>
            {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={onStatusFilter}>
          <SelectTrigger className="h-9 w-auto gap-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {canCreate ? <Button onClick={onNewBooking}><Plus className="size-4" /> New booking</Button> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep CalendarToolbar`
Expected: no output. (If `Button` has no `size="icon"` variant, use `variant="outline"` with `className="size-9 p-0"` instead; confirm against `src/components/ui/button.tsx` before implementing.)

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/calendar/CalendarToolbar.tsx
git commit -m "feat(calendar): toolbar (view switch, date nav, filters, new booking)"
```

---

### Task 10: Slot-create prefill for the new-booking sheet

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/useOpenOperatorBooking.ts`
- Test: `src/components/redesign/bookings/new-booking/useOpenOperatorBooking.test.ts`
- Modify: `src/components/redesign/bookings/new-booking/OperatorBookingHost.tsx`
- Modify: `src/components/redesign/bookings/new-booking/OperatorBookingSheet.tsx`
- Modify: `src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx`

**Interfaces:**
- Consumes: existing `operatorBookingParams`, `OperatorBookingSheet`, `OperatorBookingForm`, `EMPTY_OPERATOR_BOOKING` + `OperatorBookingSlot` (`{ date: string /* YYYY-MM-DD */; time: string /* HH:mm 24h */ }`) from `./operator-booking-types`.
- Produces: `operatorBookingParams(prefill?: { date?: string; time?: string }): Record<string, string>`, and a `prefill?: { date?: string; time?: string }` prop threaded `OperatorBookingHost` → `OperatorBookingSheet` → `OperatorBookingForm`, which seeds `slots[0]`.

**Context:** `OperatorBookingHost` renders `<OperatorBookingSheet open onOpenChange>` (gated on `?newbooking=1` via `useDetailParam('newbooking')`); the sheet renders `<OperatorBookingForm onDone>`; the form does `useState(EMPTY_OPERATOR_BOOKING)`. The sheet mounts the form fresh each open, so seeding the initial slot from a `prefill` prop is safe. The slot time format is 24h `HH:mm`, which matches the `dropToInit`/`openNewBooking` value (`minutesToTimeString(min).slice(0,5)`).

- [ ] **Step 1: Update the failing test for `operatorBookingParams`**

Replace `src/components/redesign/bookings/new-booking/useOpenOperatorBooking.test.ts` body with:

```ts
import { describe, expect, it } from 'vitest';
import { operatorBookingParams } from './useOpenOperatorBooking';

describe('operatorBookingParams', () => {
  it('sets newbooking=1 with no prefill', () => {
    expect(operatorBookingParams()).toEqual({ newbooking: '1' });
  });
  it('adds date and time when prefilled', () => {
    expect(operatorBookingParams({ date: '2026-07-10', time: '13:00' })).toEqual({
      newbooking: '1', date: '2026-07-10', time: '13:00',
    });
  });
  it('omits empty prefill fields', () => {
    expect(operatorBookingParams({ date: '2026-07-10' })).toEqual({ newbooking: '1', date: '2026-07-10' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/redesign/bookings/new-booking/useOpenOperatorBooking.test.ts`
Expected: FAIL (the prefill cases).

- [ ] **Step 3: Extend `operatorBookingParams`**

In `src/components/redesign/bookings/new-booking/useOpenOperatorBooking.ts`, replace `operatorBookingParams`:

```ts
export function operatorBookingParams(prefill?: { date?: string; time?: string }): Record<string, string> {
  const params: Record<string, string> = { newbooking: '1' };
  if (prefill?.date) params.date = prefill.date;
  if (prefill?.time) params.time = prefill.time;
  return params;
}
```

- [ ] **Step 4: Thread `prefill` through the host and sheet**

In `src/components/redesign/bookings/new-booking/OperatorBookingHost.tsx`, add `useSearchParams` (the host already runs under Suspense) and pass `prefill` to the sheet:

```tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useDetailParam } from '@/hooks/useDetailParam';
import { OperatorBookingSheet } from './OperatorBookingSheet';

export function OperatorBookingHost() {
  const { paramId, setParam } = useDetailParam('newbooking');
  const sp = useSearchParams();
  const open = !!paramId;
  const prefill = open ? { date: sp.get('date') ?? undefined, time: sp.get('time') ?? undefined } : undefined;
  return (
    <OperatorBookingSheet
      open={open}
      prefill={prefill}
      onOpenChange={(v) => { if (!v) setParam(null); }}
    />
  );
}
```

In `src/components/redesign/bookings/new-booking/OperatorBookingSheet.tsx`, accept and forward `prefill` (add it to the props type and pass to the form):

```tsx
export function OperatorBookingSheet({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill?: { date?: string; time?: string };
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* keep the existing SheetContent wrapper; only add the prefill prop */}
      <OperatorBookingForm prefill={prefill} onDone={() => onOpenChange(false)} />
    </Sheet>
  );
}
```

- [ ] **Step 5: Seed the form's first slot from `prefill`**

In `src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx`, change the signature and initial state (the slot shape is `{ date: string; time: string }`, both possibly empty in `EMPTY_OPERATOR_BOOKING`):

```tsx
export function OperatorBookingForm({ prefill, onDone }: { prefill?: { date?: string; time?: string }; onDone: () => void }) {
  const [state, setState] = useState<OperatorBookingState>(() =>
    prefill?.date || prefill?.time
      ? {
          ...EMPTY_OPERATOR_BOOKING,
          slots: [
            {
              date: prefill.date ?? EMPTY_OPERATOR_BOOKING.slots[0]?.date ?? '',
              time: prefill.time ?? EMPTY_OPERATOR_BOOKING.slots[0]?.time ?? '',
            },
          ],
        }
      : EMPTY_OPERATOR_BOOKING,
  );
  // ...rest of the component unchanged
}
```

- [ ] **Step 6: Run the test + type-check**

Run: `npx vitest run src/components/redesign/bookings/new-booking/useOpenOperatorBooking.test.ts && npx tsc --noEmit 2>&1 | grep -E "OperatorBookingForm|OperatorBookingHost|OperatorBookingSheet|useOpenOperatorBooking"`
Expected: test PASS; no new type errors in the four files.

- [ ] **Step 7: Commit**

```bash
git add src/components/redesign/bookings/new-booking/useOpenOperatorBooking.ts src/components/redesign/bookings/new-booking/useOpenOperatorBooking.test.ts src/components/redesign/bookings/new-booking/OperatorBookingHost.tsx src/components/redesign/bookings/new-booking/OperatorBookingSheet.tsx src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx
git commit -m "feat(booking): new-booking sheet accepts date/time prefill for slot-create"
```

---

### Task 11: `OperatorCalendar` container

**Files:**
- Create: `src/components/redesign/calendar/OperatorCalendar.tsx`

**Interfaces:**
- Consumes: `useAdminAppointments`, `useAdminCleaners` from `@/hooks/useAdminData`; `useAuth` from `@/hooks/useAuth`; `useManagerPermissions` from `@/hooks/useManagerPermissions`; `deriveCalendarEvents` (Task 2); `useCalendarNavigation` (Task 3); `decodeDropId`, `dropToInit` (Task 3); `gridDaysFor`, `toDateKey` from `@/lib/calendar/dateRange`; the four views (Tasks 5-8); `CalendarToolbar` (Task 9); `RescheduleDialog`, `RescheduleInit` from `@/components/redesign/bookings/reschedule/RescheduleDialog`; `useOpenBookingDetail` from `@/components/redesign/bookings/useOpenBookingDetail`; `useOpenOperatorBooking` + `operatorBookingParams` (Task 10) — actually use a router push with `operatorBookingParams({date,time})`; `DndContext`, `PointerSensor`, `KeyboardSensor`, `useSensor`, `useSensors` from `@dnd-kit/core`; `ErrorState` from `@/components/ui/error-state`; `CleanerOption` from `@/components/redesign/bookings/bookings-types`.
- Produces: `<OperatorCalendar />` (default export not required; named export).

**Notes:** This is the wiring task. Drag end → decode → find dragged appointment → open RescheduleDialog seeded. Click event → `?booking=`. Empty slot → push `?newbooking=1&date=&time=`. Filters applied before deriving events. `nowMs` from `Date.now()` captured once per render is fine (no realtime tick needed for the first cut except the now-line, which can read a state ticked every 60s — include a light interval).

- [ ] **Step 1: Implement `OperatorCalendar.tsx`**

```tsx
// src/components/redesign/calendar/OperatorCalendar.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useAdminAppointments, useAdminCleaners, type AdminAppointment } from '@/hooks/useAdminData';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ErrorState } from '@/components/ui/error-state';
import type { ViewMode } from '@/lib/calendar/types';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';
import { RescheduleDialog, type RescheduleInit } from '@/components/redesign/bookings/reschedule/RescheduleDialog';
import { useOpenBookingDetail } from '@/components/redesign/bookings/useOpenBookingDetail';
import { operatorBookingParams } from '@/components/redesign/bookings/new-booking/useOpenOperatorBooking';
import { deriveCalendarEvents } from './deriveCalendar';
import { useCalendarNavigation } from './useCalendarNavigation';
import { decodeDropId, dropToInit } from './calendarDrop';
import { CalendarToolbar } from './CalendarToolbar';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
import { weekDays } from '@/lib/calendar/dateRange';

function rangeLabelFor(view: string, date: Date): string {
  if (view === 'month') return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (view === 'day') return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  if (view === 'agenda') return 'Upcoming';
  const days = weekDays(date, 1);
  const a = days[0], b = days[6];
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString('en-US', { day: 'numeric', year: 'numeric' });
  return `${left} to ${right}`;
}

export function OperatorCalendar() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrgRole } = useAuth();
  const { appointments, loading, error, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;

  const isMobile = useIsMobile();
  const { view, focusedDate, setView, next, prev, today, goToDate } = useCalendarNavigation('week');
  // Mobile (below md) defaults to Agenda, but never clobbers an explicit choice.
  const viewPicked = useRef(false);
  const pickView = (v: ViewMode) => { viewPicked.current = true; setView(v); };
  useEffect(() => { if (isMobile && !viewPicked.current) setView('agenda'); }, [isMobile, setView]);
  const [cleanerFilter, setCleanerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reschedule, setReschedule] = useState<{ appointment: AdminAppointment; init: RescheduleInit } | null>(null);

  // Tick the now-line every 60s.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cleanerOptions: CleanerOption[] = useMemo(
    () => cleaners.map((c) => ({ id: c.id, name: `${c.user_profile?.first_name ?? ''} ${c.user_profile?.last_name ?? ''}`.trim() || 'Cleaner' })),
    [cleaners],
  );

  const filtered = useMemo(
    () => appointments.filter((a) =>
      (cleanerFilter === 'all' || a.cleaner_id === cleanerFilter) &&
      (statusFilter === 'all' || a.status === statusFilter),
    ),
    [appointments, cleanerFilter, statusFilter],
  );
  const events = useMemo(() => deriveCalendarEvents(filtered), [filtered]);

  const openBooking = useOpenBookingDetail();

  const openNewBooking = (date?: string, time?: string) => {
    const qs = new URLSearchParams(operatorBookingParams(date || time ? { date, time } : undefined)).toString();
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const onDragEnd = (e: DragEndEvent) => {
    const decoded = decodeDropId(e.over?.id as string | undefined);
    if (!decoded) return;
    const eventId = (e.active.data.current as { eventId?: string } | undefined)?.eventId;
    const appt = eventId ? appointments.find((a) => a.id === eventId) : null;
    if (!appt) return;
    setReschedule({ appointment: appt, init: dropToInit(decoded) });
  };

  if (error) return <ErrorState title="Couldn't load the calendar" onRetry={() => void refetch()} />;

  const rangeLabel = rangeLabelFor(view, focusedDate);

  return (
    <>
      <CalendarToolbar
        view={view}
        rangeLabel={rangeLabel}
        cleaners={cleanerOptions}
        cleanerFilter={cleanerFilter}
        statusFilter={statusFilter}
        canCreate={canEdit}
        onView={pickView}
        onPrev={prev}
        onNext={next}
        onToday={today}
        onCleanerFilter={setCleanerFilter}
        onStatusFilter={setStatusFilter}
        onNewBooking={() => openNewBooking()}
      />

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {view === 'week' && <WeekView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={openNewBooking} />}
        {view === 'day' && <DayView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={openNewBooking} />}
        {view === 'month' && <MonthView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={(d) => openNewBooking(d)} onPickDay={(d) => { goToDate(d); pickView('day'); }} />}
        {view === 'agenda' && <AgendaView events={events} focusedDate={focusedDate} nowMs={nowMs} onOpen={openBooking} />}
      </DndContext>

      {reschedule ? (
        <RescheduleDialog
          appointment={reschedule.appointment}
          appointments={appointments}
          cleaners={cleanerOptions}
          canHandleRequests={canHandleRequests}
          init={reschedule.init}
          onOpenChange={(o) => { if (!o) setReschedule(null); }}
          onDone={() => { setReschedule(null); void refetch(); }}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Type-check + run the calendar unit suite**

Run: `npx tsc --noEmit 2>&1 | grep -E "calendar/OperatorCalendar" ; npx vitest run src/components/redesign/calendar/`
Expected: no new type errors in OperatorCalendar; all calendar unit tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/calendar/OperatorCalendar.tsx
git commit -m "feat(calendar): OperatorCalendar container (dnd, reschedule, open, create, filters)"
```

---

### Task 12: Route page, nav item, and browser smoke

**Files:**
- Create: `src/app/(redesign)/app/admin-dashboard/calendar/page.tsx`
- Modify: `src/components/redesign/shell/nav-items.ts`

**Interfaces:**
- Consumes: `OperatorCalendar` (Task 11); `OperatorShell` from `@/components/redesign/shell/OperatorShell`; `useRequireManagerFlag` from `@/lib/redesign/useRequireManagerFlag`; the `Spinner`/auth-gating pattern from the sibling bookings page.
- Produces: reachable `/app/admin-dashboard/calendar` gated on `can_view_bookings`, and a "Calendar" nav item.

- [ ] **Step 1: Add the nav item**

In `src/components/redesign/shell/nav-items.ts`, add `CalendarRange` to the lucide import, and insert this item into `OPERATOR_NAV` immediately after the `bookings` entry (before `people`):

```ts
  { id: "calendar", label: "Calendar", href: "/app/admin-dashboard/calendar", icon: CalendarRange, requires: "can_view_bookings" },
```

(Use `CalendarRange`, not `CalendarDays`, so it does not read as a duplicate of the Bookings icon. Do not set `primary` — the mobile bottom bar already has four primaries.)

- [ ] **Step 2: Create the route page (mirror the bookings page wrapper)**

```tsx
// src/app/(redesign)/app/admin-dashboard/calendar/page.tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorCalendar } from "@/components/redesign/calendar/OperatorCalendar";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function OperatorCalendarInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  const flagState = useRequireManagerFlag("can_view_bookings");

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (flagState === "checking") return <Spinner />;

  return (
    <OperatorShell active="calendar">
      <OperatorCalendar />
    </OperatorShell>
  );
}

export default function OperatorCalendarPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorCalendarInner />
    </Suspense>
  );
}
```

- [ ] **Step 3: Full gates**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"   # expect the pre-existing baseline count, no NEW errors in calendar files
npx vitest run src/components/redesign/calendar/ src/lib/appointments/isResponseOverdue.test.ts src/lib/calendar/dateRange.test.ts src/components/redesign/overview/deriveOverview.test.ts src/components/redesign/bookings/new-booking/useOpenOperatorBooking.test.ts
npx eslint src/components/redesign/calendar src/app/\(redesign\)/app/admin-dashboard/calendar src/components/redesign/shell/nav-items.ts
```
Expected: no new tsc errors; all listed unit tests PASS; eslint clean on changed files.

- [ ] **Step 4: Browser smoke (login as the seeded admin against local dev)**

Start `npm run dev`, sign in (`admin-verify@test.local` / `TestPass123!`), open `/app/admin-dashboard/calendar`. Verify:
- The Calendar nav item appears and is active; all four views render and switch via the segmented control.
- Week/Day show the brand-blue now-line on today; short jobs render compact; long addresses truncate inside the card.
- Dragging a job onto a new slot opens the reschedule dialog pre-seeded with that date/time; Cancel leaves the booking unchanged.
- Clicking a job opens the `?booking=` detail sheet in place; closing it returns to the calendar.
- Clicking an empty slot opens the new-booking sheet with the date/time seeded.
- The cleaner and status filters narrow the visible events.

Restore any local dev data you mutate.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(redesign)/app/admin-dashboard/calendar/page.tsx" src/components/redesign/shell/nav-items.ts
git commit -m "feat(calendar): route page + Calendar nav item (gated on can_view_bookings)"
```

---

## Final verification (before opening the PR)

- [ ] Full unit suite green except the documented `formDraft` flake: `npm run test:unit`
- [ ] `npx tsc --noEmit` shows only the pre-existing baseline errors (none in calendar files)
- [ ] `npm run lint` clean on all changed files
- [ ] `ui-ux-pro-max` implementation-phase conformance pass: no raw hex in the calendar components, status via badge variants, brand-blue now-line, touch targets and contrast OK
- [ ] Update `docs/redesign/2026-07-09-functionality-audit.md` row R1 to done (first cut: view + reschedule; dispatch lanes dormant)
- [ ] Open PR to `master`, title `feat(operator): calendar cockpit (R1)`, with the four gating checks green
