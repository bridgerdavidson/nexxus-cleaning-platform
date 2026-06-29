# Redesign Homeowner — Slice 1b (Live cleaning tracking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Prereq:** Build this AFTER Slice 1a (PR #104) merges to master; branch off updated master. It enriches `HomeownerCleaningHero` (built in 1a) and reuses the 1a presenters/shell.

**Goal:** Make the homeowner Home hero come alive while a cleaning is in progress (live checklist progress bar + "X of Y" + stage label + elapsed time + before-photo peek), and show a completed-cleaning recap (after-photos + checklist-done summary + receipt), backed by one migration.

**Architecture:** One migration adds homeowner read access + realtime to the cleaner's existing active-job data (`checklist_item_completions`) and two timestamp columns to `appointments`, stamped by the lifecycle route. Read-only homeowner hooks mirror the cleaner's, adding per-appointment realtime so the watch experience updates live. All number/label/elapsed logic lives in pure, unit-tested presenters; components stay thin and are verified on the Vercel preview.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (design tokens), Supabase (Postgres + RLS + Realtime), TanStack Query, Vitest (unit + integration), Playwright/preview.

## Global Constraints

- **Design system only.** Build from `src/components/ui/*` + tokens (`brand-600/500`, `shadow-soft-*`, `rounded-card/pill`, `bg-card`, `text-muted-foreground`, semantic `positive/caution/critical`). **No raw hex.** Status/progress carried by the badge/pill + progress vocabulary, never decorative stripes.
- **No em dashes** in user-facing copy.
- **Reuse** the 1a presenters + `HomeownerCleaningHero`; mirror the cleaner active-job hooks (`useChecklistCompletions`, `useJobPhotosForAppointment`) read-only. Reuse `checklistProgressLabel` and `useSupabaseRealtimeSync`.
- **Migration discipline:** new migration uses the **next free number** (likely `097` — verify the latest on master at build time). `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` then `CREATE POLICY`, `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE`. Never edit a shipped migration. Run `npx supabase db reset` to verify it rebuilds.
- **RLS test correctness:** assert homeowner reads with an **RLS-enforced client** (anon client + the homeowner's access token), NOT the service-role `createTestSupabaseClient()` (which bypasses RLS).
- Path alias `@/*` → `./src/*`.
- **Gates before PR:** `npm run test`, `npx tsc --noEmit`, `npm run lint`; `npx supabase db reset` for the migration; one Codex review before push; visual verification on the Vercel preview.

## Testing approach
- **Unit (Vitest)** for the pure progress presenters (percent, elapsed-time, stage label).
- **Integration (Vitest + local Supabase)** for the migration: homeowner can read own `checklist_item_completions`, cannot read another homeowner's; lifecycle route stamps `started_at`/`completed_at`.
- **Visual (preview)** for `LiveCleaningProgress` + `CompletedCleaningRecap` + the enriched hero (in-progress + complete), logged in as a homeowner with an active/completed cleaning.

## File structure

**Create:**
- `supabase/migrations/097_homeowner_live_tracking.sql` — homeowner RLS on `checklist_item_completions`, its realtime, and `appointments.started_at`/`completed_at`.
- `src/components/ui/progress.tsx` — minimal token-based progress bar primitive.
- `src/components/redesign/homeowner/home/job-progress-presenters.ts` — pure: `progressPercent`, `formatElapsed`, `stageLabel`.
- `src/components/redesign/homeowner/home/job-progress-presenters.test.ts`.
- `src/hooks/useHomeownerJobProgress.ts` — completions count + checklist total + realtime.
- `src/hooks/useHomeownerJobPhotos.ts` — before/after photos + realtime.
- `src/hooks/useHomeownerJobProgress.integration.test.ts` — the migration RLS test.
- `src/components/redesign/homeowner/home/LiveCleaningProgress.tsx`.
- `src/components/redesign/homeowner/home/CompletedCleaningRecap.tsx`.

**Modify:**
- `src/app/api/appointments/[appointmentId]/lifecycle/route.ts` — stamp `started_at`/`completed_at`.
- `src/app/api/appointments/[appointmentId]/lifecycle/route.integration.test.ts` — stamping assertions (create if absent).
- `src/hooks/useHomeownerData.ts` — add `job_progress, started_at, completed_at` to the `useHomeownerAppointments` select (additive).
- `src/components/redesign/homeowner/HomeownerCleaningHero.tsx` — render `LiveCleaningProgress` (in_progress) + `CompletedCleaningRecap` (complete).
- `src/lib/queryKeys.ts` — add `appointments.checklistTotal(...)` / `jobPhotos` keys if missing (verify existing `keys.appointments.checklistCompletions` + `keys.jobPhotos.byAppointment`).

---

### Task 1: Migration — homeowner live-tracking access + timestamps

**Files:**
- Create: `supabase/migrations/097_homeowner_live_tracking.sql`

**Interfaces:**
- Produces: homeowner SELECT on `checklist_item_completions` (own appointments); `checklist_item_completions` in the realtime publication; `appointments.started_at timestamptz`, `appointments.completed_at timestamptz`.

- [ ] **Step 1: Write the migration.** (Verify the file number is the next free one on master first.)

```sql
-- 097_homeowner_live_tracking.sql
-- Homeowner can watch their cleaning live: read checklist completions for their
-- own appointments (realtime), and read job start/finish timestamps.

-- 1) Homeowner read on checklist_item_completions (mirror of cic_org_read, by homeowner_id).
drop policy if exists cic_homeowner_read on checklist_item_completions;
create policy cic_homeowner_read on checklist_item_completions
  for select to authenticated
  using (exists (select 1 from appointments a
                 where a.id = checklist_item_completions.appointment_id
                   and a.homeowner_id = (select auth.uid())));

-- 2) Realtime for live progress (job_photos + appointments already covered).
alter table public.checklist_item_completions replica identity full;
alter publication supabase_realtime add table public.checklist_item_completions;

-- 3) Job lifecycle timestamps on appointments (power elapsed-time + the messaging grace window).
alter table appointments add column if not exists started_at timestamptz;
alter table appointments add column if not exists completed_at timestamptz;
```

- [ ] **Step 2: Verify it rebuilds cleanly.**

Run: `npx supabase db reset`
Expected: completes with no error; the publication add does not fail (it is the only place `checklist_item_completions` is added).

> Note: if `db reset` errors that the table is already in the publication, guard the add: `do $$ begin alter publication supabase_realtime add table public.checklist_item_completions; exception when duplicate_object then null; end $$;`

- [ ] **Step 3: Regenerate types if the project tracks them; otherwise add the fields to the `Appointment` type in Task 4.** (No DB type regen step if the repo hand-maintains `src/types`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/097_homeowner_live_tracking.sql
git commit -m "feat(redesign): migration - homeowner live-tracking RLS, realtime, job timestamps"
```

---

### Task 2: Migration RLS integration test

**Files:**
- Create: `src/hooks/useHomeownerJobProgress.integration.test.ts`

**Interfaces:**
- Consumes: `tests/helpers/{fixtures,supabase,auth}` (`withTestOrg`, an RLS-enforced user client). Verify the exact helper that makes a token-scoped client before writing (e.g. `createUserClient(accessToken)` or `createTestSupabaseClient({ accessToken })`). The default `createTestSupabaseClient()` is service-role and MUST NOT be used for the read assertions.

- [ ] **Step 1: Write the failing test.** (Requires `npx supabase start` running + `.env.test.local`.)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../tests/helpers/fixtures';
import { createTestSupabaseClient, createUserClient } from '../../tests/helpers/supabase';

describe('checklist_item_completions homeowner RLS (migration 097)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let appt: { id: string };

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
    appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'in_progress',
    });
    const admin = createTestSupabaseClient();
    const { data: li } = await admin
      .from('checklist_line_items').select('id').limit(1).single();
    await admin.from('checklist_item_completions').insert({
      appointment_id: appt.id,
      checklist_line_item_id: li!.id,
      organization_id: org.organizationId,
    });
  });

  afterEach(async () => { await Promise.all([org.cleanup(), org2.cleanup()]); });

  it('lets the owning homeowner read their appointment completions', async () => {
    const client = createUserClient(org.homeowner.accessToken); // RLS-enforced
    const { data, error } = await client
      .from('checklist_item_completions').select('*').eq('appointment_id', appt.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('does NOT let a different homeowner read those completions', async () => {
    const client = createUserClient(org2.homeowner.accessToken); // RLS-enforced, not a participant
    const { data } = await client
      .from('checklist_item_completions').select('*').eq('appointment_id', appt.id);
    expect(data ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it (with local Supabase up + migration applied)**

Run: `npm run test:integration -- useHomeownerJobProgress`
Expected: PASS. (If `createUserClient` does not exist, find the repo's token-scoped client helper and use it; do not fall back to the service-role client.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHomeownerJobProgress.integration.test.ts
git commit -m "test(redesign): homeowner RLS on checklist_item_completions"
```

---

### Task 3: Lifecycle route stamps started_at / completed_at

**Files:**
- Modify: `src/app/api/appointments/[appointmentId]/lifecycle/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/lifecycle/route.integration.test.ts` (create if absent)

**Interfaces:**
- Produces: a POST to the lifecycle route with `event: 'started'` sets `appointments.started_at = now()` (if null); `event: 'completed'` sets `appointments.completed_at = now()`.

- [ ] **Step 1: Read the real route** and confirm its exact request shape + where it loads the appointment + records the notification event (the gather quoted a `{ organizationId, event }` body and a `supabaseAdmin` update path — verify against the actual file; match its auth + admin-client usage).

- [ ] **Step 2: Write/extend the failing integration test** asserting the stamp. Mirror the repo's route integration-test pattern (`callRoute`, `bearerHeader`, `withTestOrg`, `createTestAppointment`). Assert that after a `started` call, the appointment row has a non-null `started_at`; after `completed`, a non-null `completed_at`.

- [ ] **Step 3: Implement the stamping.** In the route, after the appointment is validated and before/after the `recordNotificationEvent` call, add an admin update:

```ts
await supabaseAdmin
  .from('appointments')
  .update(
    event === 'started'
      ? { started_at: new Date().toISOString() }
      : { completed_at: new Date().toISOString() },
  )
  .eq('id', appointmentId)
  // only set started_at once (idempotent re-fires from realtime/retries must not move it)
  .is(event === 'started' ? 'started_at' : 'completed_at', null);
```

> Use the route's existing admin client variable name and event-discriminator exactly as in the file. The `.is(..., null)` guard keeps the first timestamp stable across retries.

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- lifecycle`
Expected: PASS (started/completed stamps set; re-fire does not move the timestamp).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/appointments/[appointmentId]/lifecycle/route.ts" "src/app/api/appointments/[appointmentId]/lifecycle/route.integration.test.ts"
git commit -m "feat(redesign): stamp appointment started_at/completed_at on job lifecycle"
```

---

### Task 4: Extend the homeowner appointments select

**Files:**
- Modify: `src/hooks/useHomeownerData.ts` (the `useHomeownerAppointments` SELECT + its inline `Appointment` type)

**Interfaces:**
- Produces: `Appointment` objects from `useHomeownerAppointments` now carry `job_progress`, `started_at`, `completed_at`.

- [ ] **Step 1: Add the three fields to the select string** in `useHomeownerAppointments` (additive, alongside the existing `id, ..., status, total_price`):

```ts
// in the .select(`...`) template, add:
//   job_progress, started_at, completed_at,
```

- [ ] **Step 2: Add the fields to the inline `Appointment` interface** in `useHomeownerData.ts`:

```ts
  job_progress?: 'not_started' | 'before_photos' | 'checklist' | 'after_photos' | 'completed' | null;
  started_at?: string | null;
  completed_at?: string | null;
```

- [ ] **Step 3: Verify the existing homeowner unit tests still pass** (they construct `Appointment` fixtures; the new fields are optional so fixtures stay valid).

Run: `npm run test -- home-presenters`
Expected: PASS (no changes needed to presenters; fields are additive + optional).

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: zero new errors in `useHomeownerData.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHomeownerData.ts
git commit -m "feat(redesign): select job_progress + start/complete timestamps for homeowner appointments"
```

---

### Task 5: Progress primitive

**Files:**
- Create: `src/components/ui/progress.tsx`

**Interfaces:**
- Produces: `<Progress value={number /* 0-100 */} className? aria-label? />` — a token-based filled bar, no new dependency.

- [ ] **Step 1: Implement** a minimal, accessible div-based progress bar (no Radix dep):

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Progress({
  value,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  className?: string;
  'aria-label'?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn('h-2 w-full overflow-hidden rounded-pill bg-muted', className)}
    >
      <div
        className="h-full rounded-pill bg-brand-600 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/progress.tsx
git commit -m "feat(ui): minimal token-based Progress primitive"
```

---

### Task 6: Job-progress presenters (pure)

**Files:**
- Create: `src/components/redesign/homeowner/home/job-progress-presenters.ts`
- Test: `src/components/redesign/homeowner/home/job-progress-presenters.test.ts`

**Interfaces:**
- Produces:
  - `progressPercent(done: number, total: number): number` (0-100; 0 when total is 0)
  - `formatElapsed(startIso: string | null, nowMs: number): string | null` ("just started", "12 min", "1 hr 5 min"; null when no start)
  - `stageLabel(stage: string | null | undefined): string` (consumer copy per `job_progress`)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { progressPercent, formatElapsed, stageLabel } from './job-progress-presenters';

describe('progressPercent', () => {
  it('computes a clamped rounded percent', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(0, 14)).toBe(0);
    expect(progressPercent(8, 14)).toBe(57);
    expect(progressPercent(14, 14)).toBe(100);
    expect(progressPercent(20, 14)).toBe(100);
  });
});

describe('formatElapsed', () => {
  const start = '2026-06-25T10:00:00.000Z';
  const at = (m: number) => new Date('2026-06-25T10:00:00.000Z').getTime() + m * 60_000;
  it('returns null with no start', () => {
    expect(formatElapsed(null, at(30))).toBeNull();
  });
  it('says just started under a minute', () => {
    expect(formatElapsed(start, at(0))).toBe('just started');
  });
  it('formats minutes', () => {
    expect(formatElapsed(start, at(12))).toBe('12 min');
  });
  it('formats hours + minutes', () => {
    expect(formatElapsed(start, at(65))).toBe('1 hr 5 min');
  });
});

describe('stageLabel', () => {
  it('maps job_progress to warm copy', () => {
    expect(stageLabel('before_photos')).toBe('Getting started');
    expect(stageLabel('checklist')).toBe('Cleaning in progress');
    expect(stageLabel('after_photos')).toBe('Finishing up');
    expect(stageLabel('completed')).toBe('All done');
    expect(stageLabel('not_started')).toBe('Getting started');
    expect(stageLabel(null)).toBe('Cleaning in progress');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- job-progress-presenters`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function formatElapsed(startIso: string | null, nowMs: number): string | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;
  const mins = Math.floor((nowMs - start) / 60_000);
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function stageLabel(stage: string | null | undefined): string {
  switch (stage) {
    case 'not_started':
    case 'before_photos':
      return 'Getting started';
    case 'after_photos':
      return 'Finishing up';
    case 'completed':
      return 'All done';
    case 'checklist':
    default:
      return 'Cleaning in progress';
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test -- job-progress-presenters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner/home/job-progress-presenters.ts src/components/redesign/homeowner/home/job-progress-presenters.test.ts
git commit -m "feat(redesign): job-progress presenters (percent, elapsed, stage label)"
```

---

### Task 7: useHomeownerJobProgress + useHomeownerJobPhotos hooks

**Files:**
- Create: `src/hooks/useHomeownerJobProgress.ts`
- Create: `src/hooks/useHomeownerJobPhotos.ts`

**Interfaces:**
- Consumes: `supabase`, `useOrgQuery`, `keys`, `useSupabaseRealtimeSync`.
- Produces:
  - `useHomeownerJobProgress(appointmentId: string | null, checklistId: string | null): { doneCount: number; totalCount: number; isLoading: boolean }`
  - `useHomeownerJobPhotos(appointmentId: string | null): { beforePhotos: JobPhoto[]; afterPhotos: JobPhoto[]; isLoading: boolean }`

- [ ] **Step 1: Implement `useHomeownerJobProgress.ts`** (mirror `useChecklistCompletions`, add the checklist total + realtime). Verify `keys.appointments.checklistCompletions` exists; add a `checklistTotal` key if needed.

```ts
import { supabase } from '@/lib/supabase';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { keys } from '@/lib/queryKeys';
import { useSupabaseRealtimeSync } from '@/lib/useSupabaseRealtimeSync';

export function useHomeownerJobProgress(appointmentId: string | null, checklistId: string | null) {
  const completions = useOrgQuery({
    queryKey: keys.appointments.checklistCompletions(appointmentId ?? ''),
    enabled: !!appointmentId,
    queryFn: async ({ signal }) => {
      const { count, error } = await supabase
        .from('checklist_item_completions')
        .select('id', { count: 'exact', head: true })
        .eq('appointment_id', appointmentId as string)
        .abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const total = useOrgQuery({
    queryKey: ['checklistTotal', checklistId ?? ''],
    enabled: !!checklistId,
    queryFn: async ({ signal }) => {
      const { count, error } = await supabase
        .from('checklist_line_items')
        .select('id', { count: 'exact', head: true })
        .eq('checklist_id', checklistId as string)
        .abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useSupabaseRealtimeSync({
    channelName: `cic:homeowner:${appointmentId}`,
    table: 'checklist_item_completions',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.appointments.checklistCompletions(appointmentId ?? '')],
    }),
  });

  return {
    doneCount: completions.data ?? 0,
    totalCount: total.data ?? 0,
    isLoading: completions.isLoading || total.isLoading,
  };
}
```

- [ ] **Step 2: Implement `useHomeownerJobPhotos.ts`** (mirror `useJobPhotosForAppointment` read + add realtime; `job_photos` is already in the publication and homeowner-readable):

```ts
import { supabase } from '@/lib/supabase';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { keys } from '@/lib/queryKeys';
import { useSupabaseRealtimeSync } from '@/lib/useSupabaseRealtimeSync';
import type { JobPhoto } from '@/types';

export function useHomeownerJobPhotos(appointmentId: string | null) {
  const queryKey = keys.jobPhotos.byAppointment(appointmentId ?? '');
  const query = useOrgQuery({
    queryKey,
    enabled: !!appointmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_photos')
        .select('id, photo_url, photo_type, uploaded_at')
        .eq('appointment_id', appointmentId as string)
        .order('uploaded_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as JobPhoto[];
    },
  });

  useSupabaseRealtimeSync({
    channelName: `job-photos:homeowner:${appointmentId}`,
    table: 'job_photos',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const all = query.data ?? [];
  return {
    beforePhotos: all.filter((p) => p.photo_type === 'before'),
    afterPhotos: all.filter((p) => p.photo_type === 'after'),
    isLoading: query.isLoading,
  };
}
```

> Verify exact import paths/signatures (`keys.jobPhotos.byAppointment`, the `JobPhoto` type, `useOrgQuery` option names) against `useCleanerData.ts` before finalizing; match them.

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: zero new errors in the two hooks.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useHomeownerJobProgress.ts src/hooks/useHomeownerJobPhotos.ts
git commit -m "feat(redesign): homeowner live job-progress + photos hooks (realtime)"
```

---

### Task 8: LiveCleaningProgress + enrich the in-progress hero

**Files:**
- Create: `src/components/redesign/homeowner/home/LiveCleaningProgress.tsx`
- Modify: `src/components/redesign/homeowner/HomeownerCleaningHero.tsx` (in_progress state renders `LiveCleaningProgress`)

**Interfaces:**
- Consumes: `useHomeownerJobProgress`, `useHomeownerJobPhotos`, the Task 6 presenters, `Progress`, `checklistProgressLabel`.
- Produces: `<LiveCleaningProgress appointment={Appointment} />` shown inside the in-progress hero.

- [ ] **Step 1: Implement `LiveCleaningProgress.tsx`** (renders on the brand-gradient hero, so text is white):

```tsx
'use client';

import { useMemo } from 'react';
import type { Appointment } from '@/hooks/useHomeownerData';
import { Progress } from '@/components/ui/progress';
import { useHomeownerJobProgress } from '@/hooks/useHomeownerJobProgress';
import { useHomeownerJobPhotos } from '@/hooks/useHomeownerJobPhotos';
import { checklistProgressLabel } from '@/components/redesign/cleaner/job/active-job-presenters';
import { progressPercent, formatElapsed, stageLabel } from './job-progress-presenters';

export function LiveCleaningProgress({ appointment }: { appointment: Appointment }) {
  const { doneCount, totalCount } = useHomeownerJobProgress(
    appointment.id,
    appointment.checklist_id ?? null,
  );
  const { beforePhotos } = useHomeownerJobPhotos(appointment.id);
  const pct = progressPercent(doneCount, totalCount);
  const elapsed = useMemo(
    () => formatElapsed(appointment.started_at ?? null, Date.now()),
    [appointment.started_at],
  );

  return (
    <div className="mt-3 border-t border-white/20 pt-3">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span>{stageLabel(appointment.job_progress)}</span>
        {elapsed && <span className="tabular-nums text-white/85">{elapsed}</span>}
      </div>
      {totalCount > 0 && (
        <>
          <Progress
            value={pct}
            aria-label={checklistProgressLabel(doneCount, totalCount)}
            className="mt-2 bg-white/25"
          />
          <p className="mt-1 text-xs text-white/85 tabular-nums">
            {checklistProgressLabel(doneCount, totalCount)}
          </p>
        </>
      )}
      {beforePhotos.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {beforePhotos.slice(0, 3).map((p) => (
            <img
              key={p.id}
              src={p.photo_url}
              alt="Before photo"
              className="h-14 w-14 flex-none rounded-control object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

> The `Progress` fill is `bg-brand-600`; on the gradient the track is `bg-white/25` (passed via className). If the brand fill is low-contrast on the gradient, switch the fill to white via a `barClassName` prop on `Progress` (add the prop if needed) - keep it token-driven, no raw hex.

- [ ] **Step 2: Enrich the in-progress hero.** In `HomeownerCleaningHero.tsx`, in the `in_progress` branch, render `<LiveCleaningProgress appointment={appointment} />` below the existing where/cleaner block. Keep the empty/upcoming/complete branches unchanged here (complete handled in Task 9).

- [ ] **Step 3: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/homeowner/home/LiveCleaningProgress.tsx src/components/redesign/homeowner/HomeownerCleaningHero.tsx
git commit -m "feat(redesign): live cleaning progress on the in-progress hero"
```

---

### Task 9: CompletedCleaningRecap + enrich the complete hero

**Files:**
- Create: `src/components/redesign/homeowner/home/CompletedCleaningRecap.tsx`
- Modify: `src/components/redesign/homeowner/HomeownerCleaningHero.tsx` (complete state renders the recap)

**Interfaces:**
- Consumes: `useHomeownerJobPhotos`, `useHomeownerJobProgress`, `checklistProgressLabel`, the appointment's `payment_status` + `total_price` (already on `Appointment`).
- Produces: `<CompletedCleaningRecap appointment={Appointment} />` shown under the complete hero (after-photos + checklist-done summary + receipt line).

- [ ] **Step 1: Implement `CompletedCleaningRecap.tsx`** (rendered below the gradient hero, on the warm card surface, so default text colors):

```tsx
'use client';

import type { Appointment } from '@/hooks/useHomeownerData';
import { useHomeownerJobPhotos } from '@/hooks/useHomeownerJobPhotos';
import { useHomeownerJobProgress } from '@/hooks/useHomeownerJobProgress';
import { checklistProgressLabel } from '@/components/redesign/cleaner/job/active-job-presenters';

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function CompletedCleaningRecap({ appointment }: { appointment: Appointment }) {
  const { afterPhotos } = useHomeownerJobPhotos(appointment.id);
  const { doneCount, totalCount } = useHomeownerJobProgress(
    appointment.id,
    appointment.checklist_id ?? null,
  );
  const paid = appointment.payment_status === 'paid';

  return (
    <div className="mt-3 rounded-card border border-border bg-card p-4 shadow-soft-sm">
      {afterPhotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {afterPhotos.slice(0, 4).map((p) => (
            <img
              key={p.id}
              src={p.photo_url}
              alt="After photo"
              className="h-20 w-20 flex-none rounded-control object-cover"
            />
          ))}
        </div>
      )}
      {totalCount > 0 && (
        <p className="mt-3 text-sm font-medium text-muted-foreground tabular-nums">
          {checklistProgressLabel(doneCount, totalCount)}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{paid ? 'Paid' : 'Receipt'}</span>
        <span className="text-sm font-semibold tabular-nums">{formatUsd(appointment.total_price)}</span>
      </div>
    </div>
  );
}
```

> Confirm `Appointment.payment_status` + `total_price` shapes (they exist per Slice 1a). If the org redacts pay display, this is the homeowner's own price (not a cleaner pay-display concern), so no redaction applies.

- [ ] **Step 2: Enrich the complete hero.** In `HomeownerCleaningHero.tsx`, in the `complete` branch, render `<CompletedCleaningRecap appointment={appointment} />` under the hero.

- [ ] **Step 3: tsc + lint + unit tests**

Run: `npx tsc --noEmit && npm run lint && npm run test -- home-presenters job-progress-presenters homeowner-nav-items`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/homeowner/home/CompletedCleaningRecap.tsx src/components/redesign/homeowner/HomeownerCleaningHero.tsx
git commit -m "feat(redesign): completed-cleaning recap (after-photos + checklist + receipt)"
```

---

## Pre-PR
- [ ] `npx supabase db reset` rebuilds cleanly; `npm run test` (unit + integration) green; `npx tsc --noEmit`; `npm run lint`.
- [ ] Conformance pass (`ui-feature-workflow`): no raw hex; Progress + photos use tokens; no em dashes; white-on-gradient contrast checked for the in-progress bar.
- [ ] One Codex review (`/codex:review --scope branch --base master --wait`); apply valid fixes.
- [ ] Push + PR; verify on the Vercel preview as a homeowner with an in-progress and a completed cleaning (progress bar updates live, elapsed time, before/after photos, receipt).

## Self-review (done while writing)
- **Spec coverage:** the spec's Slice 1b items — migration (`checklist_item_completions` homeowner RLS + realtime + `started_at`/`completed_at`), `useHomeownerJobProgress`, in-progress hero with progress bar + X/Y + stage + elapsed + before-photo peek, completed recap — map to Tasks 1-9. The grace-window reuse of `started_at`/`completed_at` is satisfied by Task 1's columns (the job-messaging feature consumes them later).
- **Placeholder scan:** no TBD; every code step has real code. The "verify exact signature" notes point at real files (`useCleanerData.ts`, the lifecycle route, `tests/helpers`) rather than inventing APIs — required because these cross unchanged code.
- **Type consistency:** `useHomeownerJobProgress(appointmentId, checklistId)` and `useHomeownerJobPhotos(appointmentId)` signatures are identical across Tasks 7, 8, 9; `progressPercent/formatElapsed/stageLabel` identical across Tasks 6 and 8; `Progress({ value })` identical across Tasks 5 and 8.
- **Risk flagged for the build:** the in-progress bar fill contrast on the brand gradient (Task 8 note) and confirming the lifecycle route is actually called on job start (it fires `job_started`, so `started_at` stamping is reliable).
