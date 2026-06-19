# Dashboard Redesign — Design Spec

**Date:** 2026-06-19 · **Status:** design approved (direction + architecture); pending user spec review → implementation plan.

## Context
The current Nexxus UI grew organically; its information architecture and visual organization were never intentionally designed. The redesign **foundation** (design tokens + ~30 owned shadcn/Radix primitives + `/ui-kit` gallery) shipped to master in PR #78. This spec covers the next phase: redesigning the actual **screens** from scratch on that foundation — without letting the legacy UI anchor the new design — and shipping it in parallel with a live legacy app until a single cutover.

The redesign is the hard gate (milestone #4) before marketing to paying cleaning companies, so the **Operator console is the priority** (it's what gets demoed and pre-sold).

Companion detail docs (read alongside this spec):
- `docs/redesign/2026-06-19-dashboard-functional-inventory.md` — what every surface *does* (jobs, data, actions, states, state machines). The design-input, function only.
- `docs/redesign/2026-06-19-redesign-decisions.md` — living decisions log: locked identity, enforced `ui-ux-pro-max` rules, per-experience shell decisions, build architecture, capture system.
- `docs/redesign/mockups/*.html` — the approved wireframes (operator desktop + mobile, cleaner, homeowner, platform).

## Goals
- Redesign all four **experiences** on the new primitive kit: **Operator** (admin+manager, one permissioned design), **Cleaner field app**, **Homeowner app**, **Platform back-office**.
- Build the new UI **in parallel** with a 100%-live legacy app; **reuse the existing headless data hooks** (no backend rework); **single cutover** deletes legacy at the end.
- Each built screen is **screenshot-matched** to its approved direction before it's considered done.

## Non-goals
- No backend / API / schema changes (hooks are reused unchanged).
- No new business logic or features in this phase (view layer only). Deferred product gaps (invoicing, disputes UI, microdeposits) are out of scope unless explicitly pulled in.
- Not re-picking the visual identity — tokens/fonts/canvas/shadows are locked from the foundation.

## The four experiences (locked direction)
Summaries; full detail in the decisions log.
- **Operator console (admin + manager):** data-dense triage cockpit. Desktop = full-height brand rail (mark → lockup on hover) + top bar (search / New booking / bell / profile) + Overview = KPI strip + **"Needs you now"** triage queue centerpiece + Today/Active dispatch column. Mobile = bottom tabs (Overview/Bookings/People/Messages) + Menu→full-rail drawer + New-booking FAB. Manager = same design behind 15 permission flags.
- **Cleaner field app:** phone-first, big touch targets, action-forward. Offer-first home (Accept/Propose/Decline w/ SLA), full-width Start-job → in-job flow, glanceable earnings. Bottom nav: Home/Jobs/Earnings/Messages/Menu.
- **Homeowner app:** warm consumer app. "Your next cleaning" reassurance hero; one creation action (Request a cleaning, button + FAB); status not management. Bottom nav: Home/Cleanings/Messages/Account.
- **Platform back-office (`/owner`):** utilitarian internal tool; stat cards + filterable tenant table + org drill-down (View As, Stripe reset). Desktop-only; reuses operator data-dense language.

## Build architecture (decided — Approach B)
Flag-gated `(redesign)` route group; legacy never edited; hooks reused; single cutover. Full detail + first-scaffolding steps + gotchas in the decisions log ("Build architecture — DECIDED"). Key points:
- `src/app/(redesign)/layout.tsx` applies `.redesign font-jakarta` + `ThemeProvider` + a `(dev)`-style `notFound()` prod gate (kept during build). Does **not** re-wrap AuthProvider/QueryClientProvider.
- New screens at `/app/{role}-dashboard` (distinct prefix, avoids legacy route collision; promoted at cutover). New components in `src/components/redesign/`.
- `NEXT_PUBLIC_REDESIGN_ENABLED` flips the `getDashboardPath` redirect in `login/page.tsx`.
- Fresh feature branch off current master.

## Build order
1. **Operator shell + Overview** on real primitives — the canonical, screenshot-matched **reference screen**. Establishes the rail, top bar, mobile shell, KPI/queue/dispatch composition, and the `(redesign)` scaffolding (group layout, flag, components dir). Everything else copies these patterns.
2. Remaining operator screens (Bookings list+calendar, Appointment detail panel, Customers, Properties, Services/Checklists, People/Cleaners, Payments/Payouts, Analytics, Messages) — reusing shared surfaces.
3. Cleaner field app (home → jobs → in-job flow → earnings).
4. Homeowner app (home → request flow → cleanings → account).
5. Platform back-office (overview table → org drill-down).
6. **Cutover:** flip flag in prod, verify, delete legacy + promote `/app/*` + add redirects (one PR).

Each screen is its own feature branch + PR through the normal CI/preview/E2E flow.

## Fidelity & acceptance criteria (per screen)
- Built on `src/components/ui/` primitives + locked tokens; no ad-hoc hex/fonts.
- Consumes the existing hook(s) unchanged; no backend edits.
- Matches its approved mockup's layout/structure/behavior; verified by Playwright MCP screenshot vs mockup, iterated with `ui-ux-pro-max` review until seamless.
- Passes the enforced rules (decisions log): SVG icons, 150–300ms transitions, AA both themes, focus rings, ≥44px touch targets, filtering on lists, reduced-motion, responsive at 375/768/1024/1440.
- Legacy untouched; new screen reachable only behind the flag/gate.

## Verification
- `npx tsc --noEmit`, `npm run lint`, `npm run test` (CI gates).
- Playwright MCP: navigate the `(redesign)` screen on local dev (flag on, logged in), screenshot desktop + mobile widths, compare to mockup.
- Codex pre-push review per feature branch (per CLAUDE.md).

## Open IA decisions to resolve during build (from inventory §7)
Messages as a primary destination across roles (decided); Settings as a rail/drawer destination vs separate route; unify "Team Members" + "Cleaner Management" into one People surface with role facets; homes for disputes/invoicing; charge-flow representation (new flow primary); self-pay as a first-class mode; full Action-Center taxonomy; per-permission KPI matrix for managers. Resolve each as its screen is designed; record in the decisions log.

## Risks
See decisions log "Gotchas": don't re-instantiate QueryClient/Auth in the group layout; portal overlays need `.redesign-overlay` (validate custom toast early); preview/E2E need Supabase env + a session; cross-boundary links must fall back to legacy during rollout; keep URL-param contract identical for deep-link survival.
