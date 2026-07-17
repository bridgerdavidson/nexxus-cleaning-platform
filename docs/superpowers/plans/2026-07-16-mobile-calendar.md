# Mobile Operator Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below Tailwind `md`, the operator calendar renders a mini month grid (status-colored workload dots, 4+ count swap, blue today chip) with a selected-day list, an Upcoming tab, a compact two-row header, and a filter bottom sheet. Desktop is byte-for-byte unchanged.

**Architecture:** New mobile-only presentational components in `src/components/redesign/calendar/` fed by the existing shared layer (`useAdminAppointments` → `deriveCalendarEvents` → `calendarStatus`). `OperatorCalendar` keeps owning all state and branches on `useIsMobile()`. One new pure helper module carries the only new logic (per-day dot/count summary + month-change selection) and is unit tested.

**Tech Stack:** Next.js 16 / React 19, Tailwind v3 tokens, lucide-react, vaul Drawer primitive (`ui/drawer`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-mobile-calendar-design.md`

## Global Constraints

- Branch: `feat/mobile-calendar` cut from `origin/master`. Never commit to `master`.
- No em dashes in any user-facing copy (UI text, labels, empty states).
- Design-system only: tokens/primitives from `src/components/ui/*`, `tailwind.config.js`, `src/app/globals.css`. No raw hex in components. Companion mockups are structure reference only.
- Icons: lucide-react only.
- Path alias `@/*` → `./src/*`. New pure logic gets co-located `*.test.ts` (Vitest, style of `calendarStatus.test.ts`).
- Desktop calendar files (`CalendarToolbar` visuals, `WeekView`, `DayView`, `MonthView`, `AgendaView` internals, DnD) must not change behavior at `md`+. (`CalendarToolbar.tsx` gains only an `export` keyword on `STATUS_OPTIONS`.)
- Week starts Monday (`monthMatrix(date, 1)`), matching the desktop `MonthView`.
- Touch targets ≥ 44px (`size-11` / `h-11` on interactive controls; day cells ≥ 44px tall).
- `npx tsc --noEmit` has pre-existing repo errors; gate on "no NEW errors in touched files" (grep output for the touched filenames).

---

### Task 1: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Cut the branch from current master and bring the spec over**

```bash
git -C <worktree> fetch origin master
git checkout -b feat/mobile-calendar origin/master
git cherry-pick e60f4c4   # docs: spec for the mobile operator calendar
```

Expected: clean cherry-pick (doc file is new; no conflicts).

- [ ] **Step 2: Commit this plan document on the new branch**

```bash
git add docs/superpowers/plans/2026-07-16-mobile-calendar.md
git commit -m "docs: implementation plan for the mobile operator calendar"
```

---

### Task 2: `monthCellSummary` pure helper (TDD)

**Files:**
- Create: `src/components/redesign/calendar/monthCellSummary.ts`
- Test: `src/components/redesign/calendar/monthCellSummary.test.ts`

**Interfaces:**
- Consumes: `calendarStatus(ev, nowMs).dotClass` (existing), `CalendarEvent`, `toDateKey` (existing).
- Produces (used by Tasks 4 and 6):

```ts
export type MonthCellSummary =
  | { kind: 'none' }
  | { kind: 'dots'; dotClasses: string[] }   // 1-3 events, start-time order
  | { kind: 'count'; count: number };        // 4+ events

export function monthCellSummary(dayEvents: CalendarEvent[], nowMs: number): MonthCellSummary;
/** Selection target after a month change: today when visible, else the 1st. Returns a yyyy-MM-dd key. */
export function selectionForMonth(monthDate: Date, nowMs: number): string;
```

- [ ] **Step 1: Write the failing test** (`monthCellSummary.test.ts`; reuse the `ev()` factory pattern from `calendarStatus.test.ts`)

```ts
// src/components/redesign/calendar/monthCellSummary.test.ts
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/calendar/types';
import { monthCellSummary, selectionForMonth } from './monthCellSummary';

const NOW = Date.parse('2026-07-10T12:00:00Z');
function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'a1', date: '2026-07-10', startMin: 780, durationMin: 90, endMin: 870,
    start: new Date(2026, 6, 10, 13, 0), status: 'confirmed',
    cleanerConfirmationStatus: null, customerLabel: '12 Maple St',
    serviceLabel: 'Standard clean', cleanerId: 'cl1', cleanerName: 'Cleo C.',
    responseDeadline: null, ...over,
  };
}

describe('monthCellSummary', () => {
  it('returns none for an empty day', () => {
    expect(monthCellSummary([], NOW)).toEqual({ kind: 'none' });
  });
  it('returns 1-3 status dots in start-time order, even from unsorted input', () => {
    const s = monthCellSummary(
      [ev({ id: 'b', startMin: 900, status: 'pending' }), ev({ id: 'a', startMin: 600, status: 'confirmed' })],
      NOW,
    );
    expect(s).toEqual({ kind: 'dots', dotClasses: ['bg-warm-400', 'bg-caution'] });
  });
  it('uses the overdue dot for a pending event whose deadline passed', () => {
    const s = monthCellSummary([ev({ status: 'pending', responseDeadline: '2026-07-10T10:00:00Z' })], NOW);
    expect(s).toEqual({ kind: 'dots', dotClasses: ['bg-critical'] });
  });
  it('swaps to a count at 4+', () => {
    const four = [1, 2, 3, 4].map((n) => ev({ id: String(n), startMin: 600 + n }));
    expect(monthCellSummary(four, NOW)).toEqual({ kind: 'count', count: 4 });
  });
});

describe('selectionForMonth', () => {
  it('picks today when the month contains it', () => {
    expect(selectionForMonth(new Date(2026, 6, 1), NOW)).toBe('2026-07-10');
  });
  it('picks the 1st for any other month', () => {
    expect(selectionForMonth(new Date(2026, 7, 15), NOW)).toBe('2026-08-01');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- src/components/redesign/calendar/monthCellSummary.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Minimal implementation**

```ts
// src/components/redesign/calendar/monthCellSummary.ts
/**
 * Pure per-day summary for the mobile mini-month grid: 1-3 events render as
 * status-colored dots (start-time order), 4+ collapse to a count so slammed
 * days pop at a glance. Also owns the month-change selection rule.
 */
import type { CalendarEvent } from '@/lib/calendar/types';
import { toDateKey } from '@/lib/calendar/dateRange';
import { calendarStatus } from './calendarStatus';

export type MonthCellSummary =
  | { kind: 'none' }
  | { kind: 'dots'; dotClasses: string[] }
  | { kind: 'count'; count: number };

export function monthCellSummary(dayEvents: CalendarEvent[], nowMs: number): MonthCellSummary {
  if (dayEvents.length === 0) return { kind: 'none' };
  if (dayEvents.length > 3) return { kind: 'count', count: dayEvents.length };
  const sorted = [...dayEvents].sort((a, b) => a.startMin - b.startMin);
  return { kind: 'dots', dotClasses: sorted.map((e) => calendarStatus(e, nowMs).dotClass) };
}

export function selectionForMonth(monthDate: Date, nowMs: number): string {
  const now = new Date(nowMs);
  if (now.getFullYear() === monthDate.getFullYear() && now.getMonth() === monthDate.getMonth()) {
    return toDateKey(now);
  }
  return toDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- src/components/redesign/calendar/monthCellSummary.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/calendar/monthCellSummary.ts src/components/redesign/calendar/monthCellSummary.test.ts
git commit -m "feat(calendar): per-day dot/count summary for the mobile mini month"
```

---

### Task 3: `MobileCalendarBar` + `CalendarFilterSheet`

**Files:**
- Create: `src/components/redesign/calendar/MobileCalendarBar.tsx`
- Create: `src/components/redesign/calendar/CalendarFilterSheet.tsx`
- Modify: `src/components/redesign/calendar/CalendarToolbar.tsx` (line 18: `const STATUS_OPTIONS` → `export const STATUS_OPTIONS`; no other change)

**Interfaces:**
- Consumes: `SegmentedControl`, `Button`, `Label`, `Select*` from `ui/*`; `Drawer*` from `ui/drawer`; `CleanerOption` from `bookings-types`; `STATUS_OPTIONS` from `CalendarToolbar`.
- Produces (used by Task 5):

```ts
export type MobileCalendarView = 'month' | 'agenda';
export function MobileCalendarBar(props: {
  view: MobileCalendarView; rangeLabel: string; filtersActive: boolean;
  onView: (v: MobileCalendarView) => void; onPrev: () => void; onNext: () => void;
  onToday: () => void; onOpenFilters: () => void;
}): JSX.Element;

export function CalendarFilterSheet(props: {
  open: boolean; onOpenChange: (o: boolean) => void; cleaners: CleanerOption[];
  cleanerFilter: string; statusFilter: string;
  onCleanerFilter: (v: string) => void; onStatusFilter: (v: string) => void;
}): JSX.Element;
```

- [ ] **Step 1: Export `STATUS_OPTIONS` from `CalendarToolbar.tsx`** (add `export` keyword only).

- [ ] **Step 2: Write `MobileCalendarBar.tsx`**

```tsx
// src/components/redesign/calendar/MobileCalendarBar.tsx
'use client';

import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';

export type MobileCalendarView = 'month' | 'agenda';

const VIEWS: { value: MobileCalendarView; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Upcoming' },
];

/** Compact two-row mobile calendar header (spec: header under ~100px). */
export function MobileCalendarBar({
  view, rangeLabel, filtersActive, onView, onPrev, onNext, onToday, onOpenFilters,
}: {
  view: MobileCalendarView;
  rangeLabel: string;
  filtersActive: boolean;
  onView: (v: MobileCalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenFilters: () => void;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-xl font-bold tabular-nums tracking-tight">{rangeLabel}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="icon" className="size-11" aria-label="Previous" onClick={onPrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" className="h-11" onClick={onToday}>Today</Button>
          <Button variant="outline" size="icon" className="size-11" aria-label="Next" onClick={onNext}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl options={VIEWS} value={view} onChange={onView} />
        <Button variant="outline" size="icon" className="relative size-11" aria-label="Filters" onClick={onOpenFilters}>
          <Filter className="size-4" />
          {filtersActive ? (
            <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-brand-600" />
          ) : null}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `CalendarFilterSheet.tsx`**

```tsx
// src/components/redesign/calendar/CalendarFilterSheet.tsx
'use client';

import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';
import { STATUS_OPTIONS } from './CalendarToolbar';

/** Bottom-sheet filters for the mobile calendar (same cleaner/status filters as desktop). */
export function CalendarFilterSheet({
  open, onOpenChange, cleaners, cleanerFilter, statusFilter, onCleanerFilter, onStatusFilter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cleaners: CleanerOption[];
  cleanerFilter: string;
  statusFilter: string;
  onCleanerFilter: (v: string) => void;
  onStatusFilter: (v: string) => void;
}) {
  const active = cleanerFilter !== 'all' || statusFilter !== 'all';
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 px-5">
          <div className="space-y-1.5">
            <Label htmlFor="cal-filter-cleaner">Cleaner</Label>
            <Select value={cleanerFilter} onValueChange={onCleanerFilter}>
              <SelectTrigger id="cal-filter-cleaner" className="h-11 w-full" aria-label="Filter by cleaner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cleaners</SelectItem>
                {cleaners.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-filter-status">Status</Label>
            <Select value={statusFilter} onValueChange={onStatusFilter}>
              <SelectTrigger id="cal-filter-status" className="h-11 w-full" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DrawerFooter>
          {active ? (
            <Button
              variant="ghost"
              onClick={() => { onCleanerFilter('all'); onStatusFilter('all'); }}
            >
              Reset filters
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 4: Type-check touched files**

Run: `npx tsc --noEmit 2>&1 | grep -E "MobileCalendarBar|CalendarFilterSheet|CalendarToolbar" || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/calendar/MobileCalendarBar.tsx src/components/redesign/calendar/CalendarFilterSheet.tsx src/components/redesign/calendar/CalendarToolbar.tsx
git commit -m "feat(calendar): compact mobile header and filter bottom sheet"
```

---

### Task 4: `MobileMonthView` (mini grid + day list)

**Files:**
- Create: `src/components/redesign/calendar/MobileMonthView.tsx`

**Interfaces:**
- Consumes: `monthCellSummary` (Task 2), `monthMatrix/toDateKey/fromDateKey/isSameDayLocal`, `groupEventsByDate`, `AgendaRow`, `EmptyState`, `Button`, `cn` from `@/lib/utils`.
- Produces (used by Task 5):

```ts
export function MobileMonthView(props: {
  events: CalendarEvent[]; focusedDate: Date; selectedKey: string; nowMs: number;
  canEdit: boolean; onSelectDay: (key: string) => void; onOpen: (id: string) => void;
  onCreate: (date: string) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the component**

```tsx
// src/components/redesign/calendar/MobileMonthView.tsx
'use client';

import { CalendarDays, Plus } from 'lucide-react';
import type { CalendarEvent } from '@/lib/calendar/types';
import { cn } from '@/lib/utils';
import { monthMatrix, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { AgendaRow } from './AgendaRow';
import { monthCellSummary, type MonthCellSummary } from './monthCellSummary';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function cellAriaLabel(d: Date, count: number): string {
  const ds = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (count === 0) return `${ds}, no bookings`;
  return `${ds}, ${count} ${count === 1 ? 'booking' : 'bookings'}`;
}

function dayListLabel(d: Date, now: Date): string {
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return isSameDayLocal(d, now) ? `Today · ${label}` : label;
}

function CellSignal({ summary, onToday }: { summary: MonthCellSummary; onToday: boolean }) {
  if (summary.kind === 'count') {
    return (
      <span className={cn('text-[10px] font-extrabold leading-none tabular-nums', onToday ? 'text-white' : 'text-brand-700')}>
        {summary.count}
      </span>
    );
  }
  if (summary.kind === 'dots') {
    return (
      <>
        {summary.dotClasses.map((c, i) => (
          <span key={i} className={cn('size-1.5 rounded-full', onToday ? 'bg-white' : c)} />
        ))}
      </>
    );
  }
  return null;
}

/** Mini month grid + selected-day booking list (mobile only; spec 2026-07-16). */
export function MobileMonthView({
  events, focusedDate, selectedKey, nowMs, canEdit, onSelectDay, onOpen, onCreate,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  selectedKey: string;
  nowMs: number;
  canEdit: boolean;
  onSelectDay: (key: string) => void;
  onOpen: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  const cells = monthMatrix(focusedDate, 1);
  const byDate = groupEventsByDate(events);
  const month = focusedDate.getMonth();
  const now = new Date(nowMs);

  const selectedDate = cells.find((d) => toDateKey(d) === selectedKey) ?? focusedDate;
  const dayEvents = byDate.get(selectedKey) ?? [];

  return (
    <div className="pb-20">
      <div className="rounded-card border border-border bg-card p-2">
        <div className="grid grid-cols-7">
          {DOW.map((d) => (
            <div key={d} className="py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const key = toDateKey(d);
            const inMonth = d.getMonth() === month;
            const today = isSameDayLocal(d, now);
            const selected = key === selectedKey;
            const cellEvents = byDate.get(key) ?? [];
            const summary = monthCellSummary(cellEvents, nowMs);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(key)}
                aria-label={cellAriaLabel(d, cellEvents.length)}
                aria-pressed={selected}
                className={cn(
                  'flex min-h-11 items-start justify-center rounded-control py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected && !today && 'bg-muted ring-1 ring-border',
                )}
              >
                <span className={cn('flex w-8 flex-col items-center gap-1 rounded-control pb-1 pt-0.5', today && 'bg-brand-600')}>
                  <span
                    className={cn(
                      'text-[13px] font-bold leading-5 tabular-nums',
                      today ? 'text-white' : inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  <span className="flex h-1.5 items-center justify-center gap-0.5">
                    <CellSignal summary={summary} onToday={today} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[12.5px] font-extrabold text-foreground">{dayListLabel(selectedDate, now)}</div>
        {dayEvents.length > 0 ? (
          dayEvents.map((ev) => <AgendaRow key={ev.id} event={ev} nowMs={nowMs} onOpen={onOpen} />)
        ) : (
          <EmptyState
            icon={<CalendarDays />}
            title="Nothing scheduled"
            description="No bookings on this day."
            action={
              canEdit ? (
                <Button onClick={() => onCreate(selectedKey)}>
                  <Plus /> Book this day
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "MobileMonthView" || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/calendar/MobileMonthView.tsx
git commit -m "feat(calendar): mobile mini month grid with status dots and day list"
```

---

### Task 5: Wire the mobile branch into `OperatorCalendar`

**Files:**
- Modify: `src/components/redesign/calendar/OperatorCalendar.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 2-4, plus existing `stepDate` (exported from `./useCalendarNavigation`), `fromDateKey` from `@/lib/calendar/dateRange`.

- [ ] **Step 1: Apply the edits**

Imports to add:

```ts
import { fromDateKey, toDateKey } from '@/lib/calendar/dateRange';
import { stepDate } from './useCalendarNavigation';
import { selectionForMonth } from './monthCellSummary';
import { MobileCalendarBar, type MobileCalendarView } from './MobileCalendarBar';
import { MobileMonthView } from './MobileMonthView';
import { CalendarFilterSheet } from './CalendarFilterSheet';
```

(`weekDays` import stays; `useCalendarNavigation` import stays.)

Replace the mobile-default effect (currently `setView('agenda')`) and add mobile state:

```ts
// Mobile (below md) defaults to the mini month, but never clobbers an explicit choice.
const viewPicked = useRef(false);
const pickView = (v: ViewMode) => { viewPicked.current = true; setView(v); };
useEffect(() => { if (isMobile && !viewPicked.current) setView('month'); }, [isMobile, setView]);

const [selectedDayKey, setSelectedDayKey] = useState(() => toDateKey(new Date()));
const [filtersOpen, setFiltersOpen] = useState(false);
```

Below `const rangeLabel = ...`, add the mobile derivations + handlers:

```ts
// Mobile renders only month/agenda; any other view value coerces to month.
const mobileView: MobileCalendarView = view === 'agenda' ? 'agenda' : 'month';
const filtersActive = cleanerFilter !== 'all' || statusFilter !== 'all';

const mobileStep = (dir: -1 | 1) => {
  const nd = stepDate(mobileView, focusedDate, dir);
  goToDate(nd);
  if (mobileView === 'month') setSelectedDayKey(selectionForMonth(nd, nowMs));
};
const mobileToday = () => {
  today();
  setSelectedDayKey(toDateKey(new Date(nowMs)));
};
const selectDay = (key: string) => {
  setSelectedDayKey(key);
  const d = fromDateKey(key);
  if (d.getMonth() !== focusedDate.getMonth() || d.getFullYear() !== focusedDate.getFullYear()) goToDate(d);
};
```

Mobile early-return before the desktop JSX (after the `if (error)` return; RescheduleDialog and DndContext stay desktop-only since drag cannot trigger on mobile):

```tsx
if (isMobile) {
  return (
    <>
      <MobileCalendarBar
        view={mobileView}
        rangeLabel={rangeLabelFor(mobileView, focusedDate)}
        filtersActive={filtersActive}
        onView={(v) => pickView(v)}
        onPrev={() => mobileStep(-1)}
        onNext={() => mobileStep(1)}
        onToday={mobileToday}
        onOpenFilters={() => setFiltersOpen(true)}
      />
      {mobileView === 'month' ? (
        <MobileMonthView
          events={events}
          focusedDate={focusedDate}
          selectedKey={selectedDayKey}
          nowMs={nowMs}
          canEdit={canEdit}
          onSelectDay={selectDay}
          onOpen={openBooking}
          onCreate={(d) => openNewBooking(d)}
        />
      ) : (
        <AgendaView events={events} focusedDate={focusedDate} nowMs={nowMs} onOpen={openBooking} />
      )}
      <CalendarFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        cleaners={cleanerOptions}
        cleanerFilter={cleanerFilter}
        statusFilter={statusFilter}
        onCleanerFilter={setCleanerFilter}
        onStatusFilter={setStatusFilter}
      />
    </>
  );
}
```

Desktop JSX below stays exactly as-is.

- [ ] **Step 2: Type-check + full unit suite**

Run: `npx tsc --noEmit 2>&1 | grep -E "OperatorCalendar|MobileMonth|MobileCalendarBar|CalendarFilterSheet|monthCellSummary" || echo CLEAN`
Expected: `CLEAN`.
Run: `npm run test:unit`
Expected: all pass (no existing test touches the removed agenda-default effect).

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/calendar/OperatorCalendar.tsx
git commit -m "feat(calendar): mobile calendar branch with mini month, Upcoming, and filter sheet"
```

---

### Task 6: Seeded visual verification + conformance pass

**Files:** none shipped (scratchpad SQL + screenshots only)

- [ ] **Step 1: Seed multi-status appointments for the smoke org in local Supabase**

Introspect first (`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c '\d appointments'`), then write a scratchpad SQL file that inserts, for the smoke org (org of `smoke-operator@test.local`): 3 bookings today (pending / confirmed / in_progress), 5 bookings on one day next week (forces the count swap), 1 booking with a passed `response_deadline` (overdue red), plus 2 scattered singles. Reuse the org's existing property/service/customer rows (create minimal ones if the org has none). Run with `psql -f`.

- [ ] **Step 2: Playwright screenshots at 390x844** (dev server, smoke-operator session)

Capture: (1) month landing view: today chip blue with white dots, dot days, the 5-booking count day, today's list below; (2) tap the 5-booking day: selected ring + list of 5; (3) tap an empty day: Nothing scheduled + Book this day; (4) Book this day → new-booking sheet opens with the date prefilled; (5) filter sheet open; (6) a filter applied: badge dot on funnel + dots/list shrink; (7) Upcoming view; (8) tap a booking row: detail sheet opens.

- [ ] **Step 3: Desktop regression screenshot at 1440x900**

Calendar page: toolbar, week view, month view all unchanged. Expected: identical to pre-change desktop.

- [ ] **Step 4: ui-ux-pro-max implementation-phase conformance pass**

Re-invoke the skill checklist against the built screens; then grep the four new files for leaks:
`grep -nE "#[0-9a-fA-F]{3,8}\b" src/components/redesign/calendar/MobileMonthView.tsx src/components/redesign/calendar/MobileCalendarBar.tsx src/components/redesign/calendar/CalendarFilterSheet.tsx src/components/redesign/calendar/monthCellSummary.ts`
Expected: no matches (no raw hex). Also verify: no em dashes in user-facing strings, touch targets ≥44px in the DOM.

- [ ] **Step 5: Full pre-push gates**

Run: `npm run test:unit` and `npm run lint` and the tsc grep from Task 5.
Expected: unit green; lint no new errors; tsc grep CLEAN.
(Full `npm run test` including integration is unreliable locally while sessions share Supabase; CI arbitrates.)

---

### Task 7: PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/mobile-calendar
gh pr create --base master --title "feat(calendar): mobile mini-month calendar for operators" --body "<summary + screenshots + spec/plan links>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Watch the four required checks** (`CI / typecheck + lint`, `CI / unit + integration`, `E2E (1/2)`, `E2E (2/2)`); fix and re-push if red. Hand to Bridger for merge.
