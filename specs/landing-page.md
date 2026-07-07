# Nexxus marketing landing page

Status: approved via grill session + mockup review, 2026-07-06 (see `brainstorming/2026-07-06-landing-page-grill-session.md`). Structure is the approved blend of mockup directions A/B/C.

## UI implementation & styling source

The browser-companion mockups behind this spec (scratchpad `direction-a/b/c.html`) are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC` via `brand-*`/semantic tokens, Plus Jakarta Sans via the `.redesign` scope, warm canvas, soft "pillowy" shadows, the rounded scale). Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off.

## Goals

- Show, don't tell: visitors (cleaning company owners/admins, non-technical) see and click the product before reading about it. Advanced but calm.
- Single long scroll page, light warm canvas only. Brand is just "Nexxus"; no Tri-Nexus mention.
- Primary CTA everywhere: join the early-access waitlist.
- No em dashes anywhere in the copy (repo rule).

## Routing and hosting

- Page lives in a new route group: `src/app/(marketing)/landing/page.tsx`, reachable at `/landing` on any deploy (this is the preview URL until DNS exists). Not flag-gated.
- `(marketing)/layout.tsx` wraps children in `<div className="redesign font-jakarta">` (same pattern as `(redesign)/layout.tsx`) but with NO ThemeProvider so the page is always light. Sets its own `metadata` (title "Nexxus, the calm way to run your cleaning company", description, Open Graph).
- New root `middleware.ts`: if `MARKETING_HOST` env var is set and the request's host matches it, rewrite `/` (and only `/`) to `/landing`. When `MARKETING_HOST` is unset the middleware is a pass-through no-op. Narrow matcher (`/`) so app routes are untouched. This makes the future get.jobber-style subdomain a pure DNS + env change.

## Page composition (top to bottom)

All marketing components live under `src/components/marketing/`. Demo fixtures in `src/components/marketing/demo-data.ts` (one fictional company, "Brightside Cleaning Co", cleaners Maria R./James T./Dana W., consistent across all sections). Animations use the `motion` package, durations/easings from the token scale, and every animated piece respects `prefers-reduced-motion` (the `.redesign` scope already hard-disables animation under it; provide static fallbacks that still make sense).

1. **`MarketingNav`** - sticky, translucent warm canvas, Logo primitive + "Nexxus". Anchor links: How it works, Try it, Pricing, FAQ. Right: "Log in" (ghost, links to `/login`) + "Join the waitlist" (primary, scrolls to waitlist section).
2. **`HeroSection`** - eyebrow Badge ("Early access · Built for cleaning companies"), H1 "Run your cleaning company from one calm screen.", one-sentence sub, two CTAs (Join the waitlist; See how it works -> scrolls to story). Below: **`HeroTriptych`**: owner dashboard frame center, cleaner phone left, homeowner phone right, built from real primitives (Card, StatTile-like KPIs, StatusPill, Button, Avatar). A looping ~12s synced sequence: booking appears on homeowner phone -> "needs you" row pops onto the dashboard -> owner assigns -> job lands on cleaner phone -> loop resets gently. Pauses on hover/touch. On mobile the triptych stacks with the dashboard first, phones peeking.
3. **`StorySection`** ("How it works", anchor `#how-it-works`) - "Follow one job from booked to paid." Four steps: (1) Sarah books online at 9 PM, card saved; (2) Maria gets her day on her phone; (3) Job done, photos attached, homeowner notified; (4) Card charged, payout on its way. Desktop: scroll-pinned stage, steps advance on scroll with clickable step pills. Mobile/reduced-motion: same stage advanced by tapping the step pills (no pinning). Each step shows a vignette built from real primitives; captions in plain language.
4. **`LiveDemoSection`** ("Try it", anchor `#try-it`) - "Now try the office view yourself." A framed, fully client-side operator dashboard with the demo company: Tabs (Today / Calendar / Payments). Today: KPI row + job list rows; clicking a row opens a detail panel; the amber "Assign a cleaner" row can actually be assigned (picker with the two cleaners) and flips to scheduled. Calendar: static week grid with jobs placed. Payments: a couple of rows with AnimatedNumber total. An auto-played beat (a new booking sliding in ~8s after mount) runs once, pauses forever on first interaction. Everything from ui primitives; zero network.
5. **`FeatureCardsSection`** - three Cards with live widgets: (a) "Scheduling that fills itself" with a mini month grid (clickable days show job dots); (b) "Paid without chasing" with AnimatedNumber ticking collected revenue; (c) "Know where every job stands" with a StatusPill that cycles scheduled -> in progress -> completed on view/tap.
6. **`PricingSection`** (anchor `#pricing`) - "Priced like you price: by the crew. Office staff free." A "How many cleaners?" slider (1-25, default 5) recomputing all three tier totals live. Tiers (placeholder numbers, ZenMaid x Jobber hybrid): Starter $29/mo, 2 cleaner seats included, +$10/extra; Growth $79/mo, 5 seats, +$8/extra (highlighted "Most popular"); Pro $149/mo, 10 seats, +$6/extra. Under the slider: "Placeholder early-access pricing" microcopy is NOT shown; instead a small line "Early access pricing. Lock it in by joining the waitlist." Feature lists per research doc. Note "Unlimited office staff and free homeowner accounts on every plan." All tier CTAs scroll to waitlist. Annual note: "2 months free when billed annually."
7. **`FaqSection`** (anchor `#faq`) - 6 questions (accordion; if no accordion primitive exists, build `src/components/ui/accordion.tsx` on Radix or native details styled to system): cleaners' tech skill, what happens when pricing is final (waitlist members keep early pricing), online booking, payments/payouts (Stripe), data import/migration help, when early access opens.
8. **`WaitlistSection`** (anchor `#waitlist`) - brand-gradient band (from tokens: brand-950 -> brand-700). Form: work email (required), company name, team size (Select: "Just me", "2-5", "6-10", "11-25", "25+"). Posts to `/api/waitlist`. Success state replaces form ("You're on the list. We'll be in touch soon."). Duplicate email returns the same success. Inline validation errors via FormField/Input primitives.
9. **`MarketingFooter`** - logo, copyright, placeholder Privacy/Terms links (href `#` for now).

## Waitlist backend

- Migration `supabase/migrations/102_waitlist_signups.sql`: table `waitlist_signups` (id uuid pk default gen_random_uuid(), email text not null, company_name text, team_size text, source text not null default 'landing', created_at timestamptz not null default now()); unique index on `lower(email)`; RLS enabled with NO policies (service-role access only).
- Route `src/app/api/waitlist/route.ts` (POST): validates email shape + field lengths (email <= 320, company <= 200, team_size in the allowed set), inserts via the admin client, treats unique-violation (23505) as success so the endpoint is idempotent and does not leak who is already signed up. Returns 400 on validation failure, 200 `{ ok: true }` otherwise. No auth required.
- Integration test `src/app/api/waitlist/route.integration.test.ts` per `create-tests` conventions: happy path inserts row, duplicate email still 200 with single row, invalid email 400, oversize fields 400, team_size outside the set 400.

## Non-goals

- No dark mode on marketing. No social proof/testimonials. No separate pricing page. No real billing. No SEO blog/infra beyond basic metadata + OG tags.

## Acceptance

- `/landing` renders logged-out with no auth flicker or console errors; all interactions work with JS only (no network except waitlist POST).
- Desktop and mobile layouts both polished (user reviews screenshots of the BUILT page, mobile + desktop).
- Conformance pass: no raw hex or off-system styling in `src/components/marketing/**` (tokens/primitives only), reduced-motion safe.
- `npm run test`, `npx tsc --noEmit` (no new errors), `npm run lint` all pass.
