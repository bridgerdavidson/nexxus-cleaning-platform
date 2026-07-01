# Sub-project 4a: Cleaner "Message homeowner" from the active job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Give the cleaner a **"Message homeowner"** action in the active-job flow that opens a per-appointment homeowner↔cleaner thread they can read and reply in (closing the homeowner→cleaner round-trip for the active-job case). Build the reusable cleaner job-thread + host that sub-project 4b's Messages-tab list will also use.

**Architecture:** The cleaner is a **participant** of the homeowner↔cleaner job thread, so this mirrors the homeowner side exactly: read via `useMessages(conversationId)`, send via `useSendJobMessage(appointmentId)` (the guarded PR1 route; RLS forbids a direct client insert for this pair), render via the shared `MessageThreadTakeoverView`. A new `CleanerJobThread` mirrors `HomeownerMessageThread`'s job branch (counterparty = the homeowner). A new `CleanerJobThreadHost` mirrors `CleanerMessageThreadHost` but for `?jobthread=<appointmentId>`: it resolves the appointment (homeowner name/avatar) + the existing job conversation, computes read-only from `isJobMessagingWindowOpen`, and renders the thread in a `MobileTakeover` with a "Back to job" return. The active-job view gains a "Message homeowner" action wired the same way "Message office" already is. **No migration, no new API route, no RLS change** (reuses the shipped guarded route + window gating + kill-switch).

**Tech Stack:** Next.js `(redesign)` cleaner phone app, React 19, TanStack Query, Tailwind design system; Vitest.

## Global Constraints
- Design system only (`src/components/ui/*` + tokens); brand `#0150FC`; NO raw hex; NO `primary-<number>` (legacy yellow); `bg-primary/10` etc. (brand) allowed.
- **No em dashes** in user-facing copy. **"Office" not "operator"**; the homeowner-facing/cleaner-facing copy says "homeowner"/"the office", never "operator".
- Never import `lib/supabase-admin` from client code. New pure logic gets a co-located `*.test.ts`.
- Reuse the shipped guarded send route (`useSendJobMessage`), window gate (`isJobMessagingWindowOpen`), and takeover (`MobileTakeover` + `MessageThreadTakeoverView`). Do not add a new send path or duplicate the thread UI.
- The org **kill-switch** `organizations.homeowner_cleaner_messaging_enabled` is enforced server-side by the guarded route (403). The UI relies on that (a toast on failure); do not add a client-side flag fetch in 4a.

## Background (verified)
- `useSendJobMessage()` (`src/hooks/useSendJobMessage.ts`): `sendJobMessage({ appointmentId, content }) -> { success, message?, conversationId?, error? }`. Posts to `/api/appointments/:id/messages`, patches the sender's `keys.messages.byConversation` cache, invalidates `keys.conversations.byUser(userId, 'job')`.
- `HomeownerMessageThread` (`src/components/redesign/homeowner/messages/HomeownerMessageThread.tsx`): the mirror. Job branch reads `useMessages({conversationId})`, sends `useSendJobMessage`, renders `MessageThreadTakeoverView` with `readOnly` + `readOnlyNotice`, captures the created conversationId on first send.
- `CleanerMessageThreadHost` (`src/components/redesign/cleaner/messages/CleanerMessageThreadHost.tsx`): the host pattern. Reads `?thread`/`?to`/`?appointment`/`?from`; renders a `MobileTakeover` (key by param) with a "Back to job" close when `?from=` is present (`router.replace('/app/cleaner-dashboard?job=<from>')`).
- `CleanerActiveJob` (`.../cleaner/job/CleanerActiveJob.tsx`): owns `onMessageOffice` -> opens `CleanerOfficePicker`. `CleanerActiveJobView` renders the action. `useOpenOfficeThread().openThreadFromJob(personId, appointmentId)` navigates to `/messages?to=..&appointment=..&from=..`.
- `CleanerAppointment` (`src/hooks/useCleanerData.ts`): has `id`, `status`, `cleaner_confirmation_status`, and `homeowner: { first_name, last_name, avatar_url? }`. An active job is `in_progress`, so `isJobMessagingWindowOpen` is open (the window helper opens on `in_progress` regardless of `completed_at`, which the cleaner query does not select).
- `isJobMessagingWindowOpen(appt, now)` (`src/lib/messaging/jobMessagingWindow.ts`): `{ status, cleaner_confirmation_status, completed_at?, cancelled_at?, started_at? }`.
- `useConversations({ userId, scope: 'job' })`: participant-scoped list of the cleaner's job threads (`appointment_id` non-null) — used by the host to resolve the conversationId for an appointment.

---

## Task 1: `CleanerJobThread` (read + reply, window-gated)

**Files:**
- Create: `src/components/redesign/cleaner/messages/CleanerJobThread.tsx`

**Interfaces:**
- Produces: `<CleanerJobThread appointmentId conversationId homeownerName avatarUrl readOnly onBack backLabel />`. Reads `useMessages({conversationId})`, sends via `useSendJobMessage`, renders `MessageThreadTakeoverView` (variant `takeover`).

- [ ] **Step 1: Write the component** (mirror `HomeownerMessageThread`'s job branch; read it first)

Create `src/components/redesign/cleaner/messages/CleanerJobThread.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { useSendJobMessage } from '@/hooks/useSendJobMessage';
import { toast } from '@/components/ui/toast';
import { toMessageVM } from '@/components/redesign/messages/messages-presenters';
import { MessageThreadTakeoverView } from '@/components/redesign/messages/MessageThreadTakeoverView';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'H';
}

/**
 * Cleaner side of a homeowner<->cleaner per-appointment job thread. The cleaner is
 * a participant; reads via useMessages, sends via the guarded route (useSendJobMessage),
 * window-gated read-only. Mirrors HomeownerMessageThread's job branch, counterparty =
 * the homeowner.
 */
export function CleanerJobThread({
  appointmentId,
  conversationId,
  homeownerName,
  avatarUrl,
  readOnly,
  onBack,
  backLabel,
}: {
  appointmentId: string;
  conversationId: string | null;
  homeownerName: string;
  avatarUrl: string | null;
  readOnly: boolean;
  onBack: () => void;
  backLabel?: string;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [activeConvId, setActiveConvId] = useState<string | null>(conversationId);
  useEffect(() => setActiveConvId(conversationId), [conversationId]);

  const { messages: rawMessages, loading, hasMore, isLoadingMore, loadMoreMessages, messagesEndRef } =
    useMessages({ conversationId: activeConvId, userId });
  const { sendJobMessage, sending } = useSendJobMessage();
  const [draft, setDraft] = useState('');

  // Every message in a job thread references the one appointment; suppress inline booking cards.
  const messages = useMemo(
    () => rawMessages.map((m, i) => toMessageVM(m, userId, i > 0 ? rawMessages[i - 1] : null, () => null)),
    [rawMessages, userId],
  );

  const onSend = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    const res = await sendJobMessage({ appointmentId, content });
    if (res.success) {
      setDraft('');
      if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
    } else {
      toast.error(res.error || 'Could not send the message.');
    }
  }, [draft, sendJobMessage, appointmentId, activeConvId]);

  return (
    <MessageThreadTakeoverView
      title={homeownerName}
      initials={initials(homeownerName)}
      avatarUrl={avatarUrl}
      conversationKey={activeConvId}
      messages={messages}
      loading={loading && !!activeConvId}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={loadMoreMessages}
      messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
      onOpenBooking={() => {}}
      variant="takeover"
      onBack={onBack}
      backLabel={backLabel}
      readOnly={readOnly}
      readOnlyNotice="This cleaning is finished. You can still read the conversation."
      emptyTitle="Message the homeowner"
      emptyBody="Coordinate access and details with the homeowner. They will see it right away."
      composer={{
        draft,
        onDraftChange: setDraft,
        pendingFiles: [],
        onAddFiles: () => {},
        onRemoveFile: () => {},
        stagedBooking: null,
        attachableBookings: [],
        onStageBooking: () => {},
        onClearStagedBooking: () => {},
        onSend,
        sending,
        isMobile: true,
        showReferenceBooking: false,
        showAddImage: false,
      }}
    />
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (confirm `MessageThreadTakeoverView` composer accepts `showAddImage`; `HomeownerMessageThread` passes it, so it exists). No new errors.

- [ ] **Step 3: Commit**
```bash
git add src/components/redesign/cleaner/messages/CleanerJobThread.tsx
git commit -m "feat(messaging): CleanerJobThread (cleaner side of the homeowner job thread)"
```

---

## Task 2: `canMessageHomeowner` gate (pure) + test

**Files:**
- Create: `src/components/redesign/cleaner/messages/canMessageHomeowner.ts`
- Create: `src/components/redesign/cleaner/messages/canMessageHomeowner.test.ts`

**Interfaces:**
- Produces: `canMessageHomeowner(appt) => boolean` — true when the job has a real homeowner counterparty to message (a homeowner id exists; not a self-pay/no-homeowner job).

- [ ] **Step 1: Write the failing test**

Create `canMessageHomeowner.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { canMessageHomeowner } from './canMessageHomeowner';

describe('canMessageHomeowner', () => {
  it('true when the appointment has a homeowner', () => {
    expect(canMessageHomeowner({ homeowner_id: 'h1', is_self_pay: false })).toBe(true);
  });
  it('false for a self-pay job with no homeowner', () => {
    expect(canMessageHomeowner({ homeowner_id: null, is_self_pay: true })).toBe(false);
  });
  it('false when homeowner_id is missing', () => {
    expect(canMessageHomeowner({ homeowner_id: null, is_self_pay: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run -> RED.** `npm run test:unit -- canMessageHomeowner`

- [ ] **Step 3: Implement**

Create `canMessageHomeowner.ts`:
```typescript
/**
 * Whether the cleaner has a homeowner counterparty to message for this job. A
 * self-pay / org-owned job has no homeowner, so there is no one to message.
 */
export function canMessageHomeowner(appt: {
  homeowner_id?: string | null;
  is_self_pay?: boolean | null;
}): boolean {
  return !!appt.homeowner_id;
}
```
(NOTE: verify `CleanerAppointment` exposes `homeowner_id`; if it only exposes the nested `homeowner` object, key the gate on `!!appt.homeowner` instead and adjust the test + call site. Confirm against `useCleanerData.ts` before implementing.)

- [ ] **Step 4: Run -> GREEN.** `npm run test:unit -- canMessageHomeowner`

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/cleaner/messages/canMessageHomeowner.ts src/components/redesign/cleaner/messages/canMessageHomeowner.test.ts
git commit -m "feat(messaging): canMessageHomeowner gate (+ tests)"
```

---

## Task 3: `CleanerJobThreadHost` (`?jobthread=<appointmentId>`) + mount

**Files:**
- Create: `src/components/redesign/cleaner/messages/CleanerJobThreadHost.tsx`
- Modify: wherever `CleanerMessageThreadHost` is mounted (find it: `grep -rn "CleanerMessageThreadHost" src/app src/components`) — mount `CleanerJobThreadHost` beside it.

**Interfaces:**
- Consumes `?jobthread=<appointmentId>` (+ optional `?from=<jobId>`). Resolves the appointment (homeowner name/avatar), the existing job conversationId (via `useConversations` scope `'job'`), and read-only (via `isJobMessagingWindowOpen`); renders `CleanerJobThread` in a `MobileTakeover`.

- [ ] **Step 1: Write the host** (mirror `CleanerMessageThreadHost`)

Create `src/components/redesign/cleaner/messages/CleanerJobThreadHost.tsx`:
```tsx
'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useCleanerAppointments } from '@/hooks/useCleanerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { CleanerJobThread } from './CleanerJobThread';

/**
 * Mounts the cleaner's homeowner<->cleaner JOB thread takeover from
 * `?jobthread=<appointmentId>` (+ optional `?from=<jobId>` for a Back-to-job
 * return). Layout sibling, like CleanerMessageThreadHost. Heavy hooks mount only
 * when a job thread is open.
 */
export function CleanerJobThreadHost() {
  const searchParams = useSearchParams();
  const jobThreadParam = searchParams.get('jobthread');
  if (!jobThreadParam) return null;
  return <JobThreadHostInner appointmentId={jobThreadParam} fromParam={searchParams.get('from')} />;
}

function JobThreadHostInner({ appointmentId, fromParam }: { appointmentId: string; fromParam: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const { appointments } = useCleanerAppointments();
  const { conversations } = useConversations({ userId, scope: 'job' });

  const appointment = useMemo(
    () => appointments.find((a) => a.id === appointmentId) ?? null,
    [appointments, appointmentId],
  );
  const conversationId = useMemo(
    () => conversations.find((c) => c.appointment_id === appointmentId)?.id ?? null,
    [conversations, appointmentId],
  );

  const homeownerName = appointment
    ? `${appointment.homeowner?.first_name ?? ''} ${appointment.homeowner?.last_name ?? ''}`.trim() || 'Homeowner'
    : 'Homeowner';
  const avatarUrl = appointment?.homeowner?.avatar_url ?? null;
  const readOnly = appointment ? !isJobMessagingWindowOpen(appointment, new Date()) : false;

  const clearAll = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('jobthread');
    sp.delete('from');
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const backToJob = useCallback(() => {
    router.replace(`/app/cleaner-dashboard?job=${fromParam}`, { scroll: false });
  }, [router, fromParam]);

  return (
    <MobileTakeover key={appointmentId} onClosed={fromParam ? backToJob : clearAll} ariaLabel="Homeowner conversation">
      {(close) => (
        <CleanerJobThread
          appointmentId={appointmentId}
          conversationId={conversationId}
          homeownerName={homeownerName}
          avatarUrl={avatarUrl}
          readOnly={readOnly}
          onBack={close}
          backLabel={fromParam ? 'Back to job' : undefined}
        />
      )}
    </MobileTakeover>
  );
}
```
(Verify `CleanerAppointment.homeowner` includes `avatar_url`; if not, pass `null` and note it. Verify `ConversationWithDetails` exposes `appointment_id` — it does, from migration 098.)

- [ ] **Step 2: Mount it** beside `CleanerMessageThreadHost` (run the grep to find the file — likely the cleaner layout or the messages page). Add `<CleanerJobThreadHost />` next to the existing `<CleanerMessageThreadHost />`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` + `npm run lint`.

- [ ] **Step 4: Commit**
```bash
git add src/components/redesign/cleaner/messages/CleanerJobThreadHost.tsx <the mount file>
git commit -m "feat(messaging): CleanerJobThreadHost (?jobthread= takeover)"
```

---

## Task 4: "Message homeowner" action in the active-job flow

**Files:**
- Modify: `src/components/redesign/cleaner/job/CleanerActiveJobView.tsx` (add the action beside "Message office")
- Modify: `src/components/redesign/cleaner/job/CleanerActiveJob.tsx` (wire `onMessageHomeowner`)

**Interfaces:**
- `CleanerActiveJobView` gains an `onMessageHomeowner?: () => void` prop and renders a "Message homeowner" action next to the existing "Message office" one, shown only when provided.
- `CleanerActiveJob` passes `onMessageHomeowner` only when `canMessageHomeowner(appointment)`; it navigates to `/app/cleaner-dashboard/messages?jobthread=<appointmentId>&from=<appointmentId>`.

- [ ] **Step 1: Add the action to `CleanerActiveJobView`**

Read the current "Message office" affordance in `CleanerActiveJobView.tsx`; add a sibling "Message homeowner" button/row using the SAME styling (design-system tokens), gated on `onMessageHomeowner` being provided:
```tsx
{onMessageHomeowner && (
  <Button variant="outline" size="sm" onClick={onMessageHomeowner}>
    <MessageSquare /> Message homeowner
  </Button>
)}
```
(Match the exact component/placement the "Message office" action uses; if it is a row in a card rather than a `Button`, mirror that shape.)

- [ ] **Step 2: Wire it in `CleanerActiveJob`**

Add the navigation + the gate. Near the existing `onMessageOffice`:
```tsx
import { useRouter } from 'next/navigation';
import { canMessageHomeowner } from '../messages/canMessageHomeowner';
// ...
const router = useRouter();
const onMessageHomeowner = useCallback(() => {
  router.push(`/app/cleaner-dashboard/messages?jobthread=${appointmentId}&from=${appointmentId}`);
}, [router, appointmentId]);
// ...
// pass to the view only when there is a homeowner to message:
onMessageHomeowner={canMessageHomeowner(appointment) ? onMessageHomeowner : undefined}
```
(Use `router.push` so a hardware/gesture back returns to the active job; the host's `?from=` close also routes back to `?job=`. Confirm the active-job route base is `/app/cleaner-dashboard` and that navigating with `?jobthread=` opens the host — if `CleanerJobThreadHost` is mounted on the cleaner layout it will render over the current page; if it is mounted only on the `/messages` page, navigate to `/app/cleaner-dashboard/messages?jobthread=...` instead. Match wherever Task 3 mounted the host.)

- [ ] **Step 3: Verify (types, lint, conformance)**

Run: `npx tsc --noEmit` + `npm run lint`. Run **ui-ux-pro-max** at implementation for the new action (design-system conformance; manual token audit if the CLI is absent, as in 2a/2b): tokens only, matches the "Message office" affordance, no `primary-<number>`.

- [ ] **Step 4: Commit**
```bash
git add src/components/redesign/cleaner/job/CleanerActiveJobView.tsx src/components/redesign/cleaner/job/CleanerActiveJob.tsx
git commit -m "feat(messaging): 'Message homeowner' action in the cleaner active-job flow"
```

---

## Task 5: Manual verification (mobile screenshots)

- [ ] **Step 1:** Local dev, log in as `cleaner@nexxus.com`. Open an in-progress job (active-job flow). Confirm a **"Message homeowner"** action appears beside "Message office" (and is ABSENT on a self-pay job with no homeowner). Tap it -> the homeowner thread opens as a takeover; send a message -> it appears (guarded route); the back button reads "Back to job" and returns to the active job. Cross-check: the homeowner (John Doe) sees the reply in their Messages tab.
- [ ] **Step 2:** Send the user screenshots of the built action + thread (user is on mobile).

---

## Self-Review
- **Spec coverage:** §5.4 (the per-appointment "Message homeowner" from the active job + the cleaner-side job thread). The Messages-tab "Your cleanings" job-list section is sub-project **4b** (reuses `CleanerJobThread` + `CleanerJobThreadHost`). Cleaner↔office is unchanged (already shipped).
- **Reuse / non-regression:** reuses `useSendJobMessage`, `useMessages`, `MessageThreadTakeoverView`, `MobileTakeover`, `isJobMessagingWindowOpen`. The office thread/host and the collapsing office inbox are untouched (`CleanerJobThreadHost` is a separate `?jobthread=` host; "Message homeowner" is an additive action). No migration, no new route, no RLS change.
- **Gating:** window gating via `isJobMessagingWindowOpen` (active job = in_progress = open); the org kill-switch is enforced by the guarded route (toast on 403); the action is hidden when there is no homeowner (`canMessageHomeowner`).
- **Known follow-up (4b):** listing all job threads in the Messages tab (past + upcoming, read-only when the window is closed) + job threads in the unread badge; `CleanerAppointment` will need `completed_at`/`cancelled_at` in its select for accurate read-only on completed threads (the active-job case does not).
