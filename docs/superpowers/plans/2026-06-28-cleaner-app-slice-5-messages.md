# Cleaner App Slice 5: Messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to implement task-by-task. Each task is independently committable. Steps use `- [ ]` checkboxes.

**Goal:** Replace the cleaner Messages placeholder with a phone-first office-messaging surface (collapsing inbox + thread), wire the active-job "Message office" button, and add an unread badge to the Messages nav tab — **reusing** the shipped operator messaging stack. **No new data layer, no migration, no API route.**

**Design spec:** `docs/superpowers/specs/2026-06-28-cleaner-app-slice-5-messages-design.md` (read §2 office model, §4 screens, §6 takeover extraction, §9 styling boundary).

**Architecture:** Mirror the cleaner redesign convention exactly — Container (`*.tsx`) → pure presentational View → pure React-free `derive*.ts` (+ co-located `*.test.ts`). Reuse the operator data hooks and leaf components verbatim; build cleaner-specific layout.

**Tech:** Next.js 16 App Router, React 19, TS, Tailwind v3, TanStack Query v5, Vitest.

## Global Constraints
- **Feature flag:** the whole `(redesign)` tree is `notFound()`-gated in `(redesign)/layout.tsx` via `redesignUiEnabled()`. The Messages screen does NOT re-check it.
- **No permission gate for cleaners.** Do NOT import/copy the operator `can_view_messages` gate (it locks cleaners out). The only guard is the existing `cleaner-dashboard/layout.tsx` "must be a cleaner" check. Server RLS enforces who a cleaner can message.
- **Cleaner-facing copy says "office," never "operator."** No em dashes (use period/comma/parentheses/"to").
- **Design system only:** build from `src/components/ui/*` + tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `brand-600`, `rounded-card`, `rounded-control`, soft shadows). No raw hex, no bespoke classes. Status via Badge/pill vocabulary. (Spec §9.)
- **Reuse leaf components verbatim:** `MessageBubble`, `MessageComposer`, `messages-format.ts` formatters, `messages-presenters` (`toConversationRowVM`, `toMessageVM`, `BookingBadge`), `messages-types.ts`, and the 4 hooks `useConversations`/`useMessages`/`useSendMessage`/`useStartConversation`, `useOrganizationMembers`.
- **`derive*.ts` + tests are React-free** (no `.tsx` imports). Formatting happens in Views.
- **Reused hook signatures (verbatim — do not guess):**
  - `useConversations({ userId, searchQuery?, roleFilter? }) → { data: ConversationWithDetails[], loading, error, isRefetching }`
  - `useMessages({ conversationId, userId, limit?, onUnreadCountUpdate? }) → { messages: MessageWithDetails[], loading, error, hasMore, isLoadingMore, loadMore, markMessagesAsRead, messagesEndRef }`
  - `useSendMessage() → { sendMessage(opts), isPending, error }`; `opts = { conversationId?, senderId, recipientId, content, attachments?, appointmentId? }`; **throws** if no `currentOrganizationId`.
  - `useStartConversation() → { startConversation(recipientId) → { success, conversationId?, conversation?, error? }, starting, error }`
  - `useOrganizationMembers({ excludeCurrentUser? }) → { data: OrganizationMember[], loading, error }`; member = `{ id, email, first_name, last_name, phone, role: UserRole, avatar_url, org_role }`
  - `toConversationRowVM(conv, currentUserId) → ConversationRowVM`; `toMessageVM(msg, currentUserId, prev, getBooking) → MessageVM`; `unreadTotal(rows)`.
- **Auth:** get `userId` from `useAuth()` (`user.id`); org context is loaded (layout waits on `orgStatus`).
- Path alias `@/*` → `./src/*`. Branch `feat/redesign-cleaner-app-slice5-messages` (already off `origin/master` @ `e79b596`). Gates: `npx tsc --noEmit`, `npm run test:unit`, `npm run lint`. Dev points at REMOTE dev Supabase; log in as `cleaner@nexxus.com` / `Cleaner123!`.

---

### Task 1: Shared `useKeyboardInset` + `MobileTakeover` (extract from the operator overlay)

**Files:**
- Create: `src/hooks/useKeyboardInset.ts`
- Create: `src/components/redesign/shared/MobileTakeover.tsx`
- Modify: `src/components/redesign/messages/OperatorMessagesView.tsx` (delete the inline `MobileThreadOverlay`, import the shared one with `desktopHidden`)

**Why:** `MobileThreadOverlay` (operator) and `CleanerJobDetailOverlay` (cleaner) are two copies of the same takeover. Hoist ONE primitive so the new cleaner thread is not copy #3. (Spec §6. `CleanerJobDetailOverlay` migration is deferred — leave it untouched this slice.)

- [ ] **Step 1: `useKeyboardInset`.** Extract the `visualViewport` logic verbatim into a hook that sets a `--kbd` CSS var on a ref'd element.

```ts
// src/hooks/useKeyboardInset.ts
"use client";
import { useEffect, type RefObject } from "react";

/**
 * Keeps a fixed/overlay surface's bottom lifted above the iOS on-screen keyboard.
 * The visual viewport shrinks when the keyboard opens but a fixed/dvh layout does
 * not, so we publish the keyboard height as `--kbd` on the target element; the
 * caller pads its bottom by `max(env(safe-area-inset-bottom), var(--kbd, 0px))`.
 * Mount-only (empty deps): re-binding per render is unnecessary and the effect is
 * idempotent. `enabled=false` is a no-op (e.g. takeovers with no text input).
 */
export function useKeyboardInset(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      ref.current?.style.setProperty("--kbd", `${kb}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 2: `MobileTakeover`.** Move the operator `MobileThreadOverlay` verbatim, generalize: export it; add `title?`/`ariaLabel?`/`desktopHidden?=false`/`keyboardAware?=true`; **adopt the `!e.defaultPrevented` Escape guard** (from the cleaner job overlay — strictly better when nesting drawers); use `useKeyboardInset` for the `--kbd` effect.

```tsx
// src/components/redesign/shared/MobileTakeover.tsx
"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";

/**
 * Full-screen slide-in surface that covers the whole shell (top bar, bottom nav)
 * so a thread/detail gets the entire screen, like a native app. Render-prop hands
 * children a `close()` that animates out then fires `onClosed`. Extracted from the
 * operator MobileThreadOverlay; the cleaner Messages thread and operator Messages
 * both consume it. (CleanerJobDetailOverlay still has its own copy — migrate later.)
 */
export function MobileTakeover({
  onClosed,
  children,
  ariaLabel,
  desktopHidden = false,
  keyboardAware = true,
}: {
  onClosed: () => void;
  children: (close: () => void) => ReactNode;
  ariaLabel?: string;
  desktopHidden?: boolean;
  keyboardAware?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const closingRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    window.setTimeout(onClosed, 300);
  }, [onClosed]);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Mount-only: lock scroll + focus (re-running .focus() per render collapses the
  // iOS keyboard). Escape closes only when nothing nested consumed it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useKeyboardInset(ref, keyboardAware);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), var(--kbd, 0px))" }}
      className={cn(
        "redesign-overlay fixed inset-0 z-50 flex flex-col bg-card outline-none",
        "pt-[env(safe-area-inset-top)]",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        desktopHidden && "lg:hidden",
        shown ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">{children(close)}</div>
    </div>
  );
}
```

- [ ] **Step 3: Migrate the operator overlay.** In `OperatorMessagesView.tsx`, delete the local `MobileThreadOverlay` function (lines ~10-101) and its now-unused imports; import `MobileTakeover`; replace the usage `<MobileThreadOverlay onClosed=...>` with `<MobileTakeover onClosed=... ariaLabel="Conversation" desktopHidden keyboardAware>`. Keep the render-prop body identical. **Behavior must be unchanged** (operator still hidden on `lg`).
- [ ] **Step 4: Gates.** `npx tsc --noEmit`; `npm run lint`; `npm run test:unit` (operator messages presenter tests still green). Manually confirm operator Messages mobile thread still slides in (visual, later in Task 10 it's covered by E2E).
- [ ] **Step 5: Commit.** `feat(messages): extract shared MobileTakeover + useKeyboardInset (operator adopts it)`

---

### Task 2: `office-contacts.ts` — office filter + primary resolution (pure, TDD)

**Files:** Create `src/components/redesign/cleaner/messages/office-contacts.ts` + `office-contacts.test.ts`

**Interfaces:**
- Consumes: `OrganizationMember` from `@/hooks/useOrganizationMembers`; `rolesUserCanMessage` from `@/lib/messagingPermissions`.
- Produces: `OfficeContact`, `filterOfficeContacts(members) → OfficeContact[]`, `resolvePrimaryOfficeContact(members) → OfficeContact | null`.

- [ ] **Step 1: Failing test.**

```ts
// office-contacts.test.ts
import { describe, it, expect } from "vitest";
import { filterOfficeContacts, resolvePrimaryOfficeContact } from "./office-contacts";
import type { OrganizationMember } from "@/hooks/useOrganizationMembers";

function m(over: Partial<OrganizationMember>): OrganizationMember {
  return { id: "u", email: "a@b.c", first_name: "A", last_name: "B", phone: null,
    role: "admin", avatar_url: null, org_role: "admin", ...over };
}

describe("filterOfficeContacts", () => {
  it("keeps only admin/manager (the office), drops cleaners/homeowners", () => {
    const out = filterOfficeContacts([
      m({ id: "1", role: "admin" }), m({ id: "2", role: "manager" }),
      m({ id: "3", role: "cleaner" }), m({ id: "4", role: "homeowner" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["1", "2"]);
  });
});

describe("resolvePrimaryOfficeContact", () => {
  it("prefers the org owner (org_role owner), then admin, then manager", () => {
    expect(resolvePrimaryOfficeContact([
      m({ id: "mgr", role: "manager", org_role: "manager" }),
      m({ id: "adm", role: "admin", org_role: "admin" }),
      m({ id: "own", role: "admin", org_role: "owner" }),
    ])?.id).toBe("own");
  });
  it("falls back to first admin when no owner", () => {
    expect(resolvePrimaryOfficeContact([
      m({ id: "mgr", role: "manager", org_role: "manager" }),
      m({ id: "adm", role: "admin", org_role: "admin" }),
    ])?.id).toBe("adm");
  });
  it("falls back to a manager when no admin", () => {
    expect(resolvePrimaryOfficeContact([m({ id: "mgr", role: "manager", org_role: "manager" })])?.id).toBe("mgr");
  });
  it("returns null when there is no office contact", () => {
    expect(resolvePrimaryOfficeContact([m({ id: "c", role: "cleaner", org_role: "cleaner" })])).toBeNull();
  });
});
```

- [ ] **Step 2: Implement.**

```ts
// office-contacts.ts  (React-free)
import type { OrganizationMember } from "@/hooks/useOrganizationMembers";
import { rolesUserCanMessage } from "@/lib/messagingPermissions";
import type { UserRole } from "@/types";

export interface OfficeContact {
  id: string;
  name: string;
  role: UserRole;
  orgRole: string;
  avatarUrl: string | null;
}

const OFFICE_ROLES = new Set(rolesUserCanMessage("cleaner")); // ['admin','manager']

function toOffice(m: OrganizationMember): OfficeContact {
  const name = [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.email || "Office";
  return { id: m.id, name, role: m.role as UserRole, orgRole: m.org_role, avatarUrl: m.avatar_url };
}

export function filterOfficeContacts(members: OrganizationMember[]): OfficeContact[] {
  return members.filter((m) => OFFICE_ROLES.has(m.role as UserRole)).map(toOffice);
}

/** Deterministic single "office" recipient: org owner -> first admin -> first manager. */
export function resolvePrimaryOfficeContact(members: OrganizationMember[]): OfficeContact | null {
  const office = filterOfficeContacts(members);
  return (
    office.find((o) => o.orgRole === "owner") ??
    office.find((o) => o.role === "admin") ??
    office.find((o) => o.role === "manager") ??
    null
  );
}
```

- [ ] **Step 3:** `npm run test:unit -- office-contacts` (PASS), `npx tsc --noEmit`.
- [ ] **Step 4: Commit.** `feat(cleaner-messages): office-contacts filter + primary resolution (pure, tested)`

---

### Task 3: `deriveOfficeInbox.ts` — mode + collapse + rows (pure, TDD)

**Files:** Create `src/components/redesign/cleaner/messages/deriveOfficeInbox.ts` + `deriveOfficeInbox.test.ts` + `messages-cleaner-types.ts`

**Interfaces:**
- Consumes: `ConversationWithDetails` (`@/types` via the hook), `toConversationRowVM`, `ConversationRowVM`, `OfficeContact`.
- Produces: `OfficeInboxModel`, `deriveOfficeInbox(input) → OfficeInboxModel`.

**Mode rule (keyed on reachable office people, NOT thread count):** `loading` → `'loading'`. Compute `people` = office contacts unioned with the participants of any existing conversations (so an orphaned former-admin thread is never stranded). `people.length === 0` → `'empty'` (`noOfficeContacts: true`, no action). `people.length === 1` → `'single'`: `singleContact` = that person, `singleConversationId` = the existing conversation id or `null` (fresh), title `"Office"`. `people.length >= 2` → `'inbox'`: search-filtered rows (sorted desc by `lastMessageAt`) PLUS `officeContacts` on the model for the compose picker, so a **specific** admin/manager is reachable even with zero prior threads.

- [ ] **Step 1: types.**

```ts
// messages-cleaner-types.ts
import type { ConversationRowVM } from "@/components/redesign/messages/messages-types";
import type { OfficeContact } from "./office-contacts";

export type OfficeInboxMode = "loading" | "empty" | "single" | "inbox";

export interface OfficeInboxModel {
  mode: OfficeInboxMode;
  /** inbox mode: search-filtered, sorted rows. */
  rows: ConversationRowVM[];
  /** single mode: the existing conversation id, or null when none exists yet. */
  singleConversationId: string | null;
  /** single mode: who the office thread is with (for header avatar/recipient). */
  singleContact: OfficeContact | null;
  /** single mode header title. */
  singleTitle: string;
  /** inbox mode: all office contacts (for the "New message" compose picker), so the
   *  cleaner can start a thread with a SPECIFIC admin/manager, not just the default. */
  officeContacts: OfficeContact[];
  /** true when there is no admin/manager to message at all. */
  noOfficeContacts: boolean;
}
```

- [ ] **Step 2: Failing test** (cover all four modes + the collapse boundary + search). Key cases:
  - `loading: true` → `mode 'loading'`.
  - no conversations + no office contacts → `'empty'`, `noOfficeContacts: true`.
  - no conversations + 1 office contact → `'single'`, `singleConversationId: null`, `singleContact` set, title `"Office"`.
  - 1 conversation (+ any contacts) → `'single'`, `singleConversationId` = that conv id.
  - 2 conversations → `'inbox'`, 2 rows sorted desc by `lastMessageAt`.
  - 1 conversation + 2 office contacts → `'inbox'` (so the cleaner can reach the other person).
  - search filters inbox rows by name (reuse `deriveMessages` semantics).

```ts
// deriveOfficeInbox.test.ts (sketch — fill bodies)
import { describe, it, expect } from "vitest";
import { deriveOfficeInbox } from "./deriveOfficeInbox";
import type { ConversationWithDetails } from "@/types";
// build minimal ConversationWithDetails fixtures (other_participant, last_message_at, unread_count, etc.)
// and OrganizationMember-derived OfficeContact[] fixtures; assert mode/rows/singleConversationId per the rule.
```

- [ ] **Step 3: Implement** `deriveOfficeInbox` using `toConversationRowVM` for rows, `office` count for the collapse decision, and the `deriveMessages` search filter (import `deriveMessages` with `unreadOnly:false, roleFilter:'all'`). React-free (note `deriveMessages.ts` and `messages-presenters` `toConversationRowVM` are React-free — `toMessageVM`/presenters that import `.tsx` are NOT used here; `toConversationRowVM` lives in `messages-presenters.tsx` so import it carefully — if importing the `.tsx` pulls React, copy the 20-line `toConversationRowVM` into a `.ts` helper instead to keep `deriveOfficeInbox` React-free). **Decision:** add a tiny `conversationRowVMs(convs, userId)` in `office-contacts.ts` (React-free) that inlines the mapping, OR verify `messages-presenters.tsx` is tree-shakeable/React-free at the function level; prefer the React-free helper to keep the unit test clean.
- [ ] **Step 4:** `npm run test:unit -- deriveOfficeInbox` (PASS), `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `feat(cleaner-messages): deriveOfficeInbox mode/collapse logic (pure, tested)`

---

### Task 4: `useUnreadMessageCount` — lightweight nav-badge source

**Files:** Create `src/hooks/useUnreadMessageCount.ts`

**Why:** the nav badge must not mount the full `useConversations` (4 realtime channels) on every cleaner page. A dedicated `count` query + one channel is enough.

- [ ] **Step 1: Implement.** A TanStack `useQuery` returning the number of unread messages addressed to the user, plus a realtime refetch.

```ts
// src/hooks/useUnreadMessageCount.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { keys } from "@/lib/queryKeys";
import { useSupabaseRealtimeSync } from "@/lib/useSupabaseRealtimeSync";

/** Total unread messages addressed to `userId` (recipient_id = me, is_read = false).
 * Drives the Messages bottom-nav badge. Separate from useConversations to avoid
 * mounting the full inbox (4 realtime channels) on every cleaner page. */
export function useUnreadMessageCount(userId: string | undefined) {
  const query = useQuery({
    queryKey: keys.messages.unreadCount(userId ?? "anon"),
    enabled: !!userId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .eq("is_read", false);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 15_000,
  });

  useSupabaseRealtimeSync({
    enabled: !!userId,
    channelName: `messages:recipient:${userId}`,
    table: "messages",
    filter: `recipient_id=eq.${userId}`,
    behavior: { type: "invalidate", keys: [keys.messages.unreadCount(userId ?? "anon")] },
  });

  return query.data ?? 0;
}
```

- [ ] **Step 2:** Add `keys.messages.unreadCount` to `src/lib/queryKeys.ts` (under the existing `messages` factory): `unreadCount: (userId: string) => [...keys.messages.all, "unread", userId] as const`. **Verify** the exact `useSupabaseRealtimeSync` option names against `src/lib/useSupabaseRealtimeSync.ts` and an existing caller (channelName/table/filter/behavior or event/schema) — adapt the call to the real signature. Confirm the `messages` channel shares/ dedupes with `useConversations`'s `messages:recipient:<id>` if names collide (they should dedupe).
- [ ] **Step 3:** `npx tsc --noEmit`; `npm run lint`.
- [ ] **Step 4: Commit.** `feat(cleaner-messages): useUnreadMessageCount nav-badge hook`

---

### Task 5: The thread — `CleanerThread` (Data) + `CleanerMessageThreadView` (presentational)

**Files:**
- Create: `src/components/redesign/cleaner/messages/CleanerMessageThreadView.tsx`
- Create: `src/components/redesign/cleaner/messages/CleanerThread.tsx`
- Create: `src/components/redesign/cleaner/messages/messages-cleaner-presenters.ts` (cleaner `CleanerAppointment → InlineBookingVM` mapper)
- Modify: `src/components/redesign/messages/MessageThreadPanel.tsx` + Create `src/components/redesign/messages/useThreadScroll.ts` (extract the scroll/paging effects; behavior-preserving) — **optional DRY step; if it risks operator regressions, inline the scroll logic in the View instead and skip the MessageThreadPanel edit.**

**Interfaces:**
- `CleanerMessageThreadView` props: `{ title, initials, avatarUrl, messages: MessageVM[], loading, hasMore, isLoadingMore, onLoadMore, messagesEndRef, onOpenBooking, composer: React.ComponentProps<typeof MessageComposer>, variant: 'inline'|'takeover', onBack?: () => void }`. Renders: trimmed header (back chevron only in `takeover`/when `onBack`; avatar + title; **no** Details/Delete/role-subtitle) + the scroll body (reuse `useThreadScroll` or inline) with `MessageBubble` loop + day dividers + skeleton/empty ("Start the conversation with your office.") + `<MessageComposer {...composer} />`.
- `CleanerThread` (Data) props: `{ conversationId: string | null, recipient: OfficeContact, variant, onBack?, armedAppointment?: CleanerAppointment | null, onArmedConsumed?: () => void }`. Wires `useMessages` (when `conversationId`), `useSendMessage`, draft/pendingFiles state, builds `MessageVM[]` via `toMessageVM` with a `getBooking` backed by `useCleanerAppointments` mapped through `cleanerApptToInlineBookingVM`, and the composer's `stagedBooking` from `armedAppointment` (mapped via `cleanerApptToContactBookingVM`). On send: call `sendMessage({ senderId: userId, recipientId: recipient.id, content: draft, attachments: pendingFiles, appointmentId: armedAppointment?.id, conversationId: conversationId ?? undefined })`; clear draft/files + `onArmedConsumed()`; surface `MESSAGING_FORBIDDEN_TEXT`/send error via toast. When `conversationId` is null (fresh single-office thread), the first send creates it (get_or_create in `useSendMessage`).

- [ ] **Step 1 (presenter).** `cleanerApptToInlineBookingVM(appt) → InlineBookingVM` and `cleanerApptToContactBookingVM(appt) → ContactBookingVM` using `CleanerAppointment` fields (`id`, `service_type?.name`, `scheduled_date`, `scheduled_time`, `propertyAddress`, status) and the `messages-format`/date helpers. React-free where possible (it's a `.ts`). Add a focused unit test for the mapper (status mapping + fallbacks).
- [ ] **Step 2 (View).** Build `CleanerMessageThreadView` from the design system. Reuse `MessageBubble`/`MessageComposer`. Header back button = `IconButton`/chevron with `aria-label="Back"`, shown when `onBack` provided. Apply `useKeyboardInset` is NOT needed here (the takeover/inline wrapper owns it); the View just lays out header/scroll/composer in a `flex h-full min-h-0 flex-col`. Presentational — verified by type-check + visual (matches `CleanerScheduleView` precedent), no render test.
- [ ] **Step 3 (Data).** Build `CleanerThread`. Use `useAuth().user.id`. Map messages with `toMessageVM(msg, userId, prev, getBooking)`. Compose `composer` props: `{ draft, onDraftChange, pendingFiles, onAddFiles, onRemoveFile, stagedBooking, attachableBookings: [], onStageBooking: noop, onClearStagedBooking: () => onArmedConsumed?.(), onSend, sending: isPending, isMobile: true }`. **If** `MessageComposer` shows a dead "reference a booking" affordance when `attachableBookings` is empty, gate it: add an optional `showReferenceBooking?: boolean` (default true) to `MessageComposer` and pass `false` here (behavior-preserving for the operator).
- [ ] **Step 4 (optional DRY).** Extract `useThreadScroll({ conversationKey, messages, messagesEndRef, hasMore, isLoadingMore, onLoadMore }) → { scrollRef, sentinelRef }` from `MessageThreadPanel` (the `useEffect`s at lines 49-95) and have both `MessageThreadPanel` and `CleanerMessageThreadView` consume it. Keep `MessageThreadPanel` behavior identical. If anything wobbles, skip and inline the ~30 lines in the View.
- [ ] **Step 5:** `npx tsc --noEmit`; `npm run test:unit` (mapper test green + operator tests green); `npm run lint`.
- [ ] **Step 6: Commit.** `feat(cleaner-messages): CleanerThread + thread view (reuses bubble/composer)`

---

### Task 6: `CleanerMessages` container + `CleanerMessagesView` (list/empty/single) + wire page

**Files:**
- Create: `src/components/redesign/cleaner/messages/CleanerMessagesView.tsx`
- Create: `src/components/redesign/cleaner/messages/CleanerConversationRow.tsx` (trimmed row: avatar + name + preview + time + unread; no role pill, no delete)
- Create: `src/components/redesign/cleaner/messages/CleanerOfficePicker.tsx` (the "New message" compose picker: lists office contacts; phone-first sheet/dialog)
- Create: `src/components/redesign/cleaner/messages/CleanerMessages.tsx`
- Modify: `src/app/(redesign)/app/cleaner-dashboard/messages/page.tsx`

**Interfaces:**
- `CleanerMessages` (Data): `useAuth` (userId), `useConversations({ userId, searchQuery })`, `useOrganizationMembers()` → `filterOfficeContacts`, local `search` state, `useOpenThread` (Task 7) to open a row. Computes `deriveOfficeInbox({ conversations, officeContacts, currentUserId, search, loading })`. Renders by mode:
  - `loading` → skeleton list.
  - `empty` → `EmptyState` ("No office contacts yet", no action) — the org has no admin/manager to message.
  - `single` → render `<CleanerThread variant="inline" conversationId={singleConversationId} recipient={singleContact!} />` inside a full-height wrapper (see Step 2) — no back button, no picker (one person).
  - `inbox` → `CleanerMessagesView` (search field + a **"New message"** compose button + `CleanerConversationRow` list + an empty-list prompt). Row tap → `openThread(row.id)`. Compose tap → open `CleanerOfficePicker` (lists `officeContacts`); picking a person → `startConversation(person.id)` then `openThread(conversationId)`. **This is the path to message a specific admin/manager**; the default-resolved shortcut never blocks it.
- `CleanerMessagesView` props: `{ rows, search, onSearch, onOpenRow }`.

- [ ] **Step 1 (row + view + picker).** Build `CleanerConversationRow` (model on `ConversationRow` minus the role pill + the `lg` hover-delete); `CleanerOfficePicker` (a phone-first sheet/dialog listing `officeContacts` as tappable rows — name + avatar + a subtle role hint like "Owner"/"Manager"; reuse the operator `NewMessageDialog` role-filter approach, restyled minimal); and `CleanerMessagesView` (a search `Input`, a **"New message"** compose button that opens the picker, the row list, and an empty-list prompt). Design-system styling.
- [ ] **Step 2 (single-mode layout).** The inline thread must fill the space between the sticky top bar and the fixed bottom nav and keep its composer above both the nav and the keyboard. Render the single-mode thread in a wrapper that breaks out of `<main>`'s padding: e.g. a `fixed inset-x-0 top-[var(--cleaner-topbar-h)] bottom-0` column constrained to `max-w-lg mx-auto`, OR a `flex h-[calc(100dvh-...)]` column with the composer pinned and `useKeyboardInset` applied to the wrapper. **Verify the exact top-bar/bottom-nav heights** against `CleanerTopBar`/`CleanerBottomNav` and reuse a token if present. The composer sits above the bottom nav; when focused, the keyboard covers the nav and `--kbd` lifts the composer. This is the one layout area to validate on the real device (Task 10) — keep the bottom nav tappable.
- [ ] **Step 3 (container).** Build `CleanerMessages`. Wire search (debounce optional; `useConversations` already does client search via `searchQuery`, but we pass `search` to `deriveOfficeInbox` for inbox filtering — pick ONE search path: prefer passing `searchQuery` into `useConversations` OR filtering in `deriveOfficeInbox`, not both; **decision:** filter in `deriveOfficeInbox` and leave `useConversations({ userId })` unsearched, so the single/inbox decision sees all conversations).
- [ ] **Step 4 (page).** Replace `messages/page.tsx` with `import { CleanerMessages } ...; export default () => <CleanerMessages />;`. Remove the "operator" copy.
- [ ] **Step 5:** `npx tsc --noEmit`; `npm run lint`; `npm run test:unit`.
- [ ] **Step 6: Commit.** `feat(cleaner-messages): collapsing office inbox + single-thread + page`

---

### Task 7: Thread takeover host (`?thread=`) + `useOpenThread` + layout wiring

**Files:**
- Create: `src/components/redesign/cleaner/messages/CleanerMessageThreadHost.tsx`
- Create: `src/hooks/useOpenThread.ts` (analog of `useOpenJob`)
- Modify: `src/app/(redesign)/app/cleaner-dashboard/layout.tsx` (mount the host as a Suspense sibling)

- [ ] **Step 1 (`useOpenThread`).** `(conversationIdOrOffice: string, appointmentId?: string) => void` → `router.replace('${pathname}?thread=...' + (appointmentId ? '&appointment=...' : ''), { scroll:false })`. (No `useSearchParams`, so no Suspense needed at the call site — matches `useOpenJob`.)
- [ ] **Step 2 (host).** `CleanerMessageThreadHost` reads `useDetailParam('thread')` + the `appointment` param (via `useSearchParams`). When `paramId` present:
  - Resolve the conversation + recipient: if `paramId === 'office'`, resolve `resolvePrimaryOfficeContact(useOrganizationMembers().data)`, then `useStartConversation().startConversation(primary.id)` (idempotent get_or_create) to get the `conversationId`; else `paramId` IS the conversationId and the recipient is the conversation's `other_participant` (find it in `useConversations` data, or derive recipient from the loaded conversation).
  - Render `<MobileTakeover onClosed={() => setParam(null)} ariaLabel="Office conversation">{(close) => <CleanerThread variant="takeover" conversationId={...} recipient={...} onBack={close} armedAppointment={armed} onArmedConsumed={clearAppointmentParam} />}</MobileTakeover>` keyed by `paramId`.
  - While resolving `office` → convId, render a takeover with a skeleton thread (don't flash empty).
- [ ] **Step 3 (layout).** In `cleaner-dashboard/layout.tsx`, add a second sibling under the existing job host: `<Suspense fallback={null}><CleanerMessageThreadHost /></Suspense>`.
- [ ] **Step 4:** `npx tsc --noEmit`; `npm run lint`.
- [ ] **Step 5: Commit.** `feat(cleaner-messages): ?thread= takeover host + useOpenThread + layout mount`

---

### Task 8: Unread badge on the Messages nav tab

**Files:**
- Modify: `src/components/redesign/cleaner/shell/CleanerBottomNav.tsx` (accept `messagesUnread?: number`, render the pill on the Messages tab)
- Modify: `src/components/redesign/cleaner/shell/CleanerShell.tsx` (mount `useUnreadMessageCount`, pass it down)

- [ ] **Step 1 (badge markup).** In `CleanerBottomNav`, add `messagesUnread?: number` to props; for the `messages` item when `> 0`, render a count pill mirroring `NotificationBell` (`absolute ... rounded-full bg-brand-600 text-[10px] font-bold text-white`), positioned top-right of the icon, `aria-label={`${n} unread messages`}`, capped `99+`. Keep the tab layout intact (pill is absolutely positioned).
- [ ] **Step 2 (shell).** In `CleanerShell`, `const { user } = useAuth(); const messagesUnread = useUnreadMessageCount(user?.id);` and pass `messagesUnread` to `<CleanerBottomNav activeId={activeId} messagesUnread={messagesUnread} />`. (Confirm `useAuth` is safe to call in the shell; the layout already gates on auth/org.)
- [ ] **Step 3:** `npx tsc --noEmit`; `npm run lint`. Verify the badge appears for a cleaner with unread office messages and clears after opening the thread (Task 10).
- [ ] **Step 4: Commit.** `feat(cleaner-messages): unread badge on the Messages nav tab`

---

### Task 9: Wire the active-job "Message office" button

**Files:**
- Modify: `src/components/redesign/cleaner/job/CleanerActiveJobView.tsx` (enable the button; call an `onMessageOffice` prop)
- Modify: `src/components/redesign/cleaner/job/CleanerActiveJob.tsx` (provide `onMessageOffice`: resolve primary office contact, navigate to the office thread with the job armed)

- [ ] **Step 1 (view).** Replace the disabled `Button` (lines ~149-159) with an enabled one: `<Button variant="outline" size="default" onClick={onMessageOffice} className="flex-1 gap-2"><MessageSquare className="size-4" aria-hidden /> Message office</Button>`. Add `onMessageOffice: () => void` to `CleanerActiveJobViewProps`. Keep "office" copy (already correct).
- [ ] **Step 2 (container).** In `CleanerActiveJob`, build `onMessageOffice`: use `useOpenThread()` (router-based, no Suspense) and navigate `openThread('office', appointment.id)` so the thread host resolves the primary office contact, opens the takeover over the Messages tab, and arms the appointment. Because the active job is itself a takeover, this **navigates to** `/app/cleaner-dashboard/messages?thread=office&appointment=<id>` (use `router.push`), which closes/leaves the job overlay cleanly (no nested takeovers). Confirm `CleanerActiveJob` has the appointment id in scope (it does, `appointmentId`).
- [ ] **Step 3:** `npx tsc --noEmit`; `npm run lint`. The thread opens with a "Re: <job>" staged chip (from `armedAppointment`) and the first sent message carries `appointment_id`.
- [ ] **Step 4: Commit.** `feat(cleaner-messages): wire active-job "Message office" to the armed office thread`

---

### Task 10: Visual verification + ui-ux-pro-max (implementation) + E2E + gates

**Files:** E2E spec `tests/e2e/cleaner-messages.spec.ts` (+ fix-ups).

- [ ] **Step 1: Dev server.** Run `npm run dev` (background). Log in as `cleaner@nexxus.com` / `Cleaner123!` (REMOTE dev Supabase).
- [ ] **Step 2: Playwright MCP screenshots at 375px** of: (a) single-office inline thread, (b) multi-office inbox list, (c) empty state, (d) no-office-contacts state, (e) thread takeover opened from an inbox row, (f) "Message office" from an active job (armed chip + send). Confirm: no "operator" copy, no em dashes, money/time `tabular-nums`, brand `#0150FC`, composer stays above the keyboard, bottom nav reachable in single mode, unread badge appears + clears.
- [ ] **Step 3: ui-ux-pro-max implementation pass.** Run the real Python 3.11 exe (`C:/Users/mvbda/AppData/Local/Programs/Python/Python311/python.exe`) on `.../2.5.0/src/ui-ux-pro-max/scripts/search.py` for `--domain ux "messaging keyboard safe-area touch-target"` and check the BUILT files for design-system conformance (raw hex, off-system shadows, touch targets ≥44px, token usage). Fix any leak; commit as a follow-up.
- [ ] **Step 4: E2E (Playwright).** Cover: open Messages → office thread; type + send (optimistic appears); unread badge appears for an inbound message and clears on open; "Message office" from a started job opens the armed thread. Include a reduced-motion run.
- [ ] **Step 5: Send Bridger the BUILT-screen screenshots** (he is on mobile) for sign-off on the single/inbox collapse boundary and the inline-thread layout.
- [ ] **Step 6: Full gates.** `npm run test`; `npx tsc --noEmit`; `npm run lint` — green (no new failures introduced). (Integration tests: none — messaging has no API routes.)
- [ ] **Step 7: Commit fix-ups.** `fix(cleaner-messages): design-system conformance + visual fixes`

---

## Ship (after implementation)
Per CLAUDE.md: finished feature on its own branch. Run the Codex review on the branch diff vs `master` (`node "<codex-plugin>/scripts/codex-companion.mjs" review --scope branch --base master`), apply valid findings in a follow-up commit, then a whole-branch review pass, then push `feat/redesign-cleaner-app-slice5-messages` and open a PR to `master`. No migration → no `migrate-*` jobs. Merge when the 4 checks are green. After merge: update `docs/superpowers/cleaner-app-status.md` (Slice 5 done, **next = Slice 6: Profile + employee placeholders + read-only Services**, and wire the real `organizations.default_payout_model` into Today) and the project memory.

## Risks / watch-items
- **Single-mode inline-thread layout** (composer above bottom nav + keyboard) is the only genuinely new layout; validate on the real device.
- **React-free `deriveOfficeInbox`:** keep it free of `.tsx` imports (use a local row mapper if `messages-presenters.tsx` pulls React).
- **`MobileTakeover` migration:** operator Messages must behave identically (still `lg:hidden`). `CleanerJobDetailOverlay` is intentionally NOT migrated this slice.
- **Unread channel naming:** confirm `useUnreadMessageCount`'s realtime call matches the real `useSupabaseRealtimeSync` signature and dedupes with `useConversations`.
- **`useSendMessage` throws without org** — the cleaner layout already waits on `orgStatus`, but guard the send UI for the not-yet-loaded case.
