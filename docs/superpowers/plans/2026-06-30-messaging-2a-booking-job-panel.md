# Sub-project 2a: Operator booking-detail "Messages on this job" panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** On the redesign operator Booking detail sheet, show a read-only **"Messages on this job"** panel: the homeowner<->cleaner per-appointment thread, view-only (the office never posts into it). Reads `messages` by `appointment_id` via the existing org-staff `messages_select` policy (089). No migration, no new RLS.

**Architecture:** A read-only messages-by-appointment hook (`useJobThreadMessages`) mirrors `useMessages`' read/paging/realtime but is keyed by `appointment_id` (the column the guarded send route already stamps on every job message) and has no mark-as-read/compose. A pure presenter (`toJobTranscriptVM`) turns enriched messages into participant-labeled transcript rows (the operator is neither party, so `MessageBubble`'s mine/theirs alignment is wrong; we render a 2-sided transcript: cleaner one side, homeowner the other, each with a name label). A presentational `JobThreadTranscript` renders those rows from design-system primitives (reused later by sub-project 2b's console). `JobMessagesPanel` wires the hook + presenter + transcript and is mounted inside `BookingDetailSheet` when the appointment has both a homeowner and a cleaner.

**Tech Stack:** Next.js `(redesign)` route group, React 19, TanStack Query v5, Tailwind design system; Vitest (unit + integration against local Supabase).

## Global Constraints

- Design system only (`src/components/ui/*` + tokens); brand `#0150FC`; **no raw hex**; **no `primary-<number>`** (legacy yellow); semantic shades `-50`/`-700` (no `critical-600`).
- **No em dashes** in user-facing copy. **"Office" not "operator"** in any CUSTOMER-facing string (this panel is operator-facing, so admin/manager wording is fine; but the panel renders homeowner/cleaner content, so any chrome copy stays plain).
- Never import `lib/supabase-admin` from client code. New pure logic gets a co-located `*.test.ts`; the new read path gets an `*.integration.test.ts`.
- Read-only is enforced at the UI layer (no composer, no send path). Per spec §6 the `messages` RLS is unchanged; the DB still permits org staff to insert (089 branch 2), but no shipped UI exposes a composer on a job thread. Do NOT add a composer here.
- Do not change `useMessages`' behavior for its existing callers; the only edit to it is to `export` an existing helper.

## Background (verified)

- `messages.appointment_id uuid` exists (baseline FK `messages_appointment_id_fkey`); the guarded route `POST /api/appointments/[appointmentId]/messages` stamps it on every job message (`route.ts:152`).
- `messages_select` (089): `... or ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))` — any org admin/manager reads every org message. So `select * from messages where appointment_id = X` returns the job thread to an operator who is org staff, with **no conversation row read and no new policy**.
- `useMessages` (`src/hooks/useMessages.ts`): reads `messages` by `conversation_id`, enriches via a module-private `enrichMessages(messagesData)` (fetches `user_profiles` for sender/recipient + `message_attachments`), reverses to chronological, cursor-pages via `loadMoreMessages`, and subscribes realtime. `markMessagesAsRead`/auto-mark filter `recipient_id = userId`, so they no-op for a non-participant operator.
- `MessageWithDetails` (from `@/types`) carries `id, sender_id, recipient_id, content, created_at, conversation_id, appointment_id, is_read, sender: UserProfile|null, recipient: UserProfile|null, attachments`.
- `BookingDetailSheet` (`src/components/redesign/bookings/BookingDetailSheet.tsx`) is presentational; it receives `detail: BookingDetailVM` with `id` (appointmentId), `customer` (homeowner name), `customerId`, `cleaner` (cleaner name), `cleanerId`. It already renders "Message customer"/"Message cleaner" buttons (those open the OPERATOR's own thread; the new panel is the SEPARATE homeowner<->cleaner thread).
- `keys` (`src/lib/queryKeys.ts`) is a flat factory; `messages` currently has `byConversation` + `unreadCount`.

---

## Task 1: `useJobThreadMessages` read-only hook (messages by appointment_id)

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/hooks/useMessages.ts` (export `enrichMessages`)
- Create: `src/hooks/useJobThreadMessages.ts`

**Interfaces:**
- Produces: `useJobThreadMessages({ appointmentId, limit? }) => { messages: MessageWithDetails[]; loading: boolean; hasMore: boolean; isLoadingMore: boolean; loadMoreMessages: () => Promise<number>; messagesEndRef: RefObject<HTMLDivElement>; error: string | null }`. `messages` is chronological (oldest first).

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, extend the `messages` group:
```typescript
  messages: {
    byConversation: (convId: string) => ['messages', 'conversation', convId] as const,
    byAppointment: (apptId: string) => ['messages', 'appointment', apptId] as const,
    unreadCount: (userId: string, scope: 'office' | 'all' = 'office') =>
      ['messages', 'unread', userId, scope] as const,
  },
```

- [ ] **Step 2: Export `enrichMessages` from `useMessages.ts`**

Change its declaration from `async function enrichMessages(` to `export async function enrichMessages(` (no other change). This is the only edit to `useMessages.ts`; its callers are unaffected.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useJobThreadMessages.ts`:
```typescript
'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { useVisibilityRefetch } from './useVisibilityRefetch';
import { enrichMessages } from './useMessages';
import { MessageWithDetails } from '../types';

interface UseJobThreadMessagesOptions {
  /** The appointment whose homeowner<->cleaner job thread to read. */
  appointmentId: string | null;
  limit?: number;
}

/**
 * Read-only view of a per-appointment homeowner<->cleaner job thread for an
 * OPERATOR (admin/manager). Reads `messages` by `appointment_id` (authorized by
 * the 089 messages_select org-staff policy) without touching the conversation
 * row (operators have no conversations read policy for job threads). No
 * mark-as-read, no compose: the office views these threads but never posts into
 * them. Realtime invalidates on any change to the thread (low volume; simpler
 * and safer than re-implementing useMessages' optimistic append for a view that
 * never sends).
 */
export function useJobThreadMessages({ appointmentId, limit = 30 }: UseJobThreadMessagesOptions) {
  const queryClient = useQueryClient();
  const queryKey = keys.messages.byAppointment(appointmentId ?? '');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [hasMore, setHasMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const query = useQuery({
    queryKey,
    enabled: !!appointmentId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const currentCount = queryClient.getQueryData<MessageWithDetails[]>(queryKey)?.length ?? 0;
      const fetchN = Math.max(limit, currentCount);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('appointment_id', appointmentId as string)
        .order('created_at', { ascending: false })
        .limit(fetchN);

      if (error) throw error;
      if (!data || data.length === 0) {
        setHasMore(false);
        return [] as MessageWithDetails[];
      }
      const enriched = await enrichMessages(data);
      setHasMore(data.length === fetchN);
      return [...enriched].reverse();
    },
  });

  // Realtime: any insert/update on this appointment's messages refetches.
  useSupabaseRealtimeSync({
    channelName: `messages:appointment:${appointmentId ?? ''}`,
    table: 'messages',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  useVisibilityRefetch({ keys: [queryKey], enabled: !!appointmentId });

  const loadMoreMessages = useCallback(async (): Promise<number> => {
    if (!appointmentId || loadingMoreRef.current || !hasMore) return 0;
    const list = queryClient.getQueryData<MessageWithDetails[]>(queryKey) ?? [];
    if (list.length === 0) return 0;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const cursor = list[0].created_at;
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('appointment_id', appointmentId)
        .lt('created_at', cursor)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data || data.length === 0) {
        setHasMore(false);
        return 0;
      }
      const enriched = await enrichMessages(data);
      const older = [...enriched].reverse();
      let added = 0;
      queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev => {
        const existing = prev ?? [];
        const ids = new Set(existing.map(m => m.id));
        const fresh = older.filter(m => !ids.has(m.id));
        added = fresh.length;
        return fresh.length ? [...fresh, ...existing] : existing;
      });
      setHasMore(data.length === limit);
      return added;
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [appointmentId, queryClient, queryKey, limit, hasMore]);

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    hasMore,
    isLoadingMore,
    loadMoreMessages,
    messagesEndRef,
  };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` (no new errors). The hook compiles and `enrichMessages` resolves from `./useMessages`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/queryKeys.ts src/hooks/useMessages.ts src/hooks/useJobThreadMessages.ts
git commit -m "feat(messaging): useJobThreadMessages read-only hook (messages by appointment_id)"
```

---

## Task 2: `toJobTranscriptVM` pure presenter (+ unit test)

**Files:**
- Create: `src/components/redesign/messages/jobTranscript.ts`
- Create: `src/components/redesign/messages/jobTranscript.test.ts`

**Interfaces:**
- Produces: `toJobTranscriptVM(messages, { cleanerId, now? }) => JobTranscriptRowVM[]` and the `JobTranscriptRowVM` type.

- [ ] **Step 1: Write the failing test**

Create `src/components/redesign/messages/jobTranscript.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { toJobTranscriptVM } from './jobTranscript';

const NOW = new Date('2026-06-30T18:00:00Z');

function msg(over: Partial<Parameters<typeof toJobTranscriptVM>[0][number]> = {}) {
  return {
    id: 'm1',
    sender_id: 'home-1',
    content: 'hello',
    created_at: '2026-06-30T17:00:00Z',
    sender: { first_name: 'Hank', last_name: 'Homeowner', role: 'homeowner' },
    ...over,
  };
}

describe('toJobTranscriptVM', () => {
  it('sides a cleaner-sent message to the cleaner and others to the homeowner', () => {
    const rows = toJobTranscriptVM(
      [
        msg({ id: 'a', sender_id: 'home-1' }),
        msg({ id: 'b', sender_id: 'cln-1', sender: { first_name: 'Cara', last_name: 'Cleaner', role: 'cleaner' } }),
      ],
      { cleanerId: 'cln-1', now: NOW },
    );
    expect(rows.map(r => r.side)).toEqual(['homeowner', 'cleaner']);
    expect(rows[1].senderName).toBe('Cara');
  });

  it('falls back to a role label when the sender profile has no name', () => {
    const rows = toJobTranscriptVM([msg({ sender: null })], { cleanerId: 'cln-1', now: NOW });
    expect(rows[0].senderName).toBe('Homeowner');
  });

  it('shows a day divider on the first message and when the day changes', () => {
    const rows = toJobTranscriptVM(
      [
        msg({ id: 'a', created_at: '2026-06-29T10:00:00Z' }),
        msg({ id: 'b', created_at: '2026-06-29T11:00:00Z' }),
        msg({ id: 'c', created_at: '2026-06-30T09:00:00Z' }),
      ],
      { cleanerId: 'cln-1', now: NOW },
    );
    expect(rows.map(r => r.showDayDivider)).toEqual([true, false, true]);
    expect(rows[2].dayLabel).toBe('Today');
  });
});
```

- [ ] **Step 2: Run it to confirm RED**

Run: `npm run test:unit -- jobTranscript`
Expected: FAIL ("toJobTranscriptVM is not a function" / module not found).

- [ ] **Step 3: Implement the presenter**

Create `src/components/redesign/messages/jobTranscript.ts`:
```typescript
export interface JobTranscriptRowVM {
  id: string;
  /** cleaner = aligned to one side, homeowner = the other. */
  side: 'homeowner' | 'cleaner';
  senderName: string;
  content: string;
  timeLabel: string;   // "1:00 PM"
  dayLabel: string;    // "Today" / "Yesterday" / "Jun 29"
  showDayDivider: boolean;
}

interface TranscriptInput {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: { first_name?: string | null; last_name?: string | null; role?: string | null } | null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Build a read-only, participant-labeled transcript of a homeowner<->cleaner job
 * thread for an OPERATOR (who is neither party). The cleaner's messages align to
 * one side, the homeowner's to the other, each labeled with the sender's name (or
 * a role fallback). Day dividers mark the first message and each day change.
 */
export function toJobTranscriptVM(
  messages: TranscriptInput[],
  opts: { cleanerId: string | null; now?: Date },
): JobTranscriptRowVM[] {
  const now = opts.now ?? new Date();
  let prevDay: number | null = null;
  return messages.map(m => {
    const d = new Date(m.created_at);
    const side: 'homeowner' | 'cleaner' =
      opts.cleanerId && m.sender_id === opts.cleanerId ? 'cleaner' : 'homeowner';
    const name = `${m.sender?.first_name ?? ''} ${m.sender?.last_name ?? ''}`.trim();
    const senderName = name || (side === 'cleaner' ? 'Cleaner' : 'Homeowner');
    const day = startOfDay(d);
    const showDayDivider = prevDay === null || day !== prevDay;
    prevDay = day;
    return {
      id: m.id,
      side,
      senderName,
      content: m.content,
      timeLabel: timeLabel(d),
      dayLabel: dayLabel(d, now),
      showDayDivider,
    };
  });
}
```

- [ ] **Step 4: Run it to confirm GREEN**

Run: `npm run test:unit -- jobTranscript`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/messages/jobTranscript.ts src/components/redesign/messages/jobTranscript.test.ts
git commit -m "feat(messaging): toJobTranscriptVM read-only transcript presenter (+ tests)"
```

---

## Task 3: `JobThreadTranscript` presentational component

**Files:**
- Create: `src/components/redesign/messages/JobThreadTranscript.tsx`

**Interfaces:**
- Consumes: `JobTranscriptRowVM[]` (Task 2).
- Produces: `<JobThreadTranscript rows loading hasMore isLoadingMore onLoadMore />` — a read-only, scrollable transcript. Reused by sub-project 2b's console.

- [ ] **Step 1: Write the component**

Create `src/components/redesign/messages/JobThreadTranscript.tsx`:
```tsx
'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { JobTranscriptRowVM } from './jobTranscript';

/**
 * Read-only transcript of a homeowner<->cleaner job thread for an operator. The
 * operator is neither party, so messages are labeled by sender and aligned by
 * participant (cleaner right, homeowner left) instead of the mine/theirs bubble
 * used in 2-party chat. No composer: the office never posts into a job thread.
 */
export function JobThreadTranscript({
  rows,
  loading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  emptyText = 'No messages between the homeowner and cleaner yet.',
}: {
  rows: JobTranscriptRowVM[];
  loading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  emptyText?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) onLoadMore();
      },
      { root: scrollRef.current, rootMargin: '120px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className={cn('h-9 rounded-card', i % 2 ? 'w-2/3 ml-auto' : 'w-1/2')} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <MessageSquare className="size-5 text-muted-foreground" aria-hidden />
        <p className="max-w-xs text-xs text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {isLoadingMore && (
        <div className="flex justify-center py-1">
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      )}
      {rows.map(row => (
        <div key={row.id} className="flex flex-col gap-1">
          {row.showDayDivider && (
            <div className="self-center py-1 text-[11px] font-semibold text-muted-foreground">
              {row.dayLabel}
            </div>
          )}
          <div className={cn('flex flex-col', row.side === 'cleaner' ? 'items-end' : 'items-start')}>
            <div className="px-1 text-[11px] font-semibold text-muted-foreground">
              {row.senderName}
              <span className="ml-1.5 font-normal">{row.timeLabel}</span>
            </div>
            <div
              className={cn(
                'mt-0.5 max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-sm',
                row.side === 'cleaner'
                  ? 'bg-primary/10 text-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {row.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` + `npm run lint` (no new errors; only design-system tokens used: `bg-muted`, `bg-primary/10`, `text-foreground`, `text-muted-foreground`, `rounded-card` — no raw hex, no `primary-<number>`).

- [ ] **Step 3: Commit**
```bash
git add src/components/redesign/messages/JobThreadTranscript.tsx
git commit -m "feat(messaging): JobThreadTranscript read-only presentational view"
```

---

## Task 4: `JobMessagesPanel` + mount in `BookingDetailSheet`

**Files:**
- Create: `src/components/redesign/bookings/JobMessagesPanel.tsx`
- Modify: `src/components/redesign/bookings/BookingDetailSheet.tsx`

**Interfaces:**
- Consumes: `useJobThreadMessages` (Task 1), `toJobTranscriptVM` (Task 2), `JobThreadTranscript` (Task 3).
- `BookingDetailSheet` renders `<JobMessagesPanel appointmentId cleanerId />` when `detail.customerId && detail.cleanerId` are both present.

- [ ] **Step 1: Write the panel**

Create `src/components/redesign/bookings/JobMessagesPanel.tsx`:
```tsx
'use client';

import { useMemo } from 'react';
import { useJobThreadMessages } from '@/hooks/useJobThreadMessages';
import { toJobTranscriptVM } from '@/components/redesign/messages/jobTranscript';
import { JobThreadTranscript } from '@/components/redesign/messages/JobThreadTranscript';

/**
 * Read-only "Messages on this job" panel for the operator booking detail. Shows
 * the homeowner<->cleaner per-appointment thread (view-only). Only render this
 * when the appointment has both a homeowner and an assigned cleaner (a job thread
 * needs both participants).
 */
export function JobMessagesPanel({
  appointmentId,
  cleanerId,
}: {
  appointmentId: string;
  cleanerId: string;
}) {
  const { messages, loading, hasMore, isLoadingMore, loadMoreMessages } = useJobThreadMessages({
    appointmentId,
  });

  const rows = useMemo(() => toJobTranscriptVM(messages, { cleanerId }), [messages, cleanerId]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Messages on this job
      </div>
      <p className="text-xs text-muted-foreground">
        The conversation between the homeowner and the cleaner. View only.
      </p>
      <JobThreadTranscript
        rows={rows}
        loading={loading}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMoreMessages}
      />
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `BookingDetailSheet`**

In `src/components/redesign/bookings/BookingDetailSheet.tsx`:
1. Add the import near the other local imports:
```tsx
import { JobMessagesPanel } from "./JobMessagesPanel";
```
2. Insert the panel as its own section right AFTER the "Message customer / Message cleaner" buttons block (the `{detail.customerId || detail.cleanerId ? (...) : null}` block, around line 147-160) and BEFORE the `{canViewPayments ? (...)}` block. Use a `Separator` so it reads as a distinct section:
```tsx
{detail.customerId && detail.cleanerId ? (
  <>
    <Separator />
    <JobMessagesPanel appointmentId={detail.id} cleanerId={detail.cleanerId} />
  </>
) : null}
```
(`Separator` is already imported. The panel renders its own empty state when the thread has no messages, so it is safe to always show when both participants exist.)

- [ ] **Step 3: Verify (types, lint, conformance)**

Run: `npx tsc --noEmit` + `npm run lint`.
Then run the **ui-ux-pro-max** skill at the implementation phase against the new panel + transcript for design-system conformance (no raw hex / off-system styling; touch targets; read-only clarity). The CLI on this machine needs the full Python 3.11 exe (the `python`/`python3` aliases are Store stubs) — the ui-ux-pro-max skill carries the canonical command.

- [ ] **Step 4: Commit**
```bash
git add src/components/redesign/bookings/JobMessagesPanel.tsx src/components/redesign/bookings/BookingDetailSheet.tsx
git commit -m "feat(messaging): read-only 'Messages on this job' panel on the booking detail"
```

---

## Task 5: Integration test — operator org-staff reads job messages by appointment_id

**Files:**
- Create: `src/app/api/_messaging/job-thread-operator-read-rls.integration.test.ts`

**Interfaces:**
- Consumes the existing helpers exactly as the sibling tests do. **Read `src/app/api/_messaging/messages-org-membership-rls.integration.test.ts` and `src/app/api/_messaging/operator-org-office-reply-rls.integration.test.ts` FIRST** to copy the real helper signatures (`createTestSupabaseClient`, `withTestOrg`, the RLS user-client helper, `createTestAppointment` or the appointment fixture, and how a job message + `get_or_create_job_conversation` are seeded). Do not invent helper names.

- [ ] **Step 1: Write the test**

Seed via the service-role client: org A with admin `A1`, homeowner `H`, cleaner `C` (all members of A); an appointment `appt` in A with `homeowner_id = H`, `cleaner_id = C`; a job conversation via `get_or_create_job_conversation(H, C, appt.id)`; and a job message in it with `organization_id = A`, `appointment_id = appt.id`, `sender_id = H`, `recipient_id = C`. Org B with manager `B1`.

Assert with RLS user-clients:
1. **`A1` (org admin, NOT a participant) CAN read the job message by appointment_id**: `select * from messages where appointment_id = appt.id` returns the row (089 org-staff read).
2. **`B1` (other org) CANNOT**: the same select returns empty.
3. **A participant still reads it** (sanity): `H` (or `C`) `select ... where appointment_id = appt.id` returns the row.

Match the assertion style of the sibling `_messaging` tests (RLS client returns `data` non-empty / empty array). Run the file in isolation (the integration suite flakes on parallel GoTrue auth).

- [ ] **Step 2: Run it -> GREEN**

Requires local Supabase up + `.env.test.local`.
Run: `npm run test:integration -- job-thread-operator-read-rls`
Expected: PASS (3 assertions). If RED on assertion 1, the operator read path is broken — stop and re-check the 089 policy / seeding before proceeding.

- [ ] **Step 3: Commit**
```bash
git add src/app/api/_messaging/job-thread-operator-read-rls.integration.test.ts
git commit -m "test(messaging): operator org-staff reads job messages by appointment_id (RLS)"
```

---

## Self-Review
- **Spec coverage:** §5.3 (operator booking-detail read-only "Messages on this job" panel, reads `messages` by `appointment_id` via the org-staff policy, no conversations policy). §5.2 (console job-thread section) is explicitly sub-project **2b**, not here.
- **No migration / no RLS change:** the read path uses the existing 089 `messages_select`. Per spec §6, `messages` RLS is unchanged. Read-only is UI-enforced (no composer); the panel never calls a send path.
- **Non-regression:** `useMessages` only gains an `export` on an existing helper; its callers are untouched. `BookingDetailSheet` gains one additive section guarded on both participants existing; all existing fields/actions are unchanged.
- **Design system:** transcript uses tokens only (`bg-muted`, `bg-primary/10`, `text-foreground`, `text-muted-foreground`, `rounded-card`); ui-ux-pro-max conformance is a required step in Task 4.
- **Reuse:** `JobThreadTranscript` + `toJobTranscriptVM` are built as reusable primitives so sub-project 2b's console read-only thread renders identically.
- **Known/accepted:** DB still permits org staff to insert into a job thread (089 branch 2); no shipped UI exposes a composer there. A DB-level `appointment_id IS NULL` insert restriction is a possible later hardening but deviates from spec §6 and is out of scope here.
