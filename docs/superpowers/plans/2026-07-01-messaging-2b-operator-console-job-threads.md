# Sub-project 2b: Operator Messages console job-thread section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.
> **DEPENDS ON sub-project 2a (PR #115) being merged to master** — reuses `useJobThreadMessages`, `JobThreadTranscript`, `toJobTranscriptVM`. Branch off FRESH master after #115 lands.

**Goal:** In the operator Messages console (org-scoped office inbox from 1b), also surface the org's homeowner<->cleaner **job threads** as a visually-distinct, **read-only** section. Selecting one opens the read-only transcript in the thread pane (no composer). This is spec §5.2 (the console half of "operator read-only job threads"; the booking-detail half shipped in 2a).

**Architecture:** A new `useOrgJobThreads` hook lists the org's job threads by reducing `messages` (filtered `organization_id = org AND appointment_id IS NOT NULL`, authorized by the 089 org-staff `messages_select` policy) to one summary per appointment. A pure `toJobThreadRowVM` presenter builds display rows from each summary + the appointment the operator already loads via `useAdminAppointments`. `InboxList` renders those rows as a separate "Cleaning job threads" section (read-only badge). Selection is dual: `?c=<conversationId>` (office, replyable, unchanged) XOR `?job=<appointmentId>` (job, read-only). When a job is selected, the thread pane renders `OperatorJobThreadPane` (a header + 2a's `JobThreadTranscript` fed by `useJobThreadMessages`). No migration, no new RLS.

**Tech Stack:** Next.js `(redesign)`, React 19, TanStack Query v5, Tailwind design system; Vitest.

## Global Constraints

- Design system only (`src/components/ui/*` + tokens); brand `#0150FC`; NO raw hex; NO `primary-<number>` (legacy yellow); `bg-primary/10` (brand tint) is allowed.
- No em dashes in user-facing copy. This console is operator-facing (admin/manager wording is fine), but it renders homeowner/cleaner content read-only.
- Never import `lib/supabase-admin` from client code. New pure logic gets a co-located `*.test.ts`; the new read path gets an `*.integration.test.ts`.
- Read-only is UI-enforced (no composer on job threads); `messages` RLS is unchanged (spec §6). The office/1b path (`scope: 'org-office'`, `?c=`) must remain byte-for-byte behaviorally unchanged; all 2b additions are additive/opt-in.
- Keep `can_view_messages` gate on the console (unchanged from 1b).

## Background (verified in 2a)

- `messages.appointment_id` exists; job messages carry it. `messages_select` (089) lets any org admin/manager read every org message. So `select * from messages where organization_id = X and appointment_id is not null` returns the org's job messages to an operator with NO conversations read and NO new policy.
- 2a shipped: `useJobThreadMessages({ appointmentId })` (read-only messages-by-appointment, cursor paging, realtime), `toJobTranscriptVM(messages, { cleanerId })` -> participant-aligned rows, `JobThreadTranscript` (presentational read-only transcript, currently hard-caps height at `max-h-80`).
- `OperatorMessages` (`src/components/redesign/messages/OperatorMessages.tsx`): container. Uses `useConversations({ userId, scope: 'org-office', orgId })`, `useMessages({ conversationId: selectedId })`, `useAdminAppointments()` (exposes `appointments`), `?c=` selection via `setSelected`. Renders `OperatorMessagesView`.
- `OperatorMessagesView` -> `InboxList` (office `rows: ConversationRowVM[]`) + `MessageThreadPanel` (thread) + `ContextPanel`.
- `AdminAppointment` carries `id, homeowner {first_name,last_name}, cleaner_id, cleaner_profile.user_profile {first_name,last_name,avatar_url}, scheduled_date, scheduled_time`.

---

## Task 1: `useOrgJobThreads` hook (list org job threads)

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Create: `src/hooks/useOrgJobThreads.ts`

**Interfaces:**
- Produces: `useOrgJobThreads({ orgId, userId }) => { jobThreads: JobThreadSummary[]; loading: boolean; error: string | null }` (userId is used only for the operator's own unread count) where
  ```typescript
  interface JobThreadSummary {
    appointmentId: string;
    conversationId: string;
    lastMessageContent: string;
    lastMessageAt: string;    // ISO
    unreadCount: number;      // operator's own unread (usually 0; read-only oversight)
  }
  ```

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, add a top-level group (after `messages`):
```typescript
  jobThreads: {
    byOrg: (orgId: string) => ['job-threads', 'org', orgId] as const,
  },
```

- [ ] **Step 2: Write the hook**

Create `src/hooks/useOrgJobThreads.ts`:
```typescript
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { useVisibilityRefetch } from './useVisibilityRefetch';

export interface JobThreadSummary {
  appointmentId: string;
  conversationId: string;
  lastMessageContent: string;
  lastMessageAt: string;
  unreadCount: number;
}

// Cap: reduce the most recent N job messages to per-appointment threads. Job
// threads are low-volume; a thread whose latest activity is older than this
// window won't list here (the booking-detail panel from 2a is the complete
// per-job view). Logged, not silent, if the cap is hit.
const MESSAGE_WINDOW = 500;

/**
 * List the org's homeowner<->cleaner JOB threads for the operator console
 * (read-only). Reduces `messages` (org-scoped, appointment_id NOT NULL,
 * authorized by the 089 org-staff messages_select policy) to one summary per
 * appointment. No conversations read (job threads have no org-staff conversations
 * policy) and no new migration.
 */
export function useOrgJobThreads({ orgId, userId }: { orgId: string; userId: string }) {
  const queryKey = keys.jobThreads.byOrg(orgId);

  const query = useQuery({
    queryKey,
    enabled: !!orgId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, appointment_id, content, created_at, recipient_id, is_read')
        .eq('organization_id', orgId)
        .not('appointment_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_WINDOW);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === MESSAGE_WINDOW) {
        // eslint-disable-next-line no-console
        console.warn(`[useOrgJobThreads] hit the ${MESSAGE_WINDOW}-message window; older job threads may be omitted.`);
      }

      const byAppt = new Map<string, JobThreadSummary>();
      const unread = new Map<string, number>();
      for (const m of rows) {
        const apptId = m.appointment_id as string;
        // rows are newest-first, so the first seen per appointment is the latest.
        if (!byAppt.has(apptId)) {
          byAppt.set(apptId, {
            appointmentId: apptId,
            conversationId: m.conversation_id as string,
            lastMessageContent: (m.content as string) ?? '',
            lastMessageAt: m.created_at as string,
            unreadCount: 0,
          });
        }
        if (m.recipient_id === userId && m.is_read === false) {
          unread.set(apptId, (unread.get(apptId) ?? 0) + 1);
        }
      }
      const summaries = Array.from(byAppt.values()).map(s => ({
        ...s,
        unreadCount: unread.get(s.appointmentId) ?? 0,
      }));
      summaries.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      return summaries;
    },
  });

  // Realtime: any org message change may add/reorder a job thread. Distinct
  // channel name from 1b's org-office message channel (dedup hinges on the name).
  useSupabaseRealtimeSync({
    channelName: `messages:org:${orgId}:job-threads`,
    table: 'messages',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  useVisibilityRefetch({ keys: [queryKey], enabled: !!orgId });

  const jobThreads = useMemo(() => query.data ?? [], [query.data]);
  return { jobThreads, loading: query.isLoading, error: query.error?.message ?? null };
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (no new errors).

- [ ] **Step 4: Commit**
```bash
git add src/lib/queryKeys.ts src/hooks/useOrgJobThreads.ts
git commit -m "feat(messaging): useOrgJobThreads (list org job threads for the console)"
```

---

## Task 2: `toJobThreadRowVM` presenter (+ unit test)

**Files:**
- Create: `src/components/redesign/messages/jobThreadRow.ts`
- Create: `src/components/redesign/messages/jobThreadRow.test.ts`

**Interfaces:**
- Produces: `toJobThreadRowVM(summary, appointment, now?) => JobThreadRowVM`:
  ```typescript
  export interface JobThreadRowVM {
    appointmentId: string;
    cleanerId: string | null;   // for the transcript side derivation later
    title: string;              // "John Doe and Wanda Jones"
    dateLabel: string;          // appointment date, e.g. "Oct 15"
    preview: string;            // last message, single line
    timeLabel: string;          // time-ago of last message, e.g. "2h"
    unreadCount: number;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/components/redesign/messages/jobThreadRow.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { toJobThreadRowVM } from './jobThreadRow';

const NOW = new Date('2026-06-30T12:00:00Z');

const summary = {
  appointmentId: 'appt-1',
  conversationId: 'conv-1',
  lastMessageContent: 'Gate code is 1234',
  lastMessageAt: '2026-06-30T10:00:00Z',
  unreadCount: 2,
};

const appt = {
  id: 'appt-1',
  cleaner_id: 'cln-1',
  scheduled_date: '2026-10-15',
  homeowner: { first_name: 'John', last_name: 'Doe' },
  cleaner_profile: { user_profile: { first_name: 'Wanda', last_name: 'Jones' } },
};

describe('toJobThreadRowVM', () => {
  it('builds the title from the homeowner and cleaner names', () => {
    const vm = toJobThreadRowVM(summary, appt as never, NOW);
    expect(vm.title).toBe('John Doe and Wanda Jones');
    expect(vm.cleanerId).toBe('cln-1');
    expect(vm.preview).toBe('Gate code is 1234');
    expect(vm.unreadCount).toBe(2);
  });

  it('falls back to generic labels when the appointment is missing', () => {
    const vm = toJobThreadRowVM(summary, undefined, NOW);
    expect(vm.title).toBe('Homeowner and cleaner');
    expect(vm.cleanerId).toBeNull();
  });

  it('formats a short time-ago label', () => {
    const vm = toJobThreadRowVM(summary, appt as never, NOW);
    expect(vm.timeLabel).toBe('2h');
  });
});
```

- [ ] **Step 2: Run -> RED.** `npm run test:unit -- jobThreadRow`

- [ ] **Step 3: Implement**

Create `src/components/redesign/messages/jobThreadRow.ts`:
```typescript
import type { JobThreadSummary } from '@/hooks/useOrgJobThreads';

export interface JobThreadRowVM {
  appointmentId: string;
  cleanerId: string | null;
  title: string;
  dateLabel: string;
  preview: string;
  timeLabel: string;
  unreadCount: number;
}

interface ApptLike {
  id: string;
  cleaner_id?: string | null;
  scheduled_date?: string | null;
  homeowner?: { first_name?: string | null; last_name?: string | null } | null;
  cleaner_profile?: { user_profile?: { first_name?: string | null; last_name?: string | null } | null } | null;
}

function fullName(p?: { first_name?: string | null; last_name?: string | null } | null): string {
  return `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
}

function monthDay(s?: string | null): string {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return monthDay(new Date(iso).toISOString().slice(0, 10));
}

/**
 * Build a read-only job-thread row for the operator console from a message-derived
 * summary + the appointment the operator already loads. Falls back to generic
 * labels when the appointment is not in the loaded set.
 */
export function toJobThreadRowVM(
  summary: JobThreadSummary,
  appointment: ApptLike | undefined,
  now: Date = new Date(),
): JobThreadRowVM {
  const home = fullName(appointment?.homeowner) || 'Homeowner';
  const cleaner = fullName(appointment?.cleaner_profile?.user_profile) || 'cleaner';
  const title = appointment ? `${home} and ${cleaner}` : 'Homeowner and cleaner';
  return {
    appointmentId: summary.appointmentId,
    cleanerId: appointment?.cleaner_id ?? null,
    title,
    dateLabel: monthDay(appointment?.scheduled_date),
    preview: summary.lastMessageContent || 'Photo',
    timeLabel: timeAgo(summary.lastMessageAt, now),
    unreadCount: summary.unreadCount,
  };
}
```

- [ ] **Step 4: Run -> GREEN.** `npm run test:unit -- jobThreadRow`

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/messages/jobThreadRow.ts src/components/redesign/messages/jobThreadRow.test.ts
git commit -m "feat(messaging): toJobThreadRowVM console job-thread row presenter (+ tests)"
```

---

## Task 3: `JobThreadRow` component + `InboxList` job section + transcript height prop

**Files:**
- Create: `src/components/redesign/messages/JobThreadRow.tsx`
- Modify: `src/components/redesign/messages/InboxList.tsx`
- Modify: `src/components/redesign/messages/JobThreadTranscript.tsx` (add an optional height override so the console pane can fill; default keeps 2a's `max-h-80`)

**Interfaces:**
- `InboxList` gains optional props: `jobRows?: JobThreadRowVM[]`, `selectedJobId?: string | null`, `onSelectJob?: (appointmentId: string) => void`. When `jobRows` is non-empty it renders a labeled read-only section beneath the office conversations. Existing office behavior is unchanged when the props are omitted.
- `JobThreadTranscript` gains optional `maxHeightClassName?: string` (default `'max-h-80'`).

- [ ] **Step 1: `JobThreadRow` component**

Create `src/components/redesign/messages/JobThreadRow.tsx`:
```tsx
'use client';

import { cn } from '@/lib/utils';
import type { JobThreadRowVM } from './jobThreadRow';

export function JobThreadRow({
  row,
  active,
  onSelect,
}: {
  row: JobThreadRowVM;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-0.5 border-l-2 px-4 py-3 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{row.title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{row.timeLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        {row.dateLabel && (
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{row.dateLabel}</span>
        )}
        <span className="truncate text-xs text-muted-foreground">{row.preview}</span>
      </div>
    </button>
  );
}
```
(Read-only: no delete affordance, no unread pip beyond the section framing. Uses design tokens only.)

- [ ] **Step 2: Render the job section in `InboxList`**

Add the three optional props to `InboxList`'s prop type and import `JobThreadRow` + `JobThreadRowVM`. After the office conversation list (inside the scroll container, below the `props.rows.map(...)` block), render:
```tsx
{props.jobRows && props.jobRows.length > 0 && (
  <div className="mt-1 border-t border-border/60 pt-2">
    <div className="flex items-center gap-2 px-4 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Cleaning job threads
      </span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Read only
      </span>
    </div>
    {props.jobRows.map((row) => (
      <JobThreadRow
        key={row.appointmentId}
        row={row}
        active={row.appointmentId === props.selectedJobId}
        onSelect={() => props.onSelectJob?.(row.appointmentId)}
      />
    ))}
  </div>
)}
```
Keep the existing empty-state logic keyed on `props.rows` only (the office list); the job section is supplementary. Do not let the job section change the office `rows.length === 0` empty state.

- [ ] **Step 3: `JobThreadTranscript` height override**

In `JobThreadTranscript.tsx`, add `maxHeightClassName = 'max-h-80'` to the props and replace the hard-coded `max-h-80` on the scroll container with `maxHeightClassName`. Default preserves 2a behavior (the booking panel passes nothing).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run lint`. Run the **ui-ux-pro-max** implementation-phase conformance check (manual token audit if the CLI is still absent, as in 2a): tokens only, read-only section visually distinct, no `primary-<number>`.

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/messages/JobThreadRow.tsx src/components/redesign/messages/InboxList.tsx src/components/redesign/messages/JobThreadTranscript.tsx
git commit -m "feat(messaging): console job-thread row + inbox section + transcript height prop"
```

---

## Task 4: `OperatorJobThreadPane` + wire dual selection into the console

**Files:**
- Create: `src/components/redesign/messages/OperatorJobThreadPane.tsx`
- Modify: `src/components/redesign/messages/OperatorMessages.tsx`
- Modify: `src/components/redesign/messages/OperatorMessagesView.tsx`

**Interfaces:**
- `OperatorJobThreadPane` reads + renders a single job thread read-only: props `{ appointmentId: string; title: string; dateLabel: string; cleanerId: string | null; onBack?: () => void }`. Uses `useJobThreadMessages` + `toJobTranscriptVM` + `JobThreadTranscript` (full-height).
- `OperatorMessages` adds a `?job=<appointmentId>` selection, mutually exclusive with `?c=`, and passes the job section + active job pane to the View.

- [ ] **Step 1: `OperatorJobThreadPane`**

Create `src/components/redesign/messages/OperatorJobThreadPane.tsx`:
```tsx
'use client';

import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useJobThreadMessages } from '@/hooks/useJobThreadMessages';
import { toJobTranscriptVM } from './jobTranscript';
import { JobThreadTranscript } from './JobThreadTranscript';

export function OperatorJobThreadPane({
  appointmentId,
  title,
  dateLabel,
  cleanerId,
  onBack,
}: {
  appointmentId: string;
  title: string;
  dateLabel: string;
  cleanerId: string | null;
  onBack?: () => void;
}) {
  const { messages, loading, hasMore, isLoadingMore, loadMoreMessages } = useJobThreadMessages({ appointmentId });
  const rows = useMemo(() => toJobTranscriptVM(messages, { cleanerId }), [messages, cleanerId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border/60 bg-card px-3 py-2.5">
        {onBack && (
          <IconButton aria-label="Back to conversations" className="h-9 w-9 lg:hidden" onClick={onBack}>
            <ArrowLeft className="size-5" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">
            {dateLabel ? `${dateLabel} · ` : ''}Read only
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
        <JobThreadTranscript
          rows={rows}
          loading={loading}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreMessages}
          conversationKey={appointmentId}
          maxHeightClassName="max-h-full"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Dual selection in `OperatorMessages`**

- Read `const jobParam = searchParams.get('job')`.
- Add a `setSelectedJob(appointmentId: string)` that sets `?job=` and clears `?c=`/`to`/`appointment`; and make the existing `setSelected` (office) also clear `?job=`.
- `const { jobThreads } = useOrgJobThreads({ orgId: currentOrganizationId ?? '', userId })`.
- Build `apptById` already exists; build `jobRows = jobThreads.map(s => toJobThreadRowVM(s, apptById.get(s.appointmentId)))`.
- `const selectedJob = jobParam ? (jobRows.find(r => r.appointmentId === jobParam) ?? null) : null`.
- Pass to the View: `jobRows`, `selectedJobId: jobParam`, `onSelectJob: setSelectedJob`, and the active job pane inputs (`selectedJob`).
- When `selectedJob` is set, the View renders `OperatorJobThreadPane` instead of the office `MessageThreadPanel`. Office selection (`selectedId`) and `selectedJob` are mutually exclusive by construction (each setter clears the other param).

- [ ] **Step 3: `OperatorMessagesView` renders the active pane**

- Thread `renderThread`: when `props.selectedJob` is set, render `<OperatorJobThreadPane appointmentId={props.selectedJob.appointmentId} title={props.selectedJob.title} dateLabel={props.selectedJob.dateLabel} cleanerId={props.selectedJob.cleanerId} onBack={onBack} />`; else render the existing office `MessageThreadPanel` unchanged.
- `hasSelection` becomes `!!props.selectedId || !!props.selectedJob` (so the mobile takeover opens for a job thread too). The mobile takeover's `onClosed` must clear whichever selection is active.
- Pass `jobRows`, `selectedJobId`, `onSelectJob` into `InboxList`.
- The About/`ContextPanel` column only applies to office threads; when a job thread is selected, do not show it (job threads have no operator "contact" context).

- [ ] **Step 4: Verify + manual**

Run: `npx tsc --noEmit` + `npm run lint`. Manual (local dev, admin@nexxus.com): the console shows office threads (replyable) + a "Cleaning job threads · Read only" section; clicking a job thread opens the read-only transcript (no composer); clicking an office thread still replies normally; the two selections don't collide.

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/messages/OperatorJobThreadPane.tsx src/components/redesign/messages/OperatorMessages.tsx src/components/redesign/messages/OperatorMessagesView.tsx
git commit -m "feat(messaging): operator console job-thread section + read-only pane (dual selection)"
```

---

## Task 5: Integration test — operator lists org job threads (RLS-backed)

**Files:**
- Create: `src/app/api/_messaging/operator-console-job-threads-rls.integration.test.ts`

- [ ] **Step 1: Write the test**

Read a sibling `_messaging/*.integration.test.ts` for exact helper usage. Seed via service role: org A (admin A1, homeowner H, cleaner C); TWO appointments in A (each with H + C via `createTestAppointment`); a job conversation + one message per appointment (`appointment_id` set, `organization_id = A`). Org B with manager B1.

Assert with RLS user-clients (mirror the 2a `job-thread-operator-read-rls` style, but for the LIST query the hook uses):
1. `A1` reads the org's job messages via `select ... from messages where organization_id = A and appointment_id not null` -> returns rows spanning BOTH appointments (i.e. `new Set(rows.map(r => r.appointment_id)).size === 2`).
2. `B1` (other org) runs the same query -> empty.
3. (Guard) `A1` selecting the job `conversations` rows by id -> empty (no job conversations policy; the console lists from messages, not conversations).

- [ ] **Step 2: Run -> GREEN** (Supabase up). `npm run test:integration -- operator-console-job-threads-rls`. Run in isolation.

- [ ] **Step 3: Commit**
```bash
git add src/app/api/_messaging/operator-console-job-threads-rls.integration.test.ts
git commit -m "test(messaging): operator lists org job threads by org + appointment_id (RLS)"
```

---

## Self-Review
- **Spec coverage:** §5.2 (org-scoped console lists read-only job threads, visually distinct from replyable office threads, no composer). The booking-detail half is 2a.
- **Reuse:** consumes 2a's `useJobThreadMessages` + `toJobTranscriptVM` + `JobThreadTranscript` (with the additive height prop); no duplicate read logic.
- **Non-regression:** the 1b org-office path (`scope: 'org-office'`, `?c=`, office reply) is untouched; every 2b addition is opt-in (new props default off, new `?job=` param, new list hook). `can_view_messages` gate preserved.
- **No migration / no RLS change:** the list reads `messages` by org + `appointment_id` (089). Read-only is UI-enforced (spec §6).
- **Known/accepted:** the list caps at the most recent `MESSAGE_WINDOW` job messages (logged if hit); per-recipient unread (operator's own) rather than a team-wide model, matching 1b. Both documented.
