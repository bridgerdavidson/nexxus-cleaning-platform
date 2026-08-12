# Landing refresh: top bar, white-label section, pricing accuracy

**Date:** 2026-08-11
**Status:** Approved direction (companion session with Bridger); spec pending his review
**Branch:** `feat/landing-refresh` (batched; one PR at the end of the session, per Bridger)
**Design inputs:** browser-companion session (`.superpowers/brainstorm/51396-1786480120/`), pricing source of truth `~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md`

## Goals

Three landing-page changes, one per section below:

1. Replace the generic AI-landing top bar with one that wears the product's design language, morphing from docked app chrome into a floating pill on scroll.
2. A new interactive white-label section: an admin dashboard + cleaner phone tableau that visitors re-brand live with a color picker and their own company name, powered by the production theming code.
3. Make the pricing section match the locked pricing decision instead of the stale placeholders.

Already shipped on this branch: the mobile Log in button fix (`ac52831`).

## UI implementation & styling source

The browser-companion mockups from this session are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC` via `--brand-*` vars, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale `chip/control/field/card/pill`). Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. Marketing demo surfaces (frames, fake data) follow the same rule: token classes only, so the branding override mechanism works.

## 1. MarketingNav: docked chrome that floats on scroll

**Resting state (top of page):** solid white app chrome, exactly the product's own top-bar idiom (`bg-card`, `border-b border-border`, `h-16`, sticky). No translucency, no backdrop blur, anywhere, in either state.

**Floating state (scrolled):** the bar's inner container contracts into an inset pill: constrained width, `rounded-pill`, `border border-border`, `bg-card`, `shadow-soft-lg`, offset a few px from the top edge. Visually identical to companion option B.

**Behavior:**

- Trigger: an IntersectionObserver sentinel placed in the hero (roughly half a viewport down). Crossing it toggles a class; the morph is a one-shot CSS transition (~250ms, `ease-out-soft`) on the inner container's max-width, margins, border-radius, background, border, and shadow. Never bind styles to scroll position per-frame.
- The outer `<header>` keeps a constant `h-16` reserved height in both states so content never shifts and `scroll-mt-16` anchors keep working; the pill floats within that box (small `top` offset + reduced inner height are absorbed inside it).
- `prefers-reduced-motion: reduce`: no transition; states swap instantly.
- Contents unchanged in both states: logo (links `#top`), section links (hidden below `md` as today), Log in (visible at all widths, per `ac52831`), Join the waitlist. Link hit areas stay at least 44px tall.
- Mobile: same two states, tighter horizontal padding; the pill spans nearly full width at small sizes.

**Files:** rewrite `src/components/marketing/MarketingNav.tsx` in place. No new primitives expected; if the sentinel hook is generally useful, extract it (`useScrolledPast`) into `src/lib/`.

## 2. BrandingSection: the white-label demo

New section component `src/components/marketing/BrandingSection.tsx`, rendered between `FlexibilitySection` and `PricingSection` in `src/app/(marketing)/landing/page.tsx` (sets up "included on every plan" right before the pricing cards). Section anchor `#white-label`, added to the nav links only if it doesn't crowd the bar (implementer's call at build time).

**Composition (companion layout B, with Bridger's rail note):**

- **Text block** above: kicker badge "White-label", H2 "Your customers see your brand. Not ours.", subline "Pick a color, type your name, and the whole platform wears it. Included on every plan." Below the tableau, a small caption lands the jab: "Some platforms charge $197 a month to take their logo off. Here it is included." (Bridger saw this flagged and did not veto; keep it one line so it is easy to cut.)
- **Tableau**: two overlapping device frames on the warm canvas, reusing/extending `frames.tsx`:
  - Admin dashboard in a `BrowserFrame` with an **expanded rail**: brand mark + company name lockup at top (the typed name must land here visibly), a few nav items, then a main pane with KPI tiles and booking rows using brand-colored status pills and a primary button.
  - Cleaner `PhoneFrame` overlapping in front: brand header (mark + company name), a today's-job card, brand-primary "Start job" button.
  - Both surfaces are decorative demos: `aria-hidden`, static demo data, no internal animation loops (the section's one animation is the brand cycle below).
- **Theme bar** below the tableau: a floating pill toolbar (white card, `rounded-pill`, `shadow-soft-md`) containing:
  - Three preset company chips (fake brands with distinct hues, e.g. Sparkle & Co teal, Summit Shine orange, Bluebird Home blue). Chips show swatch + name; the active chip gets a ring + check, not color alone. Min 44px touch targets.
  - A color picker: native `<input type="color">` behind a swatch-button facade (44px), with a visible micro-label "Brand color".
  - A company-name text field, visible micro-label "Company name" (not placeholder-only), maxLength ~24.
- On narrow screens the theme bar wraps to two rows; the tableau scales down with the phone stacking mostly over the dashboard (same overlap idiom the hero uses).

**Mechanism (production code, not a simulation):**

- A wrapper element around the tableau gets `style` built from `rampToCssVars(deriveBrandRamp(hex))` (`src/lib/branding/palette.ts`), overriding `--brand-50..950` + `--brand-ink` locally. Frame internals use only token classes (`bg-primary`, `text-brand-ink`, `bg-accent`, ...) so both devices repaint from the vars. Scope: the override wrapper contains ONLY the tableau, never the section text or the rest of the page.
- Note: `--primary`/`--accent`/`--ring` chain to `--brand-*` in `globals.css`, so they follow automatically.
- Typed company name renders in both surfaces' lockups; the mark is derived with `orgInitials()` from `src/lib/branding/monogram.ts` (the product's real pre-logo-upload fallback). No file upload on the landing page (moderation/friction; decided with Bridger).
- State is plain React state; no persistence, no analytics events for MVP.

**Idle animation:**

- Until first interaction, cycle through the presets every ~4s (CSS-transition color/name crossfade on the same var-override mechanism; one timer, cleared permanently on any pointer/keyboard interaction with the theme bar).
- `prefers-reduced-motion: reduce`: no auto-cycle; the section rests on preset 1.
- Cycle only runs while the section is in view (IntersectionObserver) so it doesn't burn main-thread time offscreen.

**Copy rules:** no em dashes in any user-facing string. The $ figure stays generic ("Some platforms"), no competitor names.

## 3. PricingSection: locked numbers

Source of truth: the 2026-07-26 pricing decision. The section keeps its structure (header, crew slider card, three tier cards, footnote) and gains a billing-period toggle.

**Numbers:**

| | Starter | Growth | Pro |
|---|---|---|---|
| Annual (per month, default display) | $29 | $79 | $139 |
| Monthly | $39 | $99 | $169 |
| Cleaner seats included | 3 | 8 | 15 |
| Extra seat | $10/mo flat | $10/mo flat | $10/mo flat |
| Hard cap before upgrade | 5 | 15 | unlimited |

- **Billing toggle:** a two-option `SegmentedControl` ("Billed annually" / "Billed monthly"), annual preselected. Annual shows the annual per-month price with a "billed annually" note; monthly shows monthly prices. Toggle state feeds the same `AnimatedNumber`.
- **Crew slider stays** (1 to 25+). Seat math per tier: `base + max(0, cleaners - included) * 10`.
- **Hard caps surfaced honestly:** when the slider exceeds a tier's cap (Starter > 5, Growth > 15), that tier's card shows a "Needs Growth" / "Needs Pro" state: the price area swaps to that message plus a one-line explainer ("Starter supports up to 5 cleaners"), and the card's CTA drops to the outline variant with its label unchanged. Text, not just graying, per the color-only rule.
- **Feature lists** (from the locked gates, phrased for the card):
  - Starter: "The whole core product", online booking and scheduling incl. recurring, homeowner and cleaner apps, card payments with automatic cleaner payouts, in-app messaging and notifications, **your own branding on everything (white-label)**, standard support.
  - Growth (popular): everything in Starter, ACH payments (0.8% capped at $5, at cost), cancellation and no-show fee tooling, analytics dashboard, priority support, new features land here first.
  - Pro: everything in Growth, white-glove onboarding, free data migration, first access to AI features, unlimited seats.
- **Blurbs** update to match seat counts ("For solo operators and first hires" fits Starter's 3 seats; adjust Growth/Pro to 8/15).
- **Footnote block** replaces the current one: 14 day free trial on every plan, no credit card, trial runs at the Growth level. 1% platform fee on jobs paid through the platform, stated openly ("We only make money when you do"), includes automatic contractor payouts. Card processing at cost (2.9% + 30¢), no markup. Remove "Early access pricing. Lock it in..." (waitlist framing stays only in the CTA buttons). Remove any implication the customer covers fees; homeowners never pay anything.
- Remove the stale "Placeholder early-access numbers" comment; point the new comment at the brain doc path as pricing's source of truth.
- The `Tier` type gains `annual`/`monthly` bases and `cap: number | null`; `tierTotal` and cap logic become small pure helpers exported for a unit test (`PricingSection.test.ts` colocated, or in `src/lib/` if extracted).

## Out of scope (this session's later tasks or explicit non-goals)

- CapabilityExplorer fidelity rework (task 5, deferred by Bridger).
- Real logo file upload in the demo.
- Stripe Billing wiring, plan-picker, or any in-app pricing surface; this is marketing copy only.
- Nav link set changes beyond optionally adding `#white-label`.

## Testing & verification

- Unit: pricing tier math (cap states, annual/monthly totals) as pure-function tests.
- No API routes touched, so no integration tests.
- Visual: Playwright screenshots at 375px and 1280px of (a) both nav states, (b) branding section idle + after picker interaction, (c) pricing at both toggle positions and slider extremes. Reduced-motion spot check via emulation.
- Conformance pass before the PR: no raw hex or mockup styling in shipped components (demo swatch colors for the preset chips are data, not styling, and live in one constants block); ui-ux-pro-max implementation-phase check.
