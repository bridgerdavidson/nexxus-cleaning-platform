# Landing page — grill session log (2026-07-06)

Session goal: build the full marketing landing page for Nexxus (the cleaning platform), now that the UI redesign gives us a design language worth showing. The page must *show* the product (interactive, animated) rather than describe it, feel advanced-but-calm for blue-collar buyers (cleaning company owners/admins), and carry placeholder subscription pricing.

Note: the `grill-me` project skill was not present in this checkout (only `create-tests` and `ui-feature-workflow` under `.claude/skills/`), so the interview was run manually and logged here per the same convention.

## Q&A record

**Q1. Use the browser companion to explore UX/structure first, or build directly?**
A: Yes, explore first.

**Q2. Mobile or desktop right now?**
A: Mobile. (So: Claude drives the mockups itself and sends screenshots; no localhost links.)

**Q3. Where should the landing page live? (root `/` is currently a 404)**
A: A marketing **subdomain**, like Jobber's `get.jobber.com` pattern — not a route on the app domain. Current app domain is `cleaning.tri-nexus...`; the bare `tri-nexus` domain is a sister property-management platform's marketing site today. Owner will likely move that to its own subdomain too, freeing a subdomain for the cleaning marketing page. Explicitly did not want a plain route.

**Q4. What does the pricing section show at launch (pricing not yet decided)?**
A: Placeholder tiers with real-looking numbers.

**Q5. How is the subdomain served, build-wise?**
A: Same Next.js app, host-based routing (recommended option): landing lives in a `(marketing)` route group; middleware rewrites the marketing host to it. One codebase, shares the design system, previewable at a normal route until DNS exists.

**Q6. What form does the interactive showcase take?**
A: **All four**, composed: short auto-playing UI motion, a live-feeling embedded product demo (real redesign components + seeded fake data), a guided animated walkthrough (booking → assign → complete → paid), and interactive feature cards with small live widgets.

**Q7. Primary CTA (no SaaS billing exists yet)?**
A: Join early access **waitlist**.

**Q8. Placeholder pricing ballpark?**
A: Research how **ZenMaid** does seat-based billing and blend it with **Jobber**'s tier model to set temp numbers (tiers + per-cleaner seats hybrid).

**Q9. Where do waitlist signups go?**
A: Supabase table + API route (validation, dedupe; visible in Studio).

**Q10. One long page or multi-page site?**
A: One long scrolling page with anchor nav.

**Q11. Which personas does the page showcase?**
A: All three — operator dashboard as the star, cleaner mobile day view, homeowner experience.

**Q12. Social proof with no public customers?**
A: Skip social proof for now; let the product demo do the convincing.

**Q13. Branding on the page; mention the Tri-Nexus sister platform?**
A: Just "**Nexxus**", no sister-platform mention.

**Q14. Theme?**
A: Light warm canvas only (dark vignettes allowed inside demo frames for contrast).

**Q15. Waitlist form fields?**
A: Email + company name + team size (team size feeds the seat-based pricing decision).

**Q16. Reference sites for feel?**
A: Blend: Jobber/ZenMaid plain-spoken warmth + Linear/Stripe-style product motion, kept gentle. No other specific references in mind.

## Derived constraints

- Buyer persona: cleaning company owners/admins, non-technical, blue-collar. "Advanced but calm."
- Styling source is the design system only (`src/components/ui/*`, tokens in `tailwind.config.js` / `globals.css`): brand electric blue `#0150FC`, warm canvas `#F7F6F3`, Plus Jakarta Sans, pillowy radii, soft shadows. Mockups are UX/structure reference only.
- No em dashes in any user-facing copy (repo rule).
- Waitlist backend follows create-tests conventions (integration test co-located with the route).
- Until DNS/subdomain exists, the page is reachable at a normal preview route; middleware host-rewrite ships ready for the subdomain.
