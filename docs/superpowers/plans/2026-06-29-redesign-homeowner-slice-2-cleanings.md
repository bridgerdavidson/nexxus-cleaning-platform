# Redesign Homeowner — Slice 2 (Cleanings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Prereq:** Build AFTER Slice 1b (PR #105) is on master; branch off current master. Reuses the 1a/1b `HomeownerCleaningHero` (incl. `LiveCleaningProgress` + `CompletedCleaningRecap`) unchanged.

**Goal:** Give the homeowner a **Cleanings** tab: a glanceable list grouped Upcoming / Past, and a deep-linkable full-screen detail takeover (`?appointment=<id>`) that reuses the live-tracking hero/recap, shows read-only booking details, and lets the homeowner **cancel their own upcoming cleaning with the cancellation fee disclosed before charging**.

**Architecture:** Mirror the cleaner Schedule pattern (Approach B): a pure derive + thin Container/View, a write-only open hook for the list, and a `useDetailParam`-driven detail **host mounted in the layout** (inside `Suspense`) so `?appointment=` opens the takeover from any tab and from notification deep-links. The detail reuses `HomeownerCleaningHero`. Cancel reuses the existing `/api/appointments/:id/cancel` route + the pure `computeCancellationFee` math; the route is extended (the only backend change) to let the **owning homeowner** cancel their own appointment (role + ownership check, `party` forced to `homeowner`). The cancel UI is built fresh from the design system (a vaul `Drawer`), not the legacy `CancelWithFeeModal`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (design tokens), Supabase (Postgres + RLS), TanStack Query, Vitest (unit + integration), Playwright/Vercel preview.

## UI implementation & styling source (boundary contract — read before building any screen)

The homeowner mockup (`docs/redesign/mockups/homeowner-shell.html`) and any companion sketches are **UX/structure reference ONLY**. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup, and do **not** import legacy pre-redesign components (e.g. `CancelWithFeeModal`, with its `bg-white`/`text-gray-*`/`primary-*` yellow styling) into redesign screens. Reuse legacy **logic/hooks/routes**; build presentation fresh. Status/urgency is carried by the **badge/pill vocabulary**, never decorative side-accents or stripes. `ui-ux-pro-max` runs again at implementation for design-system conformance (the catch-net for off-system leaks).

## Scope (and what is deliberately deferred)

In scope (spec §4 "Cleanings", §9 Slice 2):
- Cleanings list grouped **Upcoming** / **Past**, each a glanceable status card (descriptive badge, date pill, service, cleaner).
- Deep-linkable **detail takeover** (`?appointment=`) carrying the same lifecycle hero/live-tracking + completed recap as Home, plus read-only details (when, where/address, service, special requests, price) and a **Cancel cleaning** action.
- **Cancel with fee disclosure**: the confirm surfaces any cancellation fee before charging (late cancels trigger the off-session cancellation-fee charge).

**Deferred to Slice 3 (Messages), matching the cleaner-app precedent** (cleaner Slice 2 shipped Schedule + job-detail with NO messaging; messaging landed in cleaner Slice 5):
- **"Message office"** and **"Message about this cleaning"** actions in the detail. The homeowner office-thread/inbox infrastructure (conversations + `ChatThread` + takeover) is built in Slice 3; wiring the detail's message actions belongs there, where there is somewhere for them to land. Do **not** add a dead/placeholder "Message office" button in this slice.
- **Reschedule / request-change** — deferred per spec §8.

> **Why the backend change in this slice:** the spec §4 said "reuse the existing homeowner cancel/confirm path," but there is **no** homeowner cancel path today — `/api/appointments/:id/cancel` is gated to org staff (`allowedRoles: ['owner','admin','manager']`). Slice 2 adds the owning-homeowner path to that same route (Task 5), reusing the entire fee/charge/idempotency pipeline. This is the one backend change; there is **no migration** in this slice.

## Global Constraints

- **Design system only.** Build from `src/components/ui/*` + tokens (`brand-600/500/700`, `shadow-soft-*`, `rounded-card/control/pill`, `bg-card`, `text-muted-foreground`, semantic `positive/caution/critical`). **No raw hex.** Status carried by the `Badge`/pill vocabulary.
- **No em dashes** in user-facing copy (UI text, labels, buttons, toasts). Use periods, commas, parentheses, or "to" for ranges.
- **Reuse, don't reinvent:** `HomeownerCleaningHero` (Home/detail share it), the `home-presenters` (`homeownerStatusLabel`, `cleanerDisplayName`, `formatCleaningWhen`), `MobileTakeover`, `useDetailParam`, `computeCancellationFee`, the cleaner detail-host + open-hook patterns.
- **Do not edit legacy** `src/app/homeowner-dashboard/*` or `src/components/CancelWithFeeModal.tsx`. The redesign route group is additive and flag-gated.
- **Path alias** `@/*` → `./src/*`.
- **Gates before PR:** `npm run test`, `npx tsc --noEmit`, `npm run lint`; one Codex review before push (`/codex:review --scope branch --base master --wait`); visual verification on the Vercel preview as a homeowner.

## Testing approach
- **Unit (Vitest)** for the pure list derive (`deriveCleanings`): grouping + sort + empty.
- **Integration (Vitest + local Supabase)** for the cancel-route homeowner path: owner cancels own appointment (party forced homeowner); a different homeowner gets 403; an org-staff caller still works (regression).
- **Visual (preview)** for the Cleanings list, the detail takeover (upcoming / in-progress / complete states reusing the hero), and the cancel drawer fee disclosure.

## File structure

**Create:**
- `src/components/redesign/homeowner/cleanings/derive-cleanings.ts` — pure: group + sort appointments into Upcoming/Past.
- `src/components/redesign/homeowner/cleanings/derive-cleanings.test.ts`.
- `src/components/redesign/homeowner/cleanings/CleaningRow.tsx` — glanceable status card (button row).
- `src/components/redesign/homeowner/cleanings/useOpenCleaning.ts` — write-only `?appointment=<id>` setter (no searchParams read; no Suspense needed by the list).
- `src/components/redesign/homeowner/cleanings/HomeownerCleaningsView.tsx` — presentational list (sections + empty/skeleton).
- `src/components/redesign/homeowner/cleanings/HomeownerCleanings.tsx` — container (hooks + derive + open).
- `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx` — the detail takeover (MobileTakeover + hero + read-only fields + cancel action).
- `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetailHost.tsx` — reads `?appointment=`, finds the appointment, renders the detail.
- `src/components/redesign/homeowner/cleanings/CancelCleaningSheet.tsx` — fresh design-system cancel confirm (vaul `Drawer`) with fee disclosure.
- `src/hooks/useCancelMyCleaning.ts` — mutation: POST cancel + invalidate homeowner appointments.

**Modify:**
- `src/app/(redesign)/app/homeowner-dashboard/cleanings/page.tsx` — render `<HomeownerCleanings />`.
- `src/app/(redesign)/app/homeowner-dashboard/layout.tsx` — mount `<HomeownerCleaningDetailHost />` inside `<Suspense fallback={null}>`.
- `src/hooks/useHomeownerData.ts` — add `special_requests` to the `useHomeownerAppointments` SELECT + the `Appointment` interface (additive).
- `src/app/api/appointments/[appointmentId]/cancel/route.ts` — allow the owning homeowner (role + ownership check; force `party='homeowner'`, `no_show=false`).
- `src/app/api/appointments/[appointmentId]/cancel/route.integration.test.ts` — homeowner-path cases.

---

### Task 1: Cleanings list derive (pure) + tests

**Files:**
- Create: `src/components/redesign/homeowner/cleanings/derive-cleanings.ts`
- Test: `src/components/redesign/homeowner/cleanings/derive-cleanings.test.ts`

**Interfaces:**
- Consumes: `Appointment` from `@/hooks/useHomeownerData`.
- Produces:
  - `type CleaningSection = { key: 'upcoming' | 'past'; label: string; appointments: Appointment[] }`
  - `deriveCleanings(appointments: Appointment[]): { sections: CleaningSection[]; total: number; isEmpty: boolean }`
  - Grouping (status-based, mirrors the Home hero's status semantics): **Upcoming** = status in `pending | confirmed | in_progress`, sorted by `scheduled_date` then `scheduled_time` **ascending** (soonest first). **Past** = status in `completed | cancelled`, sorted by `scheduled_date` then `scheduled_time` **descending** (most recent first). Sections with zero appointments are omitted. `isEmpty` is true when there are no appointments at all.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { deriveCleanings } from './derive-cleanings';
import type { Appointment } from '@/hooks/useHomeownerData';

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a',
    scheduled_date: '2026-07-01',
    scheduled_time: '10:00:00',
    status: 'confirmed',
    total_price: 120,
    property: null,
    service_type: null,
    ...over,
  } as Appointment;
}

describe('deriveCleanings', () => {
  it('returns empty when there are no appointments', () => {
    const r = deriveCleanings([]);
    expect(r.isEmpty).toBe(true);
    expect(r.sections).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('splits Upcoming (pending/confirmed/in_progress) from Past (completed/cancelled)', () => {
    const r = deriveCleanings([
      appt({ id: 'p', status: 'pending' }),
      appt({ id: 'c', status: 'confirmed' }),
      appt({ id: 'ip', status: 'in_progress' }),
      appt({ id: 'done', status: 'completed' }),
      appt({ id: 'x', status: 'cancelled' }),
    ]);
    const upcoming = r.sections.find((s) => s.key === 'upcoming');
    const past = r.sections.find((s) => s.key === 'past');
    expect(upcoming?.appointments.map((a) => a.id).sort()).toEqual(['c', 'ip', 'p']);
    expect(past?.appointments.map((a) => a.id).sort()).toEqual(['done', 'x']);
    expect(r.total).toBe(5);
    expect(r.isEmpty).toBe(false);
  });

  it('sorts Upcoming ascending and Past descending by date then time', () => {
    const r = deriveCleanings([
      appt({ id: 'u-late', status: 'confirmed', scheduled_date: '2026-07-10', scheduled_time: '09:00:00' }),
      appt({ id: 'u-soon', status: 'confirmed', scheduled_date: '2026-07-02', scheduled_time: '09:00:00' }),
      appt({ id: 'u-soon-am', status: 'confirmed', scheduled_date: '2026-07-02', scheduled_time: '08:00:00' }),
      appt({ id: 'p-old', status: 'completed', scheduled_date: '2026-06-01', scheduled_time: '09:00:00' }),
      appt({ id: 'p-recent', status: 'completed', scheduled_date: '2026-06-20', scheduled_time: '09:00:00' }),
    ]);
    expect(r.sections.find((s) => s.key === 'upcoming')?.appointments.map((a) => a.id)).toEqual([
      'u-soon-am', 'u-soon', 'u-late',
    ]);
    expect(r.sections.find((s) => s.key === 'past')?.appointments.map((a) => a.id)).toEqual([
      'p-recent', 'p-old',
    ]);
  });

  it('omits a section that has no appointments', () => {
    const r = deriveCleanings([appt({ id: 'c', status: 'confirmed' })]);
    expect(r.sections.map((s) => s.key)).toEqual(['upcoming']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- derive-cleanings`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
import type { Appointment } from '@/hooks/useHomeownerData';

export type CleaningSectionKey = 'upcoming' | 'past';

export interface CleaningSection {
  key: CleaningSectionKey;
  label: string;
  appointments: Appointment[];
}

const UPCOMING_STATUSES = new Set<Appointment['status']>(['pending', 'confirmed', 'in_progress']);

const keyOf = (a: Appointment) => `${a.scheduled_date ?? ''} ${a.scheduled_time ?? ''}`;
const byWhenAsc = (a: Appointment, b: Appointment) => keyOf(a).localeCompare(keyOf(b));
const byWhenDesc = (a: Appointment, b: Appointment) => -byWhenAsc(a, b);

export function deriveCleanings(appointments: Appointment[]): {
  sections: CleaningSection[];
  total: number;
  isEmpty: boolean;
} {
  const upcoming = appointments.filter((a) => UPCOMING_STATUSES.has(a.status)).sort(byWhenAsc);
  const past = appointments.filter((a) => !UPCOMING_STATUSES.has(a.status)).sort(byWhenDesc);

  const sections: CleaningSection[] = [];
  if (upcoming.length) sections.push({ key: 'upcoming', label: 'Upcoming', appointments: upcoming });
  if (past.length) sections.push({ key: 'past', label: 'Past', appointments: past });

  return { sections, total: appointments.length, isEmpty: appointments.length === 0 };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test -- derive-cleanings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner/cleanings/derive-cleanings.ts src/components/redesign/homeowner/cleanings/derive-cleanings.test.ts
git commit -m "feat(redesign): homeowner cleanings list derive (upcoming/past)"
```

---

### Task 2: CleaningRow card

**Files:**
- Create: `src/components/redesign/homeowner/cleanings/CleaningRow.tsx`

**Interfaces:**
- Consumes: `Appointment`, the `home-presenters` (`homeownerStatusLabel`, `cleanerDisplayName`, `formatCleaningWhen`), `Badge`.
- Produces: `<CleaningRow appointment={Appointment} onClick={() => void} />` — a full-width tappable card (button) showing the service name, date pill, status badge, address line, and cleaner name. Reuses the same tone→variant mapping the hero uses.

- [ ] **Step 1: Implement the card.** (No raw hex; build from `bg-card` + tokens. The whole row is a `button` for a large touch target.)

```tsx
'use client';

import type { Appointment } from '@/hooks/useHomeownerData';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import {
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
} from '../home/home-presenters';

const TONE_TO_VARIANT = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
} as const;

export function CleaningRow({
  appointment,
  onClick,
}: {
  appointment: Appointment;
  onClick: () => void;
}) {
  const { label, tone } = homeownerStatusLabel(appointment.status);
  const cleaner = cleanerDisplayName(appointment);
  const where = appointment.property?.address ?? appointment.property?.name ?? 'Your home';
  const service = appointment.service_type?.name ?? 'Cleaning';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold">{service}</span>
          <Badge variant={TONE_TO_VARIANT[tone]} className="shrink-0">
            {label}
          </Badge>
        </div>
        <p className="mt-1 text-sm font-medium tabular-nums text-muted-foreground">
          {formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time)}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {where}
          {cleaner ? ` · ${cleaner}` : ''}
        </p>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
    </button>
  );
}
```

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero new errors. (If `Badge` has no `positive/caution/critical` variant, confirm against `src/components/ui/badge.tsx` — the hero already uses these variants, so they exist.)

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/homeowner/cleanings/CleaningRow.tsx
git commit -m "feat(redesign): homeowner cleaning row card"
```

---

### Task 3: Cleanings list (container + view) + open hook + page wiring

**Files:**
- Create: `src/components/redesign/homeowner/cleanings/useOpenCleaning.ts`
- Create: `src/components/redesign/homeowner/cleanings/HomeownerCleaningsView.tsx`
- Create: `src/components/redesign/homeowner/cleanings/HomeownerCleanings.tsx`
- Modify: `src/app/(redesign)/app/homeowner-dashboard/cleanings/page.tsx`

**Interfaces:**
- Consumes: `useHomeownerAppointments`, `deriveCleanings`, `CleaningRow`.
- Produces: `<HomeownerCleanings />` (default-exportable wrapper), `useOpenCleaning(): (id: string) => void`.

- [ ] **Step 1: Write the write-only open hook** (mirror `useOpenJob`; sets `?appointment=` on the current path; reads no search params, so the list needs no Suspense boundary).

```ts
'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Open the cleaning-detail takeover by setting `?appointment=<id>` on the
 * current path. Uses router.replace (no scroll) so closing restores list state;
 * reads no search params, so callers need no Suspense boundary (matches useOpenJob). */
export function useOpenCleaning(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?appointment=${id}`, { scroll: false }),
    [router, pathname],
  );
}
```

- [ ] **Step 2: Write the presentational view** (sections + skeleton + empty; build from `ui/*`).

```tsx
'use client';

import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { Appointment } from '@/hooks/useHomeownerData';
import type { CleaningSection } from './derive-cleanings';
import { CleaningRow } from './CleaningRow';

export function HomeownerCleaningsView({
  sections,
  isEmpty,
  loading,
  onOpen,
}: {
  sections: CleaningSection[];
  isEmpty: boolean;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3 pt-1">
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="pt-10">
        <EmptyState
          icon={<CalendarDays />}
          title="No cleanings yet"
          description="When you request a cleaning, it will show up here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-1">
      {sections.map((section) => (
        <section key={section.key}>
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <h2 className="text-sm font-bold">{section.label}</h2>
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              {section.appointments.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {section.appointments.map((a: Appointment) => (
              <CleaningRow key={a.id} appointment={a} onClick={() => onOpen(a.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write the container.**

```tsx
'use client';

import { useMemo } from 'react';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { deriveCleanings } from './derive-cleanings';
import { HomeownerCleaningsView } from './HomeownerCleaningsView';
import { useOpenCleaning } from './useOpenCleaning';

export function HomeownerCleanings() {
  const { appointments, loading } = useHomeownerAppointments();
  const open = useOpenCleaning();
  const { sections, isEmpty } = useMemo(() => deriveCleanings(appointments), [appointments]);

  return (
    <HomeownerCleaningsView
      sections={sections}
      isEmpty={isEmpty}
      loading={loading}
      onOpen={open}
    />
  );
}
```

- [ ] **Step 4: Wire the page.**

```tsx
import { HomeownerCleanings } from '@/components/redesign/homeowner/cleanings/HomeownerCleanings';

export default function CleaningsPage() {
  return <HomeownerCleanings />;
}
```

- [ ] **Step 5: tsc + lint + unit**

Run: `npx tsc --noEmit && npm run lint && npm run test -- derive-cleanings`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/homeowner/cleanings/useOpenCleaning.ts src/components/redesign/homeowner/cleanings/HomeownerCleaningsView.tsx src/components/redesign/homeowner/cleanings/HomeownerCleanings.tsx "src/app/(redesign)/app/homeowner-dashboard/cleanings/page.tsx"
git commit -m "feat(redesign): homeowner Cleanings list (upcoming/past)"
```

---

### Task 4: Cleaning detail takeover (read-only) + host + layout mount + special_requests

**Files:**
- Modify: `src/hooks/useHomeownerData.ts` (add `special_requests` to the SELECT + `Appointment` type)
- Create: `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx`
- Create: `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetailHost.tsx`
- Modify: `src/app/(redesign)/app/homeowner-dashboard/layout.tsx`

**Interfaces:**
- Consumes: `MobileTakeover`, `HomeownerCleaningHero`, `useDetailParam`, `useHomeownerAppointments`, the `home-presenters`, `Appointment` (now with `special_requests`).
- Produces: `<HomeownerCleaningDetailHost />` (reads `?appointment=`), `<HomeownerCleaningDetail appointment loading onClose />`. Cancel is added in Task 6 (this task ships the read-only takeover).

- [ ] **Step 1: Add `special_requests` to the homeowner appointments query.** In `src/hooks/useHomeownerData.ts`, add `special_requests` to the `.select(...)` template (additive, alongside `status, total_price, ...`) and to the `Appointment` interface:

```ts
// In the Appointment interface (after total_price):
  special_requests?: string | null;
```

```ts
// In the .select(`...`) string, add the column on its own line (e.g. after total_price,):
//   special_requests,
```

- [ ] **Step 2: Build the read-only detail takeover.** Uses `MobileTakeover` (read-only: `keyboardAware={false}`). Header with a back button, then the shared hero, then read-only fields. (`onCancel` is wired in Task 6; this task renders the takeover without the cancel action.)

```tsx
'use client';

import { ChevronLeft } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { CalendarX } from 'lucide-react';
import type { Appointment } from '@/hooks/useHomeownerData';
import { HomeownerCleaningHero } from '../HomeownerCleaningHero';
import { formatCleaningWhen } from '../home/home-presenters';

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function HomeownerCleaningDetail({
  appointment,
  loading,
  onClose,
}: {
  appointment: Appointment | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <MobileTakeover ariaLabel="Cleaning details" keyboardAware={false} onClosed={onClose}>
      {(close) => (
        <>
          <div className="flex items-center gap-2 border-b border-border px-2">
            <button
              onClick={close}
              aria-label="Back"
              className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-6" />
            </button>
            <div className="min-w-0 flex-1 py-2">
              <div className="truncate text-sm font-bold">
                {appointment?.service_type?.name ?? 'Cleaning'}
              </div>
            </div>
            <div className="w-1" />
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              {loading && !appointment ? (
                <>
                  <Skeleton className="h-40 w-full rounded-card" />
                  <Skeleton className="h-16 w-full rounded-card" />
                </>
              ) : !appointment ? (
                <div className="pt-10">
                  <EmptyState
                    icon={<CalendarX />}
                    title="Cleaning not available"
                    description="This cleaning may have been removed or is no longer on your account."
                  />
                </div>
              ) : (
                <>
                  <HomeownerCleaningHero appointment={appointment} />

                  <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                    <div className="space-y-4">
                      <Field label="When">
                        {formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time)}
                      </Field>
                      <Separator />
                      <Field label="Where">
                        <div className="font-semibold">
                          {appointment.property?.name ?? 'Your home'}
                        </div>
                        {appointment.property?.address && (
                          <div className="text-muted-foreground">
                            {appointment.property.address}
                            {appointment.property.city ? `, ${appointment.property.city}` : ''}
                            {appointment.property.state ? `, ${appointment.property.state}` : ''}
                          </div>
                        )}
                      </Field>
                      <Separator />
                      <Field label="Service">
                        <div className="font-semibold">
                          {appointment.service_type?.name ?? 'Cleaning'}
                        </div>
                        {appointment.checklist?.name && (
                          <div className="text-muted-foreground">{appointment.checklist.name}</div>
                        )}
                      </Field>
                      {appointment.special_requests && (
                        <>
                          <Separator />
                          <Field label="Special requests">{appointment.special_requests}</Field>
                        </>
                      )}
                      <Separator />
                      <Field label="Price">
                        <span className="font-semibold tabular-nums">
                          {formatUsd(appointment.total_price)}
                        </span>
                      </Field>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </MobileTakeover>
  );
}
```

- [ ] **Step 3: Build the host** (mirror `CleanerJobDetailHost`; uses `useDetailParam("appointment")`).

```tsx
'use client';

import { useDetailParam } from '@/hooks/useDetailParam';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { HomeownerCleaningDetail } from './HomeownerCleaningDetail';

export function HomeownerCleaningDetailHost() {
  const { paramId, setParam } = useDetailParam('appointment');
  const { appointments, loading } = useHomeownerAppointments();

  if (!paramId) return null;
  const appointment = appointments.find((a) => a.id === paramId) ?? null;

  return (
    <HomeownerCleaningDetail
      key={paramId}
      appointment={appointment}
      loading={loading}
      onClose={() => setParam(null)}
    />
  );
}
```

- [ ] **Step 4: Mount the host in the layout** (inside `Suspense`, mirroring the cleaner layout — `useDetailParam` reads search params). In `src/app/(redesign)/app/homeowner-dashboard/layout.tsx`:
  - Add `Suspense` to the `react` import: `import { type ReactNode, Suspense, useEffect } from "react";`
  - Import the host: `import { HomeownerCleaningDetailHost } from "@/components/redesign/homeowner/cleanings/HomeownerCleaningDetailHost";`
  - Change the final `return <HomeownerShell>{children}</HomeownerShell>;` to:

```tsx
  return (
    <>
      <HomeownerShell>{children}</HomeownerShell>
      <Suspense fallback={null}>
        <HomeownerCleaningDetailHost />
      </Suspense>
    </>
  );
```

- [ ] **Step 5: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useHomeownerData.ts src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx src/components/redesign/homeowner/cleanings/HomeownerCleaningDetailHost.tsx "src/app/(redesign)/app/homeowner-dashboard/layout.tsx"
git commit -m "feat(redesign): homeowner cleaning detail takeover (deep-linkable ?appointment=)"
```

---

### Task 5: Cancel route — allow the owning homeowner (backend)

**Files:**
- Modify: `src/app/api/appointments/[appointmentId]/cancel/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/cancel/route.integration.test.ts`

**Interfaces:**
- Produces: `POST /api/appointments/:id/cancel` now also accepts a caller whose org role is `homeowner`, **only** when they own the appointment (`appt.homeowner_id === caller.userId`); for that caller the server **forces** `party='homeowner'` and `no_show=false` (ignoring any client-supplied `party`/`no_show`, so a homeowner cannot dodge the fee by claiming a cleaner-caused cancel or mark themselves a no-show). Org-staff behavior is unchanged.

- [ ] **Step 1: Read the route** (`src/app/api/appointments/[appointmentId]/cancel/route.ts`) and confirm the current shape: it calls `requireOrgAuth(request, organization_id, supabaseAdmin, { allowedRoles: ['owner','admin','manager'] })`, then loads `appt` (which includes `homeowner_id`), then computes the fee from `party`/`no_show`. The change is surgical: widen the allowed roles and, for a homeowner caller, enforce ownership + override `party`/`no_show` **after** `appt` is loaded.

- [ ] **Step 2: Write the failing integration tests.** Mirror the existing `route.integration.test.ts` in the same folder (its `callRoute`/`withTestOrg`/`createTestAppointment`/bearer-header pattern — read it first and match helpers exactly). Add three cases:

```ts
// Add to src/app/api/appointments/[appointmentId]/cancel/route.integration.test.ts
// (mirror the existing imports + setup in this file; these are illustrative names —
//  match the file's actual helpers).

it('lets the owning homeowner cancel their own appointment (party forced to homeowner)', async () => {
  const org = await withTestOrg();
  const appt = await createTestAppointment({
    organizationId: org.organizationId,
    homeownerId: org.homeowner.userId,
    cleanerId: org.cleaner.userId,
    status: 'confirmed',
  });
  // Homeowner tries to claim a cleaner-caused (free) cancel; the server must ignore party.
  const res = await callRoute(POST, {
    params: { appointmentId: appt.id },
    token: org.homeowner.accessToken,
    body: { organization_id: org.organizationId, party: 'cleaner', no_show: false },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.cancelled).toBe(true);
  // Appointment is cancelled.
  const admin = createTestSupabaseClient();
  const { data } = await admin.from('appointments').select('status').eq('id', appt.id).single();
  expect(data?.status).toBe('cancelled');
  await org.cleanup();
});

it('forbids a homeowner cancelling a different homeowner\'s appointment', async () => {
  const org = await withTestOrg();
  const other = await withTestOrg();
  const appt = await createTestAppointment({
    organizationId: org.organizationId,
    homeownerId: org.homeowner.userId,
    cleanerId: org.cleaner.userId,
    status: 'confirmed',
  });
  const res = await callRoute(POST, {
    params: { appointmentId: appt.id },
    token: other.homeowner.accessToken, // not a member of org, or not the owner
    body: { organization_id: org.organizationId, party: 'homeowner' },
  });
  expect([403, 404]).toContain(res.status);
  await Promise.all([org.cleanup(), other.cleanup()]);
});

it('still lets org staff cancel (regression)', async () => {
  const org = await withTestOrg();
  const appt = await createTestAppointment({
    organizationId: org.organizationId,
    homeownerId: org.homeowner.userId,
    cleanerId: org.cleaner.userId,
    status: 'confirmed',
  });
  const res = await callRoute(POST, {
    params: { appointmentId: appt.id },
    token: org.owner.accessToken,
    body: { organization_id: org.organizationId, party: 'org' },
  });
  expect(res.status).toBe(200);
  await org.cleanup();
});
```

> The cancel route returns 404 when `!stripeEnabled() || !stripeNewChargeFlowEnabled()`. The integration env must have both flags on for these tests (the existing cancel tests already run against that env; match their setup). If the existing test file sets the flags via env/helper, reuse that exact mechanism.

- [ ] **Step 3: Run the tests, verify the homeowner cases fail** (the owning-homeowner call currently 403s on role).

Run: `npm run test:integration -- cancel`
Expected: the new homeowner-allow + party-forcing cases FAIL; the org-staff regression passes.

- [ ] **Step 4: Implement the route change.** In `route.ts`:

  a. Widen the allowed roles:

```ts
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'homeowner'],
    });
    if (!auth.ok) return auth.response;
```

  b. After `appt` is loaded and the `if (!appt || appt.organization_id !== organization_id)` 404 guard, add the homeowner ownership + override block, and make `party`/`no_show` effective variables used by the fee computation:

```ts
    // A homeowner caller may only cancel their OWN appointment, and always as the
    // homeowner party (never as cleaner/org to dodge the fee, never a self-declared
    // no-show). Org staff keep the client-supplied party/no_show.
    let effectiveParty = party;
    let effectiveNoShow = no_show;
    if (auth.role === 'homeowner') {
      if (appt.homeowner_id !== auth.userId) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }
      effectiveParty = 'homeowner';
      effectiveNoShow = false;
    }
```

  c. Replace the two uses of `party` / `no_show` in the fee computation + the `recordPaymentEvent` payloads + the `chargeCancellationFee` call with `effectiveParty` / `effectiveNoShow`. Specifically:
   - `computeCancellationFee({ party: effectiveParty, noShow: effectiveNoShow, ... })`
   - the `appointment_cancelled` / `cancelled_with_inflight_debit` event payloads: `{ party: effectiveParty, no_show: effectiveNoShow, ... }`
   - `chargeCancellationFee(..., { party: effectiveParty, noShow: effectiveNoShow, insideWindow })`

> Do not change any other behavior. The `cancellation_reason` still comes from `reason`. Self-pay / completed / in-flight-debit fee skips are unchanged (a homeowner can still cancel a confirmed/pending job; the fee math decides the charge).

- [ ] **Step 5: Run the tests, verify they pass**

Run: `npm run test:integration -- cancel`
Expected: PASS (homeowner-allow, party-forced, 403-for-others, org-staff regression).

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/appointments/[appointmentId]/cancel/route.ts" "src/app/api/appointments/[appointmentId]/cancel/route.integration.test.ts"
git commit -m "feat(redesign): allow owning homeowner to cancel their own appointment (party forced)"
```

---

### Task 6: useCancelMyCleaning hook + CancelCleaningSheet (fee disclosure) + wire into detail

**Files:**
- Create: `src/hooks/useCancelMyCleaning.ts`
- Create: `src/components/redesign/homeowner/cleanings/CancelCleaningSheet.tsx`
- Modify: `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx` (add the Cancel action + sheet)

**Interfaces:**
- Consumes: `getAccessToken` (`@/lib/auth/clientAccessToken`), `useAuth().currentOrganizationId`, `computeCancellationFee`, `stripeNewChargeFlowUiEnabled`, `Drawer*` (`@/components/ui/drawer`), `Button`, `useMutation`/`useQueryClient`, `keys.appointments.byHomeowner`, the repo toast hook (match `useCleanerData.ts` mutations).
- Produces:
  - `useCancelMyCleaning(): { cancel: (appointmentId: string, reason?: string) => Promise<void>; isPending: boolean }`
  - `<CancelCleaningSheet open onOpenChange appointment onCancelled />`

- [ ] **Step 1: Implement the mutation hook.** POST the cancel route as the homeowner (server forces party). Invalidate the homeowner appointments + stats so the list/detail reflect the cancel.

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { keys } from '@/lib/queryKeys';

export function useCancelMyCleaning() {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ appointmentId, reason }: { appointmentId: string; reason?: string }) => {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // party/no_show are forced server-side for a homeowner caller; we send org id only.
        body: JSON.stringify({ organization_id: currentOrganizationId, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.details || 'Cancellation failed');
      return data as { fee_captured_cents?: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.appointments.byHomeowner(userId) });
      queryClient.invalidateQueries({ queryKey: keys.stats.homeowner(userId) });
    },
  });

  return {
    cancel: async (appointmentId: string, reason?: string) => {
      await mutation.mutateAsync({ appointmentId, reason });
    },
    isPending: mutation.isPending,
  };
}
```

- [ ] **Step 2: Implement the cancel sheet** (vaul `Drawer`; computes + discloses the fee from the org policy before charging). Build entirely from the design system.

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { computeCancellationFee } from '@/lib/payments/cancellationFee';
import type { Appointment } from '@/hooks/useHomeownerData';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useCancelMyCleaning } from '@/hooks/useCancelMyCleaning';

type FeeType = 'none' | 'flat' | 'percent';

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function CancelCleaningSheet({
  open,
  onOpenChange,
  appointment,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  onCancelled: () => void;
}) {
  const { currentOrganizationId } = useAuth();
  const { cancel, isPending } = useCancelMyCleaning();
  const [error, setError] = useState<string | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policy, setPolicy] = useState<{ windowHours: number; feeType: FeeType; feeValue: number }>({
    windowHours: 24,
    feeType: 'none',
    feeValue: 0,
  });

  // Load the org cancellation policy to preview the fee (mirrors the operator modal's read).
  useEffect(() => {
    if (!open || !currentOrganizationId) return;
    setError(null);
    let cancelled = false;
    (async () => {
      setPolicyLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as {
        cancellation_window_hours?: number;
        cancellation_fee_type?: FeeType;
        cancellation_fee_value?: number;
      };
      setPolicy({
        windowHours: Number(row.cancellation_window_hours ?? 24),
        feeType: (row.cancellation_fee_type as FeeType) ?? 'none',
        feeValue: Number(row.cancellation_fee_value ?? 0),
      });
      setPolicyLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentOrganizationId]);

  const preview = useMemo(
    () =>
      computeCancellationFee({
        party: 'homeowner',
        noShow: false,
        grossCents: Math.round(appointment.total_price * 100),
        windowHours: policy.windowHours,
        feeType: policy.feeType,
        feeValue: policy.feeValue,
        scheduledDate: appointment.scheduled_date,
        scheduledTime: appointment.scheduled_time,
      }),
    [appointment.total_price, appointment.scheduled_date, appointment.scheduled_time, policy],
  );

  const fee = preview.feeCents;

  async function submit() {
    setError(null);
    try {
      await cancel(appointment.id);
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancellation failed');
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Cancel this cleaning?</DrawerTitle>
          <DrawerDescription>
            {policyLoading
              ? 'Checking your cancellation policy.'
              : fee > 0
                ? `Cancelling now is within ${policy.windowHours} hours of your appointment, so a ${formatUsd(fee)} cancellation fee applies. Your card on file will be charged ${formatUsd(fee)}.`
                : 'You can cancel this cleaning at no charge.'}
          </DrawerDescription>
        </DrawerHeader>

        {fee > 0 && !policyLoading && (
          <div className="mx-5 mb-1 flex items-center justify-between rounded-control bg-caution-50 px-4 py-3 text-sm">
            <span className="font-medium text-caution-700">Cancellation fee</span>
            <span className="font-bold tabular-nums text-caution-700">{formatUsd(fee)}</span>
          </div>
        )}

        {error && <p className="px-5 text-sm text-critical-600">{error}</p>}

        <DrawerFooter>
          <Button variant="destructive" loading={isPending} disabled={policyLoading} onClick={submit}>
            {fee > 0 ? `Cancel and pay ${formatUsd(fee)}` : 'Cancel cleaning'}
          </Button>
          <Button variant="ghost" disabled={isPending} onClick={() => onOpenChange(false)}>
            Keep my cleaning
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
```

> **Verify before finalizing:** (1) the semantic token names `caution-50/caution-700/critical-600` exist in the theme (the cleaner Schedule uses `caution-50/caution-700`, so they do; confirm `critical-600` or use `critical-700` to match what `badge.tsx` uses). (2) That a **homeowner can read** the three `organizations.cancellation_*` columns under RLS (org members generally can read their org row). If that read is blocked, fall back to generic disclosure copy ("A cancellation fee may apply per your provider's policy.") and rely on the route's returned `fee_captured_cents` for the post-cancel toast — do not block the cancel on the preview.

- [ ] **Step 3: Wire the Cancel action into the detail.** In `HomeownerCleaningDetail.tsx`:
  - Add imports: `useState`, `Button` (`@/components/ui/button`), `stripeNewChargeFlowUiEnabled` (`@/lib/stripe/flags`), `CancelCleaningSheet`.
  - Add local state `const [cancelOpen, setCancelOpen] = useState(false);`.
  - Compute `const canCancel = !!appointment && stripeNewChargeFlowUiEnabled() && (appointment.status === 'pending' || appointment.status === 'confirmed');` (cancel only an upcoming, not-yet-started cleaning).
  - Below the details card (still inside the `appointment` branch), render the action + sheet:

```tsx
{canCancel && appointment && (
  <>
    <Button
      variant="outline"
      className="w-full text-critical-600"
      onClick={() => setCancelOpen(true)}
    >
      Cancel cleaning
    </Button>
    <CancelCleaningSheet
      open={cancelOpen}
      onOpenChange={setCancelOpen}
      appointment={appointment}
      onCancelled={close}
    />
  </>
)}
```

> `onCancelled={close}` closes the takeover after a successful cancel; the homeowner appointments query is already invalidated by the hook, so the list reflects the cancellation. (`close` is the render-prop arg already in scope.)

- [ ] **Step 4: tsc + lint + unit**

Run: `npx tsc --noEmit && npm run lint && npm run test -- derive-cleanings`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCancelMyCleaning.ts src/components/redesign/homeowner/cleanings/CancelCleaningSheet.tsx src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx
git commit -m "feat(redesign): homeowner cancel-cleaning with fee disclosure"
```

---

## Pre-PR

- [ ] `npm run test` (unit + integration) green; `npx tsc --noEmit`; `npm run lint`.
- [ ] **Conformance pass (`ui-feature-workflow` + `ui-ux-pro-max` at implementation):** no raw hex; list cards, badges, detail fields, and cancel drawer all use tokens + existing primitives; no legacy `CancelWithFeeModal`/`primary-*` yellow leaked in; no em dashes in copy; touch targets >= 44px (the row is a full card button; the back button is `size-11`).
- [ ] One Codex review (`/codex:review --scope branch --base master --wait`); apply valid fixes (auto-apply per repo workflow).
- [ ] Push + PR to master with green CI. Verify on the Vercel preview as a homeowner:
  - Cleanings list groups Upcoming / Past, taps open the detail takeover.
  - Detail reuses the hero across states (confirmed / in-progress live tracking / completed recap) and shows when/where/service/special-requests/price.
  - Deep-link: visiting `/app/homeowner-dashboard?appointment=<id>` (the notification target) opens the detail from the Home tab.
  - Cancel: drawer discloses the fee (or "no charge"), confirming cancels the cleaning and closes the takeover; a late cancel charges the disclosed fee.

## Self-review (done while writing)
- **Spec coverage (spec §4 Cleanings + §9 Slice 2):** list grouped Upcoming/Past (Task 1+3), glanceable status card with badge/date/service/cleaner (Task 2), deep-linkable `?appointment=` detail takeover reusing hero/tracking/recap (Task 4, reuses 1a/1b `HomeownerCleaningHero`), read-only property/address + special requests + price/receipt (Task 4), cancel with fee disclosure before charging (Tasks 5+6). "Message office" / "Message about this cleaning" + reschedule are explicitly deferred (Scope section) per the cleaner-app precedent and spec §8 — flagged, not silently dropped.
- **Backend-gap correction:** the spec assumed a homeowner cancel path; there is none (route is org-staff-only). Task 5 adds the owning-homeowner path to the SAME route, reusing the whole fee/charge pipeline, with security tests (ownership + party-forcing + staff regression). No migration this slice.
- **Placeholder scan:** no TBD; every code step has real code. The two "verify against the real file" notes (cancel route shape in Task 5; toast hook + token names + homeowner org-RLS in Task 6) point at concrete files because they cross unchanged code, with documented fallbacks.
- **Type consistency:** `deriveCleanings` returns `{ sections, total, isEmpty }` used identically in Tasks 1 and 3; `CleaningSection` shape consistent; `HomeownerCleaningDetail({ appointment, loading, onClose })` consistent across Tasks 4 and 6; `useCancelMyCleaning(): { cancel, isPending }` consistent across Tasks 6 steps; `CancelCleaningSheet({ open, onOpenChange, appointment, onCancelled })` consistent.
- **Risks flagged for the build:** homeowner RLS read of the org cancellation policy (Task 6 fallback); exact `critical-*` token shade (Task 6 verify); the cancel route's `stripeNewChargeFlowEnabled` 404 gate (the UI gates the button on `stripeNewChargeFlowUiEnabled()` so it never shows a dead action; integration tests run with the flag on).
