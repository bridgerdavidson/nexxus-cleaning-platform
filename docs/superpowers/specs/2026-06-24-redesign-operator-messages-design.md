# Operator Messages (redesign) — design spec

Date: 2026-06-24
Branch: `feat/redesign-operator-messages` (off `master` @ #87)
Status: design approved (desktop + mobile mockups + booking-attach model signed off via the brainstorming visual companion)

This is the **Messages** screen of the operator (admin + manager) redesign experience, the last operator screen before the Cleaner / Homeowner / Platform experiences. It follows the established redesign conventions (`(redesign)` route group, Container / pure View / pure derive(+test) split, anchored-left 1700px cap, reuse the headless hooks unchanged, flag-gated, legacy untouched). See `docs/redesign/2026-06-19-redesign-decisions.md` and the prior screens (Payments #86, Customers #81, Analytics #87) for the pattern this clones.

## 1. Goal and concept

Turn the basic two-pane messenger into an **operator communications cockpit**: the operator is never just chatting, they are chatting **about a job**. Two deliberate value-adds beyond the legacy:

1. **Booking ↔ message linkage (model A — "attach to messages").** A conversation is between two **people** (one inbox row per person, as today). A **booking attaches to an individual message** and renders as an inline card in the thread, anchored where it was sent. A thread can reference several jobs over its life. This rides on the existing `messages.appointment_id` column — **no schema change**.
2. **"About this person" context panel.** A toggleable third column (the "Details" drawer) showing who the contact is, their contact info, and their upcoming/recent bookings with quick actions, so the operator has the job context inline.

Everything reuses the existing headless data hooks. **No new API route. No DB migration.** The only backend touch is an additive optional `appointmentId` on `useSendMessage`.

## 2. Layout

Anchored-left content with the standard `max-w-[1700px]` cap (NOT mx-auto-centered), full available height. Header is **not** a KPI/stat row (Messages is a find-and-act surface, per the Customers rule): just an `h1` "Messages", a live-count subtitle (`12 conversations · 3 unread`), and a "New message" button.

Below the header, a single full-height bordered/rounded **console** card splits into up to three regions:

```
┌── Inbox (360px) ──┬──────── Thread (flex) ────────┬── About (320px, toggled) ──┐
│ search (hero)     │ header: avatar · name · Details │ identity + contact         │
│ All|Unread + role │ ─────────────────────────────── │ quick actions              │
│ conversation rows │ message bubbles + inline booking │ lifetime stats (gated $)   │
│                   │ cards + day dividers             │ Upcoming bookings          │
│                   │ ─────────────────────────────── │ Recent bookings            │
│                   │ composer (+ attach / + booking)  │                            │
└───────────────────┴─────────────────────────────────┴────────────────────────────┘
```

- **Default desktop** = two-pane (Inbox + Thread). The **Details** toggle in the thread header reveals the About column as a third pane (no awkward empty third column when nothing is selected; thread stays roomy by default).
- **Mobile** = inbox full-screen (shell bottom tabs visible, Messages active) → tapping a conversation pushes a **full-screen thread** (back arrow). **Details** (About panel) and **Reference a booking** open as **drag-dismissable bottom drawers** (the new `Drawer` primitive in §3, "New shared primitive"): the user can grab **anywhere on the sheet** and slide/fling it down to close, with a velocity threshold + snap-back, a visible grab handle, and tap-scrim-to-close as a fallback. "New message" is an icon button in the inbox header (no competing FAB — the shell owns the New-booking FAB).

## 3. Component architecture

All new components under `src/components/redesign/messages/`. Legacy `src/components/Message*.tsx` and `/admin-dashboard` are never edited.

### Container / View / derive split

- **`OperatorMessages.tsx`** (Container). Wires hooks, owns state + handlers, builds view models, passes props to the pure View. There is **no permission gate** (messaging has no `can_*` flag; the shell already restricts to admin/manager). It DOES read `useManagerPermissions()` + `currentOrgRole` only to compute `canViewPayments` (privileged `owner|admin` OR `can_view_payments`) for gating the lifetime-$ stat in the About panel.
  - Hooks: `useAuth()` (userId, role, orgId), `useConversations({ userId })`, `useMessages({ conversationId: selectedId, userId, onUnreadCountUpdate: updateUnreadCount })`, `useSendMessage()`, `useStartConversation()`, `useDeleteConversation()`, `useOrganizationMembers({ excludeCurrentUser: true })` (for New message), `useAdminAppointments()` (for the context panel + inline-card hydration; realtime already wired, so consuming it is free).
  - State: `search`, `unreadOnly`, `roleFilter`, `selectedConversationId` (URL `?c=`), `detailsOpen` (About toggle), `stagedAppointmentId` (composer attach), `pendingFiles` (composer attachments), plus dialog/sheet open flags.
  - URL contract (deep-links): `?c=<conversationId>` selects/persists the open thread (shareable); `?to=<userId>` opens/creates a thread with that user (the legacy `initialOtherParticipantId` behavior); `?to=<userId>&appointment=<id>` additionally pre-stages that booking in the composer. These let other surfaces deep-link "Message about this job" into Messages (wiring those buttons on booking surfaces is a noted follow-up, not in this PR).
- **`OperatorMessagesView.tsx`** (pure). Receives all view models + callbacks via a typed `OperatorMessagesViewProps`. No data hooks, no mutations, no business logic. Renders the console layout, skeletons, empty states, and the three regions. Used directly by the dev-preview route with mock data.

### Presentational pieces (pure, prop-driven)

- **`InboxList.tsx`** — the inbox column: search `Input` (hero, `sm:flex-1`), an **All / Unread** `SegmentedControl`, a role `Select` (All roles / Homeowners / Cleaners / Managers / Admins, options derived from `rolesUserCanMessage(role)`), and the scrollable list of `ConversationRow`. Header carries the live count.
- **`ConversationRow.tsx`** — avatar (`Avatar` + initials fallback), name, role chip, last-message preview (text, or `📷 Photo`/`📷 N photos` for image-only, prefixed `You: ` when sender is me; small booking glyph when the last message had an attached booking), time-ago, gold unread-count `Badge` (capped 9+, hidden when selected). Active/selected styling (brand-tinted, left rule). Row hover → delete via `ConfirmDialog` (replaces legacy `window.confirm`).
- **`MessageThreadPanel.tsx`** — thread header (`Avatar`, name, role, presence dot, **Details** toggle `Button`, overflow `DropdownMenu` with Delete conversation), the message scroller, and the composer. **Ports the legacy `MessageThread` scroll behaviors** (initial reveal gate, scroll-anchor restore on prepend, near-bottom auto-scroll, intersection-observer `loadMoreMessages` paging) using the refs/fns the hook already exposes (`messagesEndRef`, `hasMore`, `isLoadingMore`, `loadMoreMessages`). Empty state when no conversation selected; skeletons while loading.
- **`MessageBubble.tsx`** — one message: sender `Avatar`, content bubble (mine = brand bg / right; theirs = muted bg / left; `whitespace-pre-wrap break-words`), attachments grid (1 col for 1, 2 cols for 2+, click → lightbox), timestamp + read ticks on my messages (✓ sent / ✓✓ read from `is_read`). Renders an **`InlineBookingCard`** above/within the bubble when `message.appointment_id` is set.
- **`InlineBookingCard.tsx`** — the attached-booking card rendered in the thread ("You/<name> linked a booking"): service · date · time, address, cleaner, status badge (reusing the badge convention below), and **Open ›** → `useAppointmentPanel().openAppointment(id)` (deep-links the legacy `/admin-dashboard?appointment=<id>` drawer host; the panel is not mounted in the redesign tree, same approach Payments used). Hydrated by looking up `appointment_id` in `useAdminAppointments()` data; if not found (out-of-scope/old), a minimal fallback card that still deep-links by id.
- **`MessageComposer.tsx`** — `Textarea` (enter-to-send, shift+enter newline, auto-grow), a **+ menu** (`DropdownMenu`/`IconButton`) with "Add image" (image-only, ≤5 files, ≤10MB, preview thumbnails with remove) and "Reference a booking" (opens `ReferenceBookingMenu`), the **staged booking chip** above the input when one is attached (`📎 service · date ✕`), and Send. Send calls `sendMessage({ conversationId, senderId, recipientId, content, attachments: pendingFiles, appointmentId: stagedAppointmentId })`. The HEIC→compress→upload pipeline stays **inside `useSendMessage`** (unchanged); the composer only collects `File[]`.
- **`ReferenceBookingMenu.tsx`** — picker of the **contact's** bookings (`Popover` on desktop, drag-dismissable `Drawer` on mobile): searchable list from `deriveContactBookings`, each row = date · service · status; selecting sets `stagedAppointmentId`. Empty state "No bookings for this person" (e.g. a manager/admin contact).
- **`ContextPanel.tsx`** — the About column on desktop / mobile drag-dismissable `Drawer`: identity (`Avatar`, name, role `Badge`), contact rows (email, phone) with copy-to-clipboard (`toast` confirm), quick actions (**Profile** → the redesign Customers/Cleaners screen detail; **New booking** → existing new-booking flow), a stat strip (`N cleanings · $X lifetime · N properties`, the **$ gated by `canViewPayments`**), and **Upcoming** + **Recent** booking mini-rows (status badge + Open). Bookings come from `deriveContactBookings`.
- **`NewMessageDialog.tsx`** — start a conversation (`Dialog`): searchable list of `useOrganizationMembers` filtered by `rolesUserCanMessage(role)`; selecting calls `startConversation(member.id)` then selects the resulting thread. Empty/permission states.

### Pure logic (+ colocated Vitest)

- **`deriveMessages.ts` / `deriveMessages.test.ts`** — `deriveMessages(conversations, { search, unreadOnly, roleFilter })`: filter by name/email (case-insensitive), by `other_participant.role`, by `unread_count > 0`; keep `last_message_at DESC`; pure, immutable, generic `ConversationLike` input. Plus `unreadTotal(conversations)` for the subtitle.
- **`deriveContactBookings.ts` / `deriveContactBookings.test.ts`** — given the other participant + `AdminAppointment[]`, select that contact's bookings (homeowner contact → `homeowner_id === id`; cleaner contact → `cleaner_id === id`; manager/admin → none), split into **upcoming** (`scheduled_date >= today` and not cancelled, soonest first) and **recent** (past/completed, newest first), each capped; and a flat **all-bookings** list (newest first) for the attach picker. Pure.

### Types and presenters

- **`messages-types.ts`** — `ConversationRowVM`, `MessageVM` (incl. optional `booking?: InlineBookingVM`), `InlineBookingVM`, `ContactContextVM`, `ContactBookingVM`, `RoleFilter`, `MessagesViewProps`, etc.
- **`messages-presenters.tsx`** — `timeAgo`, `lastMessagePreview` (text/photo/mixed + `You:`), `bookingBadge` (reusing the Customers `HistoryStatusBadge` config: pending=caution/Clock, confirmed=secondary/CalendarCheck, in_progress=default/Loader2 spin, completed=positive/CheckCircle2, cancelled=critical/XCircle), `longDate`, `fmtTime`, `money2`. Shared by desktop + mobile so rendering stays in sync.

### New shared primitive: `Drawer` (vaul)

The current `src/components/ui/sheet.tsx` is built on Radix Dialog and has **no drag gesture** (it closes only on scrim-tap or the X). Mobile bottom sheets here need the native grab-and-slide feel, so add a new **`src/components/ui/drawer.tsx`** primitive built on **`vaul`** (the library behind shadcn's Drawer; React 19 + Next 16 compatible; small, and Radix-Dialog-based underneath so it composes with our portal/a11y patterns). Exports mirror shadcn: `Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose`, themed with our tokens (warm `popover` bg, `rounded-t-card`, `shadow-soft-lg`, a visible grab handle). Behavior: drag **anywhere on the sheet** to dismiss, velocity-based fling-to-close, snap-back when not pulled far enough, scrim tap-to-close fallback, body-scroll lock, focus trap, and correct scroll-vs-drag handling for scrollable content. Desktop side panels keep the existing Radix `Sheet`. **`vaul` is a new dependency** (the only one this PR adds). The primitive is reusable: adopting it for the other redesign screens' mobile detail sheets is a noted follow-up.

### Reused as-is

- Legacy **`MessageAttachmentsLightbox`** (`yet-another-react-lightbox`) imported directly for attachment viewing (behavior, not styling — avoids divergence).
- `useAppointmentPanel().openAppointment(id)` for "Open booking".
- All messaging + appointment hooks unchanged except the one additive change below.

## 4. The one backend change

`useSendMessage` (`src/hooks/useSendMessage.ts`): extend `SendMessageOptions` with optional `appointmentId?: string` and include it in the messages insert payload (`appointment_id: appointmentId ?? null`). Additive and backward compatible: the legacy `MessageInput` simply never passes it. `useMessages` already `select('*')`, so `appointment_id` is already returned for rendering. Messaging realtime (`messages`/`conversations`/`message_attachments`) is already `REPLICA IDENTITY FULL` + in the publication (baseline), so no migration.

## 5. Routing, shell, flag

- Route: **`src/app/(redesign)/app/admin-dashboard/messages/page.tsx`** — `"use client"` + Suspense + auth gate (mirrors the Payments page), mounts `OperatorShell active="messages"` + `<OperatorMessages/>`.
- **`src/components/redesign/shell/nav-items.ts`**: repoint the existing `messages` item `href` from `/admin-dashboard?tab=messages` to `/app/admin-dashboard/messages` (it is already `primary: true`). Active-nav is longest-href-match, so the route nests correctly.
- Dev preview: **`src/app/(dev)/messages-preview/page.tsx`** — mock `ConversationRowVM[]` / `MessageVM[]` / `ContactContextVM` rendered through `OperatorMessagesView` for no-login Playwright iteration (mirrors `payments-preview`).
- Gated by the existing `(redesign)` + `(dev)` layout guards (dev/preview or `NEXT_PUBLIC_REDESIGN_ENABLED`); legacy `/admin-dashboard?tab=messages` continues to serve prod until cutover.

## 6. Permissions and gotchas

- **No app-permission gate** for the screen; any operator may message (legacy parity). `rolesUserCanMessage` only constrains *which roles* appear in New message / who can be messaged.
- **Lifetime $ stat** in the About panel is the only payment-sensitive datum: gate on `canViewPayments = currentOrgRole === 'owner'|'admin' || permissions.can_view_payments`; hide the `$` figure (keep cleanings/properties counts) otherwise. Inline booking cards and the attach picker show service/date/status/address only (no price), so they need no payment gating.
- **Money is dollars**, not cents (`total_price` numeric) — but no price is shown on this screen except the gated lifetime stat (`money2`).
- **Column traps** (`src/types` reminders): `cleaner_id === cleaner_profiles.id === user_profiles.id`; `special_requests` not `special_instructions`; `duration_minutes` not `estimated_duration`.
- **CVA widening** TS noise on Button/Badge `variant` appears in every redesign file; `tsc` is `continue-on-error` in CI — ignore that pre-existing class when triaging.
- **No em dashes** in any user-facing strings (toasts, labels, empty states).
- `IconButton` forces `size="icon"` and requires `aria-label`; size via `className="h-9 w-9"`.
- Preserve the legacy realtime **channel names** by consuming the hooks unchanged (do not re-subscribe).

## 7. Testing

- Unit (Vitest, colocated): `deriveMessages.test.ts` (search/role/unread filters, sort, immutability, `unreadTotal`) and `deriveContactBookings.test.ts` (homeowner vs cleaner contact selection, upcoming/recent split + ordering + caps, attach-list ordering, empty for non-customer contacts).
- No new API route → no integration test. The additive `appointmentId` on `useSendMessage` is exercised by the screen + e2e; note it in the PR.
- Playwright: dev `/messages-preview` (desktop + mobile, both panes, Details toggle, attach picker, new-message dialog) + a live admin pass against dev Supabase (open a thread, attach a booking, send, verify inline card + About panel bookings render from real data).
- Local gates before push: `npm run test`, `npx tsc --noEmit` (ignore pre-existing CVA noise), `npm run lint`. Worktree needs its own `npm install` + a copied `.env.development.local`; run `next dev -p 3100` for the Playwright pass.

## 8. Build order (for the plan)

1. Hook change: `useSendMessage` optional `appointmentId`.
2. Add `vaul`; build the `Drawer` primitive (`ui/drawer.tsx`) and verify drag-dismiss in a quick preview/`/ui-kit` demo.
3. Types + presenters + the two pure derives (+ tests) — TDD.
4. Pure View pieces: `ConversationRow`, `InboxList`, `MessageBubble`, `InlineBookingCard`, `MessageComposer`, `ReferenceBookingMenu`, `ContextPanel`, `NewMessageDialog`, `MessageThreadPanel`, `OperatorMessagesView`.
5. Container `OperatorMessages` (wire hooks, URL params, handlers, view models).
6. Route page + dev preview + nav-items href repoint.
7. Playwright verify (preview + live) → Codex pre-push review → PR.

## 9. Explicitly out of scope (noted follow-ups)

- Wiring "Message about this job" buttons onto booking surfaces (Bookings drawer, Overview, cleaner jobs) that deep-link `?to=&appointment=` into Messages. The screen *accepts* the deep-link now; adding the buttons is a follow-up.
- Prefilling the customer in the "New booking" quick action (links to the existing flow for now).
- Migrating the other redesign screens' mobile detail sheets (Customers/Cleaners/Payments) from Radix `Sheet` to the new drag-dismissable `Drawer`. This PR introduces the primitive and uses it for Messages; rolling it out elsewhere is a follow-up.
- Cleaner/Homeowner messaging experiences (their own redesign phases).
- Typing indicators, reactions, message editing/deleting (not in legacy; not added).
