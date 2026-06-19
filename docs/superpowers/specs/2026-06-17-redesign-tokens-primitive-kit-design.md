# Redesign Phase 0 + Phase 1: Design Tokens + Primitive Component Kit

**Date:** 2026-06-17
**Status:** IMPLEMENTED (2026-06-18) and pushed as PR #78 to master. This spec was the approved direction; the build is complete. See the completion summary `docs/superpowers/specs/2026-06-18-redesign-foundation-status.md` for what shipped, decisions, and open items.
**Parent:** `docs/superpowers/specs/2026-06-08-ui-redesign-strategy-design.md` (Approach 3, foundation-first). This spec is the concrete decomposition of that roadmap's Phase 0 + Phase 1, which it says to brainstorm together because they are tightly coupled and backend-free.

## Goal

Stand up the brand foundation for the full UI redesign: machine-readable design tokens (color, type, shape, motion) and a complete, accessible primitive component kit, plus a preview gallery. No production screens change. Everything here is additive and coexists with the legacy UI (no global theme swap), per the parent strategy.

## Locked decisions (from this brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Audience priority | **End-user-first simplicity** | Real users are all-ages homeowners + blue-collar field techs on phones, not power users. Larger type, higher contrast, big touch targets, warm tone, low learning curve. Command palette de-emphasized. |
| Primary font | **Plus Jakarta Sans**, single family | Warm, rounded, highly legible, premium. One family = simplest system. Tabular numerals on for data. Deliberately not Inter (the legacy font) so the redesign reads as new. |
| Brand color | **Electric blue #0150FC** + sky accent **#68B6FA** | Pulled from the real logo SVG. Punchier and warmer than the muted navy the mood-board generator suggested. |
| Canvas temperature | **Warm gray** (tentative) | Friendliest / most human for the target audience. Flagged: revisit blue-on-warm harmony during build. |
| Shape/feel | **Pillowy & soft** (large radius, pill buttons, generous padding, soft pronounced shadow) | Friendly and approachable; also yields the biggest touch targets for phones and older users. |
| Kit foundation | **shadcn/ui** (Radix primitives + Tailwind, copied into the repo and restyled with our tokens) | Owned code, accessibility (keyboard, ARIA, focus) for free, fast, idiomatic for Next.js + Tailwind. |
| Theming | **Light + dark built together** | Logos already have dark variants; doing both now avoids a costly retrofit. |
| Primitive location | `src/components/ui/` | shadcn standard; does not exist today, so zero clash with legacy `src/components/`. |

## Scope

**In scope (Phase 0 + Phase 1):** the token system, the primitive component kit, a `<Logo>` component, a dev-only `/ui-kit` preview route, and the supporting Tailwind/CSS/font wiring. Light and dark themes.

**Out of scope (later phases):** screen/page redesigns, the `(redesign)` app route tree, navigation/app-shell, command palette, marketing pages, dark-mode *screen* work beyond the kit. Legacy components, tokens, and the yellow theme stay untouched and live.

## Part 1: Design tokens (Phase 0)

### Delivery mechanism

- Tokens are **CSS variables** declared in `globals.css`: a `:root` block (light) and a `.dark` block (dark).
- `tailwind.config.js` gets an **additive** theme extension that reads those variables. The legacy `primary`/`secondary`/`success` scales and the yellow brand stay exactly as they are; we add new keys (`brand`, `sky`, `warm`, and shadcn semantic names) alongside them. No legacy utility class changes meaning.
- shadcn semantic variables follow the standard convention (HSL channel triplets consumed as `hsl(var(--x))`) so CLI-added components work unmodified. The brand/sky/warm **ramps** are also exposed as plain hex utilities (`bg-brand-600`, `text-warm-600`) for direct use.
- Theme switching via **`next-themes`** (class strategy, `.dark` on `<html>`), mounted above the kit. Respects system preference; supports manual toggle.

### Color

Hex values below are the source of truth; implementation expresses the shadcn semantic vars as HSL channels.

**Brand (blue) ramp** (anchor = logo #0150FC at 600):
`50 #EFF4FF · 100 #DCE6FF · 200 #C0D2FF · 300 #93AEFF · 400 #5C84FF · 500 #2E62FF · 600 #0150FC · 700 #0140CC · 800 #0A2F95 · 900 #102A6E · 950 #0A1A47`

**Sky accent** (logo secondary): `300 #9CD0FD · 400 #68B6FA · 500 #3F9DF5`

**Warm-gray neutrals:**
`50 #F7F6F3 · 100 #EFEDE8 · 200 #E6E2DB · 300 #D7D2C8 · 400 #B2AB9D · 500 #8B8475 · 600 #6B6459 · 700 #4E483F · 800 #322E28 · 900 #211E1A · 950 #14120F`

**Semantic** (each with a 50 tint and a 700 deep for text-on-tint):
- success `#1FAE63` (50 `#E7F7EE`, 700 `#12814A`)
- warning `#F59E0B` (50 `#FEF3E2`, 700 `#B4740B`)
- danger `#E5484D` (50 `#FDECEC`, 700 `#B42A2F`)
- info / sky `#3F9DF5` (50 `#EAF4FE`, 700 `#1E6FB8`)

**shadcn semantic mapping:**

| Token | Light | Dark |
|---|---|---|
| background | warm-50 `#F7F6F3` | `#1A1815` |
| foreground | warm-900 `#211E1A` | `#F5F3EF` |
| card / popover | `#FFFFFF` | `#24211B` |
| card/popover-foreground | warm-900 | `#F5F3EF` |
| primary | brand-600 `#0150FC` | brand-500 `#2E62FF` (lifted for contrast on dark) |
| primary-foreground | `#FFFFFF` | `#FFFFFF` |
| secondary | warm-100 | `#2C2823` |
| secondary-foreground | warm-900 | `#F5F3EF` |
| muted | warm-100 | `#2C2823` |
| muted-foreground | warm-600 `#6B6459` | `#B8B0A2` |
| accent | brand-50 `#EFF4FF` | `#2C2823` |
| accent-foreground | brand-700 | `#DCE6FF` |
| border / input | warm-200 `#E6E2DB` | `#38332B` |
| ring | brand-600 | brand-400 `#5C84FF` |
| destructive | danger `#E5484D` | `#F2555A` |
| destructive-foreground | `#FFFFFF` | `#1A1815` |

Contrast: every foreground/background and text-on-tint pair must meet WCAG AA (4.5:1 body, 3:1 large/UI). Status is never color-only; pills/badges carry an icon or text label. Both themes verified independently.

### Typography

- **Plus Jakarta Sans** self-hosted via `next/font/google` (variable, `display: swap`), exposed as `--font-sans`. Weights: 400, 500, 600, 700, 800.
- **Tabular numerals** utility (`font-feature-settings: "tnum" 1`) applied to money, tables, timers, and stats so columns do not shift.
- **Type scale** (mobile-first, 16px base; body never below 16px on mobile to avoid iOS auto-zoom):

| Role | Size | Weight | Line height |
|---|---|---|---|
| display | 40px (2.5rem) | 800 | 1.1 |
| h1 | 32px | 700 | 1.15 |
| h2 | 24px | 700 | 1.2 |
| h3 | 20px | 700 | 1.25 |
| body-lg | 18px | 400 | 1.5 |
| body | 16px | 400 | 1.5 |
| small | 14px | 400/500 | 1.45 |
| label/overline | 12px | 600 | 1, uppercase, tracking 0.04em |

### Shape, elevation, spacing, motion

- **Radius** (pillowy): `sm 10px · md 14px · lg 18px · xl 22px · pill 9999px`. Cards default `xl`; buttons default `pill` (or `lg` for compact contexts); inputs `lg`.
- **Shadow** (soft, pronounced): `sm 0 1px 2px rgba(20,18,15,.06)` · `md 0 8px 24px rgba(20,18,15,.08), 0 2px 6px rgba(20,18,15,.05)` · `lg 0 14px 34px rgba(20,18,15,.12), 0 4px 10px rgba(20,18,15,.06)`. Dark theme uses stronger black-based alphas.
- **Spacing:** 4px base scale (Tailwind default). Comfortable density: generous default paddings, not dense.
- **Motion:** durations `fast 150ms · base 200ms · slow 300ms`; enter ease-out `cubic-bezier(0.16,1,0.3,1)`, exit ease-in (~70% of enter duration); gentle press-scale (0.97) on tappable cards/buttons; overlays animate from source. All motion gated behind `prefers-reduced-motion`.

## Part 2: Primitive component kit (Phase 1)

### Foundation & conventions

- Components built with the **shadcn/ui** workflow: Radix primitives + Tailwind, copied into `src/components/ui/`, restyled with our tokens. We own and version every file.
- Variants via **class-variance-authority (cva)**; class merging via **tailwind-merge** + **clsx** (a `cn()` helper). `React.forwardRef` everywhere; Radix `Slot`/`asChild` where it applies.
- **Icons: Lucide** (`lucide-react`), one consistent stroke set; no emoji as icons; consistent sizing tokens (16/20/24).
- Every component ships **all interaction states** (default, hover, focus-visible, active/pressed, disabled, loading where relevant, error where relevant), in **both themes**, with **min 44x44px touch targets**, visible focus rings, and correct ARIA (inherited from Radix).
- New dependencies: `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react`, `next-themes`, the relevant `@radix-ui/react-*` packages per component, `react-day-picker` (calendar), and a toast lib (`sonner` or shadcn toast).

### Inventory

**Forms:** Button, IconButton, Input, Textarea, Select, Checkbox, Radio (RadioGroup), Switch, Label, FormField (label + helper + error wrapper), Date/Calendar picker.

**Display:** Card (+ Header/Body/Footer), Badge / StatusPill, Avatar, Stat/KPI tile, Table / DataList, Tooltip, Separator, Skeleton, EmptyState.

**Overlays:** Dialog/Modal, Sheet/Drawer, DropdownMenu, Popover, Toast, ConfirmDialog (destructive-action confirm).

**Navigation:** Tabs, SegmentedControl, Breadcrumb, Pagination.

**Brand:** `<Logo>` component reading `public/brand/*` (variant + theme aware: color / mono / light / dark; mark vs full lockup).

### Component standards (applied to all)

- Forms: visible labels (never placeholder-only); errors rendered below the field with `role="alert"`; helper text persistent; semantic input types for mobile keyboards; loading state disables submit and shows a spinner.
- Destructive actions use the danger color and are visually separated; confirmation via ConfirmDialog.
- Tables: tabular numerals for numeric columns; sortable headers expose `aria-sort`; provide an accessible empty and loading (skeleton) state.

## Part 3: Preview harness

- A **dev-only `/ui-kit` route** (guarded so it never ships to prod users) rendering every component in every state, grouped by category, with a **light/dark toggle** and the warm canvas. This is the living gallery (Storybook-lite), the Playwright verification target, and the team show-and-tell surface.

## Part 4: Repo layout & coexistence

```
src/components/ui/        NEW. Primitive kit (this spec).
src/lib/utils.ts          NEW or extended. cn() helper.
public/brand/             DONE. Brand assets (logos copied in).
globals.css               EXTENDED. :root + .dark token blocks (additive).
tailwind.config.js        EXTENDED. brand/sky/warm + shadcn semantic keys (additive).
src/app/(dev)/ui-kit/     NEW. Dev-only preview route.
```

- **No global theme swap.** Legacy `primary`/`secondary`/`success`, the yellow brand, and inline class strings are untouched and keep serving production. New tokens/components are consumed only by the kit and (later) the redesign tree.
- Data layer (`src/hooks`, `src/lib`, `src/contexts`, API routes, Supabase, Stripe) is not touched.
- Legacy retirement happens only in the post-cutover cleanup pass described by the parent strategy, not here.

## Part 5: Accessibility & touch (non-negotiable)

Per the project's UI/UX guidelines: contrast AA in both themes; visible focus rings (never removed); 44px+ touch targets with 8px+ spacing; full keyboard navigation; icon-only buttons get `aria-label`; color is never the sole signal; `prefers-reduced-motion` and dynamic text scaling supported without layout breakage.

## Part 6: Verification

- Build each component, then screenshot `/ui-kit` (light + dark) via the **Playwright MCP** and iterate against this spec and the brand feel until seamless (the project's "UI must feel native + verify" practice).
- Lightweight optional visual/unit checks on primitives; no heavy test burden. API integration tests are unaffected (data layer untouched).

## Part 7: Risks & mitigations

- **Warm canvas + cool electric blue harmony.** Tentative pairing; verify on real components and retune the warm ramp or shift the blue if it reads off. Cheap to change (tokens).
- **Light + dark doubles styling surface.** Mitigated by token-driven theming: components reference semantic vars, not hardcoded colors, so dark is mostly free once the `.dark` block is right.
- **Tailwind v3 + shadcn wiring.** Use the classic v3 HSL-channel setup; confirm against current `tailwind.config.js`.
- **Kit churn once screens consume it.** Mitigated by a thorough Phase 1 inventory and dogfooding on the `/ui-kit` gallery before any screen work.

## Open items (non-blocking)

- Exact warm-gray ramp may be retuned after seeing the blue on real components.
- Toast library choice (`sonner` vs shadcn toast) finalized at implementation.

## Next step

Per the brainstorming flow, the next step is the **writing-plans** skill to turn this spec into a sequenced implementation plan (tokens wiring first, then the kit by component group, then the `/ui-kit` gallery, with Playwright verification gates). The component-by-component visual design happens during the build, verified in the gallery.
