# Homeowner Slice 3 (Messages tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the homeowner Messages tab: a sectioned inbox (Office pinned + active per-cleaning job threads + Past read-only) reusing the existing redesign chat, plus "Message office" / "Message about this cleaning" entry points on the cleaning detail. This is the first consumer of the job-messaging backend (migration 098 + the guarded send route, already merged in PR #109).

**Architecture:** The homeowner Messages tab renders office threads and per-appointment job threads in a single sectioned inbox. Office threads keep today's behavior (client-INSERT send via `useSendMessage`). Job threads are scoped to an appointment (`conversations.appointment_id IS NOT NULL`), partitioned active/past by the send window, and **sent through the guarded PR1 route** (`POST /api/appointments/[id]/messages`) because the client INSERT is RLS-blocked for the homeowner↔cleaner pair. The dominant risk — keeping job threads OUT of the existing Office inbox + unread badge used by the cleaner/operator — is solved by adding a `scope` discriminator to the two shared hooks (`useConversations`, `useUnreadMessageCount`), defaulting to `'office'` (i.e. `appointment_id IS NULL`) so every existing caller is segregated with no call-site change.

**Tech Stack:** Next.js 16 App Router (`(redesign)` route group), React 19, TypeScript, Tailwind v3, Supabase (Postgres/RLS/Realtime), TanStack Query v5, the redesign design system (`src/components/ui/*` + tokens).

## Global Constraints

- **Design system only.** Implement from `src/components/ui/*` primitives + tokens (`tailwind.config.js` / `src/app/globals.css`): brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale. **No raw hex. No `primary-*` shades** (that ramp is legacy yellow; brand blue is `brand-*` / bare semantic tokens). Semantic shades are `-50` / `-700` (`critical-700`, `caution-50/700`, `positive-50/700`); there is **no `critical-600`**.
- **No em dashes** in any user-facing copy (UI text, labels, toasts, empty states). Use a period, comma, parentheses, or "to" for ranges.
- **"Operator" is internal jargon.** Homeowner-facing copy says **"office"**, never "operator".
- **No legacy-style bleed.** Reuse redesign components + headless hooks; never import pre-redesign components.
- **Never import `lib/supabase-admin` from client code.**
- **Reuse before building.** Compose from existing redesign chat primitives (`MessageBubble`, `MessageComposer`, `MobileTakeover`, the takeover thread view). Only formalize a NEW shared primitive when a pattern is genuinely missing; never inline a one-off.
- **Approach B / flag-gated.** All new homeowner screens live under `src/app/(redesign)/app/homeowner-dashboard/*` + `src/components/redesign/homeowner/*`. Legacy `src/app/homeowner-dashboard/*` is untouched.
- Gates before push: `npm run test`, `npx tsc --noEmit`, `npm run lint`. Integration tests need local Supabase up.

---

## Background facts (verified live, do not re-derive)

- **Migration 098 (merged):** `conversations.appointment_id uuid` (FK→appointments, ON DELETE CASCADE), two partial uniques (office: pair where `appointment_id IS NULL`; job: `(appointment_id, p1, p2)` where NOT NULL), `idx_conversations_appointment`, `organizations.homeowner_cleaner_messaging_enabled boolean NOT NULL DEFAULT true`, and server-only `get_or_create_job_conversation(p_user_a, p_user_b, p_appointment_id)` (service_role only).
- **PR1 send route (merged):** `POST /api/appointments/[appointmentId]/messages`. Body `{ content: string, clientMessageId?: string (uuid) }`. Header `Authorization: Bearer <token>`. Enforces (in order) 401 token → 404 appt → 403 not-participant → 409 no-counterparty → 503 org-flag-read-error → 403 flag-off → 403 window-closed → 400 content. **201 response:** `{ message: { id, conversation_id, sender_id, recipient_id, appointment_id, organization_id, content, is_read } }`. Idempotent on `clientMessageId`. Emits a `job_message` notification to the counterparty.
- **Window helper (exists, PR1):** `isJobMessagingWindowOpen(appt, now)` in `src/lib/messaging/jobMessagingWindow.ts`. Input `{ status, cleaner_confirmation_status: string|null, completed_at, cancelled_at }`. Open when: `in_progress`; `confirmed` AND `cleaner_confirmation_status === 'approved'`; `completed` within `completed_at + 24h`. Closed when cancelled / pending / awaiting-or-rejected / past grace.
- **`job_message` notification descriptor (exists, PR1):** `describeNotification('job_message', { sender_name, snippet })` already renders. No change.
- **`messages` already has `appointment_id`** (PR #88); `useSendMessage({ appointmentId })` already sets it. `useMessages` keys by `conversation_id` and is participant-agnostic (reusable for job threads).
- **Office recipient resolution (exists):** `filterOfficeContacts(members)` + `resolvePrimaryOfficeContact(members)` in `src/components/redesign/cleaner/messages/office-contacts.ts` are React-free and role-neutral (homeowner may message admin+manager per `rolesUserCanMessage('homeowner')`). Reuse by import.
- **`useOrganizationMembers({ excludeCurrentUser: true })`** returns `members: OrganizationMember[]` with `{ id, first_name, last_name, email, role, org_role, avatar_url }`.
- **Homeowner test data (remote dev Supabase):** John Doe `homeowner@nexxus.com`, in-progress appt `4b79f4ca-06c1-46af-a101-00023fe28e2e`.

---

## File Structure

**Shared hooks / types (segregation — touched once, fixes all consumers):**
- Modify `src/types/index.ts` — add `appointment_id` to `Conversation`.
- Modify `src/lib/queryKeys.ts` — scope-discriminate `conversations.byUser` + `messages.unreadCount`.
- Modify `src/hooks/useConversations.ts` — `scope?: 'office' | 'job'` (default `'office'`).
- Modify `src/hooks/useUnreadMessageCount.ts` — `scope?: 'office' | 'all'` (default `'office'`).

**Shared chat primitives (formalize):**
- Rename `src/components/redesign/cleaner/messages/CleanerMessageThreadView.tsx` → `src/components/redesign/messages/MessageThreadTakeoverView.tsx` (+ `readOnly`/`readOnlyNotice`/`emptyTitle`/`emptyBody` props). Update the one importer (`CleanerThread.tsx`).
- Modify `src/components/redesign/messages/MessageComposer.tsx` — add `showAddImage?: boolean`.

**Job-send hook:**
- Create `src/hooks/useSendJobMessage.ts`.

**Homeowner appointment extension:**
- Modify `src/hooks/useHomeownerData.ts` — select + `Appointment` type gain `cleaner_id`, `cancelled_at`, `cleaner_confirmation_status`, cleaner `avatar_url`.

**Homeowner messages feature (`src/components/redesign/homeowner/messages/`):**
- Create `homeowner-messages-types.ts` — VMs + inbox model.
- Create `deriveHomeownerInbox.ts` + `deriveHomeownerInbox.test.ts` — pure sectioning.
- Create `useHomeownerOfficeContact.ts` — primary office contact resolver.
- Create `useOpenMessageThread.ts` — write-only param setters.
- Create `useHomeownerOrgMessagingEnabled.ts` — best-effort org kill-switch read (default true).
- Create `HomeownerMessages.tsx` — container.
- Create `HomeownerMessagesView.tsx` — presentational sectioned inbox.
- Create `HomeownerMessageThread.tsx` — thread container (office vs job send + read-only).
- Create `HomeownerMessageThreadHost.tsx` — param-driven takeover host.

**Wiring:**
- Modify `src/app/(redesign)/app/homeowner-dashboard/messages/page.tsx` — render `<HomeownerMessages />`.
- Modify `src/app/(redesign)/app/homeowner-dashboard/layout.tsx` — mount `<HomeownerMessageThreadHost />` under `<Suspense>`.
- Modify `src/components/redesign/homeowner/shell/HomeownerShell.tsx` — badge `scope: 'all'`.
- Modify `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx` — entry-point buttons.

---

## Task 1: Segregate office inbox + unread badge (dominant risk)

**Files:**
- Modify: `src/types/index.ts` (the `Conversation` interface, ~line 321)
- Modify: `src/lib/queryKeys.ts:54-60`
- Modify: `src/hooks/useConversations.ts`
- Modify: `src/hooks/useUnreadMessageCount.ts`

**Interfaces:**
- Produces: `useConversations({ userId, scope?: 'office' | 'job' })` (default `'office'`); `useUnreadMessageCount(userId, scope?: 'office' | 'all')` (default `'office'`); `keys.conversations.byUser(userId, scope?)`; `keys.messages.unreadCount(userId, scope?)`.
- Consumed by: every existing caller (gets `'office'` automatically) + Tasks 6/7 (job + all).

- [ ] **Step 1: Add `appointment_id` to the `Conversation` type**

In `src/types/index.ts`, find:
```typescript
export interface Conversation {
  id: string;
  participant_1_id: string;
  participant_2_id: string;
  last_message_at: string;
  created_at: string;
}
```
Add `appointment_id`:
```typescript
export interface Conversation {
  id: string;
  participant_1_id: string;
  participant_2_id: string;
  /** NULL = office thread (a contact pair). NON-NULL = a per-appointment job thread (homeowner<->cleaner). */
  appointment_id: string | null;
  last_message_at: string;
  created_at: string;
}
```
(`ConversationWithDetails extends Conversation`, so it inherits the field.)

- [ ] **Step 2: Scope-discriminate the query keys**

In `src/lib/queryKeys.ts`, replace the `conversations` and `messages` blocks:
```typescript
  conversations: {
    byUser: (userId: string, scope: 'office' | 'job' = 'office') =>
      ['conversations', 'user', userId, scope] as const,
  },
  messages: {
    byConversation: (convId: string) => ['messages', 'conversation', convId] as const,
    unreadCount: (userId: string, scope: 'office' | 'all' = 'office') =>
      ['messages', 'unread', userId, scope] as const,
  },
```
Existing callers passing one arg keep working (default `'office'`).

- [ ] **Step 3: Add `scope` to `useConversations` (query + key + channels)**

In `src/hooks/useConversations.ts`:
1. Extend the options:
```typescript
interface UseConversationsOptions {
  userId: string;
  scope?: 'office' | 'job';
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}

export function useConversations({ userId, scope = 'office', searchQuery = '', roleFilter = 'all' }: UseConversationsOptions) {
  const queryClient = useQueryClient();
  const queryKey = keys.conversations.byUser(userId, scope);
```
2. Filter the base query by scope (right after `.or(...)`, before `.order(...)`):
```typescript
      let convQuery = supabase
        .from('conversations')
        .select('*')
        .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`);
      convQuery = scope === 'job'
        ? convQuery.not('appointment_id', 'is', null)
        : convQuery.is('appointment_id', null);
      const { data: conversationsData, error: conversationsError } = await convQuery
        .order('last_message_at', { ascending: false });
```
3. **Suffix every realtime `channelName` in this hook with `:${scope}`** so the office and job instances don't collide under channel-dedup (identical names share one subscription and only one `onEvent` fires). Update all four:
   - `conversations:${userId}:${scope}`
   - `messages:sender:${userId}:${scope}`
   - `messages:recipient:${userId}:${scope}`
   - `message_attachments:user:${userId}:${scope}`
   (Each still returns `{ type: 'invalidate', keys: [queryKey] }`, now the scoped key.)

- [ ] **Step 4: Add `scope` to `useUnreadMessageCount` (query + key + channel)**

In `src/hooks/useUnreadMessageCount.ts`, replace the hook signature/body so office is the default and the homeowner can opt into all:
```typescript
export function useUnreadMessageCount(
  userId: string | undefined,
  scope: 'office' | 'all' = 'office',
): number {
  const key = keys.messages.unreadCount(userId ?? 'anon', scope);

  const query = useQuery({
    queryKey: key,
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async () => {
      let q = supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId as string)
        .eq('is_read', false);
      if (scope === 'office') q = q.is('appointment_id', null);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  useSupabaseRealtimeSync({
    enabled: !!userId,
    channelName: `messages:recipient:${userId ?? 'anon'}:badge:${scope}`,
    table: 'messages',
    filter: userId ? `recipient_id=eq.${userId}` : undefined,
    onEvent: () => ({ type: 'invalidate', keys: [key] }),
  });

  return query.data ?? 0;
}
```

- [ ] **Step 5: Verify no regressions**

Run: `npx tsc --noEmit`
Expected: no new errors. (`useSendMessage.onSuccess` still calls `keys.conversations.byUser(user.id)` → resolves to the office key, which is correct: an office send invalidates the office list.)
Run: `npm run test -- src/components/redesign/cleaner/messages/deriveOfficeInbox.test.ts`
Expected: PASS (the pure derive is unaffected).

- [ ] **Step 6: Commit**
```bash
git add src/types/index.ts src/lib/queryKeys.ts src/hooks/useConversations.ts src/hooks/useUnreadMessageCount.ts
git commit -m "feat(messaging): scope office inbox + unread badge to appointment_id IS NULL"
```

---

## Task 2: Formalize the shared takeover thread view + composer

**Files:**
- Rename/Modify: `src/components/redesign/cleaner/messages/CleanerMessageThreadView.tsx` → Create `src/components/redesign/messages/MessageThreadTakeoverView.tsx`
- Modify: `src/components/redesign/cleaner/messages/CleanerThread.tsx` (import + JSX tag)
- Modify: `src/components/redesign/messages/MessageComposer.tsx`

**Interfaces:**
- Produces: `MessageThreadTakeoverView` (the old `CleanerMessageThreadView` props PLUS `readOnly?: boolean`, `readOnlyNotice?: string`, `emptyTitle?: string`, `emptyBody?: string`); `MessageComposer` gains `showAddImage?: boolean`.
- Consumed by: `CleanerThread` (Task 2), `HomeownerMessageThread` (Task 6).

- [ ] **Step 1: Add `showAddImage` to `MessageComposer`**

In `src/components/redesign/messages/MessageComposer.tsx`, add to the props type (after `showReferenceBooking?`):
```typescript
  /** Hide the "Add image" affordance (job threads are text-only). Defaults to shown. */
  showAddImage?: boolean
```
Replace the `<DropdownMenu>...</DropdownMenu>` block (the Plus trigger) so the whole menu disappears when BOTH affordances are hidden, and the image item is gated:
```tsx
        {(props.showAddImage !== false || props.showReferenceBooking !== false) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Add to message" className="h-9 w-9 shrink-0 bg-primary/10 text-primary">
                <Plus className="size-5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {props.showAddImage !== false && (
                <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" />
                  Add image
                </DropdownMenuItem>
              )}
              {props.showReferenceBooking !== false && (
                <ReferenceBookingMenu
                  isMobile={props.isMobile}
                  bookings={props.attachableBookings}
                  onPick={props.onStageBooking}
                  trigger={
                    <DropdownMenuItem onSelect={(e: Event) => e.preventDefault()}>
                      <CalendarDays className="size-4" />
                      Reference a booking
                    </DropdownMenuItem>
                  }
                />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
```
(The hidden `<input ref={fileRef} .../>` stays; it is only triggered by the gated item.)

- [ ] **Step 2: Create the shared takeover view from the cleaner one**

Create `src/components/redesign/messages/MessageThreadTakeoverView.tsx` with the FULL contents of the current `CleanerMessageThreadView.tsx`, with these changes:
1. Rename the exported interface to `MessageThreadTakeoverViewProps` and the function to `MessageThreadTakeoverView`.
2. Fix the relative imports (now same-folder): `MessageBubble`, `MessageComposer`, `messages-types` import from `./` instead of `@/components/redesign/messages/`.
3. Add four optional props to the interface:
```typescript
  /** When true the composer is replaced by a closed-thread notice (history stays readable). */
  readOnly?: boolean;
  readOnlyNotice?: string;
  /** Empty-state copy (defaults to the office wording). */
  emptyTitle?: string;
  emptyBody?: string;
```
4. Parameterize the empty state (replace the hard-coded office copy):
```tsx
        ) : props.messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <MessageSquare className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">
              {props.emptyTitle ?? 'Start the conversation'}
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {props.emptyBody ?? 'Send your office a message. They will see it right away.'}
            </p>
          </div>
        ) : (
```
5. Replace the trailing `<MessageComposer {...props.composer} />` with a read-only-aware footer:
```tsx
      {props.readOnly ? (
        <div className="border-t border-border/60 bg-muted/40 px-4 py-3 text-center text-xs font-medium text-muted-foreground">
          {props.readOnlyNotice ?? 'This conversation is closed. You can still read the history.'}
        </div>
      ) : (
        <MessageComposer {...props.composer} />
      )}
```

- [ ] **Step 3: Delete the old cleaner view file and repoint its importer**

Delete `src/components/redesign/cleaner/messages/CleanerMessageThreadView.tsx`.
In `src/components/redesign/cleaner/messages/CleanerThread.tsx`:
- Change the import `import { CleanerMessageThreadView } from "./CleanerMessageThreadView";` to
  `import { MessageThreadTakeoverView } from "@/components/redesign/messages/MessageThreadTakeoverView";`
- Change the JSX tag `<CleanerMessageThreadView ... />` to `<MessageThreadTakeoverView ... />` (props unchanged; cleaner passes none of the new optional props, so behavior is identical).

- [ ] **Step 4: Verify the cleaner thread is unchanged**

Run: `npx tsc --noEmit`
Expected: no errors (the only importer was updated).
Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/messages/MessageThreadTakeoverView.tsx src/components/redesign/cleaner/messages/CleanerMessageThreadView.tsx src/components/redesign/cleaner/messages/CleanerThread.tsx src/components/redesign/messages/MessageComposer.tsx
git commit -m "refactor(messaging): extract shared MessageThreadTakeoverView + composer showAddImage"
```

---

## Task 3: `useSendJobMessage` hook

**Files:**
- Create: `src/hooks/useSendJobMessage.ts`

**Interfaces:**
- Consumes: `getAccessToken` (`@/lib/auth/clientAccessToken`), `uuidv4` (`@/lib/uuid`), `keys`, the PR1 route.
- Produces: `useSendJobMessage()` returning `{ sendJobMessage(opts: { appointmentId: string; content: string }) => Promise<{ success: boolean; message?: SentJobMessage; conversationId?: string; error?: string }>, sending: boolean }`, where `SentJobMessage` is the route's 201 `message` object.
- Consumed by: `HomeownerMessageThread` (Task 6).

- [ ] **Step 1: Write the hook**

Create `src/hooks/useSendJobMessage.ts`:
```typescript
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { uuidv4 } from '@/lib/uuid';
import { keys } from '@/lib/queryKeys';
import { useAuth } from './useAuth';
import type { MessageWithDetails, UserProfile } from '@/types';

export interface SentJobMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  appointment_id: string;
  organization_id: string;
  content: string;
  is_read: boolean;
}

interface SendJobMessageOptions {
  appointmentId: string;
  content: string;
}

/**
 * Send a homeowner<->cleaner job message through the guarded PR1 route. The
 * client cannot INSERT into `messages` for this pair (RLS `can_message_user`
 * forbids homeowner<->cleaner), so the route (service-role) is the only path.
 * Idempotent via a client-generated `clientMessageId`. On success we patch the
 * sender's message cache so the bubble appears immediately (the realtime echo
 * then dedupes by id), and invalidate the job-conversation list.
 */
export function useSendJobMessage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ appointmentId, content }: SendJobMessageOptions): Promise<SentJobMessage> => {
      const token = await getAccessToken();
      if (!token) throw new Error('You are signed out. Please sign in again.');
      const res = await fetch(`/api/appointments/${appointmentId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, clientMessageId: uuidv4() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || 'Could not send the message.');
      }
      return (json as { message: SentJobMessage }).message;
    },
    onSuccess: (message) => {
      // Patch the sender's thread cache so the bubble shows without waiting for
      // realtime. The realtime INSERT echo dedupes by id (useMessages checks it).
      const cacheKey = keys.messages.byConversation(message.conversation_id);
      const nowIso = new Date().toISOString();
      const full: MessageWithDetails = {
        id: message.id,
        organization_id: message.organization_id,
        conversation_id: message.conversation_id,
        sender_id: message.sender_id,
        recipient_id: message.recipient_id,
        appointment_id: message.appointment_id,
        subject: null,
        content: message.content,
        is_read: false,
        created_at: nowIso,
        sender: null as unknown as UserProfile,
        recipient: null as unknown as UserProfile,
        attachments: [],
      };
      queryClient.setQueryData<MessageWithDetails[]>(cacheKey, (prev) => {
        const list = prev ?? [];
        if (list.some((m) => m.id === full.id)) return list;
        return [...list, full].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: keys.conversations.byUser(user.id, 'job') });
      }
    },
  });

  const sendJobMessage = async (opts: SendJobMessageOptions) => {
    try {
      const message = await mutation.mutateAsync(opts);
      return { success: true as const, message, conversationId: message.conversation_id };
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : 'Could not send the message.' };
    }
  };

  return { sendJobMessage, sending: mutation.isPending };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirm `getAccessToken` is exported from `src/lib/auth/clientAccessToken.ts` and `uuidv4` from `src/lib/uuid.ts`; both verified present.)

- [ ] **Step 3: Commit**
```bash
git add src/hooks/useSendJobMessage.ts
git commit -m "feat(messaging): useSendJobMessage (guarded route + cache patch)"
```

---

## Task 4: Extend homeowner appointments with messaging fields

**Files:**
- Modify: `src/hooks/useHomeownerData.ts` (the `Appointment` interface + the `useHomeownerAppointments` select + the row mapper)

**Interfaces:**
- Produces: `Appointment` gains `cleaner_id?: string | null`, `cancelled_at?: string | null`, `cleaner_confirmation_status?: string | null`, and `cleaner_profile.user_profile.avatar_url`.
- Consumed by: Tasks 5/6/7/8 (window partition, thread title/avatar, entry-point gating).

- [ ] **Step 1: Extend the `Appointment` type**

In `src/hooks/useHomeownerData.ts`, update the `Appointment` interface:
- Add after `status`:
```typescript
  cleaner_id?: string | null;
  cancelled_at?: string | null;
  cleaner_confirmation_status?: string | null;
```
- Update the `cleaner_profile` shape to include the cleaner's avatar:
```typescript
  cleaner_profile?: {
    user_profile: {
      first_name: string;
      last_name: string;
      avatar_url?: string | null;
    } | null;
  } | null;
```

- [ ] **Step 2: Extend the select**

In the `useHomeownerAppointments` query, add the three columns and the avatar to the select string:
- After `status,` add a line: `cleaner_id,`
- After `completed_at,` add: `cancelled_at,\n          cleaner_confirmation_status,`
- In the `cleaner_profile` join, add `avatar_url` to the `user_profiles(...)` list:
```
          cleaner_profile:cleaner_profiles(
            user_profile:user_profiles(
              first_name,
              last_name,
              avatar_url
            )
          )
```
(The row mapper spreads `...appointment`, so the new scalar columns flow through; the `cleaner_profile` array-unwrap mapping already handles the nested object.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Manual: load the homeowner Cleanings tab on the preview; existing cards still render (regression check).

- [ ] **Step 4: Commit**
```bash
git add src/hooks/useHomeownerData.ts
git commit -m "feat(homeowner): select cleaner_id + window fields on appointments"
```

---

## Task 5: Inbox types + pure sectioning derive (TDD)

**Files:**
- Create: `src/components/redesign/homeowner/messages/homeowner-messages-types.ts`
- Create: `src/components/redesign/homeowner/messages/deriveHomeownerInbox.ts`
- Test: `src/components/redesign/homeowner/messages/deriveHomeownerInbox.test.ts`

**Interfaces:**
- Consumes: `ConversationWithDetails` (`@/types`), `Appointment` (`@/hooks/useHomeownerData`), `isJobMessagingWindowOpen` (`@/lib/messaging/jobMessagingWindow`), `toConversationRowVM` (`@/components/redesign/messages/messages-presenters`).
- Produces: `JobThreadRowVM`, `HomeownerInboxModel`, `deriveHomeownerInbox(input) => HomeownerInboxModel`.
- Consumed by: `HomeownerMessages` (Task 7).

- [ ] **Step 1: Write the types**

Create `src/components/redesign/homeowner/messages/homeowner-messages-types.ts`:
```typescript
import type { ConversationRowVM } from '@/components/redesign/messages/messages-types';

/** A per-cleaning job thread row (active or past). */
export interface JobThreadRowVM {
  conversationId: string;
  appointmentId: string;
  cleanerName: string;
  /** "Tue, Jun 30" cleaning date for labeling. */
  dateLabel: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  preview: string;
  timeLabel: string;
  unreadCount: number;
  avatarUrl: string | null;
}

export interface HomeownerInboxModel {
  /** The office thread row, or null when the homeowner has not messaged the office yet. */
  office: ConversationRowVM | null;
  active: JobThreadRowVM[];
  past: JobThreadRowVM[];
}
```

- [ ] **Step 2: Write the failing test**

Create `src/components/redesign/homeowner/messages/deriveHomeownerInbox.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { deriveHomeownerInbox } from './deriveHomeownerInbox';
import type { ConversationWithDetails } from '@/types';
import type { Appointment } from '@/hooks/useHomeownerData';

const NOW = new Date('2026-06-30T18:00:00Z');
const ME = 'home-1';

function conv(over: Partial<ConversationWithDetails>): ConversationWithDetails {
  return {
    id: 'c', participant_1_id: ME, participant_2_id: 'other', appointment_id: null,
    last_message_at: '2026-06-30T17:00:00Z', created_at: '2026-06-01T00:00:00Z',
    other_participant: { id: 'other', first_name: 'A', last_name: 'B', role: 'cleaner', email: '', avatar_url: null } as never,
    last_message: null, last_message_attachment_count: 0, unread_count: 0,
    ...over,
  } as ConversationWithDetails;
}

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a', scheduled_date: '2026-06-30', scheduled_time: '14:00', status: 'in_progress',
    total_price: 100, property: null, service_type: null,
    cleaner_id: 'cl-1', cancelled_at: null, cleaner_confirmation_status: 'approved', completed_at: null,
    cleaner_profile: { user_profile: { first_name: 'Maria', last_name: 'Lopez', avatar_url: null } },
    ...over,
  } as Appointment;
}

describe('deriveHomeownerInbox', () => {
  it('returns the office row from an appointment_id=null conversation', () => {
    const m = deriveHomeownerInbox({
      officeRows: [conv({ id: 'office-c', appointment_id: null })],
      jobRows: [], appointmentsById: new Map(), now: NOW, currentUserId: ME,
    });
    expect(m.office?.id).toBe('office-c');
    expect(m.active).toHaveLength(0);
    expect(m.past).toHaveLength(0);
  });

  it('partitions an in-progress job thread into active', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [conv({ id: 'job-c', appointment_id: 'a', unread_count: 2 })],
      appointmentsById: new Map([['a', appt({ id: 'a', status: 'in_progress' })]]),
      now: NOW, currentUserId: ME,
    });
    expect(m.active).toHaveLength(1);
    expect(m.active[0].conversationId).toBe('job-c');
    expect(m.active[0].cleanerName).toBe('Maria Lopez');
    expect(m.active[0].unreadCount).toBe(2);
    expect(m.past).toHaveLength(0);
  });

  it('partitions a cancelled job thread into past', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [conv({ id: 'job-c', appointment_id: 'a' })],
      appointmentsById: new Map([['a', appt({ id: 'a', status: 'cancelled', cancelled_at: '2026-06-30T10:00:00Z' })]]),
      now: NOW, currentUserId: ME,
    });
    expect(m.active).toHaveLength(0);
    expect(m.past).toHaveLength(1);
  });

  it('drops a job thread whose appointment is not loaded', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [conv({ id: 'job-c', appointment_id: 'missing' })],
      appointmentsById: new Map(), now: NOW, currentUserId: ME,
    });
    expect(m.active).toHaveLength(0);
    expect(m.past).toHaveLength(0);
  });

  it('sorts active by last message desc', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [
        conv({ id: 'older', appointment_id: 'a1', last_message_at: '2026-06-30T10:00:00Z' }),
        conv({ id: 'newer', appointment_id: 'a2', last_message_at: '2026-06-30T16:00:00Z' }),
      ],
      appointmentsById: new Map([
        ['a1', appt({ id: 'a1', status: 'in_progress' })],
        ['a2', appt({ id: 'a2', status: 'in_progress' })],
      ]),
      now: NOW, currentUserId: ME,
    });
    expect(m.active.map((r) => r.conversationId)).toEqual(['newer', 'older']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/components/redesign/homeowner/messages/deriveHomeownerInbox.test.ts`
Expected: FAIL ("deriveHomeownerInbox is not a function" / module not found).

- [ ] **Step 4: Implement the derive**

Create `src/components/redesign/homeowner/messages/deriveHomeownerInbox.ts`:
```typescript
import type { ConversationWithDetails } from '@/types';
import type { Appointment } from '@/hooks/useHomeownerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { toConversationRowVM } from '@/components/redesign/messages/messages-presenters';
import type { HomeownerInboxModel, JobThreadRowVM } from './homeowner-messages-types';

interface DeriveInput {
  officeRows: ConversationWithDetails[];
  jobRows: ConversationWithDetails[];
  appointmentsById: Map<string, Appointment>;
  now: Date;
  currentUserId: string;
}

function cleanerName(a: Appointment): string {
  const u = a.cleaner_profile?.user_profile;
  const n = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
  return n || 'Your cleaner';
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/**
 * Sections the homeowner inbox: the single office thread (pinned), active job
 * threads (send window open), and past job threads (archived, read-only).
 * Job rows whose appointment is not in the loaded set are dropped (defensive).
 */
export function deriveHomeownerInbox(input: DeriveInput): HomeownerInboxModel {
  const { officeRows, jobRows, appointmentsById, now, currentUserId } = input;

  const office = officeRows.length
    ? toConversationRowVM(
        [...officeRows].sort(
          (a, b) =>
            new Date(b.last_message_at ?? b.created_at).getTime() -
            new Date(a.last_message_at ?? a.created_at).getTime(),
        )[0],
        currentUserId,
      )
    : null;

  const active: JobThreadRowVM[] = [];
  const past: JobThreadRowVM[] = [];

  for (const conv of jobRows) {
    if (!conv.appointment_id) continue;
    const appt = appointmentsById.get(conv.appointment_id);
    if (!appt) continue;
    const base = toConversationRowVM(conv, currentUserId);
    const row: JobThreadRowVM = {
      conversationId: conv.id,
      appointmentId: conv.appointment_id,
      cleanerName: cleanerName(appt),
      dateLabel: dateLabel(appt.scheduled_date),
      status: appt.status,
      preview: base.preview,
      timeLabel: base.timeLabel,
      unreadCount: base.unreadCount,
      avatarUrl: appt.cleaner_profile?.user_profile?.avatar_url ?? null,
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

  const byRecent = (a: JobThreadRowVM, b: JobThreadRowVM) => {
    const ca = jobRows.find((c) => c.id === a.conversationId);
    const cb = jobRows.find((c) => c.id === b.conversationId);
    return (
      new Date(cb?.last_message_at ?? cb?.created_at ?? 0).getTime() -
      new Date(ca?.last_message_at ?? ca?.created_at ?? 0).getTime()
    );
  };
  active.sort(byRecent);
  past.sort(byRecent);

  return { office, active, past };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/components/redesign/homeowner/messages/deriveHomeownerInbox.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**
```bash
git add src/components/redesign/homeowner/messages/homeowner-messages-types.ts src/components/redesign/homeowner/messages/deriveHomeownerInbox.ts src/components/redesign/homeowner/messages/deriveHomeownerInbox.test.ts
git commit -m "feat(homeowner): pure homeowner inbox sectioning derive"
```

---

## Task 6: Homeowner thread container + host + open hook + helpers

**Files:**
- Create: `src/components/redesign/homeowner/messages/useHomeownerOfficeContact.ts`
- Create: `src/components/redesign/homeowner/messages/useOpenMessageThread.ts`
- Create: `src/components/redesign/homeowner/messages/useHomeownerOrgMessagingEnabled.ts`
- Create: `src/components/redesign/homeowner/messages/HomeownerMessageThread.tsx`
- Create: `src/components/redesign/homeowner/messages/HomeownerMessageThreadHost.tsx`

**Interfaces:**
- Consumes: `useMessages`, `useSendMessage`, `useSendJobMessage`, `useConversations({scope})`, `useHomeownerAppointments`, `useOrganizationMembers`, `useStartConversation`, `resolvePrimaryOfficeContact`, `toMessageVM`, `MessageThreadTakeoverView`, `MobileTakeover`, `isJobMessagingWindowOpen`.
- Produces: `useHomeownerOfficeContact()`, `useOpenMessageThread()`, `useHomeownerOrgMessagingEnabled()`, `<HomeownerMessageThread>`, `<HomeownerMessageThreadHost />`.

- [ ] **Step 1: Office contact resolver**

Create `src/components/redesign/homeowner/messages/useHomeownerOfficeContact.ts`:
```typescript
'use client';

import { useMemo } from 'react';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { resolvePrimaryOfficeContact, type OfficeContact } from '@/components/redesign/cleaner/messages/office-contacts';

/** The homeowner's default "office" recipient (owner -> admin -> manager). */
export function useHomeownerOfficeContact(): { office: OfficeContact | null; loading: boolean } {
  const { members, isLoading } = useOrganizationMembers({ excludeCurrentUser: true });
  const office = useMemo(() => resolvePrimaryOfficeContact(members), [members]);
  return { office, loading: isLoading };
}
```
(Confirm the field name `isLoading` against `useOrganizationMembers`; if it exposes `loading`, use that.)

- [ ] **Step 2: Write-only param opener**

Create `src/components/redesign/homeowner/messages/useOpenMessageThread.ts`:
```typescript
'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Open a homeowner message thread by setting URL params on the CURRENT path, so
 * the thread takeover (mounted in the layout) opens over whatever view is showing
 * (inbox or a cleaning detail). Mirrors useOpenCleaning's set-param-and-replace.
 * - openOffice(userId)       -> ?to=<userId>     (start/open the office thread)
 * - openOfficeThread(convId) -> ?thread=<convId> (open an existing office row)
 * - openJob(appointmentId)   -> ?job=<appointmentId>
 */
export function useOpenMessageThread() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = useCallback(
    (key: 'to' | 'thread' | 'job', value: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete('to');
      sp.delete('thread');
      sp.delete('job');
      sp.set(key, value);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return {
    openOffice: useCallback((userId: string) => set('to', userId), [set]),
    openOfficeThread: useCallback((convId: string) => set('thread', convId), [set]),
    openJob: useCallback((appointmentId: string) => set('job', appointmentId), [set]),
  };
}
```
(Note: this hook reads `useSearchParams`, so any component using it must sit under a `<Suspense>` boundary. The inbox page and the thread host are already client trees; the entry buttons live inside the cleaning-detail takeover which is mounted under the layout `<Suspense>`.)

- [ ] **Step 3: Org kill-switch read (best-effort)**

Create `src/components/redesign/homeowner/messages/useHomeownerOrgMessagingEnabled.ts`:
```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads the org kill-switch `homeowner_cleaner_messaging_enabled`. Defaults to
 * TRUE on any error or while loading (the guarded send route is the real gate;
 * this only hides entry points when the org has opted out). RLS: homeowner is an
 * org member and can read their org row.
 */
export function useHomeownerOrgMessagingEnabled(): boolean {
  const { currentOrganizationId } = useAuth();
  const { data } = useQuery({
    queryKey: ['org-messaging-enabled', currentOrganizationId ?? 'none'],
    enabled: !!currentOrganizationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('homeowner_cleaner_messaging_enabled')
        .eq('id', currentOrganizationId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.homeowner_cleaner_messaging_enabled ?? true;
    },
  });
  return data ?? true;
}
```

- [ ] **Step 4: Thread container (office vs job)**

Create `src/components/redesign/homeowner/messages/HomeownerMessageThread.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useSendJobMessage } from '@/hooks/useSendJobMessage';
import { toast } from '@/components/ui/toast';
import { isMessagingForbiddenError, MESSAGING_FORBIDDEN_TEXT } from '@/lib/messagingPermissions';
import { toMessageVM } from '@/components/redesign/messages/messages-presenters';
import { MessageThreadTakeoverView } from '@/components/redesign/messages/MessageThreadTakeoverView';
import type { Appointment } from '@/hooks/useHomeownerData';
import type { OfficeContact } from '@/components/redesign/cleaner/messages/office-contacts';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'O';
}

type ThreadConfig =
  | { kind: 'office'; recipient: OfficeContact }
  | { kind: 'job'; appointment: Appointment; cleanerName: string; avatarUrl: string | null; readOnly: boolean };

export function HomeownerMessageThread({
  config,
  conversationId,
  onBack,
}: {
  config: ThreadConfig;
  conversationId: string | null;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [activeConvId, setActiveConvId] = useState<string | null>(conversationId);
  useEffect(() => setActiveConvId(conversationId), [conversationId]);

  const {
    messages: rawMessages, loading, hasMore, isLoadingMore, loadMoreMessages, messagesEndRef,
  } = useMessages({ conversationId: activeConvId, userId });
  const { sendMessage, sending: sendingOffice } = useSendMessage();
  const { sendJobMessage, sending: sendingJob } = useSendJobMessage();

  const [draft, setDraft] = useState('');

  // Job threads reference one appointment for every message; suppress inline booking cards.
  const messages = useMemo(
    () => rawMessages.map((m, i) => toMessageVM(m, userId, i > 0 ? rawMessages[i - 1] : null, () => null)),
    [rawMessages, userId],
  );

  const title = config.kind === 'office' ? config.recipient.name : config.cleanerName;
  const avatarUrl = config.kind === 'office' ? config.recipient.avatarUrl : config.avatarUrl;
  const readOnly = config.kind === 'job' && config.readOnly;
  const sending = config.kind === 'office' ? sendingOffice : sendingJob;

  const onSend = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    if (config.kind === 'office') {
      const res = await sendMessage({
        conversationId: activeConvId ?? undefined,
        senderId: userId,
        recipientId: config.recipient.id,
        content,
      });
      if (res.success) {
        setDraft('');
        if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
      } else {
        toast.error(isMessagingForbiddenError(res) ? MESSAGING_FORBIDDEN_TEXT : res.error || 'Could not send the message.');
      }
    } else {
      const res = await sendJobMessage({ appointmentId: config.appointment.id, content });
      if (res.success) {
        setDraft('');
        if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
      } else {
        toast.error(res.error || 'Could not send the message.');
      }
    }
  }, [draft, config, sendMessage, sendJobMessage, activeConvId, userId]);

  return (
    <MessageThreadTakeoverView
      title={title}
      initials={initials(title)}
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
      readOnly={readOnly}
      readOnlyNotice="This cleaning is finished. You can still read the conversation."
      emptyTitle={config.kind === 'office' ? 'Message your office' : 'Message about this cleaning'}
      emptyBody={
        config.kind === 'office'
          ? 'Send your cleaning office a message. They will see it right away.'
          : 'Coordinate access and details with your cleaner. They will see it right away.'
      }
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
        showAddImage: config.kind === 'office',
      }}
    />
  );
}
```

- [ ] **Step 5: Thread host (param-driven takeover)**

Create `src/components/redesign/homeowner/messages/HomeownerMessageThreadHost.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { useStartConversation } from '@/hooks/useStartConversation';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { filterOfficeContacts, type OfficeContact } from '@/components/redesign/cleaner/messages/office-contacts';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import type { UserRole } from '@/types';
import { HomeownerMessageThread } from './HomeownerMessageThread';

export function HomeownerMessageThreadHost() {
  const sp = useSearchParams();
  const to = sp.get('to');
  const thread = sp.get('thread');
  const job = sp.get('job');
  if (!to && !thread && !job) return null;
  return <HostInner toParam={to} threadParam={thread} jobParam={job} />;
}

function HostInner({ toParam, threadParam, jobParam }: { toParam: string | null; threadParam: string | null; jobParam: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const isJob = !!jobParam;
  const { conversations: officeConvs } = useConversations({ userId, scope: 'office' });
  const { conversations: jobConvs } = useConversations({ userId, scope: 'job' });
  const { members } = useOrganizationMembers({ excludeCurrentUser: true });
  const { appointments } = useHomeownerAppointments();
  const { startConversation } = useStartConversation();

  // ---- Office recipient resolution (?to / ?thread) ----
  const officeContacts = useMemo(() => filterOfficeContacts(members), [members]);
  const officeRecipient: OfficeContact | null = useMemo(() => {
    if (toParam) return officeContacts.find((o) => o.id === toParam) ?? null;
    if (threadParam) {
      const p = officeConvs.find((c) => c.id === threadParam)?.other_participant;
      if (!p) return null;
      return {
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email || 'Office',
        role: (p.role as UserRole) ?? 'admin',
        orgRole: '',
        avatarUrl: p.avatar_url ?? null,
      };
    }
    return null;
  }, [toParam, threadParam, officeContacts, officeConvs]);

  const [officeConvId, setOfficeConvId] = useState<string | null>(threadParam);
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (toParam) {
      if (startedForRef.current === toParam) return;
      startedForRef.current = toParam;
      startConversation(toParam).then((res) => {
        if (res.success && res.conversationId) setOfficeConvId(res.conversationId);
      });
    } else {
      startedForRef.current = null;
      setOfficeConvId(threadParam);
    }
  }, [toParam, threadParam, startConversation]);

  // ---- Job thread resolution (?job) ----
  const jobAppt = useMemo(() => (jobParam ? appointments.find((a) => a.id === jobParam) ?? null : null), [jobParam, appointments]);
  const jobConvId = useMemo(
    () => (jobParam ? jobConvs.find((c) => c.appointment_id === jobParam)?.id ?? null : null),
    [jobParam, jobConvs],
  );

  const close = useCallback(() => {
    const next = new URLSearchParams(sp.toString());
    next.delete('to');
    next.delete('thread');
    next.delete('job');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  const ready = isJob ? !!jobAppt : !!officeRecipient;

  return (
    <MobileTakeover key={jobParam ?? threadParam ?? toParam ?? ''} onClosed={close} ariaLabel={isJob ? 'Cleaning conversation' : 'Office conversation'}>
      {(closeTakeover) =>
        ready ? (
          isJob && jobAppt ? (
            <HomeownerMessageThread
              config={{
                kind: 'job',
                appointment: jobAppt,
                cleanerName:
                  `${jobAppt.cleaner_profile?.user_profile?.first_name ?? ''} ${jobAppt.cleaner_profile?.user_profile?.last_name ?? ''}`.trim() ||
                  'Your cleaner',
                avatarUrl: jobAppt.cleaner_profile?.user_profile?.avatar_url ?? null,
                readOnly: !isJobMessagingWindowOpen(
                  {
                    status: jobAppt.status,
                    cleaner_confirmation_status: jobAppt.cleaner_confirmation_status ?? null,
                    completed_at: jobAppt.completed_at ?? null,
                    cancelled_at: jobAppt.cancelled_at ?? null,
                  },
                  new Date(),
                ),
              }}
              conversationId={jobConvId}
              onBack={closeTakeover}
            />
          ) : officeRecipient ? (
            <HomeownerMessageThread config={{ kind: 'office', recipient: officeRecipient }} conversationId={officeConvId} onBack={closeTakeover} />
          ) : null
        ) : (
          <div className="grid h-full place-items-center bg-card">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading conversation" />
          </div>
        )
      }
    </MobileTakeover>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any field-name mismatches surfaced (`useOrganizationMembers` loading flag, `useStartConversation` return shape `{ success, conversationId }`).

- [ ] **Step 7: Commit**
```bash
git add src/components/redesign/homeowner/messages/useHomeownerOfficeContact.ts src/components/redesign/homeowner/messages/useOpenMessageThread.ts src/components/redesign/homeowner/messages/useHomeownerOrgMessagingEnabled.ts src/components/redesign/homeowner/messages/HomeownerMessageThread.tsx src/components/redesign/homeowner/messages/HomeownerMessageThreadHost.tsx
git commit -m "feat(homeowner): message thread container + param-driven takeover host"
```

---

## Task 7: Inbox screen + wiring (page, layout host, badge scope)

**Files:**
- Create: `src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx`
- Create: `src/components/redesign/homeowner/messages/HomeownerMessages.tsx`
- Modify: `src/app/(redesign)/app/homeowner-dashboard/messages/page.tsx`
- Modify: `src/app/(redesign)/app/homeowner-dashboard/layout.tsx`
- Modify: `src/components/redesign/homeowner/shell/HomeownerShell.tsx`

**Interfaces:**
- Consumes: `deriveHomeownerInbox`, `useConversations({scope})`, `useHomeownerAppointments`, `useHomeownerOfficeContact`, `useOpenMessageThread`, `useHomeownerOrgMessagingEnabled`, `HomeownerInboxModel`, `JobThreadRowVM`.
- Produces: `<HomeownerMessages />`, `<HomeownerMessagesView />`.

- [ ] **Step 1: Presentational sectioned inbox**

Create `src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx`. Build it ONLY from design-system primitives (`Card`/section wrappers, `Avatar`, `Badge`, `Skeleton`, `EmptyState`, `lucide` icons). Structure:
- A header `<h1 className="text-xl font-bold">Messages</h1>` + a live-count subtitle (no KPI row).
- **Office section** (pinned): one tappable row. If `model.office` exists, render its `name` ("Office" label override — show "Cleaning office" as the title, with `preview` + `timeLabel` + unread dot). If null, render a "Message your office" prompt row. Tap calls `onOpenOffice()`.
- **"Your cleanings" section**: `model.active` rows. Each row: cleaner `Avatar` (fallback initials), `cleanerName`, `dateLabel` + a `BookingBadge`-style status pill (reuse `BookingBadge` from `messages-presenters` is operator-oriented; instead render the status with the design-system `Badge` variant mapping already used in the cleanings list, or import `BookingBadge`), `preview`, `timeLabel`, and an unread count pill (`tabular-nums`, brand bg, with `sr-only` "{n} unread"). Tap calls `onOpenJob(appointmentId)`.
- **"Past" section**: `model.past` rows, same row component but muted (`opacity` + a small "Closed" affordance); tap still opens (read-only thread). Collapse if empty.
- **Empty state** (office null + no active + no past): `EmptyState` icon `MessageSquare`, title "No messages yet", body "Message your cleaning office anytime, or message your cleaner during a cleaning." plus a primary `Button` "Message office" calling `onOpenOffice`.
- **Loading:** `Skeleton` rows.

Props:
```typescript
export interface HomeownerMessagesViewProps {
  model: HomeownerInboxModel;
  loading: boolean;
  onOpenOffice: () => void;
  onOpenOfficeThread: (conversationId: string) => void;
  onOpenJob: (appointmentId: string) => void;
}
```
Unread indicator MUST pair color with text (an unread count number, not color alone). Touch targets >= 44px. No `primary-*` ramp; use brand/semantic tokens.

- [ ] **Step 2: Container**

Create `src/components/redesign/homeowner/messages/HomeownerMessages.tsx`:
```tsx
'use client';

import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { deriveHomeownerInbox } from './deriveHomeownerInbox';
import { useHomeownerOfficeContact } from './useHomeownerOfficeContact';
import { useOpenMessageThread } from './useOpenMessageThread';
import { HomeownerMessagesView } from './HomeownerMessagesView';

export function HomeownerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { conversations: officeRows, loading: lo } = useConversations({ userId, scope: 'office' });
  const { conversations: jobRows, loading: lj } = useConversations({ userId, scope: 'job' });
  const { appointments, loading: la } = useHomeownerAppointments();
  const { office } = useHomeownerOfficeContact();
  const { openOffice, openOfficeThread, openJob } = useOpenMessageThread();

  const appointmentsById = useMemo(() => {
    const m = new Map<string, (typeof appointments)[number]>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const model = useMemo(
    () => deriveHomeownerInbox({ officeRows, jobRows, appointmentsById, now: new Date(), currentUserId: userId }),
    [officeRows, jobRows, appointmentsById, userId],
  );

  return (
    <HomeownerMessagesView
      model={model}
      loading={lo || lj || la}
      onOpenOffice={() => {
        if (model.office) openOfficeThread(model.office.id);
        else if (office) openOffice(office.id);
      }}
      onOpenOfficeThread={openOfficeThread}
      onOpenJob={openJob}
    />
  );
}
```

- [ ] **Step 3: Render it on the Messages tab**

Replace the placeholder body of `src/app/(redesign)/app/homeowner-dashboard/messages/page.tsx`:
```tsx
import { HomeownerMessages } from '@/components/redesign/homeowner/messages/HomeownerMessages';

export default function MessagesPage() {
  return <HomeownerMessages />;
}
```

- [ ] **Step 4: Mount the thread host in the layout**

In `src/app/(redesign)/app/homeowner-dashboard/layout.tsx`, add the host alongside the cleaning-detail host (both under `<Suspense>`):
```tsx
import { HomeownerMessageThreadHost } from '@/components/redesign/homeowner/messages/HomeownerMessageThreadHost';
// ...
      <Suspense fallback={null}>
        <HomeownerCleaningDetailHost />
      </Suspense>
      <Suspense fallback={null}>
        <HomeownerMessageThreadHost />
      </Suspense>
```

- [ ] **Step 5: Badge counts office + job for the homeowner**

In `src/components/redesign/homeowner/shell/HomeownerShell.tsx`, change:
```tsx
  const messagesUnread = useUnreadMessageCount(user?.id, 'all');
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` + `npm run lint`
Expected: clean.
Manual (preview): Messages tab renders the sectioned inbox; the badge appears when an unread message exists.

- [ ] **Step 7: Commit**
```bash
git add src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx src/components/redesign/homeowner/messages/HomeownerMessages.tsx "src/app/(redesign)/app/homeowner-dashboard/messages/page.tsx" "src/app/(redesign)/app/homeowner-dashboard/layout.tsx" src/components/redesign/homeowner/shell/HomeownerShell.tsx
git commit -m "feat(homeowner): Messages tab sectioned inbox + thread host wiring"
```

---

## Task 8: Cleaning-detail entry points

**Files:**
- Modify: `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx`

**Interfaces:**
- Consumes: `useOpenMessageThread`, `useHomeownerOfficeContact`, `useHomeownerOrgMessagingEnabled`, `isJobMessagingWindowOpen`.

- [ ] **Step 1: Add the entry buttons**

In `HomeownerCleaningDetail.tsx`:
1. Add imports:
```tsx
import { MessageCircle } from 'lucide-react';
import { useOpenMessageThread } from '../messages/useOpenMessageThread';
import { useHomeownerOfficeContact } from '../messages/useHomeownerOfficeContact';
import { useHomeownerOrgMessagingEnabled } from '../messages/useHomeownerOrgMessagingEnabled';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
```
2. Inside the component, add hooks + derived flags (near `canCancel`):
```tsx
  const { openOffice, openJob } = useOpenMessageThread();
  const { office } = useHomeownerOfficeContact();
  const messagingEnabled = useHomeownerOrgMessagingEnabled();
  const canMessageJob =
    !!appointment &&
    messagingEnabled &&
    !!appointment.cleaner_id &&
    isJobMessagingWindowOpen(
      {
        status: appointment.status,
        cleaner_confirmation_status: appointment.cleaner_confirmation_status ?? null,
        completed_at: appointment.completed_at ?? null,
        cancelled_at: appointment.cancelled_at ?? null,
      },
      new Date(),
    );
```
3. In the action area (after the cleaning details card, before/around the `canCancel` block), add the two buttons. "Message about this cleaning" renders only when `canMessageJob`; "Message office" always renders when an office contact exists:
```tsx
                  <div className="space-y-2">
                    {canMessageJob && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => openJob(appointment.id)}
                      >
                        <MessageCircle className="size-4" />
                        Message about this cleaning
                      </Button>
                    )}
                    {office && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => openOffice(office.id)}
                      >
                        <MessageCircle className="size-4" />
                        Message office
                      </Button>
                    )}
                  </div>
```
(Keep the existing `canCancel` block below; group spacing with the surrounding `space-y-5`.)

- [ ] **Step 2: Verify behavior**

Run: `npx tsc --noEmit`
Expected: no errors.
Manual (preview, John Doe in-progress appt): open the cleaning detail; "Message about this cleaning" + "Message office" appear; tapping each opens the takeover over the detail and Back returns to the detail. For a completed-past appt, "Message about this cleaning" is hidden (window closed) but the thread is still reachable from Messages > Past as read-only.

- [ ] **Step 3: Commit**
```bash
git add src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx
git commit -m "feat(homeowner): Message office + Message about this cleaning entry points"
```

---

## Task 9: Verification + conformance pass

- [ ] **Step 1: Full local gates**

Run: `npx tsc --noEmit` (no new errors), `npm run lint` (clean), `npm run test` (all green; if the integration suite flakes on parallel GoTrue auth, run the touched unit files in isolation: `npm run test -- src/components/redesign/homeowner/messages/deriveHomeownerInbox.test.ts`).

- [ ] **Step 2: ui-ux-pro-max implementation conformance**

Run the CLI against the built screens (full Python exe):
```bash
"C:/Users/mvbda/AppData/Local/Programs/Python/Python311/python.exe" "C:/Users/mvbda/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.5.0/src/ui-ux-pro-max/scripts/search.py" "messaging inbox touch target contrast read-only disabled empty state" --domain ux -n 12
```
Check the built inbox + thread against: touch targets >= 44px, unread paired with text (not color alone), read-only thread visually + semantically distinct (not "disabled"), empty states have guidance, safe-area + keyboard-aware composer.

- [ ] **Step 3: Off-system styling sweep (conformance gate)**

Grep the new components for leaks:
```bash
git diff --name-only master -- 'src/components/redesign/homeowner/messages/*' | xargs grep -nE '#[0-9a-fA-F]{3,6}|primary-[0-9]|—' || echo "clean"
```
Expected: `clean` (no raw hex, no `primary-*` legacy-yellow ramp, no em dashes). Any hit is a leak to fix.

- [ ] **Step 4: Visual verification on the Vercel preview (user is on mobile)**

Push the branch, wait for the preview, then drive it with Playwright MCP (homeowner role-guard + redesign flag) and capture screenshots of: the sectioned inbox (with an active job thread), an open job thread (composer, no image button), a read-only Past thread, the office thread, the cleaning-detail entry points, and the Messages-tab unread badge. Send the screenshots to the user.

- [ ] **Step 5: Codex pre-push review**

Per project workflow, run ONE Codex review right before push (user-triggered): `/codex:review --scope branch --base master --wait`. Apply valid fixes, then open the PR.

- [ ] **Step 6: Open the PR**

Branch `feat/homeowner-messages-slice3` → PR to `master`. PR body notes: consumes the job-messaging backend (PR #109); the dominant segregation (scope param) keeps job threads out of the cleaner/operator office inbox + badge; **interim sequencing gap:** a cleaner cannot yet read a homeowner's job message in-app until PR3 (they get the `job_message` notification); that is the next slice.

---

## Self-Review (completed)

- **Spec coverage:** Office thread (§Messages.1) → Tasks 6/7. Per-cleaning job threads active/archived (§Messages.2, §4.5) → Tasks 5/6/7. "Message office" / "Message about this cleaning" entry points (§Cleanings) → Task 8. Segregation (dominant risk, status doc) → Task 1. Kill-switch hides entry points (§2) → Tasks 6/8. Notification already exists (PR1). Read-only archived (§2) → Tasks 2/6.
- **Type consistency:** `scope` defaults `'office'` everywhere; `keys.conversations.byUser(userId, scope)` + `keys.messages.unreadCount(userId, scope)` updated and all callers compatible. `Appointment` window fields added in Task 4 are consumed by `isJobMessagingWindowOpen` in Tasks 5/6/8. `MessageThreadTakeoverView` new optional props are additive (cleaner unaffected). `SentJobMessage` matches the route's 201 shape.
- **Known interim gap (flagged in PR):** cleaner has no in-app job-thread surface until PR3; relies on the `job_message` notification in the meantime.
- **Placeholder scan:** none — novel logic has full code; presentational `HomeownerMessagesView` has a complete structural contract built from named design-system primitives.
