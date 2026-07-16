# R9/R10 Booking-Sheet Photos + Routing History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two view-only Collapsible sections to the operator BookingDetailSheet: phase-grouped job photos with a themed lightbox (R9), and a cleaner-assignment routing timeline (R10).

**Architecture:** Pure view-model helpers in `src/lib/bookings/` (unit-tested), one new `ui/timeline.tsx` primitive, one new thin TanStack hook for `appointment_routing_log`, two self-contained section components that own their own `<Separator/>` and hide themselves when irrelevant, and a two-line insertion into `BookingDetailSheet`. No API routes, no migration, no feature flag, no new dependencies.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 tokens, TanStack Query v5, supabase-js (client-side reads under existing RLS), `yet-another-react-lightbox` (already installed), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-r9-r10-photos-routing-history-design.md` (read it first).

**Working directory:** the worktree `/Users/bridgerdavidson/Builds/nexxus-cleaning-platform/.claude/worktrees/r9-r10-photos-routing`, branch `feat/booking-photos-routing`. Never touch the main checkout (another session owns it).

## Global Constraints

- No em dashes (`—`) in any user-facing copy (labels, empty states, error text). Use `·` separators or commas.
- No raw hex / off-system styling in components: Tailwind token classes and `src/components/ui/*` primitives only. Arbitrary values are allowed for geometry (e.g. `-left-[21px]`), never for colors.
- Path alias `@/*` → `./src/*`.
- No new npm dependencies. No migrations. No feature flag for these sections.
- `cleaner_id` on `appointment_routing_log` has **no FK** — never write a PostgREST embed for it; names come from the `cleanerOptions` prop.
- Commit every task; end every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates for every task: the named tests pass, `npx tsc --noEmit` introduces no NEW errors (baseline: 12 pre-existing), changed files are eslint-clean (`npx eslint <changed files>`).

## Pre-existing interfaces you will consume (verified 2026-07-16)

- `Collapsible` (`src/components/ui/collapsible.tsx`): `{ title: ReactNode; defaultOpen?: boolean; right?: ReactNode; children }`. Collapsed by default.
- `Badge` (`src/components/ui/badge.tsx`): variants `default | secondary | outline | positive | caution | critical | info`.
- `ErrorState` (`src/components/ui/error-state.tsx`): `{ icon?, title?, description?, onRetry?, action? }`.
- `Skeleton` (`src/components/ui/skeleton.tsx`): div with `animate-pulse rounded-control bg-muted`, style via `className`.
- `JobPhoto`, `useJobPhotosForAppointment(appointmentId: string | null)` (`src/hooks/useCleanerData.ts:929-985`): returns `{ beforePhotos, afterPhotos, allPhotos, loading, error, refetch }`; `JobPhoto = { id: string; photo_url: string; photo_type: 'before' | 'after' | 'during'; uploaded_at: string }`. Query ordered `uploaded_at` ascending.
- `keys.appointments.routingLog(appointmentId)` (`src/lib/queryKeys.ts:12-13`) **already exists and has no consumer** — use it, do not add a new key.
- `useOrgQuery` (`src/lib/useOrgQuery.ts`): call as `useOrgQuery({ queryKey, enabled, queryFn: async () => {...} })` (see `useJobPhotosForAppointment` for the exact pattern).
- `CleanerOption = { id: string; name: string }` and `BookingStatusKey = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'` (`src/components/redesign/bookings/bookings-types.ts`).
- `JobPhotoLightbox` (`src/components/JobPhotoLightbox.tsx`): default export, props `{ photos: JobPhoto[]; open: boolean; index: number; onClose: () => void; appointmentId: string }`.
- `appointment_routing_log` columns: `id, appointment_id, cleaner_id, attempt_index (smallint), sent_at, deadline_at, response ('pending'|'accepted'|'declined'|'expired'), responded_at, decline_reason, slot_index_chosen, created_at`. RLS SELECT is already granted to org owner/admin/manager (migration 059/076; `is_admin_or_manager_in_org` includes `owner`).
- `date-fns` `format` is already a dependency (see JobPhotoLightbox).

---

### Task 1: Job-photos view-model helpers

**Files:**
- Create: `src/lib/bookings/jobPhotosVm.ts`
- Test: `src/lib/bookings/jobPhotosVm.test.ts`

**Interfaces:**
- Consumes: `JobPhoto` type from `@/hooks/useCleanerData`.
- Produces (Task 5 relies on these exact names):
  - `PHASE_LABEL: Record<JobPhoto['photo_type'], string>`
  - `groupJobPhotos(photos: JobPhoto[]): Array<{ phase: JobPhoto['photo_type']; label: string; photos: JobPhoto[] }>`
  - `orderPhotosForLightbox(photos: JobPhoto[]): JobPhoto[]`
  - `photoAltText(phase: JobPhoto['photo_type'], indexInPhase: number, phaseTotal: number): string`
  - `shouldShowJobPhotos(args: { photoCount: number; photosSkipped: boolean; status: string }): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/bookings/jobPhotosVm.test.ts
import { describe, expect, it } from 'vitest';
import type { JobPhoto } from '@/hooks/useCleanerData';
import {
  groupJobPhotos,
  orderPhotosForLightbox,
  photoAltText,
  shouldShowJobPhotos,
} from './jobPhotosVm';

const photo = (id: string, photo_type: JobPhoto['photo_type']): JobPhoto => ({
  id,
  photo_type,
  photo_url: `https://example.test/${id}.jpg`,
  uploaded_at: '2026-07-15T10:00:00Z',
});

describe('groupJobPhotos', () => {
  it('groups in before -> during -> after order and drops empty phases', () => {
    const groups = groupJobPhotos([photo('a1', 'after'), photo('b1', 'before'), photo('a2', 'after')]);
    expect(groups.map((g) => g.phase)).toEqual(['before', 'after']);
    expect(groups[0].label).toBe('Before');
    expect(groups[1].photos.map((p) => p.id)).toEqual(['a1', 'a2']);
  });

  it('includes during only when present', () => {
    const groups = groupJobPhotos([photo('d1', 'during')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('During');
  });

  it('returns empty array for no photos', () => {
    expect(groupJobPhotos([])).toEqual([]);
  });
});

describe('orderPhotosForLightbox', () => {
  it('flattens phases in before -> during -> after order, stable within a phase', () => {
    const ordered = orderPhotosForLightbox([
      photo('a1', 'after'),
      photo('b1', 'before'),
      photo('d1', 'during'),
      photo('b2', 'before'),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(['b1', 'b2', 'd1', 'a1']);
  });
});

describe('photoAltText', () => {
  it('names the phase and position', () => {
    expect(photoAltText('before', 1, 3)).toBe('Before photo 2 of 3');
    expect(photoAltText('after', 0, 1)).toBe('After photo 1 of 1');
  });
});

describe('shouldShowJobPhotos', () => {
  it('shows when photos exist regardless of status', () => {
    expect(shouldShowJobPhotos({ photoCount: 2, photosSkipped: false, status: 'pending' })).toBe(true);
  });
  it('shows when photos were skipped', () => {
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: true, status: 'pending' })).toBe(true);
  });
  it('shows the empty state for started and completed jobs', () => {
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'in_progress' })).toBe(true);
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'completed' })).toBe(true);
  });
  it('hides for future bookings with nothing to show', () => {
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'pending' })).toBe(false);
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'confirmed' })).toBe(false);
    expect(shouldShowJobPhotos({ photoCount: 0, photosSkipped: false, status: 'cancelled' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/lib/bookings/jobPhotosVm.test.ts`
Expected: FAIL — cannot resolve `./jobPhotosVm`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/bookings/jobPhotosVm.ts
import type { JobPhoto } from '@/hooks/useCleanerData';

const PHASE_ORDER: Array<JobPhoto['photo_type']> = ['before', 'during', 'after'];

export const PHASE_LABEL: Record<JobPhoto['photo_type'], string> = {
  before: 'Before',
  during: 'During',
  after: 'After',
};

/** Non-empty phase groups in before -> during -> after order. Input order is
 *  preserved within a phase (the hook already sorts by uploaded_at asc). */
export function groupJobPhotos(photos: JobPhoto[]) {
  return PHASE_ORDER.map((phase) => ({
    phase,
    label: PHASE_LABEL[phase],
    photos: photos.filter((p) => p.photo_type === phase),
  })).filter((g) => g.photos.length > 0);
}

/** The flat slide order the lightbox uses, so arrow keys walk the whole visit. */
export function orderPhotosForLightbox(photos: JobPhoto[]): JobPhoto[] {
  return groupJobPhotos(photos).flatMap((g) => g.photos);
}

export function photoAltText(
  phase: JobPhoto['photo_type'],
  indexInPhase: number,
  phaseTotal: number,
): string {
  return `${PHASE_LABEL[phase]} photo ${indexInPhase + 1} of ${phaseTotal}`;
}

/** Photos are meaningful once the job started (or the cleaner explicitly
 *  skipped them); future bookings with nothing to show hide the section. */
export function shouldShowJobPhotos({
  photoCount,
  photosSkipped,
  status,
}: {
  photoCount: number;
  photosSkipped: boolean;
  status: string;
}): boolean {
  if (photoCount > 0 || photosSkipped) return true;
  return status === 'in_progress' || status === 'completed';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/lib/bookings/jobPhotosVm.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Gates + commit**

Run: `npx tsc --noEmit` (no new errors) and `npx eslint src/lib/bookings/jobPhotosVm.ts src/lib/bookings/jobPhotosVm.test.ts`

```bash
git add src/lib/bookings/jobPhotosVm.ts src/lib/bookings/jobPhotosVm.test.ts
git commit -m "feat(operator): job-photos view-model helpers for the booking sheet"
```

---

### Task 2: Routing-history view-model helpers

**Files:**
- Create: `src/lib/bookings/routingHistoryVm.ts`
- Test: `src/lib/bookings/routingHistoryVm.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (date-fns `format`).
- Produces (Tasks 4 and 5 rely on these exact names):
  - `RoutingLogRow` — `{ id: string; cleaner_id: string; attempt_index: number; sent_at: string; deadline_at: string; response: 'pending' | 'accepted' | 'declined' | 'expired'; responded_at: string | null; decline_reason: string | null }`
  - `RoutingTimelineItem` — `{ id: string; name: string; badgeVariant: 'positive' | 'critical' | 'secondary' | 'info'; badgeLabel: string; metaLine: string; declineReason: string | null; current: boolean }`
  - `buildRoutingTimeline(rows: RoutingLogRow[], cleanerNameById: Map<string, string>, now: Date): RoutingTimelineItem[]`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/bookings/routingHistoryVm.test.ts
import { describe, expect, it } from 'vitest';
import { buildRoutingTimeline, type RoutingLogRow } from './routingHistoryVm';

const NOW = new Date('2026-07-16T15:00:00');

const row = (over: Partial<RoutingLogRow>): RoutingLogRow => ({
  id: 'r1',
  cleaner_id: 'c1',
  attempt_index: 1,
  sent_at: '2026-07-12T14:05:00',
  deadline_at: '2026-07-12T18:05:00',
  response: 'pending',
  responded_at: null,
  decline_reason: null,
  ...over,
});

const NAMES = new Map([
  ['c1', 'Marcus Lee'],
  ['c2', 'Wanda Jones'],
]);

describe('buildRoutingTimeline', () => {
  it('sorts by attempt_index and maps names', () => {
    const items = buildRoutingTimeline(
      [
        row({ id: 'r2', cleaner_id: 'c2', attempt_index: 2 }),
        row({ id: 'r1', cleaner_id: 'c1', attempt_index: 1, response: 'declined', responded_at: '2026-07-12T15:00:00' }),
      ],
      NAMES,
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['r1', 'r2']);
    expect(items[0].name).toBe('Marcus Lee');
    expect(items[1].name).toBe('Wanda Jones');
  });

  it('falls back for cleaners no longer in the org', () => {
    const [item] = buildRoutingTimeline([row({ cleaner_id: 'gone' })], NAMES, NOW);
    expect(item.name).toBe('Former cleaner');
  });

  it('maps declined with reason and responded time', () => {
    const [item] = buildRoutingTimeline(
      [row({ response: 'declined', responded_at: '2026-07-12T15:00:00', decline_reason: 'Schedule conflict' })],
      NAMES,
      NOW,
    );
    expect(item.badgeVariant).toBe('critical');
    expect(item.badgeLabel).toBe('Declined');
    expect(item.metaLine).toBe('Attempt 1 · offered Jul 12, 2:05 PM · responded Jul 12, 3:00 PM');
    expect(item.declineReason).toBe('Schedule conflict');
    expect(item.current).toBe(false);
  });

  it('maps accepted', () => {
    const [item] = buildRoutingTimeline(
      [row({ response: 'accepted', responded_at: '2026-07-12T15:00:00' })],
      NAMES,
      NOW,
    );
    expect(item.badgeVariant).toBe('positive');
    expect(item.badgeLabel).toBe('Accepted');
    expect(item.metaLine).toBe('Attempt 1 · offered Jul 12, 2:05 PM · responded Jul 12, 3:00 PM');
  });

  it('maps expired with the no-response note', () => {
    const [item] = buildRoutingTimeline([row({ response: 'expired' })], NAMES, NOW);
    expect(item.badgeVariant).toBe('secondary');
    expect(item.badgeLabel).toBe('Expired');
    expect(item.metaLine).toBe('Attempt 1 · offered Jul 12, 2:05 PM · no response by deadline');
  });

  it('pending shows a same-day deadline as time only', () => {
    const [item] = buildRoutingTimeline(
      [row({ deadline_at: '2026-07-16T17:00:00' })],
      NAMES,
      NOW,
    );
    expect(item.badgeVariant).toBe('info');
    expect(item.badgeLabel).toBe('Respond by 5:00 PM');
    expect(item.current).toBe(true);
  });

  it('pending shows a cross-day deadline with the date', () => {
    const [item] = buildRoutingTimeline(
      [row({ deadline_at: '2026-07-17T09:00:00' })],
      NAMES,
      NOW,
    );
    expect(item.badgeLabel).toBe('Respond by Jul 17, 9:00 AM');
  });

  it('marks only the last pending row as current', () => {
    const items = buildRoutingTimeline(
      [
        row({ id: 'r1', attempt_index: 1, response: 'expired' }),
        row({ id: 'r2', attempt_index: 2 }),
        row({ id: 'r3', attempt_index: 3 }),
      ],
      NAMES,
      NOW,
    );
    expect(items.map((i) => i.current)).toEqual([false, false, true]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- src/lib/bookings/routingHistoryVm.test.ts`
Expected: FAIL — cannot resolve `./routingHistoryVm`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/bookings/routingHistoryVm.ts
import { format, isSameDay } from 'date-fns';

export type RoutingLogRow = {
  id: string;
  cleaner_id: string;
  attempt_index: number;
  sent_at: string;
  deadline_at: string;
  response: 'pending' | 'accepted' | 'declined' | 'expired';
  responded_at: string | null;
  decline_reason: string | null;
};

export type RoutingTimelineItem = {
  id: string;
  name: string;
  badgeVariant: 'positive' | 'critical' | 'secondary' | 'info';
  badgeLabel: string;
  metaLine: string;
  declineReason: string | null;
  current: boolean;
};

const stamp = (iso: string) => format(new Date(iso), 'MMM d, h:mm a');

/** Maps routing-log rows to timeline items, oldest attempt first. `now` is a
 *  parameter (not Date.now()) so tests and callers control the clock. */
export function buildRoutingTimeline(
  rows: RoutingLogRow[],
  cleanerNameById: Map<string, string>,
  now: Date,
): RoutingTimelineItem[] {
  const sorted = [...rows].sort((a, b) => a.attempt_index - b.attempt_index);
  const lastPendingId = [...sorted].reverse().find((r) => r.response === 'pending')?.id ?? null;

  return sorted.map((r) => {
    let badgeVariant: RoutingTimelineItem['badgeVariant'];
    let badgeLabel: string;
    switch (r.response) {
      case 'accepted':
        badgeVariant = 'positive';
        badgeLabel = 'Accepted';
        break;
      case 'declined':
        badgeVariant = 'critical';
        badgeLabel = 'Declined';
        break;
      case 'expired':
        badgeVariant = 'secondary';
        badgeLabel = 'Expired';
        break;
      default: {
        const deadline = new Date(r.deadline_at);
        badgeVariant = 'info';
        badgeLabel = `Respond by ${isSameDay(deadline, now) ? format(deadline, 'h:mm a') : stamp(r.deadline_at)}`;
      }
    }

    let metaLine = `Attempt ${r.attempt_index} · offered ${stamp(r.sent_at)}`;
    if (r.response === 'expired') metaLine += ' · no response by deadline';
    if ((r.response === 'accepted' || r.response === 'declined') && r.responded_at) {
      metaLine += ` · responded ${stamp(r.responded_at)}`;
    }

    return {
      id: r.id,
      name: cleanerNameById.get(r.cleaner_id) ?? 'Former cleaner',
      badgeVariant,
      badgeLabel,
      metaLine,
      declineReason: r.decline_reason,
      current: r.id === lastPendingId,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- src/lib/bookings/routingHistoryVm.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Gates + commit**

Run: `npx tsc --noEmit` and `npx eslint src/lib/bookings/routingHistoryVm.ts src/lib/bookings/routingHistoryVm.test.ts`

```bash
git add src/lib/bookings/routingHistoryVm.ts src/lib/bookings/routingHistoryVm.test.ts
git commit -m "feat(operator): routing-history view-model helpers for the booking sheet"
```

---

### Task 3: Timeline primitive

**Files:**
- Create: `src/components/ui/timeline.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces (Task 4 relies on these): `Timeline({ children })` and `TimelineItem({ current?: boolean, children })`.

No unit test: `src/components/ui/*` primitives carry no unit tests in this repo (verified — none exist); it is exercised visually in Task 7's smoke pass.

- [ ] **Step 1: Write the primitive**

```tsx
// src/components/ui/timeline.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A minimal vertical timeline: connector line + one dot per item. Built for
 * the booking sheet's routing history; a future payment-attempts history is
 * expected to reuse it. Deliberately tiny API: stacked items, `current`
 * highlights one dot. No icons-in-dots, no branching.
 */
function Timeline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ol className={cn('relative ml-1.5 space-y-4 border-l border-border pl-4', className)}>{children}</ol>
}

function TimelineItem({ current, children }: { current?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className={cn(
          'absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-background',
          current ? 'bg-primary' : 'bg-border',
        )}
      />
      {children}
    </li>
  )
}

export { Timeline, TimelineItem }
```

- [ ] **Step 2: Gates + commit**

Run: `npx tsc --noEmit` and `npx eslint src/components/ui/timeline.tsx`

```bash
git add src/components/ui/timeline.tsx
git commit -m "feat(ui): minimal Timeline primitive (dot + connector list)"
```

---

### Task 4: Routing-log hook + RoutingHistorySection

**Files:**
- Create: `src/hooks/useRoutingLog.ts`
- Create: `src/components/redesign/bookings/routing/RoutingHistorySection.tsx`

**Interfaces:**
- Consumes: `keys.appointments.routingLog` (exists, unused), `useOrgQuery`, `supabase` from `@/lib/supabase`, `RoutingLogRow`/`buildRoutingTimeline` (Task 2), `Timeline`/`TimelineItem` (Task 3), `Collapsible`, `Badge`, `ErrorState`, `Separator`, `CleanerOption`.
- Produces (Task 7 relies on this): `RoutingHistorySection({ appointmentId: string; cleanerOptions: CleanerOption[] })` — renders its own leading `<Separator/>`; returns `null` while loading and when the booking has no routing rows.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useRoutingLog.ts
import { supabase } from '@/lib/supabase';
import { keys } from '@/lib/queryKeys';
import { useOrgQuery } from '@/lib/useOrgQuery';
import type { RoutingLogRow } from '@/lib/bookings/routingHistoryVm';

/**
 * Cleaner-dispatch offer trail for one appointment. Client-side read: RLS
 * grants SELECT to the org's owner/admin/manager (migration 059/076).
 * NOTE: appointment_routing_log.cleaner_id has NO foreign key, so no
 * PostgREST embed is possible; callers map ids to names themselves.
 */
export function useRoutingLog(appointmentId: string | null) {
  const query = useOrgQuery({
    queryKey: keys.appointments.routingLog(appointmentId ?? ''),
    enabled: !!appointmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointment_routing_log')
        .select('id, cleaner_id, attempt_index, sent_at, deadline_at, response, responded_at, decline_reason')
        .eq('appointment_id', appointmentId as string)
        .order('attempt_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as RoutingLogRow[];
    },
  });

  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: () => void query.refetch(),
  };
}
```

- [ ] **Step 2: Write the section component**

```tsx
// src/components/redesign/bookings/routing/RoutingHistorySection.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Collapsible } from '@/components/ui/collapsible';
import { ErrorState } from '@/components/ui/error-state';
import { Separator } from '@/components/ui/separator';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { buildRoutingTimeline } from '@/lib/bookings/routingHistoryVm';
import { useRoutingLog } from '@/hooks/useRoutingLog';
import type { CleanerOption } from '../bookings-types';

/**
 * R10: the cleaner-assignment offer trail, oldest attempt first. View-only.
 * Hidden entirely for directly-assigned bookings (no routing rows) and while
 * loading, so the common direct-assign case never flashes a section.
 */
export function RoutingHistorySection({
  appointmentId,
  cleanerOptions,
}: {
  appointmentId: string;
  cleanerOptions: CleanerOption[];
}) {
  const { rows, loading, error, refetch } = useRoutingLog(appointmentId);

  if (loading) return null;
  if (!error && rows.length === 0) return null;

  const items = buildRoutingTimeline(
    rows,
    new Map(cleanerOptions.map((c) => [c.id, c.name])),
    new Date(),
  );

  return (
    <>
      <Separator />
      <Collapsible
        title="Routing history"
        right={
          rows.length > 0 ? (
            <span className="font-normal normal-case tracking-normal">{rows.length}</span>
          ) : undefined
        }
      >
        {error ? (
          <ErrorState
            title="Couldn't load routing history"
            description="Something went wrong loading the offer history. Please try again."
            onRetry={refetch}
          />
        ) : (
          <Timeline className="mt-1">
            {items.map((it) => (
              <TimelineItem key={it.id} current={it.current}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{it.name}</span>
                  <Badge variant={it.badgeVariant}>{it.badgeLabel}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{it.metaLine}</div>
                {it.declineReason ? (
                  <div className="mt-1 text-sm text-muted-foreground">“{it.declineReason}”</div>
                ) : null}
              </TimelineItem>
            ))}
          </Timeline>
        )}
      </Collapsible>
    </>
  );
}
```

- [ ] **Step 3: Gates + commit**

Run: `npx tsc --noEmit` and `npx eslint src/hooks/useRoutingLog.ts src/components/redesign/bookings/routing/RoutingHistorySection.tsx`

```bash
git add src/hooks/useRoutingLog.ts src/components/redesign/bookings/routing/RoutingHistorySection.tsx
git commit -m "feat(operator): routing-history timeline section for the booking sheet"
```

---

### Task 5: JobPhotosSection

**Files:**
- Create: `src/components/redesign/bookings/photos/JobPhotosSection.tsx`

**Interfaces:**
- Consumes: `useJobPhotosForAppointment` (existing), Task 1 helpers, `JobPhotoLightbox` (existing, default export from `@/components/JobPhotoLightbox`), `Collapsible`, `ErrorState`, `Skeleton`, `Separator`, `BookingStatusKey`.
- Produces (Task 7 relies on this): `JobPhotosSection({ appointmentId, status, photosSkipped, photoSkipReason })` — renders its own leading `<Separator/>`; returns `null` when `shouldShowJobPhotos` is false.

- [ ] **Step 1: Write the component**

```tsx
// src/components/redesign/bookings/photos/JobPhotosSection.tsx
'use client';

import { useState } from 'react';
import { Camera } from 'lucide-react';
import JobPhotoLightbox from '@/components/JobPhotoLightbox';
import { Collapsible } from '@/components/ui/collapsible';
import { ErrorState } from '@/components/ui/error-state';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobPhotosForAppointment } from '@/hooks/useCleanerData';
import {
  groupJobPhotos,
  orderPhotosForLightbox,
  photoAltText,
  shouldShowJobPhotos,
} from '@/lib/bookings/jobPhotosVm';
import type { BookingStatusKey } from '../bookings-types';

/**
 * R9: the cleaner's before/during/after photos, view-only. Phase-grouped
 * 3-column grids; every thumbnail opens the shared lightbox positioned on
 * that photo. Also surfaces the photo-skip reason (photos_skipped +
 * photo_skip_reason), which the legacy panel never showed.
 */
export function JobPhotosSection({
  appointmentId,
  status,
  photosSkipped,
  photoSkipReason,
}: {
  appointmentId: string;
  status: BookingStatusKey;
  photosSkipped: boolean;
  photoSkipReason: string | null;
}) {
  const { allPhotos, loading, error, refetch } = useJobPhotosForAppointment(appointmentId);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // While loading we don't know photoCount yet; show the skeleton only when
  // the section would plausibly render (started/completed/skipped), so
  // future bookings never flash it.
  const maybeVisible = shouldShowJobPhotos({ photoCount: 1, photosSkipped, status });
  if (loading && !maybeVisible) return null;
  if (!loading && !error && !shouldShowJobPhotos({ photoCount: allPhotos.length, photosSkipped, status })) {
    return null;
  }

  const groups = groupJobPhotos(allPhotos);
  const ordered = orderPhotosForLightbox(allPhotos);

  return (
    <>
      <Separator />
      <Collapsible
        title="Job photos"
        right={
          allPhotos.length > 0 ? (
            <span className="font-normal normal-case tracking-normal">{allPhotos.length}</span>
          ) : undefined
        }
      >
        {loading ? (
          <div className="grid grid-cols-3 gap-1.5">
            <Skeleton className="aspect-square" />
            <Skeleton className="aspect-square" />
            <Skeleton className="aspect-square" />
          </div>
        ) : error ? (
          <ErrorState
            title="Couldn't load photos"
            description="Something went wrong loading the job photos. Please try again."
            onRetry={refetch}
          />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.phase}>
                <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {group.label} <span className="font-normal">· {group.photos.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.photos.map((photo, i) => (
                    <button
                      key={photo.id}
                      type="button"
                      aria-label={photoAltText(group.phase, i, group.photos.length)}
                      onClick={() => setLightboxIndex(ordered.findIndex((p) => p.id === photo.id))}
                      className="aspect-square overflow-hidden rounded-control border border-border transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.photo_url}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {photosSkipped ? (
              <div className="flex items-start gap-2 rounded-control border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Camera className="mt-0.5 size-4 shrink-0" />
                <span>
                  Photos skipped
                  {photoSkipReason ? <>: “{photoSkipReason}”</> : null}
                </span>
              </div>
            ) : null}
            {allPhotos.length === 0 && !photosSkipped ? (
              <p className="text-sm text-muted-foreground">No photos yet.</p>
            ) : null}
          </div>
        )}
      </Collapsible>
      <JobPhotoLightbox
        photos={ordered}
        open={lightboxIndex !== null}
        index={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
        appointmentId={appointmentId}
      />
    </>
  );
}
```

Note: the `eslint-disable-next-line` for `no-img-element` follows the existing job-photo grids (`CleanerPhotoCapture.tsx` renders raw `<img>` for these public-bucket photos). If eslint does NOT flag the bare `<img>` in this repo config, drop the disable comment rather than carrying a dead suppression.

- [ ] **Step 2: Gates + commit**

Run: `npx tsc --noEmit` and `npx eslint src/components/redesign/bookings/photos/JobPhotosSection.tsx`

```bash
git add src/components/redesign/bookings/photos/JobPhotosSection.tsx
git commit -m "feat(operator): job-photos section for the booking sheet"
```

---

### Task 6: Lightbox theme pass

**Files:**
- Modify: `src/components/JobPhotoLightbox.tsx`
- Modify: `src/app/globals.css` (append one block)

**Interfaces:**
- Consumes: the component's existing props (unchanged) and the design tokens in `globals.css`.
- Produces: same component, same API — only chrome changes. Both the legacy panel and the new section get the themed viewer.

- [ ] **Step 1: Confirm the library's hook points**

Run: `grep -o '\-\-yarl__[a-z_]*' node_modules/yet-another-react-lightbox/dist/styles.css node_modules/yet-another-react-lightbox/dist/plugins/thumbnails/*.css 2>/dev/null | sort -u | head -30`
Expected: a list including `--yarl__color_backdrop`, `--yarl__color_button`, `--yarl__color_button_active`. Also confirm the thumbnails CSS exposes an active-border variable (search for `active` in the thumbnails css). Adjust the Step 3 CSS to the variables that actually exist — do not invent names.

Also confirm the render-prop icon slots for this installed version:
Run: `grep -o 'icon[A-Za-z]*' node_modules/yet-another-react-lightbox/dist/types.d.ts | sort -u`
Expected: names like `iconPrev`, `iconNext`, `iconClose`, `iconZoomIn`, `iconZoomOut`, `iconDownload`, `iconEnterFullscreen`, `iconExitFullscreen`. Use only slots that exist.

- [ ] **Step 2: Swap the icons to Lucide via render props**

In `src/components/JobPhotoLightbox.tsx`, add the imports and a `className` + `render` prop to the `<Lightbox>` (keep every existing prop):

```tsx
import {
  ChevronLeft,
  ChevronRight,
  Download as DownloadIcon,
  Maximize,
  Minimize,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
```

```tsx
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom, Download, Captions, Thumbnails, Fullscreen]}
      carousel={{ finite: false }}
      controller={{ closeOnBackdropClick: true }}
      className="job-photo-lightbox"
      render={{
        iconPrev: () => <ChevronLeft className="size-7" />,
        iconNext: () => <ChevronRight className="size-7" />,
        iconClose: () => <X className="size-6" />,
        iconZoomIn: () => <ZoomIn className="size-6" />,
        iconZoomOut: () => <ZoomOut className="size-6" />,
        iconDownload: () => <DownloadIcon className="size-6" />,
        iconEnterFullscreen: () => <Maximize className="size-6" />,
        iconExitFullscreen: () => <Minimize className="size-6" />,
      }}
      styles={{ container: { zIndex: 300 } }}
      download={{ /* existing download handler unchanged */ }}
    />
```

(Only add `className` and `render`; do not touch `slides`, `download`, or `styles`.)

- [ ] **Step 3: Theme the chrome from tokens in globals.css**

Append to `src/app/globals.css` (adjust variable names to what Step 1 actually found; `--foreground`/`--primary`/`--background` are this repo's existing token variables — verify their exact names in `:root` before writing):

```css
/* Job-photo lightbox (yet-another-react-lightbox) themed to the design system.
   Chrome only: backdrop, buttons, active-thumbnail accent. */
.job-photo-lightbox {
  --yarl__color_backdrop: hsl(var(--foreground) / 0.95);
  --yarl__color_button: hsl(var(--background) / 0.9);
  --yarl__color_button_active: hsl(var(--background));
  --yarl__thumbnails_thumbnail_active_border_color: hsl(var(--primary));
  --yarl__thumbnails_container_background_color: transparent;
  --yarl__thumbnails_thumbnail_background: transparent;
}
```

If a variable from this block does not exist in the library CSS, delete that line (spec: leave un-themeable parts library-default rather than forking library DOM/CSS).

- [ ] **Step 4: Gates + commit**

Run: `npx tsc --noEmit` and `npx eslint src/components/JobPhotoLightbox.tsx`

```bash
git add src/components/JobPhotoLightbox.tsx src/app/globals.css
git commit -m "feat(ui): theme the job-photo lightbox chrome to the design system"
```

---

### Task 7: Wire into BookingDetailSheet + admin select columns

**Files:**
- Modify: `src/hooks/useAdminData.ts` (AdminAppointment interface ~line 40-100 region; select string ~line 205-230)
- Modify: `src/components/redesign/bookings/BookingDetailSheet.tsx` (imports; insertion between the counter-windows block ending at line 411 and the Requests & notes block starting at line 413)

**Interfaces:**
- Consumes: `JobPhotosSection` (Task 5), `RoutingHistorySection` (Task 4), existing `detail: BookingDetailVM` (`detail.id`, `detail.status`), `appointment: AdminAppointment | null`, `cleanerOptions`.
- Produces: the sheet renders both sections; `AdminAppointment` gains `photos_skipped?: boolean` and `photo_skip_reason?: string | null`.

- [ ] **Step 1: Add the two columns to the admin appointments query**

In `src/hooks/useAdminData.ts`, add to the `AdminAppointment` interface (next to the existing optional payment fields around line 69-87):

```ts
  /** Cleaner used the photo-gate skip for this job (org allows skipping). */
  photos_skipped?: boolean;
  photo_skip_reason?: string | null;
```

And in the `useAdminAppointments` select string (the block listing `special_requests, notes, ...`), add two lines:

```
          special_requests,
          notes,
          photos_skipped,
          photo_skip_reason,
```

- [ ] **Step 2: Insert the sections into the sheet**

In `src/components/redesign/bookings/BookingDetailSheet.tsx` add imports:

```tsx
import { JobPhotosSection } from "./photos/JobPhotosSection";
import { RoutingHistorySection } from "./routing/RoutingHistorySection";
```

Then insert between the counter-windows block and the Requests & notes block (after the `) : null}` that closes `detail.counterWindows.length > 0 ?` and before `{detail.declinedReason || detail.specialRequests || detail.notes ? (`):

```tsx
        <JobPhotosSection
          appointmentId={detail.id}
          status={detail.status}
          photosSkipped={appointment?.photos_skipped ?? false}
          photoSkipReason={appointment?.photo_skip_reason ?? null}
        />

        <RoutingHistorySection appointmentId={detail.id} cleanerOptions={cleanerOptions} />
```

Both components render their own `<Separator/>` when visible, matching the sheet's separator pattern; when hidden they contribute nothing.

- [ ] **Step 3: Run the full unit suite + gates**

Run: `npm run test:unit`
Expected: PASS (the pre-existing formDraft failure, if still present on master, is the only allowed failure).
Run: `npx tsc --noEmit` (no NEW errors beyond the 12-error baseline) and `npx eslint src/hooks/useAdminData.ts src/components/redesign/bookings/BookingDetailSheet.tsx`

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAdminData.ts src/components/redesign/bookings/BookingDetailSheet.tsx
git commit -m "feat(operator): mount photos + routing-history sections in the booking sheet"
```

---

### Task 8: Browser smoke pass + conformance (main session, not a subagent)

**Files:** none (verification only; fix-ups get their own commits).

This task is executed by the main session with the Playwright MCP tools against `npm run dev` + `npx supabase start` running locally in the worktree.

- [ ] **Step 1: Seed data covering all states** (local Supabase only)

Via `npx supabase db reset`d local DB or targeted SQL in the local studio: one appointment with before+after photos (upload as the seeded cleaner through the cleaner shell, or INSERT `job_photos` rows pointing at any public image URLs), one appointment with `photos_skipped = true, photo_skip_reason = 'Customer asked for no photos'`, one appointment with 3 `appointment_routing_log` rows (declined with reason / expired / pending with future deadline), and one directly-assigned appointment with no routing rows.

- [ ] **Step 2: Drive the operator sheet and screenshot each state**

Open each seeded booking's sheet from the operator bookings page (`?booking=` host). Verify: sections sit between Payment (or counter-proposals when present) and Requests & notes; counts in the collapsible headers; photo grids group by phase; thumbnail click opens the themed lightbox (zoom in/out, arrows, download, thumbnails strip, Lucide icons, token backdrop); skip-reason row; "No photos yet." on an in-progress booking without photos; routing timeline badges + full-wrap decline reason + highlighted pending dot; NO routing section on the direct-assigned booking; NO photos section on a pending booking without photos. Take screenshots of: photos section open, lightbox open, routing section open, and the sheet of a direct-assigned booking.

- [ ] **Step 3: ui-ux-pro-max conformance pass**

Run the implementation-phase check from the ui-feature-workflow skill: no raw hex or mockup-copied classes in the new files (`grep -n "#[0-9a-fA-F]\{3,6\}" <new files>` returns nothing), primitives reused, badge vocabulary (not color-only) for statuses, touch targets ≥44px for thumbnails, focus rings on interactive tiles.

- [ ] **Step 4: Full gates before PR**

Run: `npm run test` (unit + integration; integration needs `npx supabase start`), `npx tsc --noEmit`, `npm run lint`.
Expected: all green apart from documented pre-existing failures (12 tsc baseline errors).

- [ ] **Step 5: Rebase + push + PR**

```bash
git fetch origin && git rebase origin/master
git push -u origin feat/booking-photos-routing
gh pr create --title "feat(operator): job photos + routing history in the booking detail sheet (R9/R10)" --body "<summary per repo convention>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected conflict surface with PR #149 (card-link email): `BookingDetailSheet.tsx` registration lines only. Do not merge without Bridger's explicit go-ahead.

---

## Self-review notes

- Spec coverage: placement/gating (Task 7 + section self-hiding), photos grids + alt + lazy + skip reason + empty (Tasks 1, 5), lightbox reuse + theme (Task 6), routing timeline + badges + deadline pill + name fallback (Tasks 2, 4), timeline primitive (Task 3), admin select columns (Task 7), no-flag/no-migration (global), smoke + conformance (Task 8). The spec's "hidden while loading" rule for routing is in Task 4; the photos loading-flash guard is in Task 5.
- `keys.appointments.routingLog` already existed unused — consumed, not duplicated.
- Type names cross-checked: `RoutingLogRow`/`RoutingTimelineItem`/`buildRoutingTimeline` (Tasks 2→4), `groupJobPhotos`/`orderPhotosForLightbox`/`photoAltText`/`shouldShowJobPhotos` (Tasks 1→5), `Timeline`/`TimelineItem` (Tasks 3→4), section props (Tasks 4/5→7).
- `Date.now()`-free VM API (`now` parameter) keeps tests deterministic.
