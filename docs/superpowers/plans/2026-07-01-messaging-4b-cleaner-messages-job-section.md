# Messaging 4b: Cleaner Messages tab — "Your cleanings" job section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cleaner Messages tab a sectioned inbox (Office + Your cleanings + Past) so the cleaner can return to any homeowner<->cleaner job thread (active or past) from Messages, not only from an active job; and count job-thread unread in the nav badge.

**Architecture:** Restructure the cleaner Messages tab from the collapsing single-office model (`deriveOfficeInbox` with 0/1/>=2 modes) to a **sectioned** inbox that mirrors the shipped homeowner Messages tab (`deriveHomeownerInbox` / `HomeownerMessagesView`), adapted to the cleaner's surface (counterparty = the homeowner; office = the org's admins/managers via the existing office-contacts picker; the cleaner app's existing flat-list row visual, not the homeowner's card visual). Job rows open the existing 4a `CleanerJobThreadHost` (`?jobthread=<appointmentId>`); office rows open the existing `CleanerMessageThreadHost` (`?thread=`/`?to=`). No migration, no route, no RLS change — the cleaner is already a participant of these threads and reads via `useConversations`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, Supabase client + RLS.

## Global Constraints

- Design system only (`src/components/ui/*` + tokens in `tailwind.config.js` / `src/app/globals.css`); brand `#0150FC`; no raw hex.
- **No `primary-<number>`** utility classes (legacy yellow). Bare `primary` / `bg-primary/10` / `brand-600` = brand blue and allowed; semantic shades `-50` / `-700` only.
- No em dashes in user-facing copy (labels, buttons, empty states, notices). Use a period, comma, parentheses, or "to" for ranges.
- Cleaner-facing copy must NOT say "operator". The cleaner messages "the office" / "the homeowner".
- Reuse legacy/redesign LOGIC and hooks; build presentation from the redesign design system. Do not import pre-redesign components.
- Never import `lib/supabase-admin.ts` from client code.

## UI implementation & styling source

No browser-companion mockups. Every screen is implemented from the design system and the cleaner app's existing patterns: the flat inbox row (`CleanerConversationRow`), `Avatar`, `Badge`, `EmptyState`, `Skeleton`, section headers, and the `UnreadPill` vocabulary the homeowner tab already uses. Job urgency/state is signalled via the status **badge** vocabulary, never a decorative stripe/accent.

## File Structure

**New:**
- `src/components/redesign/cleaner/messages/cleaner-inbox-types.ts` — `CleanerJobRowVM` + `CleanerInboxModel`.
- `src/components/redesign/cleaner/messages/deriveCleanerInbox.ts` (+ `.test.ts`) — pure presenter: office rows + active/past job rows.
- `src/components/redesign/cleaner/messages/useOpenCleanerJobThread.ts` — sets `?jobthread=<appointmentId>` (opens the 4a job host).

**Modified:**
- `src/hooks/useCleanerData.ts` — add `completed_at`, `cancelled_at` to the appointment SELECT + `CleanerAppointment` interface.
- `src/components/redesign/cleaner/messages/CleanerMessagesView.tsx` — rewrite to a sectioned view.
- `src/components/redesign/cleaner/messages/CleanerMessages.tsx` — rewrite the container (office + job conversations + appointments + office contacts -> `deriveCleanerInbox`).
- `src/components/redesign/cleaner/messages/CleanerJobThreadHost.tsx` — use the real `completed_at`/`cancelled_at` (accurate read-only for completed threads).
- `src/components/redesign/cleaner/shell/CleanerShell.tsx` — `useUnreadMessageCount(user?.id, 'all')` so job unread counts.

**Retired (deleted):**
- `src/components/redesign/cleaner/messages/deriveOfficeInbox.ts` + `deriveOfficeInbox.test.ts` — replaced by `deriveCleanerInbox`.
- `src/components/redesign/cleaner/messages/messages-cleaner-types.ts` — `OfficeInboxMode`/`OfficeInboxModel`/`DeriveOfficeInboxInput` no longer used (only importers are the rewritten/deleted files).

**Kept (still used):** `CleanerThread.tsx` (the `variant="takeover"` office thread rendered by `CleanerMessageThreadHost`), `CleanerConversationRow.tsx`, `CleanerOfficePicker.tsx`, `office-contacts.ts`, `useOpenOfficeThread.ts`, `CleanerJobThread.tsx` (4a).

**Deliberate UX changes (call out in the PR):**
- The single-office "the tab IS the Office thread" inline mode is removed; a single office contact now shows as one Office row that opens the thread on tap (matches the homeowner). This is required: an inline single thread cannot coexist with a job-threads list.
- The free-text search input is dropped in favor of sections + counts (matches the homeowner sectioned tab). Cleaner inboxes are small; restorable later if needed.

---

### Task 1: Add `completed_at` / `cancelled_at` to the cleaner appointment select

**Files:**
- Modify: `src/hooks/useCleanerData.ts` (interface ~line 16-58; SELECT ~line 135-177)

**Interfaces:**
- Produces: `CleanerAppointment.completed_at?: string | null`, `CleanerAppointment.cancelled_at?: string | null` (real appointment columns; scalar, flow through `...appointment`).

- [ ] **Step 1:** In the `CleanerAppointment` interface, add after `payment_status`:
```ts
  /** Set when the job is marked complete (charge-at-completion). Drives the 24h job-message grace window. */
  completed_at?: string | null;
  /** Set when the appointment is cancelled. Closes the job thread. */
  cancelled_at?: string | null;
```
- [ ] **Step 2:** In the appointments SELECT string, add `completed_at,` and `cancelled_at,` alongside the other scalar columns (e.g. right after `status,`).
- [ ] **Step 3:** Type-check: `npx tsc --noEmit` (no new errors).
- [ ] **Step 4:** Commit: `feat(cleaner-messages): select completed_at/cancelled_at on cleaner appointments`

---

### Task 2: `cleaner-inbox-types.ts` + `deriveCleanerInbox.ts` (+ test)

**Files:**
- Create: `src/components/redesign/cleaner/messages/cleaner-inbox-types.ts`
- Create: `src/components/redesign/cleaner/messages/deriveCleanerInbox.ts`
- Test: `src/components/redesign/cleaner/messages/deriveCleanerInbox.test.ts`

**Interfaces:**
- Consumes: `ConversationWithDetails` (`@/types`), `CleanerAppointment` (`@/hooks/useCleanerData`), `toConversationRowVM` (`@/components/redesign/messages/messages-presenters`), `isJobMessagingWindowOpen` (`@/lib/messaging/jobMessagingWindow`), `ConversationRowVM` (`@/components/redesign/messages/messages-types`).
- Produces: `CleanerInboxModel { office: ConversationRowVM[]; active: CleanerJobRowVM[]; past: CleanerJobRowVM[] }`; `deriveCleanerInbox(input): CleanerInboxModel`.

- [ ] **Step 1:** Create `cleaner-inbox-types.ts`:
```ts
import type { ConversationRowVM } from '@/components/redesign/messages/messages-types';
import type { CleanerAppointment } from '@/hooks/useCleanerData';

/** A per-cleaning job thread row on the cleaner side (counterparty = the homeowner). */
export interface CleanerJobRowVM {
  conversationId: string;
  appointmentId: string;
  /** The homeowner's name (or "Homeowner" fallback). */
  homeownerName: string;
  /** "Tue, Jun 30" cleaning date. */
  dateLabel: string;
  status: CleanerAppointment['status'];
  preview: string;
  timeLabel: string;
  unreadCount: number;
}

export interface CleanerInboxModel {
  /** Office thread rows (most-recent first); the org's admins/managers the cleaner has messaged. */
  office: ConversationRowVM[];
  active: CleanerJobRowVM[];
  past: CleanerJobRowVM[];
}
```
- [ ] **Step 2:** Write the failing test `deriveCleanerInbox.test.ts` (pin TZ for the date label):
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { deriveCleanerInbox } from './deriveCleanerInbox';
import type { ConversationWithDetails } from '@/types';
import type { CleanerAppointment } from '@/hooks/useCleanerData';

beforeAll(() => { process.env.TZ = 'UTC'; });

const NOW = new Date('2026-06-30T18:00:00Z');

function conv(over: Partial<ConversationWithDetails>): ConversationWithDetails {
  return {
    id: 'c1', participant_1_id: 'cleaner', participant_2_id: 'ho', appointment_id: null,
    organization_id: 'org', created_at: '2026-06-01T00:00:00Z', last_message_at: '2026-06-29T00:00:00Z',
    other_participant: { id: 'ho', first_name: 'John', last_name: 'Doe', email: 'j@x.com', role: 'homeowner' } as never,
    last_message: null, last_message_attachment_count: 0, unread_count: 0,
    ...over,
  } as ConversationWithDetails;
}

function appt(over: Partial<CleanerAppointment>): CleanerAppointment {
  return {
    id: 'a1', scheduled_date: '2026-06-30', scheduled_time: '10:00', status: 'in_progress',
    total_price: 100, cleaner_confirmation_status: 'approved',
    homeowner: { first_name: 'John', last_name: 'Doe', email: 'j@x.com' },
    property: null, service_type: null,
    ...over,
  } as CleanerAppointment;
}

describe('deriveCleanerInbox', () => {
  it('maps office threads (appointment_id null) into the office section', () => {
    const model = deriveCleanerInbox({
      officeRows: [conv({ id: 'o1', appointment_id: null })],
      jobRows: [], appointmentsById: new Map(), now: NOW, currentUserId: 'cleaner',
    });
    expect(model.office).toHaveLength(1);
    expect(model.active).toHaveLength(0);
    expect(model.past).toHaveLength(0);
  });

  it('puts an in_progress job in active with the homeowner name', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [], jobRows: [jc],
      appointmentsById: new Map([['a1', appt({ id: 'a1', status: 'in_progress' })]]),
      now: NOW, currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(1);
    expect(model.active[0].homeownerName).toBe('John Doe');
    expect(model.active[0].appointmentId).toBe('a1');
    expect(model.past).toHaveLength(0);
  });

  it('puts a long-completed job in past (grace window elapsed)', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [], jobRows: [jc],
      appointmentsById: new Map([['a1', appt({
        id: 'a1', status: 'completed', completed_at: '2026-06-01T00:00:00Z',
      })]]),
      now: NOW, currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(0);
    expect(model.past).toHaveLength(1);
  });

  it('keeps a just-completed job in active (within 24h grace)', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [], jobRows: [jc],
      appointmentsById: new Map([['a1', appt({
        id: 'a1', status: 'completed', completed_at: '2026-06-30T12:00:00Z',
      })]]),
      now: NOW, currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(1);
  });

  it('drops a job thread whose appointment is not loaded', () => {
    const jc = conv({ id: 'j1', appointment_id: 'missing' });
    const model = deriveCleanerInbox({
      officeRows: [], jobRows: [jc], appointmentsById: new Map(), now: NOW, currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(0);
    expect(model.past).toHaveLength(0);
  });

  it('falls back to "Homeowner" when the appointment has no homeowner', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [], jobRows: [jc],
      appointmentsById: new Map([['a1', appt({ id: 'a1', homeowner: null })]]),
      now: NOW, currentUserId: 'cleaner',
    });
    expect(model.active[0].homeownerName).toBe('Homeowner');
  });
});
```
- [ ] **Step 3:** Run it, expect FAIL (module not found).
- [ ] **Step 4:** Create `deriveCleanerInbox.ts`:
```ts
import type { ConversationWithDetails } from '@/types';
import type { CleanerAppointment } from '@/hooks/useCleanerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { toConversationRowVM } from '@/components/redesign/messages/messages-presenters';
import type { CleanerInboxModel, CleanerJobRowVM } from './cleaner-inbox-types';

interface DeriveInput {
  officeRows: ConversationWithDetails[];
  jobRows: ConversationWithDetails[];
  appointmentsById: Map<string, CleanerAppointment>;
  now: Date;
  currentUserId: string;
}

function homeownerName(a: CleanerAppointment): string {
  const n = `${a.homeowner?.first_name ?? ''} ${a.homeowner?.last_name ?? ''}`.trim();
  return n || 'Homeowner';
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/**
 * Sections the cleaner inbox: office threads (admins/managers the cleaner has
 * messaged), active job threads (send window open), and past job threads
 * (closed, read-only). Job rows whose appointment is not loaded are dropped.
 * The counterparty on a job thread is the HOMEOWNER (mirror of deriveHomeownerInbox).
 */
export function deriveCleanerInbox(input: DeriveInput): CleanerInboxModel {
  const { officeRows, jobRows, appointmentsById, now, currentUserId } = input;

  const recent = (a: ConversationWithDetails, b: ConversationWithDetails) =>
    new Date(b.last_message_at ?? b.created_at).getTime() -
    new Date(a.last_message_at ?? a.created_at).getTime();

  const office = [...officeRows].sort(recent).map((row) => toConversationRowVM(row, currentUserId));

  const active: CleanerJobRowVM[] = [];
  const past: CleanerJobRowVM[] = [];

  for (const conv of [...jobRows].sort(recent)) {
    if (!conv.appointment_id) continue;
    const appt = appointmentsById.get(conv.appointment_id);
    if (!appt) continue;
    const base = toConversationRowVM(conv, currentUserId);
    const row: CleanerJobRowVM = {
      conversationId: conv.id,
      appointmentId: conv.appointment_id,
      homeownerName: homeownerName(appt),
      dateLabel: dateLabel(appt.scheduled_date),
      status: appt.status,
      preview: base.preview,
      timeLabel: base.timeLabel,
      unreadCount: base.unreadCount,
    };
    (isJobMessagingWindowOpen(
      {
        status: appt.status,
        cleaner_confirmation_status: appt.cleaner_confirmation_status ?? null,
        completed_at: appt.completed_at ?? null,
        cancelled_at: appt.cancelled_at ?? null,
      },
      now,
    )
      ? active
      : past
    ).push(row);
  }

  return { office, active, past };
}
```
- [ ] **Step 5:** Run the test, expect PASS (6/6).
- [ ] **Step 6:** Commit: `feat(cleaner-messages): deriveCleanerInbox sectioned presenter + tests`

---

### Task 3: `useOpenCleanerJobThread` opener

**Files:**
- Create: `src/components/redesign/cleaner/messages/useOpenCleanerJobThread.ts`

**Interfaces:**
- Produces: `useOpenCleanerJobThread(): (appointmentId: string) => void` — navigates to the messages path with `?jobthread=<id>` (the 4a host reads it). Reads no search params, so no Suspense boundary needed.

- [ ] **Step 1:** Create the file:
```ts
'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const MESSAGES_PATH = '/app/cleaner-dashboard/messages';

/**
 * Open the cleaner's homeowner<->cleaner JOB thread takeover via `?jobthread=<appointmentId>`
 * (read by CleanerJobThreadHost, mounted in the cleaner layout). On the Messages page we
 * replace (no history spam); from elsewhere we push to navigate there. Reads no search
 * params, so callers need no Suspense boundary (mirrors useOpenOfficeThread).
 */
export function useOpenCleanerJobThread() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (appointmentId: string) => {
      const url = `${MESSAGES_PATH}?jobthread=${appointmentId}`;
      if (pathname === MESSAGES_PATH) router.replace(url, { scroll: false });
      else router.push(url);
    },
    [router, pathname],
  );
}
```
- [ ] **Step 2:** Type-check: `npx tsc --noEmit`.
- [ ] **Step 3:** Commit: `feat(cleaner-messages): useOpenCleanerJobThread (?jobthread= opener)`

---

### Task 4: Rewrite `CleanerMessagesView` to a sectioned inbox

**Files:**
- Modify (rewrite): `src/components/redesign/cleaner/messages/CleanerMessagesView.tsx`

**Interfaces:**
- Consumes: `CleanerInboxModel` (task 2), `CleanerConversationRow`, `Avatar`/`AvatarFallback`, `Badge`, `Button`, `EmptyState`, `Skeleton`, `cn`, lucide icons.
- Produces: `CleanerMessagesViewProps { model; loading; hasOfficeContacts; onOpenOfficeRow(id); onStartOffice(); onNew(); onOpenJob(appointmentId) }`.

Design: flat-list sections (the cleaner app's existing `-mx-4 border-y` list visual), each preceded by a section header (label + count). Office rows reuse `CleanerConversationRow`. Job rows use a local flat `JobRow` (avatar initials from the homeowner name, name, status badge / "Closed", preview, time, unread badge). Status badge maps via a small `STATUS_LABEL`. Unread badge pairs color with the count (never color alone) and carries an sr-only label. The header has a right-aligned "New" button (opens the office picker) shown only when `hasOfficeContacts`.

- [ ] **Step 1:** Replace the file with:
```tsx
'use client';

import { MessageSquare, Plus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CleanerConversationRow } from './CleanerConversationRow';
import type { CleanerInboxModel, CleanerJobRowVM } from './cleaner-inbox-types';

export interface CleanerMessagesViewProps {
  model: CleanerInboxModel;
  loading: boolean;
  hasOfficeContacts: boolean;
  onOpenOfficeRow: (conversationId: string) => void;
  onStartOffice: () => void;
  onNew: () => void;
  onOpenJob: (appointmentId: string) => void;
}

const STATUS_LABEL: Record<CleanerJobRowVM['status'], { label: string; variant: 'default' | 'secondary' | 'positive' | 'caution' | 'critical' }> = {
  pending: { label: 'Requested', variant: 'secondary' },
  confirmed: { label: 'Scheduled', variant: 'default' },
  in_progress: { label: 'In progress', variant: 'positive' },
  completed: { label: 'Completed', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'critical' },
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{label}</h2>
      <span className="ml-auto text-xs font-medium text-muted-foreground">{count}</span>
    </div>
  );
}

function ListShell({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-hidden border-y border-border/60 bg-card">{children}</div>;
}

function JobRow({ row, muted, onOpen }: { row: CleanerJobRowVM; muted?: boolean; onOpen: () => void }) {
  const status = STATUS_LABEL[row.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
        'touch-manipulation transition-colors active:bg-accent hover:bg-accent/60',
      )}
    >
      <Avatar className="size-11 shrink-0">
        <AvatarFallback>{initialsFromName(row.homeownerName)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-bold leading-tight">{row.homeownerName}</span>
          {muted ? (
            <Badge variant="outline" className="shrink-0">Closed</Badge>
          ) : (
            <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
          )}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{row.timeLabel}</span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              !muted && row.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {row.preview}
          </span>
          {!muted && row.unreadCount > 0 && (
            <span className="flex shrink-0 items-center">
              <Badge className="h-5 min-w-[1.25rem] justify-center rounded-full px-1.5 py-0 text-[10px] leading-5">
                {row.unreadCount > 99 ? '99+' : row.unreadCount}
              </Badge>
              <span className="sr-only">{row.unreadCount} unread</span>
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">
          {row.dateLabel} cleaning
        </span>
      </span>
    </button>
  );
}

function StartOfficeRow({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
        'touch-manipulation transition-colors active:bg-accent hover:bg-accent/60',
      )}
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-pill bg-primary/10 text-primary">
        <MessageSquare className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight">Message your office</span>
        <span className="mt-1 block truncate text-[13px] text-muted-foreground">
          Reach an admin or manager anytime
        </span>
      </span>
    </button>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-card" />
      ))}
    </div>
  );
}

export function CleanerMessagesView({
  model,
  loading,
  hasOfficeContacts,
  onOpenOfficeRow,
  onStartOffice,
  onNew,
  onOpenJob,
}: CleanerMessagesViewProps) {
  if (loading) return <LoadingState />;

  const hasOffice = model.office.length > 0 || hasOfficeContacts;
  const isEmpty = !hasOffice && model.active.length === 0 && model.past.length === 0;

  if (isEmpty) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<MessageSquare />}
          title="No messages yet"
          description="Once your office adds an admin or manager, you can message them here. Homeowner threads appear during a cleaning."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-1">
      <div className="flex items-center justify-end">
        {hasOfficeContacts && (
          <Button onClick={onNew} className="gap-1.5">
            <Plus className="size-4" aria-hidden /> New
          </Button>
        )}
      </div>

      <section>
        <SectionHeader label="Office" count={model.office.length} />
        <ListShell>
          {model.office.length > 0 ? (
            model.office.map((r) => (
              <CleanerConversationRow key={r.id} row={r} onSelect={() => onOpenOfficeRow(r.id)} />
            ))
          ) : (
            <StartOfficeRow onStart={onStartOffice} />
          )}
        </ListShell>
      </section>

      {model.active.length > 0 && (
        <section>
          <SectionHeader label="Your cleanings" count={model.active.length} />
          <ListShell>
            {model.active.map((r) => (
              <JobRow key={r.conversationId} row={r} onOpen={() => onOpenJob(r.appointmentId)} />
            ))}
          </ListShell>
        </section>
      )}

      {model.past.length > 0 && (
        <section>
          <SectionHeader label="Past" count={model.past.length} />
          <ListShell>
            {model.past.map((r) => (
              <JobRow key={r.conversationId} row={r} muted onOpen={() => onOpenJob(r.appointmentId)} />
            ))}
          </ListShell>
        </section>
      )}
    </div>
  );
}
```
- [ ] **Step 2:** Verify `Badge` supports the `variant` values used (`default|secondary|positive|caution|critical|outline`). If a value is missing, map to the nearest supported variant. Type-check: `npx tsc --noEmit`.
- [ ] **Step 3:** Commit: `feat(cleaner-messages): sectioned Messages view (Office + Your cleanings + Past)`

---

### Task 5: Rewrite the `CleanerMessages` container + retire the old office-inbox model

**Files:**
- Modify (rewrite): `src/components/redesign/cleaner/messages/CleanerMessages.tsx`
- Delete: `src/components/redesign/cleaner/messages/deriveOfficeInbox.ts`, `deriveOfficeInbox.test.ts`, `messages-cleaner-types.ts`

**Interfaces:**
- Consumes: `useConversations({ userId, scope })`, `useCleanerAppointments`, `useOrganizationMembers`, `filterOfficeContacts`, `useOpenOfficeThread`, `useOpenCleanerJobThread` (task 3), `deriveCleanerInbox` (task 2), `CleanerMessagesView` (task 4), `CleanerOfficePicker`.

- [ ] **Step 1:** Replace `CleanerMessages.tsx` with:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useCleanerAppointments } from '@/hooks/useCleanerData';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { useOpenOfficeThread } from '@/hooks/useOpenOfficeThread';
import { deriveCleanerInbox } from './deriveCleanerInbox';
import { filterOfficeContacts } from './office-contacts';
import { useOpenCleanerJobThread } from './useOpenCleanerJobThread';
import { CleanerMessagesView } from './CleanerMessagesView';
import { CleanerOfficePicker } from './CleanerOfficePicker';

/**
 * Cleaner Messages: a sectioned inbox (mirror of the homeowner tab).
 * - Office: threads with the org's admins/managers (open existing via ?thread=; the
 *   "New" picker starts one with a specific person via ?to=).
 * - Your cleanings: active homeowner<->cleaner job threads (send window open).
 * - Past: closed job threads (read-only).
 * Office threads render through the ?thread=/?to= host (CleanerMessageThreadHost); job
 * threads through the ?jobthread= host (CleanerJobThreadHost). Both are mounted in the layout.
 */
export function CleanerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { conversations: officeRows, loading: lo } = useConversations({ userId, scope: 'office' });
  const { conversations: jobRows, loading: lj } = useConversations({ userId, scope: 'job' });
  const { appointments, loading: la } = useCleanerAppointments();
  const { members, loading: lm } = useOrganizationMembers({ excludeCurrentUser: true });

  const { openConversation, openWith } = useOpenOfficeThread();
  const openJob = useOpenCleanerJobThread();
  const [pickerOpen, setPickerOpen] = useState(false);

  const officeContacts = useMemo(() => filterOfficeContacts(members), [members]);
  const appointmentsById = useMemo(() => {
    const m = new Map<string, (typeof appointments)[number]>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const model = useMemo(
    () =>
      deriveCleanerInbox({
        officeRows,
        jobRows,
        appointmentsById,
        now: new Date(),
        currentUserId: userId,
      }),
    [officeRows, jobRows, appointmentsById, userId],
  );

  const startOffice = () => {
    if (officeContacts.length === 1) openWith(officeContacts[0].id);
    else setPickerOpen(true);
  };

  return (
    <>
      <CleanerMessagesView
        model={model}
        loading={lo || lj || la || lm}
        hasOfficeContacts={officeContacts.length > 0}
        onOpenOfficeRow={openConversation}
        onStartOffice={startOffice}
        onNew={() => setPickerOpen(true)}
        onOpenJob={openJob}
      />
      <CleanerOfficePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        contacts={officeContacts}
        loading={lm}
        onPick={(c) => {
          setPickerOpen(false);
          openWith(c.id);
        }}
      />
    </>
  );
}
```
- [ ] **Step 2:** Delete `deriveOfficeInbox.ts`, `deriveOfficeInbox.test.ts`, `messages-cleaner-types.ts`.
- [ ] **Step 3:** Grep for any lingering imports of the deleted modules:
  `grep -rn "deriveOfficeInbox\|messages-cleaner-types\|OfficeInboxModel\|OfficeInboxMode" src/` — expect no matches (the presenters files `messages-cleaner-presenters.ts` and `office-contacts.ts` are separate and stay).
- [ ] **Step 4:** Type-check + lint: `npx tsc --noEmit` and `npm run lint`.
- [ ] **Step 5:** Commit: `feat(cleaner-messages): sectioned container; retire collapsing office-inbox model`

---

### Task 6: `CleanerJobThreadHost` — use the real completion/cancellation for read-only

**Files:**
- Modify: `src/components/redesign/cleaner/messages/CleanerJobThreadHost.tsx`

**Interfaces:**
- Consumes: `CleanerAppointment.completed_at` / `.cancelled_at` (task 1).

- [ ] **Step 1:** Replace the hardcoded-null `readOnly` block with the real values:
```tsx
  const readOnly = appointment
    ? !isJobMessagingWindowOpen(
        {
          status: appointment.status,
          cleaner_confirmation_status: appointment.cleaner_confirmation_status,
          completed_at: appointment.completed_at ?? null,
          cancelled_at: appointment.cancelled_at ?? null,
        },
        new Date(),
      )
    : false;
```
Update the preceding comment: the select now includes `completed_at`/`cancelled_at`, so a completed thread within the 24h grace stays writable and a closed one is read-only (remove the "defaults them to null" note).
- [ ] **Step 2:** Type-check: `npx tsc --noEmit`.
- [ ] **Step 3:** Commit: `feat(cleaner-messages): accurate job-thread read-only from real completed_at/cancelled_at`

---

### Task 7: Count job-thread unread in the cleaner nav badge

**Files:**
- Modify: `src/components/redesign/cleaner/shell/CleanerShell.tsx:18`

- [ ] **Step 1:** Change `useUnreadMessageCount(user?.id)` to `useUnreadMessageCount(user?.id, 'all')` (matches `HomeownerShell`; `'all'` drops the `appointment_id IS NULL` office filter so job unread counts too).
- [ ] **Step 2:** Type-check: `npx tsc --noEmit`.
- [ ] **Step 3:** Commit: `feat(cleaner-messages): count job-thread unread in the nav badge`

---

## Final gates (before PR)

- [ ] `npx tsc --noEmit` — no new errors.
- [ ] `npm run lint` — clean for touched files.
- [ ] `npm run test:unit` — all pass, including the new `deriveCleanerInbox` tests.
- [ ] Fresh-subagent review over the branch (spec compliance + quality).
- [ ] Visual (mobile screenshots): cleaner login on dev — Office section, a "Your cleanings" active job thread (opens read/write), and the nav badge reflecting job unread. Send screenshots (user is on mobile).

## Self-Review

- **Spec coverage (§5.4):** "a Messages section showing those threads (the cleaner side of the existing homeowner job threads; same window gating, same guarded send route)" -> tasks 2/4/5 (sections) + task 6 (window gating) + 4a's `CleanerJobThread` (guarded send). Unread badge -> task 7.
- **No migration/route/RLS:** confirmed — the cleaner is already a participant; reads via `useConversations`.
- **Type consistency:** `CleanerInboxModel`/`CleanerJobRowVM` defined in task 2, consumed in tasks 4/5. `completed_at`/`cancelled_at` added in task 1, consumed in tasks 2/6.
- **No placeholders:** every step carries the code.
