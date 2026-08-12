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

## 3. The remaining money + product queue (ONE list — the lanes are retired)

**2026-08-01: the parallel-lane split (A cutover / B money backend / C operator UI / D
homeowner-cleaner UI, from `docs/redesign/2026-07-17-parallel-lanes.md`) is DISSOLVED by
Bridger's call.** Lanes A and C were already closed; what remained of B and D is folded into
the single list below, and each task carries BOTH its backend and UI halves so related work
ships together in one PR. One session works this list top to bottom. The old lane file-ownership
rules no longer apply.

Already shipped from Tier 2 (checkboxes swept in `payments-audit-v4-backlog.md`): T2-1
(#213 + #214), T2-2/3/4/8/10/13/16 + the T2-5 copy fix + the T2-7 visibility half (#180),
T2-6 recovery-card gross-up (#183), T2-14/17/18 (#182), T2-15 (#181). T3-10 shipped in #172.

- [x] **3.1 Fee retry, end to end (T2-7).** **Shipped in this PR (retry endpoint + operator sheet retry + homeowner honesty/Pay now; L-7 closed).** Backend: retry endpoint for a failed
      cancellation/no-show fee, keyed on the failed payment row (re-POSTing the cancel route
      can't reconstruct party/no_show). UI: retry affordance on the failed-fee row
      (PaymentDetailSheet / triage band). Stretch: the homeowner-side fee retry surface (L-7).
- [x] **3.2 Failed-payout dismiss round trip (T2-9).** ✅ DONE 2026-08-11 (fee-dismiss PR):
      dismissal is now an honest 24h SNOOZE (`payoutDismissSnooze.ts`; the triage query stops
      honoring stale stamps, so a payout the sweep keeps failing resurfaces with a "Still
      failing" treatment instead of staying invisible), plus `POST /api/payouts/:id/undismiss`
      with a Snooze/Restore toggle in the payout detail sheet.
- [x] **3.3 Cents-precise payment stats (T2-11).** Migration: `payment_stats` returns cents
      (077 rounds to whole dollars). UI: KPI tiles consume cents. While in there, verify the
      revenue KPI nets out refunds (the T2-3 join fixed the ledger view, not necessarily the RPC).
      **✅ DONE 2026-08-11: migration 20260811203429 returns integer-cents keys (legacy dollar
      keys kept cents-precise for the deploy window) AND nets pending+succeeded refunds per
      payment (the verification found the RPC did NOT net partial refunds; a full refund was
      already excluded via status='refunded'). usePaymentStats/KPI tiles/overview consume cents.**
- [x] **3.4 Cleaner price read-path seal (pay-request PILOT BLOCKER) — BUILT, open as PR #226** **MERGED 2026-08-01 (#226, d0decab); pilot flip unblocked.**
      (`fix/cleaner-price-readpath`, migration 122: RLS seal + service-role cleaner read routes +
      DEFINER `cleaner_stats`). Background: cleaners could read `appointments.total_price` under
      row-level RLS and compute the auto-approve cap, making migration 119's price-seal cosmetic
      (write-up on PR #221). Merging #226 unblocks the pilot flip; residuals documented in its
      body. Do NOT set a real cleaner to `request` mode before it lands.
- [x] **3.5 T2-1b emailed receipts** (see 3a below; prereq: confirm the five SMTP vars in prod).
      **✅ DONE 2026-08-11: org-branded receipt emails for charge/refund/fee, drained from the
      notification_events outbox (`dispatchReceiptEmails.ts`, claim-first on email_dispatched_at,
      retry + platform alert on exhaustion) via `POST /api/cron/notification-emails` on a 5-min
      pg_cron (migration 20260811211708, incl. backfill stamp so the historical bell backlog is
      never mailed). SMTP vars confirmed in prod. ⚠ The prereq check found `CRON_SECRET` missing
      in prod (see Ops loose ends): until it is set, this cron AND the reconcile sweep never fire.**
- [ ] **3.6 Cancel notifications (T2-5, emit half).** The cancel route notifies neither customer
      nor cleaner (including when it charges a no-show fee). Wire the notifications, then restore
      the honest-but-minimal dialog copy #180 had to neuter ("This can't be undone.").
- [ ] **3.7 Realtime durability migration (T2-12).** payments/appointments live in the
      `supabase_realtime` publication via dashboard config only; add the durable
      `ALTER PUBLICATION` migration (048/081 pattern) so a rebuilt env keeps ledger liveness.
- [ ] **3.8 Small sweep (one PR):** card-links email quotes the grossed-up total (T2-6 email leg —
      verify against current code first); homeowner notice when a refund later FAILS at Stripe
      (T2-1 follow-up: today the bell promises money that never arrives, admins-only alert);
      org-scope the migration-075 `payouts_select` RLS join (latent leak flagged in the #205
      review, 104/106 pattern); wire-or-delete the 3 dead analytics charts +
      `useAdminActionItems.ts` (verified dead 2026-07-22).
- [ ] **Follow-up hardening (from 3.1): fee-retry payments-row lease.** The reauth-counter claim
      only narrows the concurrent double-charge window on fee retries (same-token/stale-token
      replays); a reader arriving after the bump but before the outcome write can still create a
      second PI. Real fix: atomic failed-to-retrying claim on the payments row + a stuck-row
      recovery path (likely a status CHECK migration). Flagged in the fee-retry final review
      2026-08-01. (Numbered 3.9 in an earlier draft; 3.9 now belongs to messaging below.)

Opportunistic alongside any of the above: the backlog L-items (L-2 sub-minimum charge,
L-4 refunds-embed pin, L-5 webhook reclaim re-stamp, L-9 orphaned Connect routes).

### 3a. T2-1b — emailed money receipts (item 3.5 above)

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

## 3.9. Messaging UI unification — full audit + fix (URGENT, MVP-blocking)

Added 2026-08-01 (Bridger). The conversations UI evolved piecemeal as each platform was built
out, and the three role surfaces no longer look like one product. The **operator/admin inbox is
the gold standard** (`src/components/redesign/messages/**`: InboxList, ConversationRow,
MessageThreadPanel, MessageBubble, MessageComposer, ContextPanel, takeover view); cleaner and
homeowner each grew parallel component sets (`redesign/cleaner/messages/**`,
`redesign/homeowner/messages/**`) that have drifted visually. Cleaner/homeowner are
**structurally** different on purpose (appointment-based job threads vs the operator inbox) and
stay that way; the *visual language* (bubbles, composer, rows, headers, empty/loading states,
timestamps, unread treatment) must unify.

- [x] **3.9.1 Audit.** ✅ DONE 2026-08-10: docs/messaging-ui-audit.md (16 drift hotspots + adoption decisions + PR slicing; doubles as the 3.9.2 spec). Inventory every messaging surface, including the embedded ones
      (`JobMessagesPanel` in booking detail, `PayRequestThreadSheet`, cleaner active-job thread,
      `MessageAttachmentsLightbox`, `NavMessagesBadge`). Screenshot each role side by side,
      catalog every inconsistency (styling, spacing, states, mobile behavior), and mark which
      admin primitives each drifted copy should adopt. Deliverable: audit doc under `docs/`
      that becomes the spec for 3.5.2.
- [x] **3.9.2 Unify.** ✅ DONE 2026-08-11 as a three-PR stack, validated by Bridger on the
      seeded demo cast: #239 (invisible consolidation: one time/format module, dead-code
      sweep, NavMessagesBadge adoption), #241 (shared primitives + operator adoption:
      ThreadHeader, InboxRow, pills/status map pinned to the bookings BADGE source, thread
      states, PersonPicker, Details re-token), #243 (cleaner + homeowner re-skin: flush
      lists, unified + trigger and header, round OrgAvatar office rows, takeover desktop
      cap). Structure stayed role-specific; the skin is one product.

## 3.95. Mobile polish pair (added 2026-08-01)

- [ ] **3.95.1 Login button on the mobile landing page.** `MarketingNav.tsx` hides the Log in
      button below the `sm` breakpoint (`hidden sm:inline-flex`), so on phones the header shows
      only logo + "Join the waitlist" and login survives only as a footer link. Add a mobile
      login affordance to the nav chrome (fits the rolling small-UI-batch branch pattern).
- [ ] **3.95.2 iOS status-bar color sweep (native feel).** Full-app pass so the strip behind
      the iOS status bar (time/battery area) matches each screen's top-of-page surface color in
      every state, instead of a single static color. Today `theme-color` is only set per-tenant
      on tenant surfaces (branding PR #227). Sweep = audit every route + state (marketing, auth,
      each role shell, scrolled headers, takeovers/sheets that change the top surface) and drive
      `theme-color` dynamically to match, plus `viewport-fit`/safe-area-inset handling where the
      layout should extend under the notch. Must COMPOSE with white-label branding (#227 owns
      the per-org value on tenant surfaces) and gains a second axis when dark mode (block 6)
      lands, so build it as a small helper, not scattered hardcodes.

## 4. Gap scan §2 — UX quick wins (✅ DONE 2026-07-29)

- [x] **All 20 shipped.** High + S items via #168/#180/#181/#188/#189/#197/#198; the final four
      via #215 (operator messages badge + clickable KPI tiles) and #216 (homeowner booking
      prefill + cleaner offline Today cache), merged 2026-07-28/29. The ping-dot sweep was
      mooted by Phase 4's dead-code deletion.

## 5. Phase 4 — legacy retirement + /app prefix removal (✅ DONE)

- [x] **Complete.** 4a-4g all merged + the `redesignUiEnabled` flag retired (#201). Role roots
      live in prod: `/admin` `/cleaner` `/homeowner` `/owner`.

## 6. Dark mode (built 2026-08-11, PR open)

Source: dark-mode plan (design revised 2026-08-11: per-user grain reaffirmed + per-theme org
logo assets, `docs/redesign/2026-07-16-dark-mode-plan.md`).

- [x] Phase 1 theme-complete the live surface (token retrofit; MessagesPage-era list was stale,
      real surface was 6 legacy files + status ramps)
- [x] Phase 2a dark logo pipeline (`logo_icon_dark_url`/`logo_full_dark_url`, 2x2 Branding
      slots, dual-theme preview + nudge, CSS-level OrgLogo/loader swap)
- [x] Phase 2b 3-way Light/Dark/System control in all three role settings (go-live)
- [ ] Phase 3 `user_profiles.theme` cross-device sync (post-MVP fast-follow)

## 7. Payments audit Tier 3 — flag-flip gates (not MVP-blocking)

Source: backlog Tier 3. Do the ACH block (T3-1 … T3-4) before ever enabling
`STRIPE_ACH_ENABLED`; the self-pay block (T3-5 … T3-9, T3-11) before `STRIPE_SELF_PAY_ENABLED`.
(T3-10 ships in block 1; T3-12…15 fold into block 2's webhook work.) Plus the "lower-severity /
ledger-accuracy" L-items opportunistically.

## 8. Payout models — pay-request pilot follow-ups

The "cleaner decides pay" (request-mode) stack SHIPPED 2026-07-31 (#205/#224/#217/#221,
migrations 117-120 in prod). Spec:
`docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md`.

- [x] **Pilot-flip blocker = the price read-path seal (PR #226, item 3.4 above).** Resolved by #226. Until it
      merges, do not set a real cleaner to `request` mode.
- [x] Org pay-model simplification (org setting becomes per-job-vs-hourly only; new cleaners get
      NO default pay; operator nudged per cleaner). **SHIPPED 2026-08-01 (#232, f7b7c5d).** Plan:
      `docs/superpowers/plans/2026-07-28-org-pay-model-simplification.md` — currently UNTRACKED
      in the landing-page worktree; commit it before starting.
- [ ] Papercuts: 30s cleaner pay-request polling latency; scorecard percent-based earnings
      estimates are wrong for flat/request cleaners.
- Umbrella 2 (cleaning company: hourly + availability) stays a later build.

## Ops loose ends (small, mostly Bridger-manual)

- [ ] ⚠⚠ **Set `CRON_SECRET` in prod — the reconcile sweep has never run there.** Discovered
      2026-08-11 while shipping 3.5: an unauthenticated POST to prod
      `/api/cron/reconcile-payments` returns the fail-closed 500 ("Server misconfigured"),
      which is the missing-`CRON_SECRET` branch, and `vercel env ls` shows no `CRON_SECRET`
      in any environment. So every pg_cron-driven route (reconcile sweep 067, auto-defer 064,
      and now notification-emails) is dead in prod; webhooks alone have been carrying money
      correctness, and the "sweep backstops missed webhook deliveries" assumption is false
      today. Fix (Bridger): generate a random 64-char secret; `vercel env add CRON_SECRET
      production`; in prod Postgres set the matching `app.cron_secret` plus `app.api_base_url =
      'https://nexxus-cleaning-platform.vercel.app'` (hosted Supabase: `ALTER DATABASE postgres
      SET ...`, then re-login/reload so pg_cron's new connections see it); redeploy prod; verify
      behaviorally (unauthenticated POST now 401s, `cron.job_run_details` shows 200s). Do the
      same for the dev preview if preview sweep coverage is wanted.
- [ ] **Repoint the test-mode Stripe webhook back at dev.** It still targets the deleted
      pay-request walkthrough branch alias, which no longer deploys; restore
      `nexxus-cleaning-platform-git-dev-…vercel.app/api/stripe/webhook` with the same
      `x-vercel-protection-bypass` param. Time-sensitive if any preview money testing happens.
- [ ] Live-test PR #161 on dev preview (0341 decline → bell + badge + banner; hard-refresh stale tabs).
- [ ] Stripe live-webhook checklist (runbook §5.1) — sequenced inside block 2 / T1-3 above.
- [ ] Stripe Dashboard branding checklist for hosted onboarding (manual, in redesign-audit memory).
- [ ] **Turn on Stripe automatic receipts** (Settings → Customer emails → Successful payments). The interim half of T2-1b: zero code, no money risk, but Nexxus-branded on every tenant's charge (separate charges and transfers use the platform's branding), so it gets revisited when the branded email lands. Note receipts never send in test mode. **Update 2026-08-11: the branded email shipped (3.5). Once the CRON_SECRET fix above is done and the drain is verified sending in prod, either skip this toggle or turn it off if it was enabled, so homeowners don't get two receipts per charge.**
- [ ] Verify prod platform balance heals ≥ $0 after the 1% fee (platform-fee follow-up).
- [ ] Flip the CI lint/tsc `continue-on-error` gates once pre-existing errors are cleaned (tsc already blocking; lint remains).
- [ ] Sweep the ping-dot idiom out of cleaner/homeowner/StatTile (Today-card restyle follow-up).
- [ ] Revisit the 1% platform fee once subscription pricing is set.
