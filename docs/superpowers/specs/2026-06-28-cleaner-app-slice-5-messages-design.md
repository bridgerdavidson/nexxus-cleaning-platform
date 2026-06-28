# Cleaner App Slice 5: Messages — Design

- **Date:** 2026-06-28
- **Status:** Design approved (office model + companion decisions locked); spec ready for plan.
- **Branch:** `feat/redesign-cleaner-app-slice5-messages` (off `origin/master` @ `#98` / `e79b596`)
- **Owner:** Bridger
- **Predecessor slices:** Shell+Today (#93/#94), Schedule+job-detail (#95), Active-job (#96), Earnings (#98). This is **Slice 5 of 6**.
- **Roadmap:** R3 (cleaner experience), the 5th of 6 flag-gated slices. Operator Messages shipped in #88/#89; this reuses that infrastructure phone-first.

## 1. Goal

Replace the cleaner **Messages** tab placeholder with a phone-first messaging surface where the field worker talks to **"the office"** (the org's admins/managers, never homeowners), reusing the shipped operator Messages chat stack and the cleaner app's full-screen takeover pattern. Also **wire the disabled "Message office" button** in the active-job flow (a deliberate Slice-5 placeholder) and add an **unread badge** to the Messages bottom-nav tab.

This is **Approach B** (UI rebuild on existing behavior): reuse the existing headless hooks, RPC, and RLS. **No new data layer, no migration, no API route.**

### Non-goals (deferred)
- A merged "virtual office thread" interleaving multiple admin/manager conversations (not supported by `useMessages`, which is single-conversation; would need new aggregation).
- A "primary office contact" data concept (resolved deterministically in the client instead, §4.3).
- Operator-only affordances: the "About this person" context panel, role filters, conversation deletion, the multi-role inbox.
- Counter-propose / scheduling inside chat; voice notes; typing indicators; presence.

## 2. The load-bearing constraint (why the office model matters)

The data model has **no "office" entity**. `conversations` rows are strictly **1:1** (`participant_1_id` / `participant_2_id`, normalized by uuid order in `get_or_create_conversation`, so each user-pair has exactly one thread). `messages` carry `sender_id` / `recipient_id` / `conversation_id` / `organization_id` and a nullable `appointment_id`. The role matrix (`src/lib/messagingPermissions.ts`, mirrored server-side in baseline `can_message_role`) allows **cleaner → admin/manager only**. So "the office" is realized as **N separate 1:1 threads**, one per admin/manager. RLS already restricts a cleaner to participant-only conversations, so a cleaner's inbox is *inherently* office-only.

**Decision (locked with Bridger): "Office inbox that collapses."**
- When there is effectively **one** office counterpart, the Messages tab IS that single **Office** thread (no list).
- When there are **several** office threads, the tab shows a small inbox list (one row per office person); tapping opens the thread.

## 3. Permissions (confirmed — do NOT copy the operator gate)

- The operator screen gates on `can_view_messages`. That is a **manager-only** grant on `manager_permissions` (keyed by `manager_id`); cleaners never have a row, so `useManagerPermissions()` returns `ALL_FALSE` and the operator gate `privileged || can_view_messages` would **lock every cleaner out**. **Do not reuse it.**
- The only gate for the cleaner Messages screen is the existing `cleaner-dashboard/layout.tsx` "must be a cleaner" role guard + the `(redesign)` flag. Messaging is **default-on** for cleaners.
- Who a cleaner may message is enforced server-side: `can_message_user` gates the `messages` INSERT and `get_or_create_conversation` (raises `42501` → surfaced as `MESSAGING_FORBIDDEN_TEXT`). `messages_select` RLS scopes a cleaner to sender/recipient/participant rows only (no org-wide read). The client mirrors this with `rolesUserCanMessage('cleaner') = ['admin','manager']`.

## 4. Screens & behavior

### 4.1 Messages tab — collapsing office inbox (`cleaner-dashboard/messages/page.tsx`)
Container `CleanerMessages` (Data) → `CleanerMessagesView` (presentational). The container:
- Loads `useConversations({ userId })` (already office-only by RLS) and `useOrganizationMembers()` filtered to office contacts via `rolesUserCanMessage('cleaner')`.
- Computes screen mode with a **pure `deriveOfficeInbox`** (§7), keyed on how many office people are reachable: `'loading' | 'empty' | 'single' | 'inbox'`.
  - **`single`** (exactly **one** office contact): render that Office thread **inline** as the tab content (titled "Office"), no list, no back chevron, no picker. The common small-operator case. (A brand-new thread with no messages shows the thread's own "say hi" empty state.)
  - **`inbox`** (**two or more** office people): a **list of existing conversation rows** (adapted row: avatar + name + last-message preview + time + unread dot; **no** role pill, **no** hover-delete) **plus a "New message" compose affordance** that opens an **office picker** listing every admin/manager (reusing the operator picker's `rolesUserCanMessage` filter) so the cleaner can start a thread with a **specific** person. Tapping a row, or picking a person, opens the thread takeover (§4.2). When there are no threads yet, the list area shows a short prompt ("Message someone at your office") with the same compose/picker.
  - **`empty`** (the org has **no** admin/manager at all): "No office contacts yet", no action.
- Search filters the inbox rows client-side (reuse `deriveMessages` search; the role-filter branch is unused).
- **Reaching a specific person is always possible** in `inbox` mode (via the picker or an existing row). The auto-resolved default office contact (§4.4: owner → admin → manager) is **only the one-tap "Message office" shortcut**, never a restriction on who the cleaner can choose.

### 4.2 The thread (shared `CleanerMessageThread`)
One thread component reused in both presentations (inline for `single`, inside the takeover for `inbox`):
- **Header (trimmed):** back chevron (only in takeover mode) + title (**"Office"** in single mode, else the office person's name) + avatar. **No** "Details" button (operator About panel) and **no** "Delete conversation" menu.
- **Body:** reuse `MessageThreadPanel`'s scroll area verbatim — `IntersectionObserver` paging, initial jump-to-bottom + near-bottom autoscroll, day dividers, skeleton/empty, `MessageBubble` loop (text, attachments + lightbox, read receipts, inline booking chip), `overscroll-contain`.
- **Composer:** reuse `MessageComposer` (textarea, image attach up to 5, Enter-to-send). For v1 the operator "reference a booking" menu is **omitted** (it lists a *contact's* bookings, which is empty for an office contact); the only booking link is the auto-staged job from the active-job entry point (§4.4).
- **Keyboard:** the composer is lifted above the iOS keyboard via the **extracted `useKeyboardInset`** hook (the operator `visualViewport` `--kbd` logic), used by both the inline thread and the takeover. Focus + body-scroll-lock effects stay **mount-only** (the focus-steal fix).
- `onOpenBooking` (tapping an inline booking chip) deep-links into the cleaner **job detail** (`?job=<id>` via `useDetailParam`), NOT the operator dashboard.

### 4.3 Thread takeover host (`inbox` mode) — mirror the job-detail pattern
- Deep-link param **`?thread=<conversationId>`** via `useDetailParam('thread')`.
- A `CleanerMessageThreadHost` mounted as a **layout sibling** of `CleanerShell` (inside `<Suspense>`, exactly like `CleanerJobDetailHost`), rendering the thread inside the **extracted shared `MobileTakeover`** (§6): `redesign-overlay fixed inset-0 z-50`, slide-in, body-scroll-lock, Escape (with the `!defaultPrevented` guard so nested drawers win), safe-area + `--kbd` padding. Closing clears the param → back to the inbox list, restoring scroll/state.

### 4.4 Active-job "Message office" wiring
`CleanerActiveJobView` lines ~149-159 hold a disabled "Message office" button with the full `appointment` in scope. Wire it to:
- Resolve the **primary office contact** with a pure `resolvePrimaryOfficeContact(members)` (precedence: org **owner** → first **admin** → first **manager**; "owner" = `user_profiles.role === 'admin'` who is the org `owner` by `organization_members.role`, falling back to any admin).
- Navigate to the Messages office thread with the job **armed**: `router.push('/app/cleaner-dashboard/messages?...')` such that the office thread opens and the next sent message carries `messages.appointment_id` (reuse `useSendMessage`'s existing `appointmentId`), shown as a small **"Re: <job>"** chip above the composer. This closes the job takeover (no nested takeovers).
- If no office contact exists, the button shows a disabled/empty affordance (rare; surfaced like the empty state).
- This button is the **one-tap shortcut** (it uses the resolved default). It does **not** restrict choice: from the Messages tab the cleaner can always open the office picker (§4.1 `inbox`) to message a **specific** admin/manager, and any existing thread is a tappable row.

### 4.5 Unread badge on the Messages nav tab
- Add an optional unread count to the bottom-nav Messages tab, rendered as the existing `NotificationBell`-style pill (`absolute rounded-full bg-brand-600` count). `CleanerNavItem` gains no required field; the shell passes a `messagesUnread` number into `CleanerBottomNav`.
- Source: a **dedicated lightweight `useUnreadMessageCount(userId)`** (count of `messages` where `recipient_id = me AND is_read = false`, one realtime channel `messages:recipient:<userId>` to refetch) — **not** the full `useConversations` (avoids mounting 4 realtime channels app-wide on every cleaner page). This is **conversation unread**, distinct from the notification bell's `notification_events` outbox (no double-counting).
- The badge clears as threads are opened (`useMessages.markMessagesAsRead` flips `is_read`; the realtime channel refetches the count). Per `tab-badge` (HIG/MD): badge indicates unread, clears on visit.

## 5. Architecture (mirror the cleaner convention exactly)
- **Route group + flag:** under `src/app/(redesign)/app/cleaner-dashboard/messages/`. Gating is the existing `(redesign)/layout.tsx` (`redesignUiEnabled()`); the screen does **not** re-check the flag.
- **Component tree** under `src/components/redesign/cleaner/messages/`:
  - `CleanerMessages.tsx` (Container: hooks, state, deep-link, VM building)
  - `CleanerMessagesView.tsx` (pure presentation: empty / single / inbox)
  - `CleanerMessageThread.tsx` (shared trimmed thread; header + `MessageThreadPanel` body + `MessageComposer`)
  - `CleanerMessageThreadHost.tsx` (`?thread=` host, layout sibling, wraps thread in `MobileTakeover`)
  - `CleanerOfficePicker.tsx` (the "New message" compose picker: lists office contacts to start a thread with a specific admin/manager; phone-first sheet/dialog, reuses the `rolesUserCanMessage` filter)
  - `deriveOfficeInbox.ts` + `deriveOfficeInbox.test.ts` (pure mode/rows/collapse logic)
  - `office-contacts.ts` + `office-contacts.test.ts` (`resolvePrimaryOfficeContact`, office filter)
  - `messages-cleaner-presenters.ts(x)` if a `CleanerAppointment → InlineBookingVM` mapper is needed for the armed-job chip.
- **Shared extraction** under `src/components/redesign/shared/`:
  - `MobileTakeover.tsx` (the hoisted `MobileThreadOverlay`, exported + generalized).
  - `useKeyboardInset.ts` (the `visualViewport` `--kbd` hook).
- **Hooks (reused as-is):** `useConversations`, `useMessages`, `useSendMessage`, `useStartConversation`, `useOrganizationMembers`. **New (small):** `useUnreadMessageCount`.
- **Data layer:** unchanged. No migration, no route.

## 6. Shared `MobileTakeover` extraction (one primitive, kill the duplicate)
`MobileThreadOverlay` currently lives un-exported inside `OperatorMessagesView.tsx` (lines 16-101); a near-duplicate is `CleanerJobDetailOverlay.tsx` (lines 41-90, minus keyboard handling). Extract one primitive:
- **API:** `{ onClosed: () => void; children: (close: () => void) => ReactNode; title?: string; ariaLabel?: string; keyboardAware?: boolean = true; desktopHidden?: boolean = false; }`.
- Preserve verbatim: the 300ms `translate-x` slide, **mount-only** body-scroll-lock + focus (focus-steal fix), Escape with `!defaultPrevented` guard, `pt-[env(safe-area-inset-top)]`, `paddingBottom: max(env(safe-area-inset-bottom), var(--kbd,0px))`, the `redesign-overlay` class.
- `desktopHidden` reproduces the operator's `lg:hidden`; the cleaner passes `false` (phone-first/always-on).
- **Migration scope:** operator `MobileThreadOverlay` adopts it (exact same behavior, low risk — operator Messages is the sibling feature) and the new cleaner thread uses it. `CleanerJobDetailOverlay` migration is **in scope if low-risk** (it is a literal fork; Slice-3 tests are the safety net) — otherwise leave a `TODO` and migrate in a follow-up to avoid bloating this slice's blast radius.

## 7. Pure logic (TDD)
- **`deriveOfficeInbox(input): OfficeInboxModel`** — given `{ conversations, officeContacts, currentUserId, search, loading }` returns `{ mode, rows, singleConversationId, singleContact, singleTitle, officeContacts }`. **Mode is keyed on the count of reachable office people** (office contacts unioned with existing-conversation participants, so an orphaned former-admin thread is never stranded): 0 → `empty`, 1 → `single`, ≥2 → `inbox`. The model carries `officeContacts` for the `inbox` compose picker. Row mapping via `toConversationRowVM`, search filter via `deriveMessages`. React-free.
- **`resolvePrimaryOfficeContact(members): OfficeContact | null`** — owner → admin → manager precedence; null when none. React-free.
- Reuse the already-tested `unreadTotal` and `toConversationRowVM` / `toMessageVM`.

## 8. Cross-cutting UX (ui-ux-pro-max verified)
- **Touch:** rows, composer, back button, send ≥ 44px; `touch-action: manipulation`; primary actions in the bottom third.
- **Nav:** `?thread=` deep-linkable; predictable back restores inbox scroll/state; unread `tab-badge` clears on visit; bottom nav stays ≤5 top-level tabs.
- **Feedback:** skeletons for inbox + thread loads > 300ms (already in `useConversations`/`MessageThreadPanel`); optimistic send (already in `useMessages`/`useSendMessage`); success is the message appearing; error surfaces `MESSAGING_FORBIDDEN_TEXT` / send-failure inline.
- **Empty states** for no-messages and no-office-contacts.
- **Safe areas + keyboard:** takeover + inline thread use `env(safe-area-inset-*)` and the `--kbd` lift; `min-h-dvh`/`inset-0`.
- **Motion:** 300ms slide, transform/opacity only, `prefers-reduced-motion` respected (carry the operator overlay's behavior).
- **Numbers:** `tabular-nums` for message timestamps.
- **A11y:** labeled icon buttons (back, send, attach), color-not-only for unread (dot/count, not hue alone), AA contrast both themes.

## 9. UI implementation & styling source (boundary — read before building)
There are **no browser-companion mockups** for this slice (Bridger chose to skip the companion; the structure is determined by the shipped operator thread + the cleaner takeover pattern). Every screen is implemented from the **design system**: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft pillowy shadows, the rounded scale). **Reuse the existing message primitives** (`MessageBubble`, `MessageComposer`, `MessageThreadPanel` body, the VM presenters/formatters) and the cleaner shell. Status/urgency use the **badge/pill vocabulary** (the unread pill), never decorative accents. Do **not** invent ad-hoc colors, raw hex, or bespoke classes. Any genuinely new pattern (the `MobileTakeover` primitive, `useKeyboardInset`) is built as a reusable, system-conformant module — not an inline one-off. Verify on the **built** screen (Playwright MCP screenshots to Bridger, who is on mobile), and run **ui-ux-pro-max at implementation** for design-system conformance.

## 10. Testing (create-tests skill)
- **Unit (`*.test.ts`, React-free):** `deriveOfficeInbox` (all four modes + collapse boundary + search), `resolvePrimaryOfficeContact` (precedence + empty). Presenter test if the `CleanerAppointment → InlineBookingVM` mapper is added.
- **No integration tests:** messaging has **no API routes** (client Supabase + RLS + RPC). `useUnreadMessageCount` is a client query; covered by the E2E flow.
- **E2E (Playwright, 375px):** open Messages → office thread; send a message (optimistic appears); unread badge appears/clears; "Message office" from an active job opens the armed thread. Reduced-motion + large Dynamic Type pass.
- **Visual:** Playwright MCP screenshots of single-thread, multi-inbox, empty, and the armed-from-job thread; ui-ux-pro-max conformance pass; send the **built** screens to Bridger.

## 11. Ship
Per CLAUDE.md: finished feature on its own branch. Local gates (`npm run test`, `npx tsc --noEmit`, `npm run lint`) green; Codex review on the branch diff vs `master`, apply valid findings as a follow-up commit; whole-branch review; push `feat/redesign-cleaner-app-slice5-messages`; PR to `master`; merge when the 4 checks are green. No migration → no `migrate-*` jobs. After merge: update `docs/superpowers/cleaner-app-status.md` (Slice 5 done, next = Slice 6 Profile/placeholders) and project memory.

## 12. Open questions / deferred
- Whether to migrate `CleanerJobDetailOverlay` onto `MobileTakeover` in this slice (low-risk refactor) or defer (§6).
- The armed-job composer chip: reuse the operator staged-booking chip UI vs a simpler "Re: <job>" pill (settle in the plan; lean simpler for v1).
- Multi-admin orgs: the `single`/`inbox` collapse boundary is the one UX call to confirm on the real screen with Bridger.
