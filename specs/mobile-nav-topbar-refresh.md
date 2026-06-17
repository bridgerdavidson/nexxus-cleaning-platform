# Spec: Mobile nav + top bar refresh (flush, unified, native-feeling)

Derived from the grill-me session in
`brainstorming/2026-06-16-mobile-nav-topbar-ui-audit.md` (decisions D1-D9).
Planning artifact only. No code is written by this document.

> **Post-review revisions (2026-06-17), after seeing it live.** Two decisions were
> reverted on review and the sections below describe the original plan, not the
> shipped code:
> - **D5 (contextual top-bar title) REVERTED.** The active page's title in the top
>   bar duplicated the title the page body already renders (e.g. admin Bookings
>   showed "Bookings" twice, stacked). Per `ui-ux-pro-max` rules
>   `navigation-consistency` (don't change nav content by page) and
>   `heading-hierarchy` (no duplicate heading per screen), the top bar now shows
>   the **persistent Nexxus brand lockup on every tab**; the page body owns its
>   title. The `tabs`/`activeTab` props added to `MobileTopBar` were removed again.
> - **D6/D9 (sliding gold capsule) REVERTED.** The active-tab indicator is back to
>   the **original 3px gold sliding pill** under the active icon. The capsule +
>   icon-box geometry measuring was removed; `MobileNavigation` measures the button
>   center again (constant `PILL_WIDTH`).
>
> Still shipped: D1-D4 (flush solid-white bars, gray-100 surface, hairline, no
> blur), D7 (near-black wordmark + standardized `primary-600`/white badges), D8
> (no flag), plus `aria-current="page"` on the active tab and `h-16` nav height.

## Goal

Make the mobile **top bar** (`MobileTopBar.tsx`) and **bottom nav**
(`MobileNavigation.tsx`) read as one matched, grounded, native-feeling pair.
Kill the "AI / cluttered" feel that comes from white-on-white bars separated only
by a soft halo shadow, plus the half-committed "floating card island" styling
(rounded corners + side borders on an edge-to-edge bar).

The fix is a single coherent visual system:

> **Flush, solid-white system bars on a `gray-100` content surface, separated by a
> single soft `gray-200` hairline on the content-facing edge only. No rounded
> corners, no side borders, no halo shadow, no blur. Gold (`primary-*`) is the
> ONE accent: brand X mark, the active-tab sliding capsule, and count badges.
> Wordmark near-black.**

## Scope

In scope (8 files):

1. `src/components/MobileTopBar.tsx` - restyle + contextual title (D1, D3, D4, D5, D7)
2. `src/components/MobileNavigation.tsx` - restyle + gold capsule (D1, D3, D4, D6, D6b, D9)
3. `src/components/NotificationBell.tsx` - standardize the bell badge (D7)
4. `src/app/homeowner-dashboard/page.tsx` - surface flip + MobileTopBar wiring (D5, D8)
5. `src/app/manager-dashboard/page.tsx` - surface flip + MobileTopBar wiring (D5, D8)
6. `src/app/admin-dashboard/page.tsx` - surface flip + MobileTopBar wiring (D5, D8)
7. `src/app/cleaner-dashboard/page.tsx` - surface flip + MobileTopBar wiring (D5, D8)

Out of scope: desktop `TopBar` / sidebar, the notification sheet internals (only
its badge color changes), any data/query/realtime change. Pure client-side visual
refactor, no feature flag (D8).

Branch: `fix/mobile-nav-topbar-refresh` off `master`.

---

## Design tokens (single source of truth for this refresh)

| Token | Value | Used for |
|---|---|---|
| Content surface | `bg-gray-100` | mobile dashboard page background |
| Bar surface | `bg-white` (solid, no `/95`, no blur) | both bars |
| Hairline | `border-gray-200` | top bar `border-b`, bottom bar `border-t` only |
| Brand gold | `primary-600` (`#D9A718`) | X mark gold leg, count badges, active icon |
| Capsule fill | `primary-100` (`#FEF5D9`) | active-tab capsule background |
| Active text/icon | `primary-700` (`#B88914`) | active tab label + icon |
| Inactive text/icon | `gray-500` | inactive tab label + icon |
| Wordmark | `text-gray-900 font-bold text-lg` | "Nexxus" |
| Title | `text-base font-semibold text-gray-900` | contextual section title |

No new Tailwind config needed; every value above already exists.

---

## File 1: `MobileTopBar.tsx`

### 1a. Container restyle (D1, D3, D4)

Current:
```
md:hidden fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg
border-b border-x border-gray-200 rounded-b-2xl
shadow-[0_2px_12px_rgba(0,0,0,0.06)] pt-[env(safe-area-inset-top)]
```
Target:
```
md:hidden fixed top-0 left-0 right-0 z-40 bg-white
border-b border-gray-200 pt-[env(safe-area-inset-top)]
```
Removed: `bg-white/95`, `backdrop-blur-lg`, `border-x`, `rounded-b-2xl`,
`shadow-[...]`. Kept: `border-b border-gray-200` (single hairline), `z-40`, the
safe-area top inset, and the `sheetOpen ? "hidden" : ""` toggle (do NOT remove -
it keeps iOS from sampling the white bar for the status-bar safe-area tint when
the notification sheet is open; see the comment already in the file).

Inner row stays `flex items-center justify-between px-4 h-14`.

### 1b. Contextual title (D5) - new props

The top bar must show the **brand lockup on home**, and the **active tab's label
as a title on every other tab**. It currently has no idea what the active tab is,
so add props:

```ts
interface MobileTopBarProps {
  role: "homeowner" | "cleaner" | "manager" | "admin";
  onTabChange: (tabId: string) => void;
  onOpenAppointment?: (appointmentId: string, intent?: NotificationOpenIntent) => void;
  showNotifications?: boolean;
  // NEW:
  tabs: { id: string; label: string }[]; // same array passed to MobileNavigation
  activeTab: string;                       // same value passed to MobileNavigation
}
```

Derivation inside the component:
```ts
const isHome = tabs.length > 0 && activeTab === tabs[0].id;
const activeLabel = tabs.find(t => t.id === activeTab)?.label ?? "";
```

`isHome` uses `tabs[0].id` as the home/overview tab. **Open item to confirm during
implementation:** verify each role's first `mobileNavTabs` entry is its
overview/home tab (it is for the dashboards as built; confirm in the Playwright
pass). If any role's first tab is not "home", switch `isHome` to an explicit
`activeTab === "overview"`-style check for that role.

### 1c. Left zone render (D5, D7)

Layout stays 3-zone: `[ mark (+ wordmark | title) ] ........ [ bell ]`.

- The small X mark SVG (`w-8 h-8`, the gray `#C2C2C2` + gold `#D8A718` paths)
  **always renders** (white-label continuity).
- When `isHome`: render the wordmark next to the mark, but refined down from the
  current shout:
  - From: `text-xl font-extrabold tracking-tight text-primary-600`
  - To:   `text-lg font-bold tracking-tight text-gray-900`
  - Gold no longer lives in the wordmark; it survives only in the mark's gold leg.
- When NOT `isHome`: render the active section title instead of the wordmark:
  - `text-base font-semibold text-gray-900`, left-aligned, single line, `truncate`.

Sketch:
```tsx
<div className="flex items-center gap-2 min-w-0">
  <svg viewBox="0 0 64 64" className="w-8 h-8 shrink-0" aria-hidden="true">
    <path d="M8 8 L24 8 L40 32 L24 56 L8 56 L24 32 Z" fill="#C2C2C2" />
    <path d="M56 8 L40 8 L24 32 L40 56 L56 56 L40 32 Z" fill="#D8A718" />
  </svg>
  {isHome ? (
    <span className="text-lg font-bold tracking-tight text-gray-900">Nexxus</span>
  ) : (
    <h1 className="text-base font-semibold text-gray-900 truncate">{activeLabel}</h1>
  )}
</div>
```
`min-w-0` on the flex parent + `truncate` on the title so long labels don't shove
the bell off the row.

### 1d. Right zone (unchanged behavior)

`NotificationBell variant="sheet"` with the existing `onOpenChange={setSheetOpen}`
and `onOpenNotification` deep-link handlers. No change beyond the badge color,
which lives in `NotificationBell.tsx` (File 3).

### 1e. Header comment

Update the component's doc comment - it currently says the bar "mirrors the bottom
nav's visual language (translucent blur, rounded, soft shadow...)". Rewrite to
describe the new flush/solid/hairline language and the contextual-title behavior.

---

## File 2: `MobileNavigation.tsx`

### 2a. Container restyle (D1, D3, D4, D6b)

Current `<nav>`:
```
md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg
border-t border-x border-gray-200 z-40 rounded-t-2xl
shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]
```
Target `<nav>`:
```
md:hidden fixed bottom-0 left-0 right-0 bg-white
border-t border-gray-200 z-40 pb-[env(safe-area-inset-bottom)]
```
Removed: `bg-white/95`, `backdrop-blur-lg`, `border-x`, `rounded-t-2xl`,
`shadow-[...]`. Kept: `border-t border-gray-200`, `z-40`, bottom safe-area inset.

Inner container height (D6b, PROVISIONAL): `h-[5.125rem]` (82px) -> `h-16` (64px).
Keep `relative flex items-center justify-around px-2 py-2`. If 64px feels cramped
with icon + label in the Playwright pass, step back up (e.g. `h-[4.5rem]` / 72px).
Note this is the content row; the safe-area inset adds device padding below it.

### 2b. Active indicator -> sliding gold capsule (D6, D9)

**Keep the geometry-measuring apparatus.** The smooth slide the user explicitly
asked for (over a "chunky" fade) comes from animating one element's `left` as the
active tab changes - exactly what the current pill does. We reuse that mechanism
and only change *what gets rendered* and the measured *width*.

Changes to the measuring logic:
- The capsule is sized to the tab's icon+label box, not a fixed 28px. Replace the
  fixed `PILL_WIDTH` width with a measured width (the capsule should sit behind the
  icon; width ~= a square-ish `2.75rem`-`3rem` around the icon, or the full button
  width minus padding - decide visually). Simplest robust approach: capsule is a
  fixed-size rounded rect centered on the active tab (measure center `left` exactly
  as today; keep a constant `CAPSULE_WIDTH`/`CAPSULE_HEIGHT`). The existing
  center-math (`btnRect.left - parentRect.left + btnRect.width/2`) already gives the
  center; offset by half the capsule width.
- Vertically position the capsule behind the icon row (top-ish), not as a 3px
  underline. e.g. an absolutely-positioned rounded rect at the icon's vertical band.

Rendered capsule (replaces the 3px line span):
```tsx
<span
  aria-hidden
  className="absolute rounded-xl bg-primary-100 will-change-[left]"
  style={{
    left: `${pillStyle.left}px`,
    width: `${CAPSULE_WIDTH}px`,
    height: `${CAPSULE_HEIGHT}px`,
    top: `${CAPSULE_TOP}px`,      // align behind the icon band
    opacity: pillStyle.opacity,
    transition: `left ${SLIDE_MS}ms ${EASE}, opacity 200ms ease-out`,
  }}
/>
```

Active icon/label already go `primary-700` / `primary-600`; with the capsule behind
them this reads as a Material-style selected pill. Keep inactive `gray-500`.

### 2c. ROLLBACK marker (D6)

The user wants a one-line revert to the 3px pill. Do NOT delete the old styling -
leave it inline, commented, with a clear marker, so rollback = swap which
`className`/`style` block is live:

```tsx
{/* ROLLBACK: to restore the 3px sliding underline pill, render this instead of the capsule above:
    className="absolute bottom-1 h-[3px] rounded-full bg-primary-600 will-change-[left]"
    style={{ left, width: PILL_WIDTH, opacity, transition: `left ${SLIDE_MS}ms ${EASE}, opacity 200ms ease-out` }}
    (and set width back to PILL_WIDTH=28 in the measuring effects) */}
```
Keep `PILL_WIDTH` defined (referenced by the rollback note) or rename to
`CAPSULE_WIDTH` and mention the old value in the comment. Either way the revert is
mechanical and self-documented.

### 2d. Count badge (D7)

The nav count badge is already `bg-primary-600 text-white ... border-2 border-white`
- this is the canonical target. No change here; File 3 brings the bell badge into
line with it.

### 2e. a11y

Add `aria-current={isActive ? "page" : undefined}` to each tab button.

---

## File 3: `NotificationBell.tsx` (D7)

Single change: standardize the bell's unread badge to match the nav badge.

- From (around line 269): `bg-primary-500 text-gray-900 ... border-2 border-white`
- To: `bg-primary-600 text-white ... border-2 border-white`

Do this for the badge in **both** variants if the dropdown (desktop) badge shares
the style - check both `variant="sheet"` and `variant="dropdown"` render paths and
make them consistent. Nothing else in this component changes.

---

## Files 4-7: the four dashboard pages (D5, D8)

Each role dashboard needs two edits.

### 4-7a. Surface flip (D8)

Flip the mobile page background off pure white so the white bars separate by tone:
- From: `min-h-screen bg-white md:bg-gray-100`
- To:   `min-h-screen bg-gray-100`

Approx lines (verify before editing - file has shifted):
- `homeowner-dashboard/page.tsx`: ~363
- `manager-dashboard/page.tsx`: ~994
- `admin-dashboard/page.tsx`: ~830
- `cleaner-dashboard/page.tsx`: ~1693

Also flip any **loading / auth spinner** screen in the same file that uses
`bg-white md:bg-gray-100`, so there's no white flash before content paints
(lean: yes). Grep each file for `bg-white md:bg-gray-100` and flip all matches.

### 4-7b. Wire MobileTopBar's new props (D5)

`MobileNavigation` already receives `tabs={mobileNavTabs}` and `activeTab={activeTab}`
in all four. `MobileTopBar` currently does not. Add the same two props to each
`<MobileTopBar ... />` call site:

```tsx
<MobileTopBar
  role={...}
  onTabChange={setActiveTab}
  onOpenAppointment={...}
  showNotifications={...}   // admin keeps {!impersonatingOrgId}
  tabs={mobileNavTabs}       // NEW
  activeTab={activeTab}      // NEW
/>
```

Approx `<MobileTopBar` lines: homeowner ~420, manager ~1059, admin ~890,
cleaner ~1736. Admin's existing `showNotifications={!impersonatingOrgId}` stays.

---

## Verification plan (Playwright MCP, mobile viewport)

Run `npm run dev`, drive the Playwright MCP browser at a phone viewport
(e.g. 390x844, iPhone-ish). For **each of the 4 roles**:

1. Land on the dashboard. Confirm:
   - Page surface is gray-100; both bars are solid white and read as raised by tone.
   - No rounded corners, no side borders, no halo shadow on either bar.
   - Top bar on the home tab shows the X mark + near-black "Nexxus" wordmark.
2. Switch tabs across all visible nav tabs. Confirm:
   - Top bar title swaps to the active tab's label (left-aligned), mark persists.
   - The gold capsule slides smoothly under the active icon (no chunky fade);
     active icon/label are gold, inactive are gray.
   - `aria-current="page"` is on the active tab (snapshot/aria check).
3. Open the notification bell. Confirm:
   - Top bar hides (status-bar safe area shows the sheet's grey backdrop, not white).
   - The bell badge is gold-on-white (matches the nav count badge), not the old
     `primary-500`/`gray-900`.
4. Take a screenshot per role x a couple of tabs for the PR.

Also: `npx tsc --noEmit` and `npm run lint` clean for the touched files (new props
typed; no unused `PILL_WIDTH` lint error - keep it referenced or rename per 2c).

Then the standard gates before PR: `npm run test`, `npx tsc --noEmit`, `npm run lint`.

## Acceptance criteria

- [ ] Both bars: solid `bg-white`, no blur, no rounded corners, no `border-x`, no
      custom shadow; exactly one `gray-200` hairline each on the content-facing edge.
- [ ] All 4 mobile dashboards render on `bg-gray-100` (no white-flash loading screen).
- [ ] Top bar shows brand lockup on the home tab and the active section title
      (left-aligned, truncating) on every other tab, across all 4 roles.
- [ ] Wordmark is `text-gray-900 font-bold text-lg`; gold remains only in the X
      mark, the active capsule, and the count badges.
- [ ] Active nav tab shows a `primary-100` capsule that slides smoothly between
      tabs; the 3px-pill code survives as a commented `// ROLLBACK:` block.
- [ ] Bottom nav height is `h-16` (or the vetoed-up value) and icons+labels are
      not cramped.
- [ ] Bell badge and nav badge are identical (`bg-primary-600 text-white` + white ring).
- [ ] `aria-current="page"` on the active tab.
- [ ] Notification sheet still hides the top bar (iOS safe-area tint correct).
- [ ] tsc + lint + tests green; Playwright screenshots attached to the PR.

## Rollback notes

- **Capsule -> pill:** swap the live capsule `className`/`style` for the commented
  `// ROLLBACK:` block in `MobileNavigation.tsx` (2c) and restore the constant
  width. One-element change, no logic rewrite.
- **Gray surface -> white:** revert the four dashboard background lines back to
  `bg-white md:bg-gray-100`. The bars still work on white (they'll just lean on the
  hairline alone for separation). Reversible by design (D2).
- The whole refactor is one branch / one PR, no feature flag, so a full revert is a
  single `git revert` of the merge.

## Open items to resolve during implementation (non-blocking)

- Confirm each role's first `mobileNavTabs` entry is the overview/home tab (drives
  `isHome`); fall back to an explicit id check per role if not.
- Final capsule dimensions + radius (`rounded-xl` band behind the icon vs a taller
  pill behind icon+label) - decide visually in the Playwright pass.
- Confirm `h-16` (64px) is comfortable; step up toward 72px if cramped (D6b is
  provisional / vetoable).
- Decide whether the top bar's hairline becomes scroll-aware later (appears on
  scroll). Out of scope for this pass; bottom-bar hairline is always on.
