# Master to-do (built 2026-07-17)

One queue across the four planning sessions of 2026-07-16: the post-cutover gap scan, the
dark-mode plan, the Phase 4 rewrite (PR #167), and the payments-audit v4 (Stripe money audit).
Sorted by urgency. Usage: "what's next?" = the topmost unchecked block. Each block names its
source doc; the source doc is the spec, this file is only the ordering.

Source docs (canonical):

| Workstream | Doc |
|---|---|
| Gap scan (legacy leaks + UX wins + payout-model queue) | `docs/redesign/2026-07-16-post-cutover-gap-scan.md` |
| Dark mode | `docs/redesign/2026-07-16-dark-mode-plan.md` |
| Phase 4 retirement + /app prefix removal | `docs/redesign/cutover-runbook.md` §6 + §6.1, as rewritten by **PR #167** |
| Payments audit v4 | `docs/payments-audit-v4-backlog.md` (tracker) + `docs/payments-audit-v4-findings-detail.md` (evidence). `docs/payments-audit-v4-pre-mvp-money-audit.md` is an abandoned partial draft — ignore it. |

> Note: the "Task #1/#2/#3" Claude task-list entries the gap scan mentions no longer exist
> (task list came back empty on 2026-07-17). This file replaces them as the queue.

---

## 0. Housekeeping (minutes, do first)

- [x] **Commit the planning docs.** Done 2026-07-17 — this file and the four planning docs
      landed together in the docs chore PR. (The abandoned draft
      `payments-audit-v4-pre-mvp-money-audit.md` was deliberately left out; it can be deleted
      from the local checkout.)
- [x] **Merge PR #167** (`docs(cutover): Phase 4 rewrite`). Merged 2026-07-17; the Phase 4
      order + URL map (§6.1 role roots) referenced below are now canon on master.

## 1. Gap scan §1 — legacy-leak fixes (small, ~2 PRs, unblocks Phase 4)

Source: gap scan §1 + §3. Prerequisite for Phase 4 step 4e (edits the same `next.config.ts`
redirect block — land small before big).

- [x] PR 1: `/owner` redirect (**the one blocker** — legacy back-office still reachable),
      operator-layout wrong-role guard, extend `?tab=` deep-link maps to the other 3 dashboards,
      the `isSelfPay` one-liner (= audit item T3-10), repoint/kill the 2 orphaned Stripe-URL
      routes. **Done: PR #172 (merged 2026-07-17).**
- [x] PR 2: re-theme `/billing/add-card` (live emailed page, still legacy yellow) — **PR #173**;
      invoices **DECIDED: retire for MVP** (Bridger, 2026-07-17 — dormant feature, table + route
      kept, no UI built; see gap-scan §1 invoices bullet). Block 1 complete.

## 2. Payments audit Tier 1 — live prod, money moves wrong (the big rock)

Source: `payments-audit-v4-backlog.md` Tier 1 (T1-1 … T1-11). CRITICAL/HIGH, all live in prod.
Suggested internal order:

- [x] **TIER 1 COMPLETE (2026-07-26): all 18 items (T1-1 … T1-18) closed.** Final PRs:
      #206 (T1-11, migration 114), #207 (T1-14/15/17/18 bundle, migration 115), #208 (T1-16,
      migration 116), #211 (T1-12a, closing PR). Earlier: T1-8 (#177/#179), T1-1 (#187, m112),
      T1-2/12b/13 (#192), T1-4/9 (#194), T1-5 (#199), T1-10 (#200, m113), T1-6 (#202),
      T1-7 (#203), T1-3+T3-12/13/14/15 (#204 + the §5.1 Stripe Dashboard ops step, confirmed
      done). All migrations (112-116) verified in prod. Per-item detail + adversarial-review
      annotations: `payments-audit-v4-backlog.md`.
      ⚠ Standing ops rule: never Vercel-rollback past `70adc1b` once any transfer_attempt
      counter > 0; roll forward via a revert PR (see backlog T1-11/F8).

## 2.5. White-label branding — Phase 0 of the go-to-market roadmap (✅ DONE 2026-07-31)

Source: `docs/white-label-branding.md` (spec) + `docs/white-label-branding-plan.md` (5-PR plan).
Strategy origin: Phase 0 of `2026-07-26-build-roadmap.md` in the brain. **All five PRs merged
2026-07-29 to 2026-07-31 (~3 working sessions vs the 5 to 7 estimate).**

Every cleaning company sets one brand color and two logos, and their whole app becomes theirs:
Settings → Branding retints everything live, reloads never flash the default blue, and the logo
carries through the rail, headers, favicon, loader, and the card-collection email.

- [x] PR 1 `feat/branding-foundation` (#219) — OKLCH palette module, Tailwind brand ramp tokenized
      to CSS vars, migration **121** (renumbered from the plan's 120, which the payout stack took;
      columns + `org-branding` bucket with server-side PNG/WebP + 2 MiB limits).
- [x] PR 2 `fix/org-selection` (#223) — deterministic AuthContext org pick + account-menu switcher
      in every role shell (spec beat the plan's settings-section placement).
- [x] PR 3 `feat/branding-runtime` (#225) — BrandProvider, pre-paint bootstrap, branding API,
      settings section with live preview + silent org refresh. Demoable from here.
- [x] PR 4 `feat/branding-surfaces` (#227) — rail crossfade + monogram fallback + sidebar expansion
      preference, homeowner/cleaner header logos with greetings promoted to real `<h1>`s, tenant
      loader, favicon/title/theme-color (tenant surfaces only; /owner and pre-auth stay Nexxus).
- [x] PR 5 `feat/branding-email` (#228) — branded card-collection email and `/billing/add-card`
      themed from the link token.

Remaining follow-ups (tracked, not blockers): set up the anchor tenant's real branding (human step),
visual pass of the branded add-card page on a preview/prod link, theme the in-app Stripe
`appearance.ts` + `--chart-*` tokens per-org. Next in the roadmap: Phase 1, SaaS billing.

## 3. Payments audit Tier 2 — visibility & notification gaps (pre-MVP)

Source: backlog Tier 2 (T2-1 … T2-18). Silent failures + operator/homeowner blind spots.
T2-1 (homeowner money notifications) is **DONE** — #213 render + #214 emit, merged 2026-07-28.
Next biggest: **T2-1b emailed receipt** (see below), disputes surface (T2-2), refunds visibility
+ confirm/partial-refund dialog (T2-3/T2-4), then the rest.

### 3a. T2-1b — emailed money receipts (next up in this block)

Homeowners now get an in-app bell for charges, fees, and refunds, but **no email**, so a
quarterly booker gets nothing at all. Their card statement shows the tenant's business name
(`on_behalf_of`), so an unrecognized charge with no receipt makes calling the bank the cheapest
path. Each dispute costs $15 + the amount, and it lands on the tenant.

- **Interim, Bridger-manual, no code:** turn on Stripe Dashboard → Settings → Customer emails →
  Successful payments. Nexxus-branded, but it stops charges going out unreceipted. Tracked in
  Ops loose ends below.
- **Real fix:** our own branded email, drained from the `notification_events` outbox that T2-1
  already fills (it has `dedupe_key` and an unread `send_after` column; `.select('id')` on the
  upsert yields exactly-once sends). Transport already exists at `src/lib/email/**`.
- ⚠ **Never deliver this with `receipt_email`** on the PaymentIntent. It mutates the request body
  under an unchanged idempotency key; the cancellation-fee path has no verification sweep behind
  it and double-charges undetected. Full reasoning in the backlog under T2-1 / T2-1b.
- **Prerequisite:** confirm the five SMTP vars are actually set in prod (they degrade silently).

## 4. Gap scan §2 — UX quick wins (interleave anytime)

Source: gap scan §2. Twenty verified small items; the six "high"-rated S items first
(operator: messages badge, availability in assign select, tappable Today rows, calendar
skeleton; homeowner: tappable hero, last-cleaning prefill; cleaner: "Next up" card, "You're
owed $X"). Good palate-cleansers between payments batches; candidates for the rolling
`fix/ui-minor-fixes` cadence.

## 5. Phase 4 — legacy retirement + /app prefix removal (after soak)

Source: runbook §6 (PR #167 version). Order is load-bearing, each step its own PR:
4a legacy charge path → 4b delete legacy page dirs (NOT `/billing/add-card`) → 4c orphaned
components → 4d gate removal (+ retire `NEXT_PUBLIC_REDESIGN_ENABLED`) → **4e remove the
`/app` prefix** (role roots per §6.1: `/admin` `/cleaner` `/homeowner` `/owner`) → 4f graduate
redirects to 308 (only in the out-of-`/app` direction; the old into-`/app` graduation is
CANCELLED) → 4g optional cleanup. Prereq: block 1 above merged; soak window observed.

## 6. Dark mode (build-ready, queued)

Source: dark-mode plan. Infra is live already; work = Phase 1 theme-complete the live surface
(invisible, small PRs) → Phase 2 the 3-way Light/Dark/System toggle in each role's settings
(the go-live moment; ui-feature-workflow + ui-ux-pro-max apply) → Phase 3
`user_profiles.theme` cross-device fast-follow. Trigger: "let's work on dark mode".

## 7. Payments audit Tier 3 — flag-flip gates (not MVP-blocking)

Source: backlog Tier 3. Do the ACH block (T3-1 … T3-4) before ever enabling
`STRIPE_ACH_ENABLED`; the self-pay block (T3-5 … T3-9, T3-11) before `STRIPE_SELF_PAY_ENABLED`.
(T3-10 ships in block 1; T3-12…15 fold into block 2's webhook work.) Plus the "lower-severity /
ledger-accuracy" L-items opportunistically.

## 8. Payout models (LOCKED until Bridger opens it)

Source: gap scan §3.5-6 + memory. "Cleaner decides payment" pilot first, then
cleaning-company-with-availability. **No spec exists** — entry point is `/grill-me` with the
queued questions. Do not start or re-raise unprompted.

## Ops loose ends (small, mostly Bridger-manual)

- [ ] Live-test PR #161 on dev preview (0341 decline → bell + badge + banner; hard-refresh stale tabs).
- [ ] Stripe live-webhook checklist (runbook §5.1) — sequenced inside block 2 / T1-3 above.
- [ ] Stripe Dashboard branding checklist for hosted onboarding (manual, in redesign-audit memory).
- [ ] **Turn on Stripe automatic receipts** (Settings → Customer emails → Successful payments). The interim half of T2-1b: zero code, no money risk, but Nexxus-branded on every tenant's charge (separate charges and transfers use the platform's branding), so it gets revisited when the branded email lands. Note receipts never send in test mode.
- [ ] Verify prod platform balance heals ≥ $0 after the 1% fee (platform-fee follow-up).
- [ ] Flip the CI lint/tsc `continue-on-error` gates once pre-existing errors are cleaned (tsc already blocking; lint remains).
- [ ] Sweep the ping-dot idiom out of cleaner/homeowner/StatTile (Today-card restyle follow-up).
- [ ] Revisit the 1% platform fee once subscription pricing is set.
