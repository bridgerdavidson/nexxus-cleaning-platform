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

- [ ] **T1-8 first** — wire `payment_events` + reconciler findings to real alerts. It is the
      substrate several other fixes report through, and it IS the "balance-floor monitor"
      already owed as a platform-fee follow-up. T1-9 depends on it.
- [ ] T1-1 (CRITICAL: refund-unwind transfer-reversal failure = platform eats the money),
      then T1-2, T1-4, T1-5, T1-6, T1-7, T1-9, T1-10, T1-11 per the backlog.
- [ ] **T1-3 (bank_paid unreachable) is coupled to the webhook-events ops step**: fix
      **T3-12 BEFORE** subscribing `transfer.reversed` in prod (partial-reversal
      terminalization bug arms the moment the event is added), then add the 3 missing prod
      webhook events (`transfer.reversed`, `payout.paid`, `payout.failed` — runbook §5.1
      checklist), then the reconcile job. T3-13/14/15 are same-area cleanups to fold in.

## 3. Payments audit Tier 2 — visibility & notification gaps (pre-MVP)

Source: backlog Tier 2 (T2-1 … T2-18). Silent failures + operator/homeowner blind spots.
Biggest first: homeowner money notifications + `receipt_email` (T2-1 — re-check master, PR
#161 may cover part), disputes surface (T2-2), refunds visibility + confirm/partial-refund
dialog (T2-3/T2-4), then the rest.

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
- [ ] Verify prod platform balance heals ≥ $0 after the 1% fee (platform-fee follow-up).
- [ ] Flip the CI lint/tsc `continue-on-error` gates once pre-existing errors are cleaned (tsc already blocking; lint remains).
- [ ] Sweep the ping-dot idiom out of cleaner/homeowner/StatTile (Today-card restyle follow-up).
- [ ] Revisit the 1% platform fee once subscription pricing is set.
