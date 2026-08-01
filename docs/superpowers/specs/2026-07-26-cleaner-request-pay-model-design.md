# Cleaner-request pay model (flexible contractor umbrella) — design spec

- **Date:** 2026-07-26
- **Status:** Approved design; implementation in progress. **Amended during PR2's adversarial
  review:** the live offer amount rides `pay_requests.current_offer_cents` (migration 119) and
  transitions CAS on `(status, updated_at)`; the cleaner has NO direct RLS read on the thread
  tables (the row carries the price snapshot) - cleaner surfaces read a service-role route that
  shapes a price-free payload; org-authored amounts are price-capped at submission; settlement
  triggers are capture-gated; the settlement gate keys on thread existence and an approved thread
  stays the basis across later mode edits. See the plan's Phase 3 amendment block for details.
- **Origin:** MASTER-TODO §8 ("payout models", Task #3). Brainstormed with Bridger 2026-07-23/26;
  Q&A log in `brainstorming/2026-07-23-cleaner-decides-payout-model.md`.
- **Scope:** design only. No code ships from this document; an implementation plan follows.

## 1. Summary

Nexxus (the pilot org) pays its contractor cleaner the way small operators actually work: the org
books a job for a customer at a locked price the cleaner never sees, the cleaner does the work and
then tells the org what they want to be paid, and the org pays it (or negotiates) and keeps the
rest. This spec productizes that flow as a third per-cleaner **pay mode**, `request`, alongside the
existing `percentage` and a new (tiny) `flat` mode, all under one **flexible contractor** umbrella
where the platform pays cleaners via Stripe Connect. The org protects its margin with an
**auto-approve threshold**: any request that leaves the org at least a configured share of the job
price approves and settles instantly; anything richer escalates to an approve/counter flow.

Two properties keep this cheap and safe:

1. **The customer price is locked at booking.** The entire charge path (save card at booking,
   charge at completion, processing gross-up, refunds, disputes, reconcile sweep) is untouched.
2. **Settlement already branches per cleaner.** `cleaner_profiles.payout_model` exists today and
   all four settlement paths read it. This design adds new values and one new way to resolve the
   cleaner's amount; it does not restructure the payout system.

The genuinely new machinery is a small negotiation state machine (`pay_requests` +
`pay_request_offers`) and its UI.

## 2. Locked decisions (from the brainstorming session)

| # | Decision |
|---|----------|
| 1 | Built for the pilot first; generalized as a catch-all for orgs that negotiate pay per job. |
| 2 | Customer price locked at booking; the request only splits the fixed pie. |
| 3 | The pay request is a required step of the cleaner's mark-complete flow (atomic with completion). |
| 4 | Escalation = org approves as-is or counters an amount (+ optional note); cleaner accepts or counters back; a cleaner counter re-runs the threshold. Money only moves on a number both sides touched. There is no bare "decline": an org decline is expressed as a counter. |
| 5 | "Cleaner decides" is a per-cleaner pay mode, not a sibling org-level model. Two product models: flexible contractor (percentage / flat / request per cleaner) and cleaning company (hourly + availability, later build). |
| 6 | Price visibility follows the existing org `cleaner_pay_display` setting ('payout_only' for Nexxus). |
| 7 | Cancellation/no-show fees: request-mode cleaner gets $0 in-app; org keeps the fee minus the platform fee. |
| 8 | Scope: request mode + flat mode + the per-cleaner pay-mode picker (umbrella settings reframe) in one spec. |

## 3. Definitions

- **Job price / gross**: the appointment's booked price in integer cents, the same gross that
  `chargeCompletedAppointment` captures and that percentage payouts are computed against.
- **Request thread**: the single `pay_requests` row for an appointment plus its ordered
  `pay_request_offers`.
- **Offer**: one named amount from one side (cleaner ask, org counter, cleaner counter).
- **Threshold / `min_margin_bps`**: org setting; the minimum share of the job price the org must
  keep for a cleaner offer to auto-approve.

## 4. Taxonomy and value-space unification

`cleaner_profiles.payout_model` becomes the single source of truth with values:

```
'percentage' | 'flat' | 'request' | 'hourly_external'
```

`organizations.default_payout_model` moves to the same value space and is only the value stamped
onto newly added cleaners; the cleaner's own value always governs behavior. Migration maps the
org-level `'percentage_contractor'` → `'percentage'` (`'hourly_external'` is unchanged). All
consumers of the old org enum are swept in the same PR (grep `default_payout_model`; known
consumers include `AuthContext`, `PayoutSettingsSection`, platform tenant views, and the
reschedule route).

Mode semantics:

- **percentage** — exists today. Cleaner gets `floor(gross × payout_percent / 100)`.
- **flat** — new. Cleaner gets `min(flat_rate_cents, gross)` per completed job. No approval
  machinery. When the cap bites (flat rate exceeds a small job's gross), the settlement records an
  admin-audience `payment_event` (`payout.flat_capped`) and the org payments UI surfaces it.
- **request** — new. Cleaner gets the approved amount from the request thread (this spec).
- **hourly_external** — exists today, untouched. Cleaner is paid outside the app
  (`isCleanerPayable` = false); the future availability model builds on this.

## 5. Request lifecycle

### States

`pay_requests.status ∈ { pending_org, pending_cleaner, approved }`. `approved` is terminal and
carries `approved_amount_cents`, `approved_via ∈ { auto, org, cleaner_accept }`, `approved_by`,
`approved_at`.

### Boundary math

```
autoApproveMaxCents = floor(job_price_cents × (10000 − min_margin_bps) / 10000)
auto-approve iff request_cents ≤ autoApproveMaxCents     (inclusive)
```

Integer cents everywhere. `request_cents ≥ 0`; a $0 request is legal and auto-approves.
`min_margin_bps = 0` means every request auto-approves (up to the price cap);
`min_margin_bps = 10000` means every request above $0 escalates. The platform 1% fee is
deliberately outside this check: the threshold protects the org's gross margin, and the platform
fee continues to come out of the org's kept side exactly as in the percentage model.

### Transitions

| From | Actor + action | To |
|---|---|---|
| (job completion, cleaner submits `request_cents`) | cleaner | `approved` (via=auto) if within threshold, else `pending_org` |
| (org completes job on cleaner's behalf, enters amount) | org | `pending_cleaner` (org-authored offer) |
| `pending_org` | org approves as-is | `approved` (via=org) |
| `pending_org` | org counters (amount ≤ job price, optional note) | `pending_cleaner` |
| `pending_cleaner` | cleaner accepts | `approved` (via=cleaner_accept) |
| `pending_cleaner` | cleaner counters (new amount) | threshold re-runs → `approved` (via=auto) or `pending_org` |

Every transition appends a `pay_request_offers` row (or approval metadata). Each cleaner offer is
evaluated against the org's threshold **at that moment**, and the evaluated
`min_margin_bps_snapshot` is recorded on the offer row; editing the org setting never re-evaluates
existing offers. No round limits, no timeouts: a stalled thread sits visibly in the org queue with
its age. Nothing auto-resolves money.

### The over-price rule

Cleaner requests **above the job price are allowed and simply escalate**. Rejecting them at
submission would leak the hidden price through the error. The cap applies to **approvals**: no
amount above `job_price_cents_snapshot` can ever be approved or countered by the org, and the
explanation for that constraint appears only in org-facing UI. Consequence: an over-price request
cannot be approved as-is; the org must counter.

### Consent symmetry

Money moves only on a number both sides touched. Auto-approval counts as org consent because the
threshold is the org's standing pre-approval. An org-authored amount (counter, or org-side
completion) always requires the cleaner's accept.

## 6. Money and settlement

- **Charge**: unchanged. The homeowner's saved card is charged the locked price at completion
  regardless of request state; funds land platform-held. A stalled thread never delays the charge
  (cards decay, disputes don't wait).
- **Settlement**: transfers (cleaner payout + tenant remainder) fire only once the request is
  `approved`, with `cleanerCents = approved_amount_cents`. For auto-approved requests this is the
  same tick as today. For escalated requests, settlement **defers** — the same
  settlement-waits-until-ready pattern established by T1-4 — and the reconcile sweep remains the
  backstop for approved-but-unsettled rows. The sweep must treat *pending* threads as normal
  business state (not stuck money); see §14 open item 3.
- **Fee cap invariant**: `platformFee = min(platformFeeCentsFor(gross, bps), gross − cleanerCents)`
  and `tenantRemainder = gross − platformFee − cleanerCents ≥ 0`. Holds because approved amounts
  are capped at gross. Transfer idempotency keys (`cleaner-payout-${appointmentId}`,
  `tenant-payout-${appointmentId}`) are unchanged.
- **Self-pay**: works unchanged. The org is charged `approved_amount + platform fee (1% of the
  notional job price) + processing gross-up`; the threshold evaluates against the notional job
  price. The approval price cap stays universal (one rule everywhere); revisit if the pilot needs
  self-pay approvals above price.
- **Cancellation / no-show fees**: for request-mode cleaners, `cleanerCents = 0` on the fee split;
  the org keeps the fee minus the platform fee. (Decision 7.)
- **Refunds / disputes**: the unwind machinery (T1-1 and successors) operates on recorded amounts,
  not percents, and carries over unchanged. A dispute arriving while a thread is pending is
  strictly *less* exposed than today: transfers have not fired and funds are still platform-held.
- **Connect / held payouts**: request- and flat-mode cleaners must be Connect-onboarded exactly
  like percentage cleaners (`isCleanerPayable` keeps its shape; only the enum widens). The existing
  held-payout machinery applies unchanged when onboarding is incomplete.

## 7. Schema changes

- `cleaner_profiles`
  - `payout_model` check constraint gains `'flat'`, `'request'`.
  - `flat_rate_cents integer null` (required when mode is `flat`; validated in the API layer).
- `organizations`
  - `default_payout_model` migrates `'percentage_contractor'` → `'percentage'`; constraint updated
    to the unified value space; column default for new orgs becomes `'percentage'`.
  - `min_margin_bps integer not null default 2000` (Nexxus's 20%).
- `pay_requests` (new; org-scoped RLS; cleaner can read own threads)
  - `id uuid pk`, `organization_id`, `appointment_id unique not null`, `cleaner_id`,
    `status text check in ('pending_org','pending_cleaner','approved')`,
    `job_price_cents_snapshot integer not null`,
    `approved_amount_cents integer null`, `approved_via text null check in ('auto','org','cleaner_accept')`,
    `approved_by uuid null`, `approved_at timestamptz null`, `created_at`, `updated_at`.
  - Added to the `supabase_realtime` publication with `REPLICA IDENTITY FULL`
    (template: migration `048_invites_realtime.sql`).
- `pay_request_offers` (new; same RLS posture)
  - `id uuid pk`, `pay_request_id fk`, `actor text check in ('cleaner','org')`, `actor_user_id uuid`,
    `amount_cents integer not null`, `note text null`,
    `min_margin_bps_snapshot integer null` (set on cleaner offers),
    `auto_approved boolean not null default false`, `created_at`.
- `payouts`
  - `pay_request_id uuid null` reference.
  - `payout_model_snapshot text null` so every payout row states which mode produced it
    (`payout_percent_snapshot` stays null for flat/request payouts).

Writes go through API routes using the admin client with explicit org/actor guards, matching the
repo's existing convention; RLS is the read-side net.

## 8. API surface

- **Mark-complete** (the cleaner's existing completion flow; exact route identified at plan time):
  accepts `request_cents`, **required** when the completing cleaner's mode is `request` and
  rejected otherwise. Creates `pay_requests` + the first offer atomically with completion, runs the
  threshold, and either settles (auto) or parks the thread at `pending_org`.
- **Org completes on the cleaner's behalf**: the same route/flow prompts the org for an amount and
  creates an org-authored offer at `pending_cleaner`.
- `POST /api/pay-requests/[id]/approve` — org approves the current cleaner offer as-is.
- `POST /api/pay-requests/[id]/counter` — org counters `{ amount_cents, note? }`; validation caps
  at `job_price_cents_snapshot`.
- `POST /api/pay-requests/[id]/respond` — cleaner `{ accept: true }` or `{ amount_cents, note? }`
  (re-runs the threshold).

All routes: org-scoped, permission-gated (§10), valid only from the expected state (else 409 so
the client refreshes), idempotent approvals, co-located `*.integration.test.ts` per repo
convention.

## 9. UX

### Cleaner

- Completion flow gains one required step for request-mode cleaners: "Request your pay". The input
  is anchored **only by the cleaner's own history** (last approved amounts at this property, their
  typical range), never the customer price unless the org runs `cleaner_pay_display: 'full'`.
- Submit resolves instantly to "You earned $X" (auto-approved; existing earnings surfaces take
  over) or "Sent to [org] for approval".
- Earnings rows gain two states: *awaiting approval* and *countered*. Countered opens the thread
  view (offer history + notes) with Accept or counter-back. Notifications on counter and approval.
- Flat-mode cleaners see no new steps anywhere; their earnings rows show the flat amount.

### Org

- **Settings → Payouts** presents the flexible-contractor umbrella: the org default pay mode, the
  threshold setting (UI copy: "Requests that leave you at least this share of the job price are
  approved automatically"), and per-cleaner mode + parameter (percent, flat dollars, or request)
  in cleaner management.
- **Payments page** gains a "Pay requests" queue: job, cleaner, price, requested amount, resulting
  margin in dollars and percent, thread age; actions Approve / Counter (amount + note). Realtime
  badge count on the nav.
- Job detail shows thread state for request-mode jobs.

All UI is built from the design system per the `ui-feature-workflow` skill; no em dashes in any
user-facing copy.

## 10. Permissions

Approve/counter is gated by the existing payments-approval manager permission (exact flag
verified at plan time via `useManagerPermissions`; a new `can_approve_pay_requests` flag is added
only if nothing fits). Admins and owners always can. Cleaners can act only on their own threads.

## 11. Events and observability

New admin-audience `payment_events` types, written at each transition:
`pay_request.submitted`, `.auto_approved`, `.escalated`, `.countered`, `.accepted`, plus
`payout.flat_capped` (§4). The ledger stays append-only forensics; current state lives on
`pay_requests`. Homeowner-audience events (T2-1) are unaffected.

## 12. Edge cases

- **Org-side completion**: org enters the amount, cleaner must accept (§5, consent symmetry). An
  unresponsive cleaner stalls that thread (and the org's own remainder); accepted for the pilot.
- **Threshold edited mid-thread**: next cleaner offer uses the new value; prior offers keep their
  snapshots.
- **Zero-price / comped jobs**: approvals cap at $0 like any job; the org compensates offline.
  Funding real pay on a $0 charge needs self-pay-style org funding and is out of pilot scope.
- **Races / double-taps**: state-guarded transitions (409 on stale state), idempotent approve,
  unchanged transfer idempotency keys. Same guard class as T1-5.
- **Dispute during a pending thread**: transfers have not fired; the existing
  no-settlement-during-dispute guard is verified against the deferred path at plan time.
- **Cleaner offboarding with an open thread**: blocked until the thread resolves, same class as
  deleting a cleaner with pending payouts.
- **Cleaner not Connect-onboarded**: request flow runs normally; the transfer holds exactly as
  held payouts do today.

## 13. Accepted trade-offs (named, not fixed)

- The auto-approve boundary leaks price bounds over repeated requests (a cleaner can bracket the
  price). Inherent to any threshold; accepted.
- Auto-approve replaces human review with a margin floor on most jobs. That is the feature.
- No timeouts: stalled threads wait for a human, visible with age in the queue.
- The website's `PayModelsSection` currently sells pre-job rate-naming ("name their price per
  job"); the real model is post-job requests. Marketing copy follow-up when this ships.

## 14. Open items to verify at plan time

1. Exact completion route(s) for cleaner- and org-side completion, and their current payloads.
2. Which existing manager-permission flag gates payment approvals; reuse vs. new flag.
3. Reconcile sweep: exclude pending-thread appointments from "stuck money" alerts while still
   catching approved-but-unsettled rows.
4. Confirm the dispute/settlement interlock covers the deferred-transfer window.
5. Payout row lifecycle under deferral: create-held-at-completion vs. create-at-approval; align
   with how held payouts are represented today (T2-15 surfaces).
6. Full consumer sweep list for the `default_payout_model` value rename.
7. Where cleaner offboarding is enforced today, to add the open-thread block.
8. `withTestOrg` extension shape (`{ payoutModel, minMarginBps }`) and fixture updates.

## 15. Testing

- **Unit** (`src/lib/**`, co-located `*.test.ts`): boundary math (floor, inclusive ≤, bps 0 and
  10000, over-price), every legal and illegal state transition, per-mode amount resolution
  (percentage / flat incl. cap / request), fee cap against flat and approved amounts.
- **Integration** (co-located `*.integration.test.ts`, helpers in `tests/helpers/`):
  complete-with-request auto and escalate paths; the three thread routes (permissions, org scope,
  state guards, price cap, idempotent approve); settlement defers then resumes on approval;
  reconcile sweep catches approved-but-unsettled; self-pay request path; cancellation fee pays the
  cleaner $0; org-side completion creates a `pending_cleaner` offer.
- **E2E** (Playwright, `tests/e2e/`): auto-approve happy path (complete → request → "You earned
  $X"); escalate → org counters → cleaner accepts → payout visible.

## 16. Rollout

No feature flag. Everything is additive and inert until a cleaner's `payout_model` is set to
`request` or `flat`; existing orgs and cleaners behave identically before and after the migration.
Pilot rollout = flip Nexxus's cleaners to `request` in settings once they confirm their threshold.
Migration is a normal numbered migration through the migrate-dev/migrate-prod pipeline.

## 17. Out of scope

- The cleaning-company availability model (umbrella 2; next build, runs while the pilot runs on
  this).
- Marketing `PayModelsSection` copy update (follow-up PR when this ships).
- Ad-hoc one-off payouts outside a job (declined; see cancellation-fee decision).
- Paying cleaners on comped/zero-price jobs.
- Payout analytics (average margin per cleaner, request patterns).
