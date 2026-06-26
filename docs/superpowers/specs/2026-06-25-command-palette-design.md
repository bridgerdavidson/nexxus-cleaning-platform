# Operator Command Palette (Cmd+K) — Design

> R1, Part 2 of "finish the operator shell chrome" (Part 1 = notifications, PR #90). The redesign operator top bar has a dead placeholder search `<Input>`, and the app has no global search anywhere. This adds a command palette: global search across the operator's records plus quick actions/navigation.

## Goal

A fast, keyboard-first command palette for the operator (admin/manager) shell that lets you find any booking, customer, cleaner, or service and jump straight to it, and run quick actions (new booking, navigate to any screen) without leaving the keyboard. Opens with Cmd+K / Ctrl+K, the top bar search field, or the mobile search icon.

## Decisions (locked in brainstorm)

1. **Command palette, not just entity search.** Searches entities AND offers an Actions group (New booking + "Go to {screen}").
2. **Results open the exact record.** Picking an entity result deep-links to that record's detail. Requires adding URL deep-link params to the redesign screens whose detail is state-only today: `?customer=`, `?booking=`, `?cleaner=` (Services already uses `?service=`).
3. **cmdk + client-side, lazy data.** Use the `cmdk` package via a themed `command.tsx` primitive (keyboard nav, a11y, grouping for free), with `shouldFilter={false}` so results come from our own filtering. Data is read from the existing entity hooks; the data component mounts only while the palette is open, so the hooks fire on first open and then serve from TanStack cache + realtime. No backend, no RPC, no migration.

## Architecture

New folder `src/components/redesign/command/`:

- **`CommandPalette.tsx`** (always mounted, in `OperatorShell`): owns `open` state, the global `keydown` listener for Cmd+K (Mac) / Ctrl+K (Windows), and renders the command dialog. Renders `<CommandPaletteData>` only when `open` (so the entity hooks are lazy). Exposes nothing; self-contained. Receives `onNewBooking` from the shell for the "New booking" action.
- **`CommandPaletteData.tsx`** (mounted only while open): calls the permission-gated entity hooks, owns the query input state, computes results via `deriveCommandResults`, renders the grouped cmdk list, and handles selection (router.push for entity deep-links and "go to" nav; calls `onNewBooking` / closes for actions).
- **`deriveCommandResults.ts`** (+ `.test.ts`): **pure**. Inputs: query string, the entity arrays (bookings/customers/cleaners/services), a permissions object, and the nav/action list. Output: ordered `CommandGroupVM[]` of `CommandItemVM { id, label, sublabel?, icon, kind: 'entity'|'action'|'nav', href?, actionId? }`, capped per entity group (top 5) with an optional "view all" overflow item that links to the filtered list screen. Reuses the existing match approach (`matchesSearch`, `matchesCustomerSearch`) and adds equivalents for cleaners/services.
- **`src/components/ui/command.tsx`**: the shadcn cmdk primitive set (`Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `CommandDialog`), themed to redesign tokens (`bg-popover`, `text-popover-foreground`, `rounded-card`, `--brand` accents). `CommandDialog` wraps the existing `Dialog` primitive.

## Data + permissions

- Hooks (lazy, only while open): `useAdminAppointments`, `useAdminCustomers`, `useAdminCleaners`, `useServices`.
- **Permission gating mirrors each screen's view gate**, computed from `useManagerPermissions` + `currentOrgRole` (privileged = owner/admin):
  - Bookings: always (core operator surface).
  - Customers: `privileged || can_view_customers`.
  - Cleaners: `privileged || can_manage_cleaners`.
  - Services: `privileged || can_manage_services` (fall back to always-visible if no such flag; services carry no sensitive money data).
  - Actions/nav: "New booking" + nav links the user can already reach; gate "Payments" nav by the same rule the nav uses (the rail already renders gated nav, so reuse `OPERATOR_NAV` and let unreachable screens 404-fallback as today).
- A user who cannot view an entity type never has it fetched (the gated hook is simply not consumed) and never sees that group.
- Known pre-existing caveat (not fixed here): `useManagerPermissions` is keyed only on userId, so it can be briefly stale right after an org switch. Affects all redesign screens; out of scope.

## Deep-link wiring (3 screens)

Each screen's Container already holds a `detailId` state that opens its detail Sheet. Add a URL param that seeds and syncs that state:

- **Customers** (`OperatorCustomers`): `?customer=<id>` opens the customer detail sheet.
- **Bookings** (`OperatorBookings`): `?booking=<id>` opens `BookingDetailSheet`.
- **Cleaners** (`OperatorCleaners`): `?cleaner=<id>` opens the cleaner detail sheet.
- **Services**: already `?service=<id>` (no change).

Pattern per screen: read the param via `useSearchParams` on mount/param-change, set `detailId` from it; on close, clear the param (router.replace without it) so back/refresh behave. Param is the single source when present; falls back to existing click-to-open state otherwise. Palette result hrefs: `/app/admin-dashboard/customers?customer=<id>`, `/app/admin-dashboard/bookings?booking=<id>`, `/app/admin-dashboard/cleaners?cleaner=<id>`, `/app/admin-dashboard/services?service=<id>`.

## Keyboard + entry points

- Global `Cmd+K` (Mac) / `Ctrl+K` (Windows) toggles the palette from anywhere in the operator shell. Listener added/removed in `CommandPalette`'s effect; `e.preventDefault()` so the browser's default is suppressed.
- The top bar search becomes a **button-styled trigger** showing "Search..." + a `⌘K` hint chip; clicking it opens the palette (it is no longer a real text input). The mobile search icon button opens it too.
- Inside: arrow keys + Enter (cmdk), Escape closes (Dialog).

## Results / commands UX

- Groups in order: **Bookings, Customers, Cleaners, Services** (each top ~5 matches, with a "View all in {screen}" overflow row when there are more), then **Actions** ("New booking", then "Go to {screen}" for each nav item).
- Empty query: show the **Actions** group only (quick navigation + new booking). (Recents is out of scope for v1.)
- Each entity row: tone-neutral entity icon + primary label (name/title) + a muted sublabel: booking = property + date; customer = email; cleaner = role/status; service = price.
- No matches: a `CommandEmpty` "No results for '{query}'".

## Testing

- **Unit** (`deriveCommandResults.test.ts`): substring matching per entity, grouping + order, per-group cap + overflow item, permission filtering (excluded groups absent), action/nav list for empty query, href construction.
- **Live Playwright**: Cmd+K opens; typing filters; selecting an entity routes to the deep-link and the detail opens; selecting an action/nav navigates; mobile (search icon opens it). Dev preview route `/(dev)/command-preview` renders the palette open with mock data for no-login screenshotting.
- Each deep-link param verified to open the right detail.

## Out of scope (follow-ups)

- Server-side search RPC (client-side over loaded data is sufficient for pilot-size orgs; revisit if a tenant outgrows the loaded window).
- Recents / frequency ranking.
- Search for the cleaner/homeowner/platform experiences (this is the operator shell only).
- Fixing the pre-existing `useManagerPermissions` org-switch staleness.

## File list

New:
- `src/components/ui/command.tsx`
- `src/components/redesign/command/CommandPalette.tsx`
- `src/components/redesign/command/CommandPaletteData.tsx`
- `src/components/redesign/command/deriveCommandResults.ts` (+ `.test.ts`)
- `src/app/(dev)/command-preview/page.tsx`

Modified:
- `src/components/redesign/shell/OperatorShell.tsx` (mount `CommandPalette`, pass `onNewBooking`)
- `src/components/redesign/shell/OperatorTopBar.tsx` (search input -> palette trigger; expose an open handler)
- `src/components/redesign/customers/OperatorCustomers.tsx` (`?customer=`)
- `src/components/redesign/bookings/OperatorBookings.tsx` (`?booking=`)
- `src/components/redesign/cleaners/OperatorCleaners.tsx` (`?cleaner=`)
- `package.json` / `package-lock.json` (`cmdk`)
