---
name: ui-feature-workflow
description: >-
  Use when designing OR implementing ANY feature with significant UI in this repo
  (new screens, redesign work, dashboards, a visually-weighty component) AND
  whenever the "browser companion" / visual mockups come up. It governs how to use
  the browser companion for UX and structure exploration WITHOUT letting throwaway
  mockup styling leak into the real build, how to write the spec so it separates UX
  from implementation styling, and it requires the ui-ux-pro-max skill at BOTH the
  design and the implementation phase. Invoke it before opening the companion,
  before writing a UI spec or plan, and before building UI, even if the user only
  says "let's redesign X", "build the cleaner screen", "mock up a layout", "design
  this dashboard", or "use the browser companion". Do not skip it just because the
  task sounds like plain implementation.
---

# Building UI features: browser companion + design-system discipline

## Why this skill exists (read this first)

The browser companion is great for figuring out **structure and flow**, but its mockups, even when they use our brand colors and look polished, are **throwaway sketches**. Their *specific* visual choices (an exact accent, a raw hex, a one-off border) are NOT design decisions.

The failure this skill prevents actually happened: a mockup's amber left-stripe on a card flowed mockup -> spec -> plan -> code and shipped as off-system UI that read as "legacy." Nobody decided that stripe belonged in our design language; it just rode the pipeline because the mockup looked designed.

So hold one line in your head the whole time:

> **The browser companion answers "what goes where and how does the flow work." The design system answers "what it looks like." Never let the first masquerade as the second.**

Mockups are reference-only, *even when they use our brand feel*. We keep them brand-ish so the user can judge "does this feel right", that is a deliberate choice, and it means the temptation to copy them is higher, so the discipline below matters more, not less.

## Step 0 — Before any significant-UI feature, ask two things

The moment a task involves real UI (a new screen, a redesign, a component with visual weight), ask the user up front, as its own short exchange:

1. **"This has real UI, do you want me to use the browser companion to explore the UX/structure first?"**
2. If yes: **"Are you on mobile or desktop right now?"**
   - **Desktop** -> start the companion and send the localhost link; they view it live and click options.
   - **Mobile** -> they cannot open localhost on a phone. Drive the companion yourself with the Playwright tools and send **screenshots/images** of each screen instead of a link.

Why ask the device every time: the user is frequently on their phone and a localhost link is useless there. Guessing wrong wastes a round trip. Ask, don't assume.

The companion's server/screens/events mechanics are owned by `superpowers:brainstorming` (its visual-companion). Use that for the plumbing; this skill governs the discipline around it.

## The companion's job vs. not-its-job

- **Its job:** UX, layout, structure, navigation, flow, information hierarchy, "which of these arrangements reads better."
- **Not its job:** final colors, exact spacing, borders, shadows, component styling, or producing components we ship.
- Treat every concrete visual in a mockup (colors, accents, borders, radii, shadows) as a sketch. If you ever catch yourself about to reproduce a mockup's exact styling in real code, **stop**, that is the exact failure mode.

## Writing the spec / plan: make the boundary a written contract

Every UI spec or implementation plan MUST contain a short, explicit section so a fresh implementer (often a subagent who never saw the mockups) cannot miss it. Use wording like:

> **UI implementation & styling source.** The browser-companion mockups here are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off.

The spec should describe screens in terms of **what they contain and how they behave**, not "make it look like the mockup."

## Implementing: build from the system, not the mockup

- **Reuse first.** Use the existing primitives in `src/components/ui/*` and the patterns sibling screens already use (status pills/badges, section cards, sheets, the shell). Match how the rest of the redesign does it.
- **Status and urgency = the badge/pill vocabulary**, not decorative side-accents or stripes. If something needs to feel time-sensitive, prefer a functional signal in our badge language (e.g., a "Respond by <time>" pill) over a decorative bar.
- **New pattern needed?** Formalize it into the design system (a primitive, a variant, or a token) and then use it, so it is consistent and reusable. Do not inline a one-off hex/border in a single component.
- **Re-derive every visual from the system.** The mockup tells you *where* the pill goes; the system tells you *what a pill looks like.*
- **Flag carryovers, don't keep them silently.** If a mockup choice is tempting but isn't in the system, raise it with the user: remove it, or formalize it, deliberately.

## Use ui-ux-pro-max at BOTH phases (required)

Invoke `ui-ux-pro-max:ui-ux-pro-max` twice in a UI feature's life:

1. **Design phase** — to inform UX, structure, navigation, and data-density decisions. Use its UX rules; override its style/color/font picks, our visual identity is locked.
2. **Implementation phase** — to verify feel/quality AND **design-system conformance against the REAL components**. This is the catch-net: its rules explicitly flag "raw hex instead of semantic tokens," off-style effects/shadows, touch-target sizes, etc., exactly the class of leak this skill prevents. Skipping this step at implementation time is how the leak survives.

(The ui-ux-pro-max CLI on this machine must be run with the full Python 3.11 executable; the `python`/`python3` aliases are Microsoft Store stubs. The ui-ux-pro-max skill carries the canonical command.)

## Before the PR: a conformance pass

Alongside the normal gates (Codex review, visual screenshots), do a quick **"did any off-system styling leak?"** check:
- No raw hex or bespoke classes copied from a mockup sit inside a component.
- Existing primitives were reused; any genuinely new pattern was formalized into the system.
- The built screen matches our design language, not just the mockup's arrangement.

If the user is on mobile, send screenshots of the **built** screens (not the mockups) so they confirm the real thing.

## Related

- `superpowers:brainstorming` — owns the visual-companion mechanics and the design -> spec flow.
- `ui-ux-pro-max:ui-ux-pro-max` — the design intelligence to run at both phases.
- Design system anchors: `src/components/ui/*` (owned primitives), `tailwind.config.js` + `src/app/globals.css` (tokens), the `(redesign)` route group for examples of the conventions.
