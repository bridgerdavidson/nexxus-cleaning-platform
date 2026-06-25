# Operator Messages (redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the flag-gated operator (admin+manager) Messages screen for the redesign: a two-pane inbox+thread with a toggleable "About this person" context panel, booking-to-message linkage (a booking attaches to a message and renders inline), and drag-dismissable mobile bottom sheets.

**Architecture:** A `(redesign)` route renders `OperatorShell` + `OperatorMessages` (Container). The Container wires the existing messaging + appointment hooks, owns state/URL params, and builds view models that flow into a pure `OperatorMessagesView` composed of small presentational components. Pure logic (conversation filtering, contact-booking selection, formatters) lives in tested `derive*`/`*-format` modules. The only backend change is an additive optional `appointmentId` on `useSendMessage`. A new `vaul`-based `Drawer` primitive powers the mobile sheets.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript, Tailwind v3, TanStack Query v5 (via existing hooks), Radix primitives, `vaul` (new), Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-06-24-redesign-operator-messages-design.md`.

## Global Constraints

- **Branch/worktree:** all work on `feat/redesign-operator-messages` in the worktree `.claude/worktrees/redesign-messages` (already created off `master` @ #87). Never edit legacy `src/components/Message*.tsx` or `src/app/{admin,manager}-dashboard`.
- **No DB migration. No new API route.** Only backend change: additive optional `appointmentId` on `useSendMessage`.
- **Money is dollars** (not cents); the only money shown is the gated lifetime stat (`money2`).
- **No em dashes** in any user-facing string (labels, toasts, empty states). Use periods/commas/parentheses.
- **Reuse hooks unchanged** (except the one `useSendMessage` change): `useConversations`, `useMessages`, `useStartConversation`, `useDeleteConversation`, `useOrganizationMembers`, `useAdminAppointments`. Consuming them gives realtime for free; do not add subscriptions.
- **`IconButton`** forces `size="icon"` and requires `aria-label`; size it via `className="h-9 w-9"`.
- **`StatusPill`** only knows appointment statuses and is NOT used for message delivery; booking status uses `Badge` via the `bookingBadge` presenter (mirrors the Customers `HistoryStatusBadge`: pending=caution/Clock, confirmed=secondary/CalendarCheck, in_progress=default/Loader2 spin, completed=positive/CheckCircle2, cancelled=critical/XCircle).
- **Column traps:** `cleaner_id === cleaner_profiles.id === user_profiles.id`; `special_requests` not `special_instructions`; `duration_minutes` not `estimated_duration`.
- **CVA `variant` widening to `string`** produces pre-existing `tsc` errors in every redesign file; `tsc` is `continue-on-error` in CI. Ignore that class when triaging your own output; introduce no NEW type errors.
- **Content layout:** anchored-left, `max-w-[1700px]` (NOT mx-auto centered). The shell already provides `lg:pl-16` + `main` gutters.
- **Path alias** `@/*` -> `./src/*`.

---

## File Structure

New, under `src/components/redesign/messages/`:
- `messages-types.ts` — view-model + filter types (no runtime logic).
- `messages-format.ts` (+ `.test.ts`) — pure formatters: `timeAgo`, `lastMessagePreview`, `longDate`, `fmtTime`, `money2`, `initialsOf`, `dayLabel`.
- `messages-presenters.tsx` — JSX helpers (`BookingBadge`) + VM builders (`toConversationRowVM`, `toMessageVM`, `toInlineBookingVM`, `toContactContext`).
- `deriveMessages.ts` (+ `.test.ts`) — pure conversation filter/sort + `unreadTotal`.
- `deriveContactBookings.ts` (+ `.test.ts`) — pure split of a contact's appointments into upcoming/recent/all.
- `ConversationRow.tsx`, `InboxList.tsx` — inbox column.
- `MessageBubble.tsx`, `InlineBookingCard.tsx` — thread message rendering.
- `MessageComposer.tsx`, `ReferenceBookingMenu.tsx` — composer + booking attach.
- `MessageThreadPanel.tsx` — thread header + scroller + composer wiring (ports legacy scroll behavior).
- `ContextPanel.tsx` — About panel (desktop column / mobile Drawer).
- `NewMessageDialog.tsx` — start a conversation.
- `OperatorMessagesView.tsx` — pure three-pane responsive composition.
- `OperatorMessages.tsx` — Container (hooks, URL params, handlers, VM build).

New shared primitive:
- `src/components/ui/drawer.tsx` — `vaul`-based drawer.

Modified:
- `src/hooks/useSendMessage.ts` — optional `appointmentId`.
- `src/components/redesign/shell/nav-items.ts` — repoint Messages href.
- `package.json` — add `vaul`.

New routes:
- `src/app/(redesign)/app/admin-dashboard/messages/page.tsx`
- `src/app/(dev)/messages-preview/page.tsx`

---

## Task 0: Worktree setup

**Files:** none (environment only).

- [ ] **Step 1: Install deps in the worktree**

The worktree does not share `node_modules`. Run:
```bash
cd .claude/worktrees/redesign-messages
npm install
```
Expected: completes; `node_modules/` present.

- [ ] **Step 2: Copy the dev env so `next dev` / Playwright can run later**

```bash
cp ../../../.env.development.local .env.development.local 2>/dev/null || echo "copy .env.development.local from the main tree manually"
```
Expected: `.env.development.local` exists in the worktree (gitignored).

- [ ] **Step 3: Sanity-check the test runner**

```bash
npx vitest run src/components/redesign/payments/derivePayments.test.ts
```
Expected: PASS (proves vitest + alias resolve in the worktree). No commit.

---

## Task 1: Add optional `appointmentId` to `useSendMessage`

**Files:**
- Modify: `src/hooks/useSendMessage.ts`

**Interfaces:**
- Produces: `sendMessage(opts: { conversationId?; senderId; recipientId; content; attachments?; appointmentId?: string })` — sets `messages.appointment_id` on insert.

- [ ] **Step 1: Extend the options type**

Find the `SendMessageOptions` interface and add the field:
```ts
interface SendMessageOptions {
  conversationId?: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachments?: File[];
  appointmentId?: string; // NEW: link this message to a booking (messages.appointment_id)
}
```

- [ ] **Step 2: Destructure it and include it in the insert payload**

In the mutation body, destructure `appointmentId` from the opts and add it to the messages insert object (the object already containing `id, organization_id, conversation_id, sender_id, recipient_id, content, is_read`):
```ts
const { conversationId, senderId, recipientId, content, attachments = [], appointmentId } = opts;
// ...
const insertPayload = {
  id: messageId,
  organization_id: currentOrganizationId,
  conversation_id: finalConversationId,
  sender_id: senderId,
  recipient_id: recipientId,
  content,
  is_read: false,
  appointment_id: appointmentId ?? null, // NEW
};
```
(If the optimistic-cache patch builds a `MessageWithDetails`, also set `appointment_id: appointmentId ?? null` on that object so the inline card shows immediately without waiting for realtime.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep useSendMessage || echo "no new errors in useSendMessage"
```
Expected: no NEW errors referencing `useSendMessage.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSendMessage.ts
git commit -m "feat(messages): optional appointmentId on useSendMessage"
```

---

## Task 2: Add `vaul` and the `Drawer` primitive

**Files:**
- Modify: `package.json` (add `vaul`)
- Create: `src/components/ui/drawer.tsx`

**Interfaces:**
- Produces: `Drawer, DrawerTrigger, DrawerPortal, DrawerClose, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription` — a bottom drawer with drag-anywhere-to-dismiss, velocity fling, snap-back, visible grab handle, scrim fallback.

- [ ] **Step 1: Install vaul**

```bash
npm install vaul@^1.1.2
```
Expected: `vaul` in `package.json` dependencies; installs cleanly under React 19.

- [ ] **Step 2: Create the Drawer primitive**

`src/components/ui/drawer.tsx`:
```tsx
'use client'

// src/components/ui/drawer.tsx
// Bottom drawer built on vaul: drag anywhere to dismiss, velocity fling-to-close,
// snap-back, visible grab handle, scrim fallback. Desktop side panels keep ui/sheet.tsx.
import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'

const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
)
Drawer.displayName = 'Drawer'

const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm', className)}
    {...props}
  />
))
DrawerOverlay.displayName = 'DrawerOverlay'

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        // redesign-overlay re-scopes the .redesign font/token vars onto portaled content
        'redesign-overlay',
        'fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto max-h-[92dvh] flex-col',
        'rounded-t-card border-t border-border bg-popover text-popover-foreground shadow-soft-lg',
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
      />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 px-5 pt-4 pb-3 text-left', className)} {...props} />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-auto flex flex-col gap-2 px-5 pb-6 pt-3', className)} {...props} />
)
DrawerFooter.displayName = 'DrawerFooter'

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn('text-base font-bold text-popover-foreground', className)}
    {...props}
  />
))
DrawerTitle.displayName = 'DrawerTitle'

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DrawerDescription.displayName = 'DrawerDescription'

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerClose,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "ui/drawer" || echo "no errors in drawer.tsx"
```
Expected: no errors in `drawer.tsx` (ignore unrelated pre-existing output).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/ui/drawer.tsx
git commit -m "feat(ui): add vaul-based Drawer primitive (drag-to-dismiss bottom sheet)"
```

(Drag behavior is verified live in Task 14/15 once the Drawer hosts the ContextPanel; vaul makes `DrawerContent` draggable from anywhere by default.)

---

## Task 3: View-model types

**Files:**
- Create: `src/components/redesign/messages/messages-types.ts`

**Interfaces:**
- Produces: `RoleFilter`, `BookingStatus`, `ConversationRowVM`, `InlineBookingVM`, `MessageVM`, `ContactBookingVM`, `ContactContextVM`, and the `OperatorMessagesViewProps` interface.

- [ ] **Step 1: Write the types**

`messages-types.ts`:
```ts
import type { UserRole } from '@/types'

export type RoleFilter = 'all' | UserRole
export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'

export interface ConversationRowVM {
  id: string                 // conversation id
  participantId: string      // other_participant.id
  name: string
  email: string              // for search (lowercased match handled in derive)
  role: UserRole
  initials: string
  avatarUrl: string | null
  preview: string            // already formatted ("You: ...", "Photo", etc.)
  timeLabel: string          // time-ago label
  unreadCount: number
  hasBooking: boolean        // last message carried an appointment_id
  lastMessageAt: string      // ISO, for sort
}

export interface InlineBookingVM {
  appointmentId: string
  found: boolean             // false => minimal fallback card (appointment not in loaded set)
  service: string
  dateLabel: string          // "Fri Jun 27"
  timeLabel: string          // "2:00 PM"
  address: string | null
  cleanerName: string | null
  status: BookingStatus
}

export interface MessageAttachmentVM {
  id: string
  url: string
}

export interface MessageVM {
  id: string
  senderId: string
  isMine: boolean
  content: string
  timeLabel: string
  isRead: boolean
  attachments: MessageAttachmentVM[]
  booking: InlineBookingVM | null
  createdAt: string          // ISO
  dayLabel: string           // "Today" / "Jun 27"
  showDayDivider: boolean    // true on the first message of a day
}

export interface ContactBookingVM {
  appointmentId: string
  service: string
  dateLabel: string          // "Jun 27"
  timeLabel: string          // "2:00 PM"
  address: string | null
  status: BookingStatus
  dayNum: string             // "27" for the date pill
  monthLabel: string         // "Jun"
}

export interface ContactContextVM {
  id: string
  name: string
  role: UserRole
  initials: string
  avatarUrl: string | null
  email: string | null
  phone: string | null
  cleaningsCount: number
  lifetimeLabel: string | null   // money2 string, or null when !canViewPayments
  propertiesCount: number | null // null when not derivable/not homeowner
  upcoming: ContactBookingVM[]
  recent: ContactBookingVM[]
}

export interface OperatorMessagesViewProps {
  // inbox
  rows: ConversationRowVM[]
  totalConversations: number
  unreadTotal: number
  search: string
  onSearchChange: (v: string) => void
  unreadOnly: boolean
  onUnreadOnlyChange: (v: boolean) => void
  roleFilter: RoleFilter
  roleOptions: { value: RoleFilter; label: string }[]
  onRoleFilterChange: (v: RoleFilter) => void
  selectedId: string | null
  onSelect: (conversationId: string) => void
  onRequestDelete: (conversationId: string) => void
  onNewMessage: () => void
  inboxLoading: boolean
  // thread
  threadTitle: string
  threadRole: UserRole | null
  threadInitials: string
  threadAvatarUrl: string | null
  messages: MessageVM[]
  threadLoading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  messagesEndRef: React.RefObject<HTMLDivElement>
  onOpenBooking: (appointmentId: string) => void
  // composer
  draft: string
  onDraftChange: (v: string) => void
  pendingFiles: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  stagedBooking: ContactBookingVM | null
  onStageBooking: (appointmentId: string) => void
  onClearStagedBooking: () => void
  attachableBookings: ContactBookingVM[]
  onSend: () => void
  sending: boolean
  // about panel
  detailsOpen: boolean
  onToggleDetails: () => void
  context: ContactContextVM | null
  onViewProfile: () => void
  onNewBooking: () => void
  onCopy: (text: string, label: string) => void
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "messages-types" || echo "ok"
git add src/components/redesign/messages/messages-types.ts
git commit -m "feat(messages): view-model types"
```

---

## Task 4: Pure formatters (`messages-format.ts`)

**Files:**
- Create: `src/components/redesign/messages/messages-format.ts`
- Test: `src/components/redesign/messages/messages-format.test.ts`

**Interfaces:**
- Produces: `timeAgo(iso, now?)`, `lastMessagePreview({ content, attachmentCount, isMine })`, `longDate(iso)`, `fmtTime(timeOrIso)`, `money2(n)`, `initialsOf(first, last)`, `dayLabel(iso, now?)`.

- [ ] **Step 1: Write the failing test**

`messages-format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  timeAgo, lastMessagePreview, money2, initialsOf, dayLabel,
} from './messages-format'

const NOW = new Date('2026-06-24T18:00:00Z').toISOString()

describe('timeAgo', () => {
  it('shows "now" under a minute', () => {
    expect(timeAgo('2026-06-24T17:59:40Z', NOW)).toBe('now')
  })
  it('shows minutes', () => {
    expect(timeAgo('2026-06-24T17:42:00Z', NOW)).toBe('18m')
  })
  it('shows hours', () => {
    expect(timeAgo('2026-06-24T15:00:00Z', NOW)).toBe('3h')
  })
})

describe('lastMessagePreview', () => {
  it('prefixes "You: " for my messages', () => {
    expect(lastMessagePreview({ content: 'hi', attachmentCount: 0, isMine: true })).toBe('You: hi')
  })
  it('renders a single photo', () => {
    expect(lastMessagePreview({ content: '', attachmentCount: 1, isMine: false })).toBe('Photo')
  })
  it('renders multiple photos with count', () => {
    expect(lastMessagePreview({ content: '', attachmentCount: 3, isMine: false })).toBe('3 photos')
  })
  it('prefers text over photo label when both present', () => {
    expect(lastMessagePreview({ content: 'see this', attachmentCount: 2, isMine: false })).toBe('see this')
  })
})

describe('money2', () => {
  it('formats dollars with two decimals and thousands', () => {
    expect(money2(1680)).toBe('$1,680.00')
  })
})

describe('initialsOf', () => {
  it('takes first letters', () => {
    expect(initialsOf('Jordan', 'Avery')).toBe('JA')
  })
  it('falls back to a dot when empty', () => {
    expect(initialsOf(null, null)).toBe('?')
  })
})

describe('dayLabel', () => {
  it('labels same day as Today', () => {
    expect(dayLabel('2026-06-24T09:00:00Z', NOW)).toBe('Today')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/components/redesign/messages/messages-format.test.ts
```
Expected: FAIL (module not found / exports undefined).

- [ ] **Step 3: Implement the formatters**

`messages-format.ts`:
```ts
// Pure formatters for the Messages screen. No React, no I/O. Mirrors money/date
// helpers used by other redesign screens but kept local to avoid cross-feature imports.

function nowMs(now?: string): number {
  return now ? new Date(now).getTime() : Date.now()
}

export function timeAgo(iso: string, now?: string): string {
  const diffMs = nowMs(now) - new Date(iso).getTime()
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 60) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function lastMessagePreview(opts: {
  content: string
  attachmentCount: number
  isMine: boolean
}): string {
  const text = opts.content?.trim()
  let body: string
  if (text) {
    body = text
  } else if (opts.attachmentCount === 1) {
    body = 'Photo'
  } else if (opts.attachmentCount > 1) {
    body = `${opts.attachmentCount} photos`
  } else {
    body = ''
  }
  return opts.isMine && body ? `You: ${body}` : body
}

export function longDate(iso: string): string {
  // iso may be a YYYY-MM-DD date string; treat as local calendar date
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtTime(value: string): string {
  // value may be "HH:MM" (scheduled_time) or a full ISO string
  const d = /^\d{1,2}:\d{2}/.test(value) ? new Date(`2000-01-01T${value}`) : new Date(value)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function money2(n: number): string {
  return `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function initialsOf(first: string | null | undefined, last: string | null | undefined): string {
  const a = (first || '').trim()
  const b = (last || '').trim()
  const out = `${a.charAt(0)}${b.charAt(0)}`.toUpperCase()
  return out || '?'
}

export function dayLabel(iso: string, now?: string): string {
  const d = new Date(iso)
  const ref = new Date(nowMs(now))
  const sameDay =
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  if (sameDay) return 'Today'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/redesign/messages/messages-format.test.ts
```
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/messages/messages-format.ts src/components/redesign/messages/messages-format.test.ts
git commit -m "feat(messages): pure formatters with tests"
```

---

## Task 5: `deriveMessages` (inbox filter/sort)

**Files:**
- Create: `src/components/redesign/messages/deriveMessages.ts`
- Test: `src/components/redesign/messages/deriveMessages.test.ts`

**Interfaces:**
- Consumes: `ConversationRowVM`, `RoleFilter` (Task 3).
- Produces: `deriveMessages(rows, { search, unreadOnly, roleFilter }): ConversationRowVM[]` (filtered, sorted by `lastMessageAt` desc, non-mutating) and `unreadTotal(rows): number`.

- [ ] **Step 1: Write the failing test**

`deriveMessages.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deriveMessages, unreadTotal } from './deriveMessages'
import type { ConversationRowVM } from './messages-types'

function row(o: Partial<ConversationRowVM>): ConversationRowVM {
  return {
    id: o.id ?? 'c1',
    participantId: o.participantId ?? 'u1',
    name: o.name ?? 'Jordan Avery',
    email: o.email ?? 'jordan@example.com',
    role: o.role ?? 'homeowner',
    initials: 'JA',
    avatarUrl: null,
    preview: o.preview ?? 'hi',
    timeLabel: '2m',
    unreadCount: o.unreadCount ?? 0,
    hasBooking: false,
    lastMessageAt: o.lastMessageAt ?? '2026-06-24T10:00:00Z',
  }
}

describe('deriveMessages', () => {
  const rows = [
    row({ id: 'a', name: 'Jordan Avery', role: 'homeowner', unreadCount: 2, lastMessageAt: '2026-06-24T10:00:00Z' }),
    row({ id: 'b', name: 'Wanda Jacobs', email: 'wanda@clean.co', role: 'cleaner', unreadCount: 0, lastMessageAt: '2026-06-24T12:00:00Z' }),
    row({ id: 'c', name: 'Marcus Lee', role: 'manager', unreadCount: 1, lastMessageAt: '2026-06-24T08:00:00Z' }),
  ]

  it('sorts by lastMessageAt desc', () => {
    expect(deriveMessages(rows, { search: '', unreadOnly: false, roleFilter: 'all' }).map(r => r.id)).toEqual(['b', 'a', 'c'])
  })
  it('filters by name (case-insensitive)', () => {
    expect(deriveMessages(rows, { search: 'wanda', unreadOnly: false, roleFilter: 'all' }).map(r => r.id)).toEqual(['b'])
  })
  it('filters by email', () => {
    expect(deriveMessages(rows, { search: 'clean.co', unreadOnly: false, roleFilter: 'all' }).map(r => r.id)).toEqual(['b'])
  })
  it('filters by role', () => {
    expect(deriveMessages(rows, { search: '', unreadOnly: false, roleFilter: 'cleaner' }).map(r => r.id)).toEqual(['b'])
  })
  it('filters unread only', () => {
    expect(deriveMessages(rows, { search: '', unreadOnly: true, roleFilter: 'all' }).map(r => r.id)).toEqual(['a', 'c'])
  })
  it('does not mutate input', () => {
    const copy = [...rows]
    deriveMessages(rows, { search: '', unreadOnly: false, roleFilter: 'all' })
    expect(rows).toEqual(copy)
  })
})

describe('unreadTotal', () => {
  it('sums unread counts', () => {
    expect(unreadTotal([row({ unreadCount: 2 }), row({ unreadCount: 1 }), row({ unreadCount: 0 })])).toBe(3)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/components/redesign/messages/deriveMessages.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`deriveMessages.ts`:
```ts
import type { ConversationRowVM, RoleFilter } from './messages-types'

export interface DeriveMessagesOpts {
  search: string
  unreadOnly: boolean
  roleFilter: RoleFilter
}

export function deriveMessages(rows: ConversationRowVM[], opts: DeriveMessagesOpts): ConversationRowVM[] {
  const q = opts.search.trim().toLowerCase()
  return rows
    .filter((r) => {
      if (opts.unreadOnly && r.unreadCount <= 0) return false
      if (opts.roleFilter !== 'all' && r.role !== opts.roleFilter) return false
      if (q) {
        const hay = `${r.name} ${r.email}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    .slice()
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
}

export function unreadTotal(rows: ConversationRowVM[]): number {
  return rows.reduce((sum, r) => sum + (r.unreadCount > 0 ? r.unreadCount : 0), 0)
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/components/redesign/messages/deriveMessages.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/messages/deriveMessages.ts src/components/redesign/messages/deriveMessages.test.ts
git commit -m "feat(messages): deriveMessages inbox filter/sort with tests"
```

---

## Task 6: `deriveContactBookings`

**Files:**
- Create: `src/components/redesign/messages/deriveContactBookings.ts`
- Test: `src/components/redesign/messages/deriveContactBookings.test.ts`

**Interfaces:**
- Consumes: `ContactBookingVM`, `BookingStatus` (Task 3); `AdminAppointment` from `@/hooks/useAdminData`.
- Produces: `deriveContactBookings(contact: { id; role }, appts: AppointmentLike[], opts: { today: string; maxUpcoming?; maxRecent? }): { upcoming; recent; all }` (each `ContactBookingVM[]`). Uses a local `AppointmentLike` structural type so it stays decoupled and testable.

- [ ] **Step 1: Write the failing test**

`deriveContactBookings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deriveContactBookings, type AppointmentLike } from './deriveContactBookings'

function appt(o: Partial<AppointmentLike>): AppointmentLike {
  return {
    id: o.id ?? 'a1',
    homeowner_id: o.homeowner_id,
    cleaner_id: o.cleaner_id,
    scheduled_date: o.scheduled_date ?? '2026-06-27',
    scheduled_time: o.scheduled_time ?? '14:00',
    status: o.status ?? 'confirmed',
    total_price: o.total_price ?? 120,
    service_type: o.service_type ?? { name: 'Deep Clean' },
    checklist: o.checklist ?? null,
    property: o.property ?? { name: null, address: '123 Oak St', city: 'SLC', state: 'UT' },
  }
}

const TODAY = '2026-06-24'

describe('deriveContactBookings', () => {
  it('selects a homeowner contact bookings by homeowner_id', () => {
    const appts = [
      appt({ id: 'mine', homeowner_id: 'h1' }),
      appt({ id: 'other', homeowner_id: 'h2' }),
    ]
    const r = deriveContactBookings({ id: 'h1', role: 'homeowner' }, appts, { today: TODAY })
    expect(r.all.map(b => b.appointmentId)).toEqual(['mine'])
  })

  it('selects a cleaner contact bookings by cleaner_id', () => {
    const appts = [appt({ id: 'job', cleaner_id: 'cl1', homeowner_id: 'h9' })]
    const r = deriveContactBookings({ id: 'cl1', role: 'cleaner' }, appts, { today: TODAY })
    expect(r.all.map(b => b.appointmentId)).toEqual(['job'])
  })

  it('splits upcoming (future, not cancelled) soonest-first and recent newest-first', () => {
    const appts = [
      appt({ id: 'past', homeowner_id: 'h1', scheduled_date: '2026-06-13', status: 'completed' }),
      appt({ id: 'soon', homeowner_id: 'h1', scheduled_date: '2026-06-27', status: 'confirmed' }),
      appt({ id: 'later', homeowner_id: 'h1', scheduled_date: '2026-07-04', status: 'confirmed' }),
      appt({ id: 'cxl', homeowner_id: 'h1', scheduled_date: '2026-06-30', status: 'cancelled' }),
    ]
    const r = deriveContactBookings({ id: 'h1', role: 'homeowner' }, appts, { today: TODAY })
    expect(r.upcoming.map(b => b.appointmentId)).toEqual(['soon', 'later'])
    expect(r.recent.map(b => b.appointmentId)).toEqual(['cxl', 'past']) // past/cancelled, newest first
  })

  it('returns empty for a non-customer contact (manager)', () => {
    const appts = [appt({ id: 'x', homeowner_id: 'h1' })]
    const r = deriveContactBookings({ id: 'm1', role: 'manager' }, appts, { today: TODAY })
    expect(r.all).toEqual([])
  })

  it('formats the date pill + label', () => {
    const r = deriveContactBookings({ id: 'h1', role: 'homeowner' }, [appt({ homeowner_id: 'h1' })], { today: TODAY })
    expect(r.upcoming[0].dayNum).toBe('27')
    expect(r.upcoming[0].monthLabel).toBe('Jun')
    expect(r.upcoming[0].service).toBe('Deep Clean')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/components/redesign/messages/deriveContactBookings.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`deriveContactBookings.ts`:
```ts
import type { UserRole } from '@/types'
import type { BookingStatus, ContactBookingVM } from './messages-types'
import { fmtTime } from './messages-format'

export interface AppointmentLike {
  id: string
  homeowner_id?: string | null
  cleaner_id?: string | null
  scheduled_date: string // YYYY-MM-DD
  scheduled_time: string // HH:MM
  status: BookingStatus
  total_price?: number
  service_type?: { name?: string | null } | null
  checklist?: { name?: string | null } | null
  property?: { name?: string | null; address?: string | null } | null
}

export interface DeriveContactBookingsOpts {
  today: string // YYYY-MM-DD
  maxUpcoming?: number
  maxRecent?: number
}

function toVM(a: AppointmentLike): ContactBookingVM {
  const d = new Date(`${a.scheduled_date}T00:00:00`)
  return {
    appointmentId: a.id,
    service: a.service_type?.name || a.checklist?.name || 'Cleaning',
    dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    timeLabel: fmtTime(a.scheduled_time),
    address: a.property?.name || a.property?.address || null,
    status: a.status,
    dayNum: String(d.getDate()),
    monthLabel: d.toLocaleDateString('en-US', { month: 'short' }),
  }
}

export function deriveContactBookings(
  contact: { id: string; role: UserRole },
  appts: AppointmentLike[],
  opts: DeriveContactBookingsOpts,
): { upcoming: ContactBookingVM[]; recent: ContactBookingVM[]; all: ContactBookingVM[] } {
  const maxUpcoming = opts.maxUpcoming ?? 4
  const maxRecent = opts.maxRecent ?? 4

  // Only homeowners (customer) and cleaners have bookings tied to them.
  const matches =
    contact.role === 'homeowner'
      ? appts.filter((a) => a.homeowner_id === contact.id)
      : contact.role === 'cleaner'
        ? appts.filter((a) => a.cleaner_id === contact.id)
        : []

  if (matches.length === 0) return { upcoming: [], recent: [], all: [] }

  const all = matches
    .slice()
    .sort((x, y) => y.scheduled_date.localeCompare(x.scheduled_date)) // newest first
    .map(toVM)

  const upcoming = matches
    .filter((a) => a.scheduled_date >= opts.today && a.status !== 'cancelled' && a.status !== 'completed')
    .sort((x, y) => x.scheduled_date.localeCompare(y.scheduled_date)) // soonest first
    .slice(0, maxUpcoming)
    .map(toVM)

  const upcomingIds = new Set(upcoming.map((u) => u.appointmentId))
  const recent = matches
    .filter((a) => !upcomingIds.has(a.id))
    .sort((x, y) => y.scheduled_date.localeCompare(x.scheduled_date)) // newest first
    .slice(0, maxRecent)
    .map(toVM)

  return { upcoming, recent, all }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/components/redesign/messages/deriveContactBookings.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/messages/deriveContactBookings.ts src/components/redesign/messages/deriveContactBookings.test.ts
git commit -m "feat(messages): deriveContactBookings with tests"
```

---

## Task 7: Presenters (badge + VM builders)

**Files:**
- Create: `src/components/redesign/messages/messages-presenters.tsx`
- Test: `src/components/redesign/messages/messages-presenters.test.tsx`

**Interfaces:**
- Consumes: VM types (Task 3), formatters (Task 4), `deriveContactBookings` (Task 6), `ConversationWithDetails`/`MessageWithDetails`/`UserProfile` from `@/types`, `AdminAppointment` from `@/hooks/useAdminData`.
- Produces:
  - `BookingBadge({ status }): JSX` — `Badge` with icon/label/variant per status.
  - `toConversationRowVM(conv, currentUserId): ConversationRowVM`
  - `toInlineBookingVM(appt: AdminAppointment | undefined, appointmentId): InlineBookingVM`
  - `toMessageVM(msg, currentUserId, prev, getBooking): MessageVM` where `getBooking(appointmentId) => InlineBookingVM | null`
  - `toContactContext(participant, appts, { canViewPayments, today }): ContactContextVM`
  - `BOOKING_STATUS_CONFIG` map (label/variant/Icon/spin) reused by `BookingBadge` and cards.

- [ ] **Step 1: Write the failing test (VM builders, the parts with logic)**

`messages-presenters.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { toInlineBookingVM, toConversationRowVM } from './messages-presenters'

describe('toInlineBookingVM', () => {
  it('builds a full card from an appointment', () => {
    const vm = toInlineBookingVM(
      {
        id: 'a1',
        scheduled_date: '2026-06-27',
        scheduled_time: '14:00',
        status: 'confirmed',
        service_type: { name: 'Deep Clean' },
        property: { name: null, address: '123 Oak St' },
        cleaner_profile: { user_profile: { first_name: 'Wanda', last_name: 'Jacobs' } },
      } as never,
      'a1',
    )
    expect(vm.found).toBe(true)
    expect(vm.service).toBe('Deep Clean')
    expect(vm.cleanerName).toBe('Wanda Jacobs')
    expect(vm.status).toBe('confirmed')
  })
  it('falls back to a minimal card when the appointment is not loaded', () => {
    const vm = toInlineBookingVM(undefined, 'missing-id')
    expect(vm.found).toBe(false)
    expect(vm.appointmentId).toBe('missing-id')
  })
})

describe('toConversationRowVM', () => {
  it('builds preview + unread + booking flag', () => {
    const conv = {
      id: 'c1',
      other_participant: { id: 'u1', first_name: 'Jordan', last_name: 'Avery', email: 'j@x.com', role: 'homeowner', avatar_url: null },
      last_message: { content: 'hello', sender_id: 'u1', appointment_id: 'a1' },
      last_message_attachment_count: 0,
      unread_count: 2,
      last_message_at: '2026-06-24T10:00:00Z',
    }
    const vm = toConversationRowVM(conv as never, 'me')
    expect(vm.name).toBe('Jordan Avery')
    expect(vm.preview).toBe('hello')
    expect(vm.unreadCount).toBe(2)
    expect(vm.hasBooking).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/components/redesign/messages/messages-presenters.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`messages-presenters.tsx`:
```tsx
import * as React from 'react'
import { Clock, CalendarCheck, Loader2, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react'
import type { ConversationWithDetails, MessageWithDetails, UserProfile, UserRole } from '@/types'
import type { AdminAppointment } from '@/hooks/useAdminData'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  timeAgo, lastMessagePreview, fmtTime, money2, initialsOf, dayLabel,
} from './messages-format'
import { deriveContactBookings } from './deriveContactBookings'
import type {
  BookingStatus, ConversationRowVM, InlineBookingVM, MessageVM, ContactContextVM,
} from './messages-types'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'positive' | 'caution' | 'critical' | 'info'

export const BOOKING_STATUS_CONFIG: Record<BookingStatus, { label: string; variant: BadgeVariant; Icon: LucideIcon; spin?: boolean }> = {
  pending: { label: 'Pending', variant: 'caution', Icon: Clock },
  confirmed: { label: 'Confirmed', variant: 'secondary', Icon: CalendarCheck },
  in_progress: { label: 'In progress', variant: 'default', Icon: Loader2, spin: true },
  completed: { label: 'Completed', variant: 'positive', Icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', variant: 'critical', Icon: XCircle },
}

export function BookingBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const c = BOOKING_STATUS_CONFIG[status] ?? BOOKING_STATUS_CONFIG.confirmed
  const { Icon } = c
  return (
    <Badge variant={c.variant} className={cn('shrink-0 whitespace-nowrap gap-1', className)}>
      <Icon className={cn('size-3', c.spin && 'motion-safe:animate-spin')} aria-hidden="true" />
      {c.label}
    </Badge>
  )
}

function fullName(p?: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!p) return 'Unknown'
  return `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'
}

export function toConversationRowVM(conv: ConversationWithDetails, currentUserId: string): ConversationRowVM {
  const p = conv.other_participant
  const last = conv.last_message
  const isMine = !!last && last.sender_id === currentUserId
  return {
    id: conv.id,
    participantId: p?.id ?? '',
    name: fullName(p),
    email: p?.email ?? '',
    role: (p?.role as UserRole) ?? 'homeowner',
    initials: initialsOf(p?.first_name, p?.last_name),
    avatarUrl: p?.avatar_url ?? null,
    preview: lastMessagePreview({
      content: last?.content ?? '',
      attachmentCount: conv.last_message_attachment_count ?? 0,
      isMine,
    }),
    timeLabel: conv.last_message_at ? timeAgo(conv.last_message_at) : '',
    unreadCount: conv.unread_count ?? 0,
    hasBooking: !!last?.appointment_id,
    lastMessageAt: conv.last_message_at ?? conv.created_at,
  }
}

export function toInlineBookingVM(appt: AdminAppointment | undefined, appointmentId: string): InlineBookingVM {
  if (!appt) {
    return {
      appointmentId, found: false, service: 'Booking', dateLabel: '', timeLabel: '',
      address: null, cleanerName: null, status: 'confirmed',
    }
  }
  const cleaner = appt.cleaner_profile?.user_profile
  return {
    appointmentId,
    found: true,
    service: appt.service_type?.name || appt.checklist?.name || 'Cleaning',
    dateLabel: new Date(`${appt.scheduled_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    timeLabel: fmtTime(appt.scheduled_time),
    address: appt.property?.name || appt.property?.address || null,
    cleanerName: cleaner ? fullName(cleaner) : null,
    status: (appt.status as BookingStatus) ?? 'confirmed',
  }
}

export function toMessageVM(
  msg: MessageWithDetails,
  currentUserId: string,
  prev: MessageWithDetails | null,
  getBooking: (appointmentId: string) => InlineBookingVM | null,
): MessageVM {
  const created = msg.created_at
  const prevDay = prev ? dayLabel(prev.created_at) : null
  const thisDay = dayLabel(created)
  return {
    id: msg.id,
    senderId: msg.sender_id,
    isMine: msg.sender_id === currentUserId,
    content: msg.content ?? '',
    timeLabel: fmtTime(created),
    isRead: !!msg.is_read,
    attachments: (msg.attachments ?? []).map((a) => ({ id: a.id, url: a.file_url })),
    booking: msg.appointment_id ? getBooking(msg.appointment_id) : null,
    createdAt: created,
    dayLabel: thisDay,
    showDayDivider: prevDay !== thisDay,
  }
}

export function toContactContext(
  participant: UserProfile,
  appts: AdminAppointment[],
  opts: { canViewPayments: boolean; today: string },
): ContactContextVM {
  const role = (participant.role as UserRole) ?? 'homeowner'
  const { upcoming, recent, all } = deriveContactBookings({ id: participant.id, role }, appts as never, { today: opts.today })

  // lifetime + properties only meaningful for a homeowner (customer)
  let lifetimeLabel: string | null = null
  let propertiesCount: number | null = null
  let cleaningsCount = 0
  if (role === 'homeowner') {
    const mine = appts.filter((a) => a.homeowner_id === participant.id)
    cleaningsCount = mine.filter((a) => a.status === 'completed').length
    if (opts.canViewPayments) {
      const sum = mine
        .filter((a) => a.status === 'completed')
        .reduce((acc, a) => acc + Number(a.total_price || 0), 0)
      lifetimeLabel = money2(sum)
    }
    propertiesCount = new Set(mine.map((a) => a.property?.address).filter(Boolean)).size || null
  } else if (role === 'cleaner') {
    cleaningsCount = appts.filter((a) => a.cleaner_id === participant.id && a.status === 'completed').length
  }

  return {
    id: participant.id,
    name: fullName(participant),
    role,
    initials: initialsOf(participant.first_name, participant.last_name),
    avatarUrl: participant.avatar_url ?? null,
    email: participant.email ?? null,
    phone: participant.phone ?? null,
    cleaningsCount,
    lifetimeLabel,
    propertiesCount,
    upcoming,
    recent,
  }
}
```
> Note: if `AdminAppointment`'s field names differ from those referenced (`cleaner_profile.user_profile`, `property.address`, `service_type.name`, `homeowner_id`, `total_price`), align to the actual type from `@/hooks/useAdminData` (see the spec's field map). Adjust the `as never` casts accordingly.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/components/redesign/messages/messages-presenters.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/messages/messages-presenters.tsx src/components/redesign/messages/messages-presenters.test.tsx
git commit -m "feat(messages): presenters (booking badge + VM builders) with tests"
```

---

## Task 8: Inbox column (`ConversationRow` + `InboxList`)

**Files:**
- Create: `src/components/redesign/messages/ConversationRow.tsx`
- Create: `src/components/redesign/messages/InboxList.tsx`

**Interfaces:**
- Consumes: `ConversationRowVM`, `RoleFilter` (Task 3); `Avatar`, `Badge`, `Input`, `IconButton`, `SegmentedControl`, `Select`, `Skeleton`, `EmptyState`.
- Produces: `ConversationRow({ row, active, onSelect, onDelete })`; `InboxList(props)` where props are the inbox slice of `OperatorMessagesViewProps`.

- [ ] **Step 1: Implement `ConversationRow`**

`ConversationRow.tsx`:
```tsx
import { CalendarDays, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import type { ConversationRowVM } from './messages-types'

const ROLE_CHIP: Record<string, string> = {
  homeowner: 'Home',
  cleaner: 'Clean',
  manager: 'Mgr',
  admin: 'Admin',
}

export function ConversationRow({
  row, active, onSelect, onDelete,
}: {
  row: ConversationRowVM
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={cn(
        'group relative flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
        'cursor-pointer transition-colors hover:bg-accent/60',
        active && 'bg-accent',
      )}
    >
      {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary" />}
      <Avatar className="size-10 shrink-0">
        {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
        <AvatarFallback>{row.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold">{row.name}</span>
            <span className="shrink-0 rounded-pill bg-muted px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {ROLE_CHIP[row.role] ?? row.role}
            </span>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">{row.timeLabel}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={cn('flex min-w-0 items-center gap-1 truncate text-[13px] text-muted-foreground', row.unreadCount > 0 && 'font-semibold text-foreground')}>
            {row.hasBooking && <CalendarDays className="size-3 shrink-0 text-primary" aria-hidden />}
            <span className="truncate">{row.preview}</span>
          </span>
          {row.unreadCount > 0 && !active ? (
            <Badge variant="default" className="h-5 min-w-5 justify-center px-1.5">
              {row.unreadCount > 9 ? '9+' : row.unreadCount}
            </Badge>
          ) : (
            <IconButton
              aria-label="Delete conversation"
              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement `InboxList`**

`InboxList.tsx`:
```tsx
import { Search, Plus, MessageSquare } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConversationRow } from './ConversationRow'
import type { ConversationRowVM, RoleFilter } from './messages-types'

export function InboxList(props: {
  rows: ConversationRowVM[]
  totalConversations: number
  unreadTotal: number
  search: string
  onSearchChange: (v: string) => void
  unreadOnly: boolean
  onUnreadOnlyChange: (v: boolean) => void
  roleFilter: RoleFilter
  roleOptions: { value: RoleFilter; label: string }[]
  onRoleFilterChange: (v: RoleFilter) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onRequestDelete: (id: string) => void
  onNewMessage: () => void
  loading: boolean
}) {
  const filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: props.unreadTotal > 0 ? `Unread (${props.unreadTotal})` : 'Unread' },
  ] as const

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="border-b border-border/60 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              placeholder="Search conversations"
              className="h-10 pl-9"
              aria-label="Search conversations"
            />
          </div>
          <IconButton aria-label="New message" className="h-10 w-10 bg-primary text-primary-foreground hover:bg-primary/90" onClick={props.onNewMessage}>
            <Plus className="size-5" />
          </IconButton>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <SegmentedControl
            options={filterOptions as unknown as { value: string; label: string }[]}
            value={props.unreadOnly ? 'unread' : 'all'}
            onChange={(v) => props.onUnreadOnlyChange(v === 'unread')}
            className="flex-1"
          />
          <Select value={props.roleFilter} onValueChange={(v) => props.onRoleFilterChange(v as RoleFilter)}>
            <SelectTrigger className="h-9 w-[120px] shrink-0" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.roleOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
              </div>
            ))}
          </div>
        ) : props.rows.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={props.search || props.unreadOnly || props.roleFilter !== 'all' ? 'No matches' : 'No conversations yet'}
            description={props.search ? 'Try a different search.' : 'Start a conversation with the New message button.'}
          />
        ) : (
          props.rows.map((row) => (
            <ConversationRow
              key={row.id}
              row={row}
              active={row.id === props.selectedId}
              onSelect={() => props.onSelect(row.id)}
              onDelete={() => props.onRequestDelete(row.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "ConversationRow|InboxList" || echo "ok"
git add src/components/redesign/messages/ConversationRow.tsx src/components/redesign/messages/InboxList.tsx
git commit -m "feat(messages): inbox column (ConversationRow + InboxList)"
```
> If `SegmentedControl`/`Select`/`EmptyState`/`IconButton` prop names differ from the above, adjust to the real signatures (see Task 7 of grounding / the primitive files). Do not invent props.

---

## Task 9: Thread message rendering (`InlineBookingCard` + `MessageBubble`)

**Files:**
- Create: `src/components/redesign/messages/InlineBookingCard.tsx`
- Create: `src/components/redesign/messages/MessageBubble.tsx`

**Interfaces:**
- Consumes: `InlineBookingVM`, `MessageVM` (Task 3); `BookingBadge` (Task 7); legacy `MessageAttachmentsLightbox` (`@/components/MessageAttachmentsLightbox`).
- Produces: `InlineBookingCard({ booking, onOpen })`; `MessageBubble({ message, onOpenBooking })`.

- [ ] **Step 1: Implement `InlineBookingCard`**

`InlineBookingCard.tsx`:
```tsx
import { CalendarDays } from 'lucide-react'
import { BookingBadge } from './messages-presenters'
import type { InlineBookingVM } from './messages-types'

export function InlineBookingCard({ booking, onOpen }: { booking: InlineBookingVM; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-card border border-primary/25 border-l-[3px] border-l-primary bg-card px-3 py-2.5 text-left shadow-soft-sm transition-colors hover:border-primary/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
        <CalendarDays className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Booking</span>
        <span className="block truncate text-[13px] font-bold">
          {booking.found ? `${booking.service} · ${booking.dateLabel}, ${booking.timeLabel}` : 'View booking'}
        </span>
        {booking.found && (booking.address || booking.cleanerName) && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {[booking.address, booking.cleanerName ? `Cleaner: ${booking.cleanerName}` : null].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      {booking.found && <BookingBadge status={booking.status} />}
      <span className="shrink-0 text-xs font-bold text-primary">Open ›</span>
    </button>
  )
}
```

- [ ] **Step 2: Implement `MessageBubble`**

`MessageBubble.tsx`:
```tsx
import { useState } from 'react'
import { Check, CheckCheck } from 'lucide-react'
import MessageAttachmentsLightbox from '@/components/MessageAttachmentsLightbox'
import { cn } from '@/lib/utils'
import { InlineBookingCard } from './InlineBookingCard'
import type { MessageVM } from './messages-types'

export function MessageBubble({ message, onOpenBooking }: { message: MessageVM; onOpenBooking: (id: string) => void }) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const mine = message.isMine
  return (
    <div className={cn('flex w-full flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {message.booking && (
        <div className={cn('max-w-[80%]', mine ? 'self-end' : 'self-start')}>
          <InlineBookingCard booking={message.booking} onOpen={() => onOpenBooking(message.booking!.appointmentId)} />
        </div>
      )}
      <div className={cn('flex max-w-[78%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        {message.content && (
          <div className={cn(
            'whitespace-pre-wrap break-words rounded-card px-3.5 py-2 text-sm',
            mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card text-foreground',
          )}>
            {message.content}
          </div>
        )}
        {message.attachments.length > 0 && (
          <div className={cn('grid gap-1.5', message.attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            {message.attachments.map((a, i) => (
              <button key={a.id} type="button" onClick={() => setLightbox(i)} className="overflow-hidden rounded-control border border-border">
                <img src={a.url} alt="attachment" className="h-28 w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 px-1 text-[10.5px] text-muted-foreground">
          <span>{message.timeLabel}</span>
          {mine && (message.isRead
            ? <CheckCheck className="size-3.5 text-primary" aria-label="Read" />
            : <Check className="size-3.5" aria-label="Sent" />)}
        </div>
      </div>
      {lightbox !== null && (
        <MessageAttachmentsLightbox
          open={lightbox !== null}
          index={lightbox}
          attachments={message.attachments.map((a) => ({ id: a.id, file_url: a.url, file_type: 'image/jpeg', file_size: null, message_id: message.id, created_at: message.createdAt }))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
```
> Verify the legacy `MessageAttachmentsLightbox` default-export name and prop shape (`open`, `index`, `attachments: MessageAttachment[]`, `onClose`) and match the `MessageAttachment` fields exactly; adjust the mapping if needed.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "InlineBookingCard|MessageBubble" || echo "ok"
git add src/components/redesign/messages/InlineBookingCard.tsx src/components/redesign/messages/MessageBubble.tsx
git commit -m "feat(messages): inline booking card + message bubble"
```

---

## Task 10: Composer + booking attach (`ReferenceBookingMenu` + `MessageComposer`)

**Files:**
- Create: `src/components/redesign/messages/ReferenceBookingMenu.tsx`
- Create: `src/components/redesign/messages/MessageComposer.tsx`

**Interfaces:**
- Consumes: `ContactBookingVM` (Task 3); `Popover`, `Drawer` (Task 2), `Textarea`, `IconButton`, `Button`, `Input`, `BookingBadge`.
- Produces:
  - `ReferenceBookingMenu({ bookings, onPick, isMobile, trigger })` — popover (desktop) / drawer (mobile) picker.
  - `MessageComposer({ draft, onDraftChange, pendingFiles, onAddFiles, onRemoveFile, stagedBooking, attachableBookings, onStageBooking, onClearStagedBooking, onSend, sending, isMobile })` — textarea, enter-to-send, attach previews, staged-booking chip.

- [ ] **Step 1: Implement `ReferenceBookingMenu`**

`ReferenceBookingMenu.tsx`:
```tsx
import { useState } from 'react'
import { Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { CalendarDays } from 'lucide-react'
import { BookingBadge } from './messages-presenters'
import type { ContactBookingVM } from './messages-types'

function PickerBody({ bookings, onPick }: { bookings: ContactBookingVM[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const filtered = bookings.filter((b) => `${b.service} ${b.address ?? ''} ${b.dateLabel}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex max-h-[60vh] flex-col">
      <div className="relative p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bookings" className="h-9 pl-9" aria-label="Search bookings" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No bookings for this person" />
        ) : filtered.map((b) => (
          <button key={b.appointmentId} type="button" onClick={() => onPick(b.appointmentId)}
            className="flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left hover:bg-accent">
            <span className="w-9 shrink-0 text-center">
              <span className="block text-base font-extrabold leading-none">{b.dayNum}</span>
              <span className="block text-[9px] font-bold uppercase text-muted-foreground">{b.monthLabel}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{b.service}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{b.timeLabel}{b.address ? ` · ${b.address}` : ''}</span>
            </span>
            <BookingBadge status={b.status} />
          </button>
        ))}
      </div>
    </div>
  )
}

export function ReferenceBookingMenu({
  bookings, onPick, isMobile, trigger,
}: {
  bookings: ContactBookingVM[]
  onPick: (id: string) => void
  isMobile: boolean
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const handlePick = (id: string) => { onPick(id); setOpen(false) }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Reference a booking</DrawerTitle></DrawerHeader>
          <PickerBody bookings={bookings} onPick={handlePick} />
          <div className="h-4" />
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[300px] p-0">
        <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Reference a booking</div>
        <PickerBody bookings={bookings} onPick={handlePick} />
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Implement `MessageComposer`**

`MessageComposer.tsx`:
```tsx
import { useRef } from 'react'
import { Plus, Send, X, CalendarDays, ImagePlus } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { IconButton } from '@/components/ui/icon-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ReferenceBookingMenu } from './ReferenceBookingMenu'
import { cn } from '@/lib/utils'
import type { ContactBookingVM } from './messages-types'

const MAX_FILES = 5

export function MessageComposer(props: {
  draft: string
  onDraftChange: (v: string) => void
  pendingFiles: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  stagedBooking: ContactBookingVM | null
  attachableBookings: ContactBookingVM[]
  onStageBooking: (id: string) => void
  onClearStagedBooking: () => void
  onSend: () => void
  sending: boolean
  isMobile: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const canSend = (props.draft.trim().length > 0 || props.pendingFiles.length > 0 || !!props.stagedBooking) && !props.sending

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) props.onSend() }
  }
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_FILES - props.pendingFiles.length)
    if (files.length) props.onAddFiles(files)
    e.target.value = ''
  }

  return (
    <div className="border-t border-border/60 bg-background p-3">
      {props.stagedBooking && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-control border border-primary/25 bg-primary/10 py-1.5 pl-3 pr-1.5">
          <CalendarDays className="size-3.5 text-primary" aria-hidden />
          <span className="text-xs font-bold text-primary">{props.stagedBooking.service} · {props.stagedBooking.dateLabel}</span>
          <IconButton aria-label="Remove attached booking" className="h-5 w-5 bg-background" onClick={props.onClearStagedBooking}>
            <X className="size-3" />
          </IconButton>
        </div>
      )}
      {props.pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {props.pendingFiles.map((f, i) => (
            <div key={i} className="relative">
              <img src={URL.createObjectURL(f)} alt="" className="size-14 rounded-control object-cover" />
              <button type="button" onClick={() => props.onRemoveFile(i)} aria-label="Remove image"
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-card border border-border bg-muted/50 p-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="Add to message" className="h-9 w-9 shrink-0 bg-primary/10 text-primary">
              <Plus className="size-5" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}><ImagePlus className="size-4" />Add image</DropdownMenuItem>
            <ReferenceBookingMenu
              isMobile={props.isMobile}
              bookings={props.attachableBookings}
              onPick={props.onStageBooking}
              trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><CalendarDays className="size-4" />Reference a booking</DropdownMenuItem>}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleFiles} />
        <Textarea
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-2 focus-visible:ring-0"
        />
        <IconButton aria-label="Send message" disabled={!canSend}
          className={cn('h-9 w-9 shrink-0', canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground')}
          onClick={props.onSend}>
          <Send className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}
```
> The "Reference a booking" item lives inside the `+` dropdown; nesting a Popover/Drawer trigger as a `DropdownMenuItem` may need the dropdown to stay open (use `onSelect={(e) => e.preventDefault()}`). If the nested-overlay interaction misbehaves, split "Reference a booking" into a separate icon button beside the `+` instead. Validate interactively in Task 15.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "ReferenceBookingMenu|MessageComposer" || echo "ok"
git add src/components/redesign/messages/ReferenceBookingMenu.tsx src/components/redesign/messages/MessageComposer.tsx
git commit -m "feat(messages): composer + reference-a-booking picker"
```

---

## Task 11: Thread panel (`MessageThreadPanel`)

**Files:**
- Create: `src/components/redesign/messages/MessageThreadPanel.tsx`

**Interfaces:**
- Consumes: `MessageVM` (Task 3); `MessageBubble` (Task 9); `MessageComposer` (Task 10); `Avatar`, `Button`, `DropdownMenu`, `Skeleton`, `EmptyState`.
- Produces: `MessageThreadPanel(props)` — the thread slice of `OperatorMessagesViewProps` plus composer props. Ports legacy paging/scroll: an IntersectionObserver top sentinel calls `onLoadMore` when `hasMore`; auto-scroll to `messagesEndRef` on new messages when near bottom.

- [ ] **Step 1: Implement**

`MessageThreadPanel.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { ArrowLeft, Info, MoreVertical, MessageSquare, Loader2, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import type { ContactBookingVM, MessageVM, UserRoleLike } from './messages-types'

const ROLE_LABEL: Record<string, string> = { homeowner: 'Homeowner', cleaner: 'Cleaner', manager: 'Manager', admin: 'Admin' }

export function MessageThreadPanel(props: {
  hasSelection: boolean
  title: string
  role: string | null
  initials: string
  avatarUrl: string | null
  detailsOpen: boolean
  onToggleDetails: () => void
  onBack?: () => void
  onRequestDelete: () => void
  messages: MessageVM[]
  loading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  messagesEndRef: React.RefObject<HTMLDivElement>
  onOpenBooking: (id: string) => void
  // composer
  composer: React.ComponentProps<typeof MessageComposer>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const countRef = useRef(0)

  // paging: observe the top sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !props.hasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && props.hasMore && !props.isLoadingMore) props.onLoadMore()
    }, { root: scrollRef.current, rootMargin: '200px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [props.hasMore, props.isLoadingMore, props.onLoadMore])

  // auto-scroll to bottom when a NEW message arrives and we are near the bottom
  useEffect(() => {
    const grew = props.messages.length > countRef.current
    countRef.current = props.messages.length
    const sc = scrollRef.current
    if (!grew || !sc) return
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 150
    if (nearBottom) props.messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [props.messages.length, props.messagesEndRef])

  if (!props.hasSelection) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={MessageSquare} title="Select a conversation" description="Choose a conversation on the left to read and reply." />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-background to-muted/30">
      <div className="flex items-center gap-3 border-b border-border/60 bg-background px-3 py-2.5">
        {props.onBack && (
          <IconButton aria-label="Back to conversations" className="h-9 w-9 lg:hidden" onClick={props.onBack}><ArrowLeft className="size-5" /></IconButton>
        )}
        <Avatar className="size-9 shrink-0">
          {props.avatarUrl ? <AvatarImage src={props.avatarUrl} alt="" /> : null}
          <AvatarFallback>{props.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{props.title}</div>
          {props.role && <div className="text-xs text-muted-foreground">{ROLE_LABEL[props.role] ?? props.role}</div>}
        </div>
        <Button variant={props.detailsOpen ? 'secondary' : 'outline'} size="sm" onClick={props.onToggleDetails} className="gap-1.5">
          <Info className="size-4" />Details
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton aria-label="Conversation actions" className="h-9 w-9"><MoreVertical className="size-4" /></IconButton></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem destructive onSelect={props.onRequestDelete}><Trash2 className="size-4" />Delete conversation</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {props.isLoadingMore && <div className="flex justify-center py-1"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
        {props.loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className={cn('h-10 rounded-card', i % 2 ? 'w-2/3 self-end' : 'w-1/2 self-start')} />
            ))}
          </div>
        ) : props.messages.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No messages yet" description="Say hello to start the conversation." />
        ) : (
          props.messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-3">
              {m.showDayDivider && <div className="self-center text-[11px] font-semibold text-muted-foreground">{m.dayLabel}</div>}
              <MessageBubble message={m} onOpenBooking={props.onOpenBooking} />
            </div>
          ))
        )}
        <div ref={props.messagesEndRef} aria-hidden />
      </div>

      <MessageComposer {...props.composer} />
    </div>
  )
}
```
> Remove the unused `UserRoleLike` import if not added to types; it is illustrative. Keep `ROLE_LABEL` local.

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "MessageThreadPanel" || echo "ok"
git add src/components/redesign/messages/MessageThreadPanel.tsx
git commit -m "feat(messages): thread panel with paging + auto-scroll"
```

---

## Task 12: Context panel (`ContextPanel`)

**Files:**
- Create: `src/components/redesign/messages/ContextPanel.tsx`

**Interfaces:**
- Consumes: `ContactContextVM`, `ContactBookingVM` (Task 3); `BookingBadge` (Task 7); `Avatar`, `Button`, `IconButton`, `Drawer` (Task 2).
- Produces: `ContextPanelBody({ context, onOpenBooking, onViewProfile, onNewBooking, onCopy })` (shared), `ContextPanel({ ...body, isMobile, open, onOpenChange })` (desktop column / mobile Drawer wrapper).

- [ ] **Step 1: Implement**

`ContextPanel.tsx`:
```tsx
import { Mail, Phone, UserCircle2, Plus, X, CalendarDays } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { BookingBadge } from './messages-presenters'
import type { ContactBookingVM, ContactContextVM } from './messages-types'

const ROLE_LABEL: Record<string, string> = { homeowner: 'Homeowner', cleaner: 'Cleaner', manager: 'Manager', admin: 'Admin' }

function BookingMini({ b, onOpen }: { b: ContactBookingVM; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mb-2 flex w-full items-center gap-3 rounded-control border border-border bg-card px-2.5 py-2.5 text-left hover:border-primary/30 hover:shadow-soft-sm">
      <span className="w-10 shrink-0 text-center">
        <span className="block text-base font-extrabold leading-none">{b.dayNum}</span>
        <span className="block text-[10px] font-bold uppercase text-muted-foreground">{b.monthLabel}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{b.service}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{b.timeLabel}{b.address ? ` · ${b.address}` : ''}</span>
      </span>
      <BookingBadge status={b.status} />
    </button>
  )
}

export function ContextPanelBody({
  context, onOpenBooking, onViewProfile, onNewBooking, onCopy, onClose,
}: {
  context: ContactContextVM
  onOpenBooking: (id: string) => void
  onViewProfile: () => void
  onNewBooking: () => void
  onCopy: (text: string, label: string) => void
  onClose?: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">About</h4>
        {onClose && <IconButton aria-label="Close details" className="h-8 w-8" onClick={onClose}><X className="size-4" /></IconButton>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="text-center">
          <Avatar className="mx-auto size-16">
            {context.avatarUrl ? <AvatarImage src={context.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xl">{context.initials}</AvatarFallback>
          </Avatar>
          <div className="mt-2.5 text-base font-extrabold">{context.name}</div>
          <span className="mt-1.5 inline-block rounded-pill bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {ROLE_LABEL[context.role] ?? context.role}
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {context.email && (
            <button type="button" onClick={() => onCopy(context.email!, 'Email')} className="flex items-center gap-2.5 rounded-control border border-border bg-card px-3 py-2.5 text-left text-[12.5px]">
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{context.email}</span><span className="text-[11px] font-bold text-primary">Copy</span>
            </button>
          )}
          {context.phone && (
            <button type="button" onClick={() => onCopy(context.phone!, 'Phone')} className="flex items-center gap-2.5 rounded-control border border-border bg-card px-3 py-2.5 text-left text-[12.5px]">
              <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{context.phone}</span><span className="text-[11px] font-bold text-primary">Copy</span>
            </button>
          )}
        </div>

        <div className="mt-3.5 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onViewProfile}><UserCircle2 className="size-4" />Profile</Button>
          {context.role === 'homeowner' && (
            <Button size="sm" className="flex-1 gap-1.5" onClick={onNewBooking}><Plus className="size-4" />New booking</Button>
          )}
        </div>

        {(context.cleaningsCount > 0 || context.lifetimeLabel || context.propertiesCount) && (
          <div className="mt-4 flex overflow-hidden rounded-control border border-border bg-card">
            <Stat v={String(context.cleaningsCount)} l="cleanings" />
            {context.lifetimeLabel && <Stat v={context.lifetimeLabel} l="lifetime" bordered />}
            {context.propertiesCount != null && <Stat v={String(context.propertiesCount)} l="properties" bordered />}
          </div>
        )}

        {context.upcoming.length > 0 && (
          <>
            <SectionLabel>Upcoming</SectionLabel>
            {context.upcoming.map((b) => <BookingMini key={b.appointmentId} b={b} onOpen={() => onOpenBooking(b.appointmentId)} />)}
          </>
        )}
        {context.recent.length > 0 && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {context.recent.map((b) => <BookingMini key={b.appointmentId} b={b} onOpen={() => onOpenBooking(b.appointmentId)} />)}
          </>
        )}
        {context.upcoming.length === 0 && context.recent.length === 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
            <CalendarDays className="size-5" aria-hidden /><span>No bookings for this person.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ v, l, bordered }: { v: string; l: string; bordered?: boolean }) {
  return (
    <div className={`flex-1 px-2 py-2.5 text-center ${bordered ? 'border-l border-border/60' : ''}`}>
      <div className="text-base font-extrabold">{v}</div>
      <div className="text-[10px] text-muted-foreground">{l}</div>
    </div>
  )
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{children}</div>
}

export function ContextPanel(props: {
  context: ContactContextVM | null
  isMobile: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenBooking: (id: string) => void
  onViewProfile: () => void
  onNewBooking: () => void
  onCopy: (text: string, label: string) => void
}) {
  if (!props.context) return null
  const body = (
    <ContextPanelBody
      context={props.context}
      onOpenBooking={props.onOpenBooking}
      onViewProfile={props.onViewProfile}
      onNewBooking={props.onNewBooking}
      onCopy={props.onCopy}
      onClose={() => props.onOpenChange(false)}
    />
  )
  if (props.isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={props.onOpenChange}>
        <DrawerContent className="max-h-[85dvh]">{body}</DrawerContent>
      </Drawer>
    )
  }
  // desktop column (rendered only when open by the View)
  return <div className="hidden w-80 shrink-0 border-l border-border bg-muted/20 lg:block">{body}</div>
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "ContextPanel" || echo "ok"
git add src/components/redesign/messages/ContextPanel.tsx
git commit -m "feat(messages): context (About) panel + mobile drawer"
```

---

## Task 13: New message dialog (`NewMessageDialog`)

**Files:**
- Create: `src/components/redesign/messages/NewMessageDialog.tsx`

**Interfaces:**
- Consumes: `Dialog*`, `Input`, `Avatar`, `EmptyState`; `OrganizationMember` from `@/hooks/useOrganizationMembers`; `rolesUserCanMessage` from `@/lib/messagingPermissions`; `UserRole` from `@/types`.
- Produces: `NewMessageDialog({ open, onOpenChange, members, currentUserRole, onPick })`.

- [ ] **Step 1: Implement**

`NewMessageDialog.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { rolesUserCanMessage } from '@/lib/messagingPermissions'
import type { OrganizationMember } from '@/hooks/useOrganizationMembers'
import type { UserRole } from '@/types'
import { initialsOf } from './messages-format'

export function NewMessageDialog({
  open, onOpenChange, members, currentUserRole, onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: OrganizationMember[]
  currentUserRole: UserRole
  onPick: (member: OrganizationMember) => void
}) {
  const [q, setQ] = useState('')
  const allowed = useMemo(() => new Set(rolesUserCanMessage(currentUserRole)), [currentUserRole])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return members
      .filter((m) => allowed.has(m.role as UserRole))
      .filter((m) => !needle || `${m.first_name ?? ''} ${m.last_name ?? ''} ${m.email}`.toLowerCase().includes(needle))
  }, [members, allowed, q])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-5 pt-5"><DialogTitle>New message</DialogTitle></DialogHeader>
        <div className="relative px-5 pt-2">
          <Search className="pointer-events-none absolute left-8 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="h-10 pl-9" aria-label="Search people" />
        </div>
        <div className="max-h-[50vh] min-h-0 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <EmptyState icon={Users} title="No one to message" description="No matching members you can message." />
          ) : filtered.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m)} className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left hover:bg-accent">
              <Avatar className="size-9 shrink-0">
                {m.avatar_url ? <AvatarImage src={m.avatar_url} alt="" /> : null}
                <AvatarFallback>{initialsOf(m.first_name, m.last_name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.email}</span>
                <span className="block truncate text-[11px] capitalize text-muted-foreground">{m.role} · {m.email}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="h-3" />
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "NewMessageDialog" || echo "ok"
git add src/components/redesign/messages/NewMessageDialog.tsx
git commit -m "feat(messages): new message dialog"
```

---

## Task 14: Pure view (`OperatorMessagesView`)

**Files:**
- Create: `src/components/redesign/messages/OperatorMessagesView.tsx`

**Interfaces:**
- Consumes: `OperatorMessagesViewProps` (Task 3) + all components (Tasks 8-13).
- Produces: `OperatorMessagesView(props: OperatorMessagesViewProps)` — header + responsive console (inbox always; thread + optional About on desktop; on mobile, inbox OR thread based on `selectedId`, About + composer-picker as drawers). The mobile single-pane switch is driven by `selectedId` (no separate prop).

- [ ] **Step 1: Implement**

`OperatorMessagesView.tsx`:
```tsx
import { cn } from '@/lib/utils'
import { InboxList } from './InboxList'
import { MessageThreadPanel } from './MessageThreadPanel'
import { ContextPanel } from './ContextPanel'
import type { OperatorMessagesViewProps } from './messages-types'

export function OperatorMessagesView(props: OperatorMessagesViewProps) {
  const hasSelection = !!props.selectedId

  return (
    <div className="mx-0 flex h-[calc(100dvh-9rem)] w-full max-w-[1700px] flex-col">
      {/* header */}
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Messages</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {props.totalConversations} conversation{props.totalConversations === 1 ? '' : 's'}
            {props.unreadTotal > 0 && <> · <span className="font-bold text-primary">{props.unreadTotal} unread</span></>}
          </p>
        </div>
      </div>

      {/* console */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-card shadow-soft-md">
        {/* inbox: full width on mobile when no selection; fixed column on desktop */}
        <div className={cn('w-full shrink-0 border-r border-border lg:w-[360px]', hasSelection && 'hidden lg:flex')}>
          <InboxList
            rows={props.rows}
            totalConversations={props.totalConversations}
            unreadTotal={props.unreadTotal}
            search={props.search}
            onSearchChange={props.onSearchChange}
            unreadOnly={props.unreadOnly}
            onUnreadOnlyChange={props.onUnreadOnlyChange}
            roleFilter={props.roleFilter}
            roleOptions={props.roleOptions}
            onRoleFilterChange={props.onRoleFilterChange}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            onRequestDelete={props.onRequestDelete}
            onNewMessage={props.onNewMessage}
            loading={props.inboxLoading}
          />
        </div>

        {/* thread: full width on mobile when selected; flex on desktop */}
        <div className={cn('min-w-0 flex-1', !hasSelection && 'hidden lg:block')}>
          <MessageThreadPanel
            hasSelection={hasSelection}
            title={props.threadTitle}
            role={props.threadRole}
            initials={props.threadInitials}
            avatarUrl={props.threadAvatarUrl}
            detailsOpen={props.detailsOpen}
            onToggleDetails={props.onToggleDetails}
            onBack={() => props.onSelect('')}
            onRequestDelete={() => props.selectedId && props.onRequestDelete(props.selectedId)}
            messages={props.messages}
            loading={props.threadLoading}
            hasMore={props.hasMore}
            isLoadingMore={props.isLoadingMore}
            onLoadMore={props.onLoadMore}
            messagesEndRef={props.messagesEndRef}
            onOpenBooking={props.onOpenBooking}
            composer={{
              draft: props.draft,
              onDraftChange: props.onDraftChange,
              pendingFiles: props.pendingFiles,
              onAddFiles: props.onAddFiles,
              onRemoveFile: props.onRemoveFile,
              stagedBooking: props.stagedBooking,
              attachableBookings: props.attachableBookings,
              onStageBooking: props.onStageBooking,
              onClearStagedBooking: props.onClearStagedBooking,
              onSend: props.onSend,
              sending: props.sending,
              isMobile: false, // overridden below via CSS-only; mobile picker handled by useIsMobile in container
            }}
          />
        </div>

        {/* desktop About column */}
        {props.detailsOpen && hasSelection && (
          <ContextPanel
            context={props.context}
            isMobile={false}
            open={props.detailsOpen}
            onOpenChange={(o) => { if (!o) props.onToggleDetails() }}
            onOpenBooking={props.onOpenBooking}
            onViewProfile={props.onViewProfile}
            onNewBooking={props.onNewBooking}
            onCopy={props.onCopy}
          />
        )}
      </div>
    </div>
  )
}
```
> `isMobile` for the composer's booking picker is decided in the Container (Task 16) via a `useIsMobile()` check and threaded into `props` (add `isMobile: boolean` to `OperatorMessagesViewProps` and pass through to both the composer and `ContextPanel`). Update Task 3's interface accordingly when wiring. Mobile renders the About panel + booking picker as drawers; desktop renders the About column + popover.

- [ ] **Step 2: Reconcile `isMobile` in types**

Add `isMobile: boolean` to `OperatorMessagesViewProps` in `messages-types.ts`, pass it into the composer (`isMobile: props.isMobile`) and into the mobile `ContextPanel` branch. The Container supplies it.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "OperatorMessagesView" || echo "ok"
git add src/components/redesign/messages/OperatorMessagesView.tsx src/components/redesign/messages/messages-types.ts
git commit -m "feat(messages): pure OperatorMessagesView composition"
```

---

## Task 15: Dev preview route + Playwright verification

**Files:**
- Create: `src/app/(dev)/messages-preview/page.tsx`

**Interfaces:**
- Consumes: `OperatorMessagesView`, `OperatorShell`, the VM types; provides mock data.

- [ ] **Step 1: Implement the preview**

`src/app/(dev)/messages-preview/page.tsx`:
```tsx
'use client'
import { useRef, useState } from 'react'
import { OperatorShell } from '@/components/redesign/shell/OperatorShell'
import { OperatorMessagesView } from '@/components/redesign/messages/OperatorMessagesView'
import type { ConversationRowVM, MessageVM, ContactContextVM, ContactBookingVM, RoleFilter } from '@/components/redesign/messages/messages-types'

const ROWS: ConversationRowVM[] = [
  { id: 'a', participantId: 'u1', name: 'Jordan Avery', email: 'jordan@x.com', role: 'homeowner', initials: 'JA', avatarUrl: null, preview: 'Can we move Friday to the morning?', timeLabel: '2m', unreadCount: 2, hasBooking: true, lastMessageAt: '2026-06-24T17:58:00Z' },
  { id: 'b', participantId: 'u2', name: 'Wanda Jacobs', email: 'wanda@x.com', role: 'cleaner', initials: 'WJ', avatarUrl: null, preview: 'Running 10 min late to the Oak St job', timeLabel: '18m', unreadCount: 1, hasBooking: false, lastMessageAt: '2026-06-24T17:42:00Z' },
  { id: 'c', participantId: 'u3', name: 'Marcus Lee', email: 'marcus@x.com', role: 'manager', initials: 'ML', avatarUrl: null, preview: 'Approved the payout, thanks', timeLabel: '1h', unreadCount: 0, hasBooking: false, lastMessageAt: '2026-06-24T17:00:00Z' },
]
const MESSAGES: MessageVM[] = [
  { id: 'm0', senderId: 'me', isMine: true, content: '', timeLabel: '2:38 PM', isRead: true, attachments: [], createdAt: '2026-06-24T14:38:00Z', dayLabel: 'Today', showDayDivider: true,
    booking: { appointmentId: 'ap1', found: true, service: 'Deep Clean', dateLabel: 'Fri Jun 27', timeLabel: '2:00 PM', address: '123 Oak St', cleanerName: 'Wanda Jacobs', status: 'confirmed' } },
  { id: 'm1', senderId: 'me', isMine: true, content: "Hi Jordan, quick question about Friday's clean.", timeLabel: '2:38 PM', isRead: true, attachments: [], booking: null, createdAt: '2026-06-24T14:38:30Z', dayLabel: 'Today', showDayDivider: false },
  { id: 'm2', senderId: 'u1', isMine: false, content: 'Can we move it to the morning instead?', timeLabel: '2:41 PM', isRead: false, attachments: [], booking: null, createdAt: '2026-06-24T14:41:00Z', dayLabel: 'Today', showDayDivider: false },
]
const BOOKINGS: ContactBookingVM[] = [
  { appointmentId: 'ap1', service: 'Deep Clean', dateLabel: 'Jun 27', timeLabel: '2:00 PM', address: '123 Oak St', status: 'confirmed', dayNum: '27', monthLabel: 'Jun' },
  { appointmentId: 'ap2', service: 'Standard Clean', dateLabel: 'Jun 13', timeLabel: '10:00 AM', address: '123 Oak St', status: 'completed', dayNum: '13', monthLabel: 'Jun' },
]
const CONTEXT: ContactContextVM = {
  id: 'u1', name: 'Jordan Avery', role: 'homeowner', initials: 'JA', avatarUrl: null, email: 'jordan.avery@gmail.com', phone: '(801) 555-0142',
  cleaningsCount: 14, lifetimeLabel: '$1,680.00', propertiesCount: 2, upcoming: [BOOKINGS[0]], recent: [BOOKINGS[1]],
}

export default function MessagesPreviewPage() {
  const endRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>('a')
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [draft, setDraft] = useState('')

  return (
    <OperatorShell active="messages">
      <OperatorMessagesView
        rows={ROWS} totalConversations={ROWS.length} unreadTotal={3}
        search={search} onSearchChange={setSearch}
        unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly}
        roleFilter={roleFilter} onRoleFilterChange={setRoleFilter}
        roleOptions={[{ value: 'all', label: 'All roles' }, { value: 'homeowner', label: 'Homeowners' }, { value: 'cleaner', label: 'Cleaners' }, { value: 'manager', label: 'Managers' }, { value: 'admin', label: 'Admins' }]}
        selectedId={selectedId} onSelect={(id) => setSelectedId(id || null)} onRequestDelete={() => {}} onNewMessage={() => {}}
        inboxLoading={false}
        threadTitle="Jordan Avery" threadRole="homeowner" threadInitials="JA" threadAvatarUrl={null}
        messages={MESSAGES} threadLoading={false} hasMore={false} isLoadingMore={false} onLoadMore={() => {}} messagesEndRef={endRef}
        onOpenBooking={() => {}}
        draft={draft} onDraftChange={setDraft} pendingFiles={[]} onAddFiles={() => {}} onRemoveFile={() => {}}
        stagedBooking={null} attachableBookings={BOOKINGS} onStageBooking={() => {}} onClearStagedBooking={() => {}}
        onSend={() => {}} sending={false}
        detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((v) => !v)} context={CONTEXT}
        onViewProfile={() => {}} onNewBooking={() => {}} onCopy={() => {}}
        isMobile={false}
      />
    </OperatorMessagesView>
  )
}
```
> Fix the obvious closing-tag typo when implementing (close `</OperatorShell>`, not `</OperatorMessagesView>`). Confirm `OperatorShell`'s import path + `active` prop against an existing preview (e.g. `payments-preview`).

- [ ] **Step 2: Run the app + Playwright check (desktop)**

```bash
npx next dev -p 3100
```
Then with Playwright MCP: navigate to `http://localhost:3100/messages-preview`, screenshot. Expected: three panes render, inline booking card visible, About panel populated, no console errors.

- [ ] **Step 3: Playwright check (mobile + drag)**

Resize to 390x844, navigate again. Tap a conversation -> full-screen thread. Tap Details -> the About **Drawer** opens; confirm you can drag it down to dismiss (vaul). Open the composer `+` -> Reference a booking -> Drawer picker. Screenshot each.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dev)/messages-preview/page.tsx"
git commit -m "feat(messages): dev preview route"
```

---

## Task 16: Container (`OperatorMessages`)

**Files:**
- Create: `src/components/redesign/messages/OperatorMessages.tsx`
- (Optional) Create: `src/hooks/useIsMobile.ts` if one does not already exist (check first; reuse if present).

**Interfaces:**
- Consumes: every hook + builder + the View.
- Produces: `OperatorMessages()` default-exported client component.

- [ ] **Step 1: Confirm/локate a mobile breakpoint hook**

```bash
ls src/hooks | grep -i mobile || grep -rl "matchMedia" src/hooks | head
```
If none exists, create `src/hooks/useIsMobile.ts`:
```ts
'use client'
import { useEffect, useState } from 'react'
export function useIsMobile(query = '(max-width: 1023px)') {
  const [is, setIs] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setIs(m.matches)
    on(); m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return is
}
```

- [ ] **Step 2: Implement the container**

`OperatorMessages.tsx`:
```tsx
'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useConversations } from '@/hooks/useConversations'
import { useMessages } from '@/hooks/useMessages'
import { useSendMessage } from '@/hooks/useSendMessage'
import { useStartConversation } from '@/hooks/useStartConversation'
import { useDeleteConversation } from '@/hooks/useDeleteConversation'
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers'
import { useAdminAppointments } from '@/hooks/useAdminData'
import { useManagerPermissions } from '@/hooks/useManagerPermissions'
import { toast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useIsMobile } from '@/hooks/useIsMobile'
import { OperatorMessagesView } from './OperatorMessagesView'
import { NewMessageDialog } from './NewMessageDialog'
import { deriveMessages, unreadTotal } from './deriveMessages'
import { deriveContactBookings } from './deriveContactBookings'
import { toConversationRowVM, toMessageVM, toInlineBookingVM, toContactContext } from './messages-presenters'
import type { ContactBookingVM, RoleFilter } from './messages-types'
import type { UserRole } from '@/types'

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All roles' },
  { value: 'homeowner', label: 'Homeowners' },
  { value: 'cleaner', label: 'Cleaners' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Admins' },
]

export default function OperatorMessages() {
  const { user, currentOrgRole } = useAuth()
  const userId = user?.id ?? ''
  const userRole = (user?.role as UserRole) ?? 'admin'
  const router = useRouter()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()

  const permissions = useManagerPermissions()
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin'
  const canViewPayments = privileged || !!permissions?.can_view_payments

  // URL-driven selection
  const selectedId = searchParams.get('c')
  const toParam = searchParams.get('to')
  const apptParam = searchParams.get('appointment')

  const setSelected = useCallback((conversationId: string) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (conversationId) sp.set('c', conversationId); else sp.delete('c')
    sp.delete('to'); sp.delete('appointment')
    router.replace(`?${sp.toString()}`, { scroll: false })
  }, [router, searchParams])

  // data
  const { conversations, loading: inboxLoading, updateUnreadCount } = useConversations({ userId })
  const { messages: rawMessages, loading: threadLoading, hasMore, isLoadingMore, loadMoreMessages, messagesEndRef } =
    useMessages({ conversationId: selectedId, userId, onUnreadCountUpdate: updateUnreadCount })
  const { appointments } = useAdminAppointments()
  const { members } = useOrganizationMembers({ excludeCurrentUser: true })
  const { sendMessage, sending } = useSendMessage()
  const { startConversation } = useStartConversation()
  const { deleteConversation, deleting } = useDeleteConversation()

  // local UI state
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [stagedAppointmentId, setStagedAppointmentId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const consumedToRef = useRef<string | null>(null)

  // VM build
  const rowsAll = useMemo(() => conversations.map((c) => toConversationRowVM(c, userId)), [conversations, userId])
  const rows = useMemo(() => deriveMessages(rowsAll, { search, unreadOnly, roleFilter }), [rowsAll, search, unreadOnly, roleFilter])

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null
  const participant = selectedConv?.other_participant ?? null

  const apptById = useMemo(() => {
    const m = new Map<string, (typeof appointments)[number]>()
    for (const a of appointments) m.set(a.id, a)
    return m
  }, [appointments])

  const messages = useMemo(() => {
    return rawMessages.map((msg, i) =>
      toMessageVM(msg, userId, i > 0 ? rawMessages[i - 1] : null, (apptId) => toInlineBookingVM(apptById.get(apptId), apptId)),
    )
  }, [rawMessages, userId, apptById])

  const context = useMemo(() => (participant ? toContactContext(participant, appointments, { canViewPayments, today }) : null), [participant, appointments, canViewPayments, today])

  const attachableBookings: ContactBookingVM[] = useMemo(() => {
    if (!participant) return []
    return deriveContactBookings({ id: participant.id, role: (participant.role as UserRole) ?? 'homeowner' }, appointments as never, { today, maxUpcoming: 50, maxRecent: 50 }).all
  }, [participant, appointments, today])
  const stagedBooking = useMemo(() => attachableBookings.find((b) => b.appointmentId === stagedAppointmentId) ?? null, [attachableBookings, stagedAppointmentId])

  // deep-link: ?to=<userId>(&appointment=<id>) -> start/open a thread
  useEffect(() => {
    if (!toParam || !userId || consumedToRef.current === toParam) return
    consumedToRef.current = toParam
    if (apptParam) setStagedAppointmentId(apptParam)
    startConversation(toParam).then((res) => {
      if (res.success && res.conversationId) setSelected(res.conversationId)
    })
  }, [toParam, apptParam, userId, startConversation, setSelected])

  // handlers
  const onSend = useCallback(async () => {
    if (!participant) return
    const content = draft.trim()
    if (!content && pendingFiles.length === 0 && !stagedAppointmentId) return
    const res = await sendMessage({
      conversationId: selectedId ?? undefined,
      senderId: userId,
      recipientId: participant.id,
      content,
      attachments: pendingFiles,
      appointmentId: stagedAppointmentId ?? undefined,
    })
    if (res.success) {
      setDraft(''); setPendingFiles([]); setStagedAppointmentId(null)
      if (!selectedId && res.conversationId) setSelected(res.conversationId)
    } else {
      toast.error(res.error || 'Could not send the message.')
    }
  }, [participant, draft, pendingFiles, stagedAppointmentId, sendMessage, selectedId, userId, setSelected])

  const onCopy = useCallback((text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {})
  }, [])

  const openBooking = useCallback((id: string) => { router.push(`/admin-dashboard?appointment=${id}`) }, [router])
  const viewProfile = useCallback(() => {
    if (!participant) return
    const role = (participant.role as UserRole)
    const path = role === 'cleaner' ? '/app/admin-dashboard/cleaners' : '/app/admin-dashboard/customers'
    router.push(path)
  }, [participant, router])
  const newBooking = useCallback(() => { router.push('/admin-dashboard?tab=bookings&new=1') }, [router])

  const onPickNew = useCallback(async (memberId: string) => {
    setNewOpen(false)
    const res = await startConversation(memberId)
    if (res.success && res.conversationId) setSelected(res.conversationId)
    else if (!res.success) toast.error(res.error || 'Could not start the conversation.')
  }, [startConversation, setSelected])

  const confirmDelete = useCallback(async () => {
    if (!deleteId) return
    const res = await deleteConversation(deleteId)
    if (res.success) { if (deleteId === selectedId) setSelected(''); setDeleteId(null) }
    else toast.error(res.error || 'Could not delete the conversation.')
  }, [deleteId, deleteConversation, selectedId, setSelected])

  return (
    <>
      <OperatorMessagesView
        rows={rows}
        totalConversations={rowsAll.length}
        unreadTotal={unreadTotal(rowsAll)}
        search={search} onSearchChange={setSearch}
        unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly}
        roleFilter={roleFilter} roleOptions={ROLE_OPTIONS} onRoleFilterChange={setRoleFilter}
        selectedId={selectedId} onSelect={setSelected} onRequestDelete={setDeleteId} onNewMessage={() => setNewOpen(true)}
        inboxLoading={inboxLoading}
        threadTitle={context?.name ?? ''} threadRole={(participant?.role as UserRole) ?? null}
        threadInitials={context?.initials ?? ''} threadAvatarUrl={context?.avatarUrl ?? null}
        messages={messages} threadLoading={threadLoading} hasMore={hasMore} isLoadingMore={isLoadingMore}
        onLoadMore={loadMoreMessages} messagesEndRef={messagesEndRef} onOpenBooking={openBooking}
        draft={draft} onDraftChange={setDraft}
        pendingFiles={pendingFiles} onAddFiles={(f) => setPendingFiles((p) => [...p, ...f].slice(0, 5))} onRemoveFile={(i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i))}
        stagedBooking={stagedBooking} attachableBookings={attachableBookings} onStageBooking={setStagedAppointmentId} onClearStagedBooking={() => setStagedAppointmentId(null)}
        onSend={onSend} sending={sending}
        detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((v) => !v)} context={context}
        onViewProfile={viewProfile} onNewBooking={newBooking} onCopy={onCopy}
        isMobile={isMobile}
      />
      <NewMessageDialog open={newOpen} onOpenChange={setNewOpen} members={members} currentUserRole={userRole} onPick={(m) => onPickNew(m.id)} />
      <ConfirmDialog
        open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null) }}
        title="Delete conversation?" description="All messages will be permanently deleted. This cannot be undone."
        confirmLabel="Delete" destructive loading={deleting} onConfirm={confirmDelete}
      />
    </>
  )
}
```
> Verify each hook's exact return names against the grounding digest (e.g. `useConversations` returns `conversations` + `updateUnreadCount`; `useMessages` returns `loadMoreMessages` + `messagesEndRef`; `useManagerPermissions` shape). Fix any mismatch. `toast` import path/api: confirm `toast.error/success` exist (Task 2 grounding) else adapt.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "OperatorMessages\.tsx|useIsMobile" || echo "ok"
git add src/components/redesign/messages/OperatorMessages.tsx src/hooks/useIsMobile.ts
git commit -m "feat(messages): OperatorMessages container (hooks, URL params, handlers)"
```

---

## Task 17: Route page + nav repoint + live verify

**Files:**
- Create: `src/app/(redesign)/app/admin-dashboard/messages/page.tsx`
- Modify: `src/components/redesign/shell/nav-items.ts`

- [ ] **Step 1: Implement the route page (clone the Payments page exactly)**

Read `src/app/(redesign)/app/admin-dashboard/payments/page.tsx` and reproduce its structure (auth gate + Suspense + `OperatorShell active="messages"`), swapping the body for `<OperatorMessages />`:
```tsx
'use client'
import { Suspense } from 'react'
import { OperatorShell } from '@/components/redesign/shell/OperatorShell'
import OperatorMessages from '@/components/redesign/messages/OperatorMessages'

export default function MessagesPage() {
  return (
    <OperatorShell active="messages">
      <Suspense fallback={null}>
        <OperatorMessages />
      </Suspense>
    </OperatorShell>
  )
}
```
> Match whatever auth-gate/loading wrapper the Payments page uses (e.g. an `orgStatus`/`user` spinner). Do not invent a different gate.

- [ ] **Step 2: Repoint the nav href**

In `src/components/redesign/shell/nav-items.ts`, change the `messages` item:
```ts
{ id: "messages", label: "Messages", href: "/app/admin-dashboard/messages", icon: MessageSquare, primary: true },
```

- [ ] **Step 3: Live verification against dev Supabase**

With `npx next dev -p 3100` running and the redesign flag on, log in as an admin (see the dev roster) and visit `/app/admin-dashboard/messages`. Verify with Playwright MCP: inbox loads real conversations, opening a thread shows messages, attaching a booking via `+` -> Reference a booking sends an inline card, the About panel shows the contact's real bookings, "Open booking" navigates to the legacy drawer. Screenshot desktop + mobile.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(redesign)/app/admin-dashboard/messages/page.tsx" src/components/redesign/shell/nav-items.ts
git commit -m "feat(messages): route page + repoint nav to /app/admin-dashboard/messages"
```

---

## Task 18: Gates, Codex review, PR

- [ ] **Step 1: Run the full local gates**

```bash
npm run test
npx tsc --noEmit
npm run lint
```
Expected: tests PASS; no NEW tsc errors beyond pre-existing CVA noise; lint clean for new files.

- [ ] **Step 2: Codex pre-push review on the finished branch**

Resolve the codex-companion path and run the branch review vs master:
```bash
node "$(ls ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | tail -1)" review --scope branch --base master
```
Apply valid findings, commit as `fix: address Codex review`.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/redesign-operator-messages
```
Open a PR to `master`. Body: summarize the screen, call out the additive `useSendMessage.appointmentId`, the new `vaul` dependency + `Drawer` primitive, and the out-of-scope follow-ups (wire "Message about this job" buttons; migrate other screens' sheets to `Drawer`). Wait for the four required checks to go green.

---

## Self-Review (completed against the spec)

- **Spec section 2 (layout):** Tasks 8/11/12/14 (inbox, thread, About, responsive console). Covered.
- **Spec section 3 (components):** every named component has a task (8-14); `messages-format` split out for testability. Covered.
- **Booking-attach model A:** `appointmentId` on `useSendMessage` (Task 1), staged chip + picker (Task 10), inline card (Task 9), hydration from `useAdminAppointments` (Tasks 7/16), `?to=&appointment=` deep-link (Task 16). Covered.
- **Spec section 4 (one backend change):** Task 1. Covered.
- **Spec section 5 (routing/flag/preview):** Tasks 15 (preview) + 17 (route + nav). Covered.
- **Spec section 6 (permissions/gotchas):** `canViewPayments` gates lifetime $ (Tasks 7/16); IconButton sizing, badge convention, no em dashes applied throughout.
- **Spec section "Drawer":** Task 2; used in Tasks 10/12; drag verified Task 15. Covered.
- **Spec section 7 (testing):** unit tests in Tasks 4/5/6/7; Playwright in Tasks 15/17. Covered.
- **Type consistency:** `OperatorMessagesViewProps` gains `isMobile` (noted in Task 14 step 2 + Task 3); hook return-name verification flagged in Tasks 7/16; `MessageAttachment` mapping flagged in Task 9. No undefined cross-task symbols.
- **Open verification flags (intentional, resolve during implementation):** exact `AdminAppointment` field names; `toast` api; `OperatorShell`/Payments page gate; `SegmentedControl`/`Select`/`EmptyState` prop names; legacy lightbox prop shape. Each is called out at its task with instructions to align to the real signature.
