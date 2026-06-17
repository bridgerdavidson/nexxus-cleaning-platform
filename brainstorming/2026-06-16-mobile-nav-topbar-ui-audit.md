# Mobile nav bottom bar + top bar - UI audit brainstorming session (2026-06-16)

Status: done (Q&A complete; implementation spec written to specs/mobile-nav-topbar-refresh.md)

## Context / the complaint

Bridger wants a UI audit of the **mobile bottom navigation bar** (`MobileNavigation.tsx`) and
the **mobile top bar** (logo + notification bell, `MobileTopBar.tsx`). His instinct: the two bars
"clash," feel cluttered, the drop shadow "gives AI," and he wants a cleaner, more solid, more
unified piece that still feels native-ish while staying on-brand. He attached a mockup + screenshot
(not visible to Claude this session; grill proceeded from the code).

## Audit findings (from the code, before grilling)

Both bars share a near-identical recipe:
- **Top** (`MobileTopBar.tsx:39-43`): `md:hidden fixed top-0`, `bg-white/95 backdrop-blur-lg`,
  `border-b border-x border-gray-200`, `rounded-b-2xl`, `shadow-[0_2px_12px_rgba(0,0,0,0.06)]`,
  `pt-[env(safe-area-inset-top)]`, height `h-14` (56px). Left: inline X mark (gray `#C2C2C2` +
  gold `#D8A718`) + "Nexxus" wordmark `text-primary-600 font-extrabold`. Right: NotificationBell (sheet).
- **Bottom** (`MobileNavigation.tsx:82-86`): `md:hidden fixed bottom-0`, `bg-white/95 backdrop-blur-lg`,
  `border-t border-x border-gray-200`, `rounded-t-2xl`, `shadow-[0_-2px_12px_rgba(0,0,0,0.06)]`,
  `pb-[env(safe-area-inset-bottom)]`, container `h-[5.125rem]` (82px). 4 tabs + Menu. Active indicator =
  3px gold sliding pill under the active icon. Icons 22px strokeWidth 1.75; labels 12px.

Root issues identified:
1. **White-on-white.** Mobile dashboards are `min-h-screen bg-white md:bg-gray-100` - the gray surface
   only appears at desktop. On mobile the page behind the bars is pure white, same as the bars.
2. **Half-committed metaphor.** Rounded corners + `border-x` (side borders) say "floating card island,"
   but the bar spans edge-to-edge touching the screen sides, which says "flush system bar." Neither wins.
3. **Shadow does all the work.** With no tonal background, the soft directional shadow is the only
   separator, so it reads as a halo / clutter rather than depth.
4. **Deviates from `.card`.** The app's own card convention is `rounded-xl` + `shadow-sm` + 4-side border;
   the bars use `rounded-2xl` + a custom shadow + 3-side border, so they don't even match the rest of the app.

Design-system anchors to stay native: brand gold = `primary-600`; surfaces `gray-50`/`gray-100`;
borders `gray-200`; `.card` = `bg-white rounded-xl border border-gray-200 shadow-sm`.

## Q&A

1. Q: Which visual metaphor do we commit to - (A) flush/native system bars,
   (B) floating pill islands, or (C) hybrid (flush top + floating bottom)?
   A: **A - flush / native system bars.** Edge-to-edge, no rounded corners, no
   side borders, no halo shadow. Separation via hairline + tone, not depth.

2. Q: How do the bars separate from content now the shadow is gone -
   (A) both white + hairline only, (B) white bars on a gray content surface
   (tonal separation, matches desktop), or (C) tinted bars on white?
   A: **B.** Try the gray content surface. Reversible - "if I don't like it we
   can always switch." OK with the mobile-bg change rippling across all 4 dashboards.

3. Q: gray-50 vs gray-100 for the surface; and soft hairline vs no hairline?
   A: Asked Claude to choose on the hairline. Decision: **gray-100 surface + a
   single soft gray-200 hairline on the content-facing edge of each bar.**
   Rationale: the "clutter" was the 12px blur shadow halo, not a thin line; a
   single crisp hairline is craft, and it insures the bottom nav's top edge stays
   legible when the ~3% white/gray-100 tonal edge washes out (bright screen/outdoors).

4. Q: Keep the frosted `bg-white/95 backdrop-blur-lg` material, or go solid?
   A: **Solid white.** Drop the blur entirely.

5. Q: Top bar = pure brand strip (A), contextual section title (B), or brand on
   home + title elsewhere (C)?
   A: **C.** `Nexxus` brand on the home/overview tab; the active section's title
   ("Bookings", "Messages", etc.) on every other tab. Small brand mark stays for
   white-label continuity.

6. Q: (1) Trim bottom-bar height to ~64px? (2) Active indicator - B (iOS tint-only)
   or C (Material gold capsule)?
   A: **C - gold capsule.** AND: leave the existing sliding-pill code COMMENTED OUT
   (not deleted) so we can revert to it easily if the capsule doesn't land.
   (Height: not answered; Claude provisionally trimming to ~64px / h-16, vetoable.)

7. Q: (1) Standardize the bell badge to `primary-600`/white to match the nav
   badge? (2) Wordmark near-black with gold only in the mark, or keep it gold?
   A: **(1) yes. (2) go with near-black wordmark.**

8. Q: (1) Apply gray-100 to all 4 dashboards? (2) No feature flag, just branch +
   Playwright + PR? (3) Any white-heavy screen to scrutinize on the flip?
   A: **(1) yes, all four. (2) no feature flag. (3) nothing specific.**

9. Q: (1) Capsule motion - per-tab fade (simpler) or sliding shared capsule
   (smoother)? (2) Title alignment - left or center?
   A: **(1) Sliding capsule** - wants tab-switch to feel smooth; fade would feel
   "chunky." **(2) Left-aligned title.**

## Decisions

- **D9: Sliding gold capsule + left title.** KEEP the geometry-measuring apparatus
  (`useLayoutEffect` + resize effect) - tabs are equal-width so only `left`
  animates (smooth slide, same mechanism as the old pill). Render a rounded
  `primary-100` capsule sized to the active tab's box instead of the 3px line.
  "ROLLBACK to pill" = swap the rendered element's class back to the 3px line
  (commented inline), NOT restore deleted code. Contextual title left-aligned next
  to the small mark.
- **D8: Rollout.** Restyle shared `MobileTopBar` + `MobileNavigation` (auto-covers
  all 4 roles); flip each dashboard wrapper `min-h-screen bg-white md:bg-gray-100`
  -> `min-h-screen bg-gray-100` (4 files). No feature flag. Branch
  `fix/mobile-nav-topbar-refresh` off master. Verify with Playwright MCP at a
  mobile viewport across all 4 dashboards x their tabs before opening the PR.
- **D7: Gold = one intentional system** (brand mark + active capsule + alerts),
  not scattered. (a) Standardize BOTH count badges to `bg-primary-600 text-white`
  + white ring (the bell badge changes from `primary-500`/`gray-900`). (b) Wordmark
  -> `text-gray-900 font-bold text-lg` (down from `text-xl font-extrabold
  text-primary-600`); gold survives only in the X mark, the active capsule, and badges.
- **D6: Active tab = Material-style gold capsule.** A soft `primary-100` rounded
  capsule behind the active icon; active icon + label go `primary-700`, inactive
  stay `gray-500`. The slide motion can carry to the capsule. **Keep the current
  sliding-pill implementation (PILL_WIDTH / pillStyle / useLayoutEffect + resize
  effect / the `<span>` pill) COMMENTED OUT with a clear `// ROLLBACK:` marker**
  so it can be restored without rewriting.
- **D6b: Bottom-bar height** trimmed from `h-[5.125rem]` (82px) to ~`h-16` (64px)
  content row + `pb-[env(safe-area-inset-bottom)]`. PROVISIONAL - user may veto.
- **D5: Top bar content = option C.** Brand lockup (mark + "Nexxus" wordmark) on
  the home/overview tab; on all other tabs show the active tab's LABEL as a title
  with the small mark retained on the left, bell on the right. Wiring: pass
  `activeTab` (+ resolve its label, + an `isHome` check = first/overview tab) into
  MobileTopBar. Refine the wordmark so it stops shouting (lighter than current
  `text-xl font-extrabold`). 3-zone layout: [mark (+title)] ........ [bell].
- **D4: Solid `bg-white` bars, no `backdrop-blur`.** Opaque planes; removes the
  near-invisible (on a gray surface) blur + its GPU/jank cost; predictable iOS
  safe-area tint.
- **D3: Surface = `gray-100`** (exact desktop value) **+ one soft `gray-200`
  hairline per bar on the content-facing edge** (top bar `border-b`, bottom bar
  `border-t`). No side borders, no shadow, no rounded corners. Possible later
  upgrade: make the TOP bar's hairline scroll-aware (appears on scroll); bottom
  bar keeps its hairline always.
- **D2: Tonal separation (option B).** Flip the mobile page surface off pure white
  to a gray (shade TBD in Q3), keep the bars white so they read as raised by TONE,
  not by shadow. Brings mobile in line with desktop's existing `md:bg-gray-100`.
  Reversible by design - revisit if it feels off in the Playwright pass.
- **D1: Flush / native metaphor.** Remove `rounded-b/t-2xl`, remove `border-x`
  (side borders), remove the custom `shadow-[...]` halo on both bars. Bars span
  edge-to-edge and anchor to the screen edges like a real iOS/Android system bar.

## Open questions / to resolve during implementation (not blocking)

- Confirm each role's FIRST tab IS the overview/home tab, so `isHome = activeTab
  === tabs[0].id` correctly drives brand-vs-title in the top bar.
- Exact capsule dimensions + radius (sized to active tab box, `rounded-xl`-ish).
- Whether to also flip the loading/auth spinner screens (`bg-white md:bg-gray-100`)
  to `bg-gray-100` so there's no white flash before content loads (lean: yes).
- Height trim to ~64px (`h-16`) is provisional - confirm visually in the Playwright
  pass; revert toward 82px if icons+labels feel cramped.
- Title typography (lean: `text-base font-semibold text-gray-900`).
- a11y: `aria-current="page"` on the active tab; the top-bar title as the bar heading.

## App-wide visual system (the through-line, for reference)

Flush, solid-white system bars on a `gray-100` content surface, separated by a
single soft `gray-200` hairline (content-facing edge only). No rounded corners,
no side borders, no halo shadow, no blur. Gold (`primary-*`) is the ONE accent:
brand X mark, active-tab sliding capsule, count badges. Wordmark near-black.
Result: top + bottom read as one matched, grounded, native-feeling pair.
