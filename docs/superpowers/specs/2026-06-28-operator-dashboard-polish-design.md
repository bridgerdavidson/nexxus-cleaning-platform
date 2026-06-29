# Operator Dashboard Polish, Design Spec

**Date:** 2026-06-28
**Status:** Draft for review
**Surface:** Redesigned operator (admin / manager) dashboard, `src/components/redesign/**` + `(redesign)` route group
**Scope:** A focused UI polish pass across six operator surfaces before the Homeowner experience. Its own PR.

---

## Goal

Tighten six rough edges in the redesigned operator dashboard so it reads as finished and on-system on both mobile and desktop: cramped mobile toolbars, a grey message thread, a redundant/anonymous FAB, invisible Services cards, plain-text Payments summary + unbounded lists, and a legacy-yellow Settings avatar control.

## Out of scope (explicitly)

- **The New booking flow / modal.** It is broken and gets its own brainstorm + redesign PR next. This spec only settles the FAB's *role and styling*; it does not touch New-booking functionality.
- Homeowner / Platform experiences, R4 launch polish. Later.
- Any non-operator surface (the cleaner app stays as shipped).

## Global constraints (apply to every task)

- **Redesign-only.** All changes live under `src/components/redesign/**` and the `(redesign)` route group, behind `NEXT_PUBLIC_REDESIGN_ENABLED` (`redesignUiEnabled()`). The legacy operator UI is untouched.
- **Design system is the styling source.** Implement from `src/components/ui/*` primitives and tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft shadows, the rounded scale). **No legacy yellow** (`primary` / `#F7C41E` / `rgba(217,167,24,...)`), **no raw hex**, **no one-off classes**. The screenshots and ASCII previews from brainstorming are UX/structure reference only.
- **Reuse before building.** Prefer existing primitives (`StatTile`, `Button` variants, `Input`, `Select`, `Card`, `Avatar`, `Sheet`, `ChevronRight` card pattern from the cleaner catalog). New shared patterns become reusable primitives, not inline one-offs.
- **Touch targets >= 44px** on every new control (ui-ux-pro-max `touch-target-size`); spacing on the 4/8 scale; mobile-first.
- **No em dashes** in any user-facing copy (labels, buttons, toasts, empty states).
- **Each surface is independently testable** and reviewable; they ship together in one PR but as separate task groups.

---

## Surface 1, List toolbars (Customers, Cleaners & team, Services)

### Problem
On mobile each list stacks full-width controls vertically: the page's create button, then a full-width search, then a full-width sort, then (Services) a full-width status filter, plus (Cleaners) a full-width segment switch and benched toggle. The user scrolls past ~half a screen before any content. The sort `Select` also stretches edge-to-edge, which reads heavy. Customers wraps at `sm` (640px); Cleaners wraps at `lg` (1024px), an inconsistency.

### Decision (from brainstorming)
**Compact wrapping filter row, nothing hidden.** Page create buttons stay visible on their page (discoverability). Layout per page on mobile:

1. Page header: title + count (+ on desktop the create button, right-aligned).
2. The page create button (mobile): stays as a clear full-width button (Customers `New customer`, Cleaners `Invite cleaner`, Services `New service`).
3. Cleaners only: the `Cleaners | Staff` segment switch stays as its own segmented control (it is a primary view switch, not a filter).
4. Search: full-width on its own row.
5. **A single wrapping row of compact, auto-width controls** for sort + status + benched. These no longer each take a full row; they sit side by side and wrap to a second line only if needed. Each stays >= 44px tall.

Normalize all three pages to wrap at `sm` (640px) so the responsive behavior is consistent.

### Reusable primitive
Add a small shared layout component, **`ListFilterBar`** (`src/components/redesign/shared/ListFilterBar.tsx`), that renders a full-width search slot above a `flex flex-wrap gap-2` row of compact control slots, and collapses to a single inline row at `sm+`. All three pages compose it so the fix lives in one place. It is layout-only (no business logic); each page passes its own `Input`, `Select`, and toggle children.

### Per-page control inventory (what each control does, kept visible)
- **Customers:** search, sort (`Newest / Oldest / A-Z / $`). 2 controls -> one compact row.
- **Cleaners & team:** segment switch (Cleaners/Staff, kept separate), search, sort (`Name A-Z / ...`), benched toggle (a filter chip). Sort + benched share the compact row; the full-width-sort bug is fixed by `w-auto`.
- **Services:** search, sort (`Name A-Z / ...`), status filter (`Active / Inactive / All`). Sort + status share the compact row.

### ui-ux-pro-max rules applied
`touch-target-size` (>=44px controls), `spacing-scale` (4/8), `mobile-first`, `content-priority` (content reachable sooner), `primary-action` (one create button per page, not competing).

---

## Surface 2, FAB, anonymous `+` becomes a labeled "New booking" action

### Problem
Today's FAB is a bare `+` floating bottom-right on every operator page with no wired action, and it reads as "add this page's item" (e.g. add customer) on a list page. Its legacy purpose is the persistent **New booking** action.

### Decision (from brainstorming)
**Labeled "New booking" FAB.** On mobile operational pages, the FAB becomes an **extended FAB**: a calendar-plus icon + `New booking` label, unmistakably the global booking action. Desktop keeps its existing top-bar New booking action (unchanged). Page-specific create buttons stay on their pages. The FAB points at the **existing** New-booking trigger; this PR does not change what that trigger opens (the modal redesign is the next PR).

### Details
- Extended FAB: pill shape, brand surface, `CalendarPlus` (lucide) + `New booking` label; bottom-right with safe-area padding; >= 44px; subtle soft shadow (token, not raw rgba).
- Shown on operational pages (Overview, Bookings, Customers, Cleaners, Services, Payments, Messages); **not** on Settings.
- If the FAB component already exists in the redesign shell, restyle it in place (icon + label + brand token); do not introduce a second floating element.

### ui-ux-pro-max rules applied
`primary-action` (one clear primary global action), `safe-area-awareness`, `truncation-strategy` (label must not truncate; icon-only fallback only below a very narrow width).

---

## Surface 3, Messages thread surfaces

### Problem
`MessageThreadPanel` wraps the whole column in an off-system gradient (`bg-gradient-to-b from-background to-muted/30`), so header, message list, and composer all read grey. The `Details` button uses canvas-scoped variants that look weak, and the composer input uses `bg-muted/50` (grey-on-grey).

### Decision (from brainstorming)
**Header + composer white; message list keeps a soft warm tint.**

- **Remove** the off-system gradient on the thread panel container.
- **Header strip** (avatar + recipient name/role + Details button): solid white (`bg-card`), keep the bottom hairline border.
- **Message list** (scroll area): soft warm canvas (`bg-background`, the warm-50 token), so white incoming bubbles (`bg-card`) still separate. Sent bubbles stay brand blue.
- **Composer area:** solid white (`bg-card`), top hairline border. The input field becomes a clean bordered field on white (`border-border` + `bg-card`, subtle inset feel via token shadow if needed), not a grey fill. The send button stays brand when active / muted when empty; the attach (`+`) button uses brand-tint on white.
- **Details button hierarchy on white:** it is a secondary toggle, not the primary action. Inactive = `outline` (bordered, white, dark text). Active (`detailsOpen`) = `secondary`/filled state that reads on white. Use existing `Button` variants; if no variant reads correctly on white, the fix is a variant tweak in `button.tsx`, not an inline override.

### ui-ux-pro-max rules applied
`color-semantic` (kill the off-token gradient), `contrast-readability` (incoming bubbles must read), `primary-action` (Details is subordinate to Send), `state-clarity` (Details toggle states distinct).

---

## Surface 4, Services, list styling + hybrid structure

### Problem
Desktop is a two-pane master-detail; the left list cards are near-invisible (`rounded-field`, `border-transparent`, no `bg-card`) and the selected state is legacy yellow (`bg-primary/10`). There is no card/chevron affordance. The user wants the cleaner-catalog card look and an editable "service page."

### Decision (from brainstorming)
**Hybrid: cards -> editable page on mobile, restyled two-pane on desktop.**

- **List cards (both layouts):** restyle to the cleaner-catalog visual language as the *reference* (white surface, border, soft shadow, an icon pill, name + meta, `ChevronRight`), built as an operator card (not an import of the cleaner component). Selected state on desktop = brand blue accent (`#0150FC` via token), never yellow.
- **Desktop:** keep the two-pane master-detail (fast service-to-service switching is genuinely better for a config surface). Left list = restyled white cards + chevron + blue selected state. Right pane = the existing `ServiceDetailPane` (edit / duplicate / delete + `ChecklistsEditor`), unchanged in function.
- **Mobile:** the list is the white-card list; tapping a card opens the detail as a full-screen **editable service page** with a clear back-to-list affordance. Reuse the existing `?service=<id>` query-param mechanism (URL-routed, so it is reopen-safe per the modal-UX conventions) and the existing `ServiceDetailPane` content; the toolbar already hides when a service is selected.
- Apply the Surface 1 compact toolbar to the Services list state.

### ui-ux-pro-max rules applied
`style-match` / `consistency` (cards match the system + sibling cleaner catalog), `visual-hierarchy` (white cards over invisible rows), `back-behavior` (mobile service page has predictable back), `no-precision-required` (full-card tap target + chevron).

---

## Surface 5, Payments, KPI cards + paginated lists

### Problem
The summary numbers (`Revenue`, `This month`, `Queued payouts`) render as plain text on the grey canvas, and `NN transactions . NN payouts` sits as a redundant subtitle under the title. The transactions and payouts lists fetch **all** rows (`useAdminPayments` / `useAdminPayouts` in `src/hooks/useAdminData.ts`, no `.limit()` / `.range()`), so the page waits on the full set and scrolls forever.

### Decision (from brainstorming)

**(a) KPI cards.** Replace the plain-text summary with a responsive grid of **`StatTile`** cards (reuse the Overview `KpiStrip` primitive): `Revenue`, `This month`, `Queued payouts`, `Transactions` (count), `Payouts` (count). Grid: 2-col mobile, scaling to a single row on desktop. Remove the `NN transactions . NN payouts` subtitle under the `Payments` title (the counts now live in tiles).
  - **Important:** the KPI tile values come from **aggregate stats**, not from the (now paginated) list arrays. Source them from the existing `payment_stats` RPC via `usePaymentStats` (revenue, this-month, queued); extend the stats source if total transaction/payout **counts** are not already provided. Tile values must reflect org totals, independent of the loaded page.

**(b) Pagination, real load reduction.** Convert the transactions and payouts lists to **incremental server fetch**: fetch the newest `PAGE_SIZE = 25` rows initially via Supabase `.order('created_at', desc).range(...)`, with a **`Load more`** button that fetches the next 25 and appends. Implement with TanStack Query `useInfiniteQuery` (or an explicit page-state hook) keyed by org. The lists render the accumulated rows; `Load more` is hidden when the last page returns fewer than `PAGE_SIZE`.
  - **Filters/sort caveat (documented):** existing client-side filter/sort apply to the **loaded** rows; older matches appear as the user loads more. Acceptable for pilot data volumes. (A future enhancement can push filters server-side.)
  - **State:** transactions and payouts keep **separate** pagination state. Switching the ledger does not reset the other; each ledger remembers its loaded pages within the session.
  - The `Your money` Stripe embed card and `Record payment` button are unchanged.

### ui-ux-pro-max rules applied
`lazy-loading` / "load content as needed, don't load everything upfront" (the core fix), `progressive-loading` (skeleton while the first page loads), `color-semantic` (StatTile tokens, no plain-text-on-grey), `number-tabular` (tile values + amounts use tabular figures).

---

## Surface 6, Settings, modernize the Profile avatar control

### Problem
`ProfileSection` imports the legacy `src/components/AvatarUpload.tsx`, which renders the avatar wrapper, upload icon, camera badge, and `Change photo` link in legacy yellow (`bg-primary-100`, `text-primary-600`, `bg-primary-600`, hardcoded `rgba(217,167,24,0.3)` shadow). The rest of the settings form is on-system; only the avatar control breaks the theme.

### Decision (from brainstorming + recon)
**Modernize the profile section to the cleaner-profile avatar style, keep the settings shell exactly as-is.**

- **Promote** the slice-6 `CleanerAvatarEditor` to a shared primitive, **`AvatarEditor`** (`src/components/redesign/shared/AvatarEditor.tsx`), on `useImageUpload`, brand tokens, initials fallback. The cleaner profile re-points at the shared primitive (thin re-export or direct import) so there is one avatar editor, not two.
- **`ProfileSection`** swaps `AvatarUpload` -> `AvatarEditor`: derive initials from first/last name (reuse the `cleanerInitials`-style helper, generalized), pass `currentAvatarUrl` + `initials`, call `updateProfile` in the `onUploaded` callback.
- **Hard constraints (unchanged):** desktop stays **one big white card** (`OperatorSettingsView` layout untouched); mobile stays **settings tabs that navigate to separate pages** via `?section=` (do **not** convert settings to the cleaner mobile pattern). Only the profile section's avatar visuals/markup change.
- Legacy `AvatarUpload.tsx` stays for the non-redesign `/settings` path; it is not deleted, just no longer used by the redesign.

### ui-ux-pro-max rules applied
`color-semantic` (brand tokens, kill yellow + raw rgba), `consistency` (one avatar editor across roles), `icon-style-consistent`.

---

## Testing strategy

- **Pure logic (Vitest, co-located `*.test.ts`):** any new derive/helper, especially the pagination page-accumulation/`hasMore` logic and the initials helper. TDD.
- **Visual (Playwright MCP):** verify each surface at 375px (mobile) and a desktop width against the design system: toolbar height reduction, white message header/composer + tinted list, Services white cards + blue select + mobile service page, Payments KPI tiles + Load more, brand-blue avatar control.
- **Conformance grep (pre-PR):** no `#F7C41E`, no `rgba(217,167,24`, no `bg-primary-`/`text-primary-` legacy classes, no raw hex in any touched redesign file.
- **Gates:** `npm run test`, `npx tsc --noEmit`, `npm run lint` green for touched files. One Codex review on the branch before push.

## Self-review (spec)

- **Placeholders:** none; each surface has a concrete decision + files.
- **Consistency:** `ListFilterBar`, `AvatarEditor`, `StatTile`, `?service=` are referenced consistently. FAB scope is bounded (role + style only; New-booking flow excluded) and stated twice to avoid leak.
- **Scope:** six loosely-coupled UI changes, one operator dashboard, one PR; each is an independently reviewable task group. Not over-large for a single plan.
- **Ambiguity:** the four brainstorming forks are resolved; remaining defaults (KPI tile set, page size 25, separate per-ledger pagination, shared `AvatarEditor`) are stated explicitly so the plan has no open choices.
