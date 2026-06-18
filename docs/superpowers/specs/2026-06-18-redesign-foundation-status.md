# Redesign Foundation — Build Status (for fresh sessions)

**Date:** 2026-06-18
**Status:** Phase 0 + Phase 1 **COMPLETE and pushed.** PR **#78** open to `master` (not merged).
**Branch:** `feat/redesign-tokens-primitive-kit` (built in a git worktree under `.claude/worktrees/redesign-tokens-kit`).
**Spec:** `docs/superpowers/specs/2026-06-17-redesign-tokens-primitive-kit-design.md`
**Plan:** `docs/superpowers/plans/2026-06-18-redesign-tokens-primitive-kit-plan.md`
**Parent strategy:** `docs/superpowers/specs/2026-06-08-ui-redesign-strategy-design.md` (Approach 3, foundation-first) — lives on branch `docs/ui-redesign-strategy`.

> If you are a fresh session: the design tokens + primitive kit are **already built and reviewed**. The plan's checkbox steps were tracked in the worktree SDD ledger, not ticked in the plan file, so do **not** assume "unchecked = not done." This doc is the source of truth for what exists.

---

## What was built (all done, in the worktree branch)

**Design tokens (light + dark)** — `src/app/globals.css` (`:root` / `.dark` blocks) + an **additive** Tailwind extension in `tailwind.config.js`:
- Brand: electric blue `#0150FC` (brand-600) + sky accent `#68B6FA`. Warm-gray neutral canvas. Plus Jakarta Sans (`--font-sans`, scoped via a `.redesign` class — NOT applied globally, so legacy Inter stays).
- Pillowy radius keys `rounded-chip/control/field/card/pill`; soft shadows `shadow-soft-sm/md/lg` (theme-aware via `--shadow-rgb`); motion tokens; status ramps `positive/caution/critical/info`; shadcn semantic vars (`background/foreground/card/popover/primary/secondary/muted/accent/border/input/ring/destructive`) as `hsl(var(--x))`.

**Primitive kit** — 30+ owned components in `src/components/ui/` (shadcn/Radix, restyled to our tokens; we own every file):
Button, IconButton, Input, Textarea, Label, FormField, Select, Checkbox, RadioGroup, Switch, Calendar, DatePicker, Card, Badge, StatusPill, Avatar, StatTile, Table, Tooltip, Separator, Skeleton, EmptyState, Dialog, Sheet, DropdownMenu, Popover, ConfirmDialog, Tabs, SegmentedControl, Breadcrumb, Pagination, Toast (custom), Logo (theme-aware), plus `theme-provider`, `theme-toggle`, `canvas-toggle`, and `cn()` in `src/lib/utils.ts`.

**Gallery** — dev/preview-only `/ui-kit` route (`src/app/(dev)/ui-kit/`): every component in every state, grouped by category, with a **light/dark toggle** and a **3-way canvas-temperature toggle** (warm / slate / neutral) for team review.

---

## Key decisions made (locked unless noted)

- **Additive coexistence (do not break this):** legacy Tailwind `primary` (yellow), `secondary` (slate), `success` ramps keep all shades; we only ADDED `DEFAULT`/`foreground` to `primary`/`secondary`. Default `rounded-*`/`shadow-*` and the global `--font-inter` are untouched. No legacy component, route, or data-layer file was modified.
- **Theming:** `next-themes` (class strategy, `.dark` on `<html>`). The redesign font + canvas apply only inside the `.redesign` scope (and `.redesign-overlay` for portaled overlays).
- **Accessibility:** 0 WCAG AA contrast violations in BOTH themes (automated audit). To reach AA, these previously-locked colors were **darkened** (user approved): `--destructive` `#E5484D`→`#DC2626`; `positive-700` `#12814A`→`#0F7042`; `caution-700` `#B4740B`→`#9A6300`. Error/link/StatTile-trend text is theme-aware.
- **Canvas temperature is still tentative.** The warm-gray default can change; the `data-canvas` toggle exists so the team can compare warm vs slate vs neutral live before deciding.
- **Production gating:** `/ui-kit` is **dev + Vercel preview only**. `src/app/(dev)/layout.tsx` returns `notFound()` when `VERCEL_ENV === 'production'`. It is never reachable by production users. (The tokens/primitives do ship to prod but are inert — no production screen imports them yet.)

---

## How to see it

- **Local:** `npm run dev`, open `http://localhost:3000/ui-kit`. Toggle light/dark and warm/slate/neutral.
- **Preview:** the PR's Vercel preview URL serves `/ui-kit` (VERCEL_ENV=preview). Best surface for team show-and-tell.

---

## Open items / follow-ups (non-blocking)

1. **Toast trigger (the one real bug):** the custom toast (`src/components/ui/toast.tsx`, store anchored on `globalThis`) RENDERS correctly and is styled (soft white card + colored icon chip, top-right) — confirmed by injecting a toast directly into the store. BUT the gallery's toast **buttons** do not update the store in local Turbopack dev (store stays empty after click, no console error; direct injection works; the `<Toaster>` is mounted + subscribed). sonner was tried first and rendered nothing at all in this app (React 19), which is why it was replaced. **Verify on the preview deploy** (a production build may dedupe the module that's getting split in dev). If it still fails: split the store into a plain non-component module (`toast-store.ts`) + a `toaster.tsx` component, or expose `toast` via React context from the Toaster.
2. **Minor polish:** `CardTitle`/`CardDescription` could use semantic `<h3>`/`<p>`; add a `noPadding` prop to the `Specimen` gallery helper (Table needed a local flush wrapper); dark-mode status badges use light `-50` tints on the dark canvas (AA-compliant but a light-on-dark look — consider dark-specific tint vars).
3. **Doc hygiene:** commit `f9b7612`'s message overclaims a `turbopack.root` change — `next.config.ts` is in fact unchanged from master.
4. **Worktree dev gotcha:** `next build` needs Supabase env in `.env.local` (legacy api routes instantiate the supabase client at module load; `.env.development.local` is not loaded by `next build`). Next 16 forces Turbopack for `next dev` and allows one dev server per directory.

---

## How to continue the redesign (next phases)

Per the parent strategy (Approach 3):
1. Scaffold the parallel `src/app/(redesign)/` route tree behind a master flag (`NEXT_PUBLIC_REDESIGN_ENABLED`, default off in prod).
2. Build redesign screens/surfaces on these primitives, one surface group at a time, verifying each in the gallery + with Playwright.
3. Keep everything additive (legacy UI stays live) until a single deliberate cutover.
4. Finish the toast trigger + the minor polish before screens depend on those pieces.
