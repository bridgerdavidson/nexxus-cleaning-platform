# Parallel session lanes — payments audit + Tier 2 + UX wins (2026-07-17)

Four Claude sessions are working the `docs/MASTER-TODO.md` queue at once. This file is the
**collision-avoidance contract**: it partitions the codebase into four lanes with **disjoint
file ownership** so no two sessions ever edit the same file. Read your lane, respect the
boundaries, and you can run several PRs deep without coordinating live.

> **If you are a session picking this up:** find your lane below, read *Global rules*, then work
> your *Ordered task list* top-down. The queue (`MASTER-TODO.md`) sets priority; the audit docs
> (`payments-audit-v4-backlog.md` + `-findings-detail.md`) are the per-item spec. This file only
> assigns *who touches which files*.

## Why partition by file, not by queue-block

The queue is sorted by urgency, but every block reaches into the same two hot directories:
`src/lib/payments/**` (money backend — Tier 1, Tier 3, Tier 2 emit sites) and
`src/components/redesign/**` (UI — Tier 2 surfaces, UX wins, dark mode). "One session per block"
would put two sessions in `reconcile.ts` and three in the same component. So we assign
**regions**, then map each region to the queue items it can finish.

---

## Global rules (all lanes)

1. **Never edit a file another lane owns.** If your queue item needs a change in someone else's
   file, it's a **handoff** (see the table below) — do your side, and the item completes when
   both lands. Different files, so no merge conflict, just an order.
2. **All DB migrations go through Lane B.** Two sessions grabbing `112_*.sql` at once is the
   nastiest collision. Highest migration today is `111`. If C or D needs a schema/RPC/publication
   change, add a line under *Migration requests* at the bottom of this file; B lands it. B will
   front-load the known Tier-2 DB migrations (T2-11 cents RPC, T2-12 realtime publication) early
   so C isn't blocked.
3. **Start every branch from current `master`.** Rebase on master before pushing. Because lanes
   own disjoint files, rebases stay clean.
4. **Small PRs, one logical change each.** Follow `CLAUDE.md`: `npm run test`, `npx tsc --noEmit`,
   `npm run lint` before push; new API routes get a co-located `*.integration.test.ts`, new
   `src/lib/**` logic gets a `*.test.ts` (invoke the `create-tests` skill).
5. **UI work runs through the skills.** Any real UI (C, D, and B's alert surface) invokes
   `ui-feature-workflow` + `ui-ux-pro-max` at design and implementation. Implement from the
   design system (`src/components/ui/*` + tokens); never copy mockup styling. No em dashes in
   product copy.
6. **When your lane runs dry, stop — don't wander into another lane's files.** Post a note here
   and take direction (dark mode / Tier 3 are the Phase-2 backlog below).
7. **Held out of the parallel phase:** dark mode (§6) and Tier 3 (§7) — see *Phase 2*. Don't start
   them while C/D are live; dark mode rewrites every component they own.

---

## Lane A — Cutover (legacy leaks → Phase 4)

- **Owner:** Session 1 (running). **Branch prefix:** `fix/cutover-*`.
- **Status:** §1 PR 1 merged (#172). Next: §1 PR 2, then §5 Phase 4 after soak.
- **Owns (exclusive):**
  - `next.config.ts`
  - `src/app/(redesign)/app/**/layout.tsx` (wrong-role guards)
  - `src/app/api/stripe/billing/**`, orphaned Stripe-URL routes it repointed
  - `src/app/billing/add-card/**` (the live emailed page) + invoices decision
  - legacy page dirs slated for Phase-4 deletion
- **Forbidden:** `src/lib/payments/**` (that's B — note `paymentSectionState.ts` and
  `HomeownerPaymentRecovery.tsx` were A's for #172 but are now **released** to B/D on master).
- **Queue:** §1 (gap scan legacy leaks) → §5 Phase 4 (owns `next.config.ts`, so retirement +
  `/app`-prefix removal stay here; order is load-bearing, see runbook §6).

## Lane B — Money backend correctness (Tier 1 → Tier 3)

- **Owner:** this session. **Branch prefix:** `feat/payments-t1-*` (then `-t3-*`).
- **Owns (exclusive):**
  - **all of `src/lib/payments/**`** (charge, settle, clawback, refund, reconcile, dispatch,
    events, moneyMath, processingFee, cancellationFee, webhookIdempotency, self-pay/ACH, …)
  - `src/lib/monitoring/**` (platform alerts)
  - `src/lib/notifications/eventTypes.ts` **+ every notification/alert emit call site**
  - `src/app/api/stripe/webhook/**`, `src/app/api/cron/reconcile-payments/**`
  - `src/app/api/payments/**`, `src/app/api/appointments/[appointmentId]/cancel/**`,
    `src/app/api/payments/[paymentId]/refund/**`, `dismiss` route
  - **all `supabase/migrations/*.sql`** (single migration owner — see rule 2)
  - the **`/app/owner` alert surface**: new component(s) in `src/components/redesign/platform/**`
    + wiring in `src/app/(redesign)/app/owner/**` (T1-8's in-app surface; decided in-app)
- **Forbidden:** `src/components/redesign/{payments,homeowner,cleaner,...}/**` except `platform`;
  `useAdminData/useHomeownerData/useCleanerData`; `notifications/labels.ts` (render = C/D).
- **Ordered task list** (spec = backlog Tier 1; internal order per MASTER-TODO §2):
  1. **T1-8** — wire `recordPlatformAlert` into the critical `payment_events` emit sites
     (money_math_violation, tenant_transfer_failed, cleaner_clawback_failed,
     transfer_reversal_failed, refund_clawback_failed) + have the cron route inspect its own
     sweep result and alert; build the **in-app `/owner` alert surface** reading `platform_alerts`.
     *This is the balance-floor monitor owed from the 1% fee work.*
  2. **T1-1** (CRITICAL) — dead-letter + retry + alert for failed transfer reversals in refund unwind.
  3. **T1-2** — bank_paid guard on `reverseJobTransfersForRefund`.
  4. **T1-4** — settle only after the payments row exists / derive fee from the PI (settlement race).
  5. **T1-5** — clear `authorization_status` on manual record + already-paid guard + order `alreadySettled`.
  6. **T1-6** — read + apply `no_show_fee_type/value` in the cancel route.
  7. **T1-7** — visible state + notify on `no_card`/`tenant_not_ready` bails; NULL-PM into a surface.
  8. **T1-9** — visible state for a failed tenant transfer (depends on T1-8 alerting landing first).
  9. **T1-10** — pass stored `account_id` (`Stripe-Account`) in dead-letter retry + terminal "dead" status.
  10. **T1-11** — attempt-suffix the `tenant-payout-`/`cleaner-payout-` idempotency keys.
  11. **T1-3 + T3-12 (coupled ops step):** fix T3-12 (partial-reversal terminalization) **before**
      subscribing `transfer.reversed`; then Bridger adds the 3 prod webhook events
      (`transfer.reversed`, `payout.paid`, `payout.failed`, runbook §5.1); then the reconcile
      bank_paid job; fold in T3-13/14/15.
  - then **§7 Tier 3** (ACH block before `STRIPE_ACH_ENABLED`; self-pay block before
    `STRIPE_SELF_PAY_ENABLED`) — same files, so B owns it, done after Tier 1.
- **Also owns the emit side of these Tier 2 handoffs:** T2-1 (homeowner charge/refund/fee events +
  `receipt_email`), T2-5 (cancel/no-show notifications), T2-9 (undismiss/resurface route),
  T2-11 (cents-precise `payment_stats`), T2-12 (durable realtime publication migration).

## Lane C — Operator / admin visibility UI (Tier 2 + operator UX wins)

- **Owner:** Session 3. **Branch prefix:** `feat/payments-t2-op-*`.
- **Owns (exclusive):**
  - `src/components/redesign/payments/**` (OperatorPayments, PaymentDetailSheet, usePaymentsTriage,
    PaymentsKpiStrip, `paymentsKpis.ts`, `payments-types.ts`)
  - `src/components/redesign/{bookings,overview,customers,calendar,messages,services,cleaners}/**`
  - `src/hooks/useAdminData.ts`, `useAdminActionItems.ts`
  - operator-facing dispute surface (new, under `redesign/payments/**`)
- **Forbidden:** `src/lib/payments/**`, any API route, migrations (request from B),
  `redesign/{homeowner,cleaner,notifications,platform}/**`, the `useHomeownerData/useCleanerData` hooks.
- **Ordered task list** (spec = backlog Tier 2; most items just READ tables the webhook already
  populates, so you are **not blocked on B**):
  1. **T2-2** — disputes list/detail surface (reads the `disputes` table; already written by webhook).
  2. **T2-3 / T2-4** — join refunds into the payments select + show refunded amount; confirm dialog +
     amount entry + partial-refund support.
  3. **T2-8** — surface an error state in the triage band (`usePaymentsTriage` ignores `.error`).
  4. **T2-10** — derive `refundable` from PI presence, not `payment_method==='card'`.
  5. **T2-16** — add the `approved` payout ledger filter.
  6. **T2-13** — reduce reliance on the client `NEXT_PUBLIC_*` mirror / add a drift check.
  7. **T2-11 (UI)** — display cents once B lands the cents-precise RPC.
  8. **T2-9 (UI)** — wire the undismiss/resurface affordance once B lands the route.
  9. **T2-5 (copy)** — fix the cancel-dialog "customer and cleaner will be notified" copy (B wires the
     actual notifications). **T2-7** — operator retry affordance for a failed cancellation/no-show fee.
  - **§4 UX wins (operator):** messages badge, availability in assign select, tappable Today rows,
    calendar skeleton (see gap scan §2).

## Lane D — Homeowner / cleaner experience UI (Tier 2 + their UX wins)

- **Owner:** Session 4. **Branch prefix:** `feat/payments-t2-hc-*`.
- **Owns (exclusive):**
  - `src/components/redesign/homeowner/**` (incl. `HomeownerPaymentRecovery.tsx` — released from A)
  - `src/components/redesign/cleaner/**`
  - `src/components/redesign/notifications/**` (the bell/feed render)
  - `src/lib/notifications/labels.ts` (notification label render)
  - `src/hooks/useHomeownerData.ts`, `useCleanerData.ts`, homeowner receipts
- **Forbidden:** `src/lib/payments/**`, any API route, migrations (request from B),
  `redesign/{payments,overview,customers,bookings,platform}/**`, `useAdminData`,
  `notifications/eventTypes.ts` + emit sites (B owns emit; you own render).
- **Ordered task list** (spec = backlog Tier 2):
  1. **T2-15** — surface held/failed payout amounts in the cleaner Earnings screen (reads existing rows).
  2. **T2-14** — receipt charge-kind + fee breakdown (fetch `charge_kind`/`processing_fee_cents`/`is_self_pay`).
  3. **T2-17** — loading/error states on the receipt deep link.
  4. **T2-18** — deterministic ordering in `useHomeownerAppointments` (add `.order()` / precedence).
  5. **T2-6** — quote the grossed-up total everywhere post-booking (now unblocked; #172 merged).
  6. **T2-1 (render)** — render the homeowner charge/refund/fee notification labels + receipts once
     B emits the events.
  - **§4 UX wins (homeowner/cleaner):** tappable hero, last-cleaning prefill; cleaner "Next up" card,
    "You're owed $X" (see gap scan §2).

---

## Cross-lane handoffs (do your side; item completes when both land)

| Item | Backend leg (Lane B) | UI leg | Note |
|---|---|---|---|
| T2-1 homeowner money notifications | add homeowner-audience charge/refund/fee events + `receipt_email` | D renders labels + receipt | B lands first; D renders |
| T2-5 cancel notifications | wire customer+cleaner notify in cancel route | C fixes dialog copy | independent files |
| T2-9 undismiss failed payout | add resurface/undismiss route | C wires affordance | independent files |
| T2-11 revenue cents | cents-precise `payment_stats` migration + RPC | C displays cents | B front-loads early |
| T2-12 realtime liveness | durable `ALTER PUBLICATION … ADD TABLE` migration | (none — infra) | B only |
| T1-9 tenant-transfer surface | visible state + alert | (owner surface is B's own) | B end-to-end |

Everything else in Tier 2 reads tables the webhook already populates (`disputes`, `refunds`,
existing payout rows), so **C and D are not blocked on B** for the bulk of their lists.

## Phase 2 — held until the parallel phase drains

- **§6 Dark mode** — touches every component C and D own; run it *after* their lanes quiesce, as a
  dedicated pass (plan: `docs/redesign/2026-07-16-dark-mode-plan.md`).
- **§7 Tier 3** — B's files; B runs it after Tier 1 (already in B's list).
- **§5 Phase 4** — Lane A, after soak; order is load-bearing (runbook §6).

## Migration requests (C/D append here; B lands them)

- _(none yet)_

---

## Appendix — kickoff prompts

Paste one into a fresh session. Each is self-contained enough to enforce boundaries even before
this doc is on the session's radar.

### Lane A (Session 1 — continue)
> You are **Lane A (Cutover)** in `docs/redesign/2026-07-17-parallel-lanes.md`. Read it, then
> continue §1: open PR 2 (re-theme `/billing/add-card` + decide invoices), then §5 Phase 4 after
> soak. Only touch Lane A's owned files (`next.config.ts`, layout guards, billing/add-card,
> legacy dirs). Start from current master.

### Lane B (this session — money backend)
> You are **Lane B (Money backend)** in `docs/redesign/2026-07-17-parallel-lanes.md`. Work the
> Tier 1 task list top-down starting at T1-8. You exclusively own `src/lib/payments/**`,
> `src/lib/monitoring/**`, the webhook/cron/payments API routes, all migrations, and the `/owner`
> alert surface. Never touch redesign UI outside `platform/**` or the role data hooks. Start from
> current master.

### Lane C (Session 3 — operator/admin UI)
> You are **Lane C (Operator/admin visibility UI)** in
> `docs/redesign/2026-07-17-parallel-lanes.md`. Read it and work your Tier 2 + operator UX-wins
> list top-down (start T2-2 disputes surface — it reads a table the webhook already populates, so
> you're not blocked on backend). You exclusively own `redesign/{payments,bookings,overview,
> customers,calendar,messages,services,cleaners}/**` and `useAdminData.ts`. Do NOT touch
> `src/lib/payments/**`, API routes, migrations (request from Lane B in the doc), or
> homeowner/cleaner/platform components. Invoke `ui-feature-workflow` + `ui-ux-pro-max` for UI.
> Start from current master.

### Lane D (Session 4 — homeowner/cleaner UI)
> You are **Lane D (Homeowner/cleaner experience UI)** in
> `docs/redesign/2026-07-17-parallel-lanes.md`. Read it and work your Tier 2 + homeowner/cleaner
> UX-wins list top-down (start T2-15 cleaner held/failed earnings — reads existing rows). You
> exclusively own `redesign/{homeowner,cleaner,notifications}/**`, `notifications/labels.ts`, and
> `useHomeownerData.ts`/`useCleanerData.ts`. Do NOT touch `src/lib/payments/**`, API routes,
> migrations (request from Lane B), operator/platform components, or `notifications/eventTypes.ts`
> (Lane B owns notification emit; you own render). Invoke `ui-feature-workflow` + `ui-ux-pro-max`
> for UI. Start from current master.
