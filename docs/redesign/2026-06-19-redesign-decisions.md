# Nexxus Redesign — Design System & Decisions Log

> Living doc for the from-scratch dashboard redesign. Pairs with `2026-06-19-dashboard-functional-inventory.md` (what the app does). This file = the design rules + locked decisions. Updated as each decision is made during brainstorming.

## Locked visual identity (from the merged foundation, PR #78)
Do NOT re-pick these — they are set and shipped.
- **Brand:** electric blue `#0150FC` (brand-600).
- **Type:** Plus Jakarta Sans (`--font-sans`, scoped via `.redesign`).
- **Canvas:** warm-gray (tentative warm/slate/neutral toggle exists).
- **Shape:** pillowy radius (`rounded-chip/control/field/card/pill`).
- **Elevation:** soft shadows (`shadow-soft-sm/md/lg`).
- **Themes:** light + dark, both AA.
- **Primitives:** ~30 owned shadcn/Radix components in `src/components/ui/`. Build screens on these.

## Build strategy (confirmed)
- Four distinct **experiences**, not four dashboards: **Operator** (admin+manager, one permissioned design), **Cleaner field app**, **Homeowner app**, **Platform back-office** (`/owner`).
- Reuse the existing **headless data hooks** (`useAdminData`, `useCleanerData`, mutations, realtime) — rebuild the **view layer only**. Legacy stays fully live until the whole new UI is done; wire backend + delete legacy at the end.
- Sequence: quick **direction pass for all** experiences → then **build Operator first** (most complex + the pre-sell demo) → replicate patterns to the others.

## Build architecture — DECIDED (Approach B) ✅
New UI runs in parallel with the live legacy app via a flag-gated `(redesign)` route group. **Legacy files are never edited.**
- **Route group:** `src/app/(redesign)/layout.tsx` applies `<ThemeProvider><div className="redesign font-jakarta min-h-screen">` + a `(dev)`-style `export const dynamic = 'force-dynamic'` + `notFound()` production gate (kept during the build so half-built screens never leak). **Do NOT re-wrap AuthProvider/QueryClientProvider** — they come from the root `LayoutWrapper` (re-wrapping splits the cache/auth).
- **Paths:** group name strips from the URL, so new screens use a distinct prefix to avoid colliding with legacy routes, e.g. **`/app/{role}-dashboard`**. Promoted/renamed at cutover.
- **Components:** new presentational components in **`src/components/redesign/`**, built on `src/components/ui/` primitives. Legacy `src/components/` untouched.
- **Flag:** `src/lib/redesign/flags.ts` → `redesignUiEnabled()` reads `NEXT_PUBLIC_REDESIGN_ENABLED === "true"`. `getDashboardPath` in `src/app/login/page.tsx` prepends `/app` when on (keep the `/owner` short-circuit first). Default `false` (prod/test), `true` in dev + a redesign-preview env.
- **Data:** reuse existing **headless hooks unchanged** (shared `QueryClient` → cache + realtime coherence for free). No backend changes.
- **Branch:** fresh feature branch off **current master** (PR #78 merged, so master has tokens + 30+ primitives + `/ui-kit`). Carry the redesign docs onto it; cut per-screen branches via the normal PR flow.
- **Cutover:** flip the flag in prod → verify → one PR deletes legacy `{role}-dashboard` + legacy components, promotes `/app/*`, removes the gate, adds legacy→`/app` redirects.
- **Gotchas:** never re-instantiate QueryClient/Auth in the group layout; portaled overlays need `.redesign-overlay` (kit handles it) — validate the custom toast early; preview/E2E need Supabase env + a logged-in session; map cross-boundary links so links into not-yet-built screens fall back to legacy; keep the URL-param contract (`?service`, `?appointment`, `?checklists`) identical so deep links survive cutover.
- Full investigation: temp synthesis (this session); to be folded into the design spec.

## How these decisions are captured (build-fidelity system)
Three layers, so the eventual build looks like what was approved in the visual companion:
1. **This decisions doc** — written intent: IA, navigation, layout, per-experience vibe + the rules below. Source of truth for *what goes where and why*.
2. **Approved mockups** — `docs/redesign/mockups/*.html`, copied out of the gitignored brainstorm session so they're versioned and openable in any browser. Current set: `operator-desktop-shell`, `operator-mobile-shell`, `cleaner-shell`, `homeowner-shell`. **Intentionally low-fidelity wireframes**: they lock LAYOUT + STRUCTURE + behavior, not final pixels. Final polish comes from the real primitive kit.
3. **Build-time fidelity loop** — when each real screen is built on the primitives in the `(redesign)` tree, screenshot it with Playwright MCP, compare side-by-side to its mockup, iterate with `ui-ux-pro-max` review until it matches, then lock. This is the actual guarantee of "looks identical."

**Bridge step:** the first build task is to reproduce the **operator shell + Overview on the real primitives** (not wireframe divs). That becomes the canonical visual reference every other screen copies, so fidelity compounds instead of drifting. The final design spec (`docs/superpowers/specs/...`) ties decisions → mockup → primitives per screen.

## `ui-ux-pro-max` rules we enforce (non-conflicting subset)
The skill classified the Operator console as a **data-dense dashboard** (space-efficient KPI cards + tables + status colors + filtering). We adopt its UX rules but **override** its style picks (it suggested navy + Fira fonts; we keep our locked identity).
- SVG icons only (Lucide), one consistent set; never emoji.
- Hover/press transitions 150–300ms; respect `prefers-reduced-motion`.
- AA contrast (4.5:1 text) in **both** themes; never color-as-only-signal (status = icon/text + color).
- Visible focus rings; keyboard nav order = visual order.
- Touch targets ≥44px; bottom nav ≤5 items, icon **and** label.
- Adaptive nav: sidebar on desktop, bottom nav + drawer on mobile. Drawer = **secondary** nav only; primary stays on the bottom bar.
- Always provide filtering/search on list/table views; row-hover highlight; tooltips on data.
- Reserve space for async content (no layout shift); skeletons for >300ms loads.
- Tables: horizontal-scroll wrapper or card layout on mobile; tabular figures for money/times.
- Test at 375 / 768 / 1024 / 1440.

## Locked decisions

### Operator console — shell (DESKTOP) ✅
- Full-height left **rail owns the brand**: collapsed = Nexxus mark only; **hover expands** the rail to the full horizontal lockup (mark + "Nexxus") and reveals nav labels. No divider between brand and nav — one clean surface.
- Rail destinations: Overview, Bookings, Customers, Cleaners & team, Services, Payments & payouts, Analytics, Messages, **Settings pinned at bottom**.
- **Top bar** (right of rail): global search, **New booking** (primary), notification bell, profile.
- **Overview** = compact KPI strip (Today's jobs / In progress / Awaiting approval / Revenue this month) + **"Needs you now" triage queue as the centerpiece** (grouped: Unassigned, All cleaners declined, Counter-proposed; inline Assign/Force-assign/Review) + **Today's schedule / Active Now dispatch column** on the right.

### Operator console — shell (MOBILE) ✅
- **Bottom tab bar** = daily loop: Overview, Bookings, People, Messages + a **Menu** tab.
- **Menu** opens the **full rail as a drawer**, grouped **Primary** (Overview/Bookings/People/Messages) + **More** (Services, Payments & payouts, Analytics, Settings). Nothing buried.
- **New booking** = FAB. Detail views = full-screen sheets (per functional inventory mobile patterns).

### Cleaner field app — shell ✅
- Phone-first; same brand/primitives but **bigger touch targets (44–50px)**, single column, action-forward.
- Home is **offer-first**: pending job offer at top with live SLA countdown + big **Accept / Propose / Decline**.
- One full-width **Start job** primary → in-job flow (before photos → checklist → after photos → complete) opens full-screen.
- This week's **earnings** glanceable from home.
- Bottom nav: Home, Jobs, Earnings, Messages + **Menu** (Services read-only, Settings). **No New-booking FAB** (cleaner doesn't create work).
- Desktop = simplified version of the rail shell; the phone is the source of truth.

### Homeowner app — shell ✅
- **Consumer app** vibe: warm, calm, reassuring; softer canvas, friendly greeting, rounded hero with the brand gradient. Not enterprise.
- Home centerpiece = **"Your next cleaning" reassurance hero** (date, service, cleaner face, status pill).
- **One creation action**: "Request a cleaning" (clear button + persistent FAB) — the only thing a homeowner makes.
- Status, not management: pending requests + history as glanceable cards; no tables/triage.
- Bottom nav: Home, Cleanings, Messages, Account. Properties, payment methods, payment history, browse-services live under **Account**.

### Platform back-office — shell ✅
- Utilitarian internal tool, **desktop-only, data-dense**; reuses the operator's table/stat-card language (no consumer vibe).
- Platform Overview = 4 stat cards (Total / Active / Trialing / Payments-ready) + filterable **tenant table** with status badges (plan + Stripe readiness), tabular figures, row-hover.
- Minimal nav: top bar (search + **Provision tenant** + profile). The app is essentially "tenant table + drill-down."
- Org-detail drill: tabs Overview / Team / Financials / Settings + **View As** (audited read-only impersonation), Stripe reset, delete.

## Open IA decisions still to resolve (from inventory §7)
Messages placement (now: a primary destination across all roles); Settings as drawer/rail destination vs separate route (now: a rail/drawer destination, not a parallel tree); unify "Team Members" + "Cleaner Management" into one People surface with role facets (TBD); disputes/invoicing homes; charge-flow representation; self-pay as first-class mode; full Action-Center taxonomy.
