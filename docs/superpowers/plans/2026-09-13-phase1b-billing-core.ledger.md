# SDD ledger — plan: docs/superpowers/plans/2026-09-13-phase1b-billing-core.md

Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md (read, reachable, binding)
Branch: feat/phase1b-billing-core (PR D), then feat/phase1b-stripe-billing (PR E)
Worktree: .claude/worktrees/phase1b   Base: d875d30 (origin/master)

## Pre-flight scan

### Shared files and interfaces, task pair by task pair

| Producer | Consumer(s) | Produced vs consumed | Finding |
|---|---|---|---|
| T2 `billing/plans.ts` | T4 TRIAL_SEAT_CAP; T10 PLANS+PLAN_TIERS; T11 TRIAL_DAYS; T12 TRIAL_EXTENSION_DAYS; T14 LOOKUP_KEYS+LookupKey; T15 PLANS+lookupKeyFor+seatLookupKeyFor; T16 PLANS+seatBounds+lookupKeyFor+seatLookupKeyFor; T19 tierFor+PLANS | every consumed symbol is in T2's code block | P4 (doc only) |
| T4 `billing/access.ts` | T5 OrgSubscriptionStatus; T6 deriveBillingAccess+ORG_BILLING_COLUMNS+OrgBillingRow; T10 same; T12 same | all present in T4's code block | P5 (doc only) |
| T3 `billing/flags.ts` | T6 billingEnforcementEnabled; T10 same; T16 billingTaxEnabled | match | clean |
| T6 `billing/guard.ts` | T10 assertOrgWritable; T20 must NOT import it | match, invariant consistent | P2 |
| T6 `requireOrgAuth.ts` | T7, T8, T9 `requireWritable` option | match | clean |
| T11 `tests/helpers/fixtures.ts` | T12/T16 use `withTestOrg({billing})`; T7/T8/T10 run BEFORE T11 | T7 text explicitly handles running first (direct column update); T8/T10 use direct updates; T12/T16 come after T11 | clean, ordering verified |
| T5/T16/T18/T22 `payments/orgBilling.ts` | four tasks, distinct symbols, sequential | mapSubscriptionStatus / appendBillingEvent / pause-resume-cancel / delete start | clean |
| T14/T16/T17/T18/T22 `stripe/billing.ts` | five tasks, additive, sequential | clean |
| T1 `platform_stats` + `types/platform.ts` | no other task | clean |
| T2 `marketing/pricing.ts` | no other task; 2 existing importers must keep working | T2 preserves every export name | P6 |
| T7 `authorizeCatalog.ts` | covers 6 routes at once; T8/T9 cover disjoint routes | no route guarded twice | clean |

### Per-task internal consistency (does each task's test agree with its own code?)

| Task | Verdict |
|---|---|
| T1 | consistent. Backfill cutoff is a deliberate fill-in, explained in Step 2. |
| T2 | consistent; `<keep ...>` markers are copy instructions, explained. See P6. |
| T3 | consistent (no test, three predicates). |
| T4 | **CONFLICT P1**: `it.each` expects `none` -> `trial_expired` frozen, but the code maps `none` -> `trialing` and then applies the clock, which for the fixture's future `trial_ends_at` yields `trialing`, unfrozen. |
| T5 | consistent. |
| T6 | **DEFECT P2**: the invariant test's `walk` helper calls `require('node:fs')` inside an ESM module. |
| T7, T8, T9 | consistent. |
| T10 | **CONFLICT P3**: test expects `nextTierFor(40)` to be null, but the code returns 'Pro' because Pro's maxSeats is null (unlimited), so it always matches. |
| T11 | consistent. |
| T12 | consistent; fixture owner-vs-admin question is flagged inside the task. |
| T13, T14, T15 | consistent. T15 leaves `basePriceLookupKey` unread by the diff function (it exists for readCurrentItems' shape). |
| T16 | consistent; the bare `organization_members` insert may hit an FK, and the task already names the fallback. |
| T17-T21 | prose-specified rather than full code. Consistent with themselves, but they need a more capable implementer. |
| T22, T23 | consistent. |

## Pre-flight rulings

Ruling P1: `deriveBillingAccess` must short-circuit `subscription_status === 'none'` to `trial_expired` with `frozen: true` BEFORE consulting the trial clock. Spec §7 says a `none` row is treated as trial_expired, full stop, and T4's own test asserts it; the code block's "map none to trialing then apply the clock" contradicts both. The spec is binding and fail-closed is the safe direction: an org in an impossible state sees a plan picker rather than silently receiving free service. Cost if wrong: an organization whose status is `none` but whose trial clock is genuinely live gets the paywall a little early. T1's backfill converts every such row to `trialing`, so this should never fire in production.

Ruling P2: the invariant test imports `readdirSync`, `statSync`, and `existsSync` at module top rather than calling `require` inside the helper. Vitest runs these as ESM where `require` is not defined, so the test as written would throw rather than assert. Cost if wrong: none, it is the same check.

Ruling P3: `nextTierFor` takes the current tier: `nextTierFor(seatsInUse: number, currentTier: PlanTier | null): string | null`, returning the name of the cheapest tier STRICTLY ABOVE `currentTier` whose seat ceiling admits `seatsInUse + 1`, and null when the current tier already admits it or none is higher. As written the function always returns 'Pro' for any large number, because Pro's ceiling is null, so the test's null case is unreachable. The corrected semantics also read better at the call site: an org on Pro that hits its purchased-seat cap needs more seats, not a different plan. Update the implementation, the test cases, and the call site, which passes `billingRow.plan_tier`. Cost if wrong: the 409's upgrade hint names the wrong plan; the refusal itself is unaffected.

Ruling P4 / P5 (documentation only): where a task's "Produces" line omits a symbol its own code block exports (`PLAN_TIERS` and `planChargeCents` in T2, `OrgSubscriptionStatus` in T4), the code block is authoritative. Cost if wrong: none.

Ruling P6: T2's `<keep the existing ... verbatim>` markers are the one place the plan cannot inline its values without copying eighteen marketing strings. To remove the risk of an implementer rewording them, the controller hands T2 a verbatim copy of the current `src/components/marketing/pricing.ts` as a reference file in the dispatch. Cost if wrong: a marketing string drifts, which the existing `pricing.test.ts` and the task review would catch.

Ruling P7: model assignment follows spec §20's build model. Migration, catalog, guard, seat cap, and all of PR E go to Opus (money-adjacent, multi-file, or prose-specified). The route-wiring batches, the status mapping, the fixture change, and the trial-extend route go to Sonnet (mechanical, complete code in the brief). Cost if wrong: a cheaper model stalls and the fix loop escalates, which the loop already handles.

## Task log

Task 1: implementer DONE (opus), commit 7d750ae. Migration 20260913032635_saas_billing_phase1.sql,
cutoff literal '2026-09-13 03:26:35+00'. db reset clean + re-applied idempotently; 9 columns and
14 platform_stats keys verified; filename guard 8/8; tsc + eslint clean; platform-stats integration 5/5.
Task 1: implementer also extended METRIC_KEYS in platform/stats/route.integration.test.ts (typed
`keyof PlatformStats`, would otherwise silently skip the six new counters). Disclosed; no later task
touches that file. Under review.
Task 1: implementer raised — backfill comps pre-cutoff orgs regardless of status, so a pre-cutoff
`active` org would be both paying and comped.
  Ruling: not a defect, and the precedence is already deliberate. Spec §17 states "Comped org with a
  Stripe subscription. Comp wins (§7 precedence). The back office warns when comping an org that has
  an active subscription." Task 4's deriveBillingAccess already returns `comped` first. No change.
  Cost if wrong: a paying org would get free service; unreachable today because no org is `active`,
  and PR G's back office surfaces comped orgs in a filter.

Plan corrections committed as bbcaf99 (rulings P1, P2, P3 applied to the plan text, so every brief
extracted from here on is correct at dispatch).
Task 1: review clean — spec PASS (byte-identical to the brief but for the two intended
substitutions), quality Approved, 0 Critical, 0 Important.
Task 1: minor (deferred): backfill statement 1 (none -> trialing) has no cutoff, so a genuinely new
  `none` org on a re-run gets flipped to trialing with a fresh clock. Fail-open, no data lost.
Task 1: minor (deferred): pre-cutoff pilot orgs are counted in BOTH `trialing` and `comped`.
  PR G's overview must not present those two buckets as disjoint.
Task 1: minor (deferred): the comp cutoff is file-creation time, not apply time, so an org created
  between then and the prod deploy is not comped. Matches intent; all pilot orgs predate it.
Task 1: "cannot verify from diff" — reviewer could not confirm the tier/period literals against the
  brain pricing doc. RESOLVED by controller: src/components/marketing/pricing.ts already mirrors the
  locked doc with Starter/Growth/Pro and BillingPeriod 'annual'|'monthly'. Not a gap.
Task 1: complete (commits 0589869..7d750ae, review clean)
Task 2: implementer DONE (opus), commit e57f1e8. plans.test 11/11, pricing.test 6/6 untouched,
test:unit 1632 pass (only the known formDraft flake), tsc + eslint clean. Implementer proved the
marketing strings unchanged with a temporary parity test against the HEAD version (one differing
string position, feature 2.1, the intended seat-bullet swap) plus tierTotal/overCap agreement
across 246 combinations. Temp files deleted. Under review.
Task 2: implementer concerns, all non-blocking:
  - `popular` now serializes after `features` on the Growth object (deep equality identical).
  - planMonthlyCents' annual path divides EXTRA_SEAT_ANNUAL_CENTS by 12: exact at $120/yr, fractional
    if that constant ever stops being a multiple of 12.
  - PLAN_TIERS and planChargeCents shipped though the brief's "Produces" list omits them (ruling P4).
Task 2: review clean — spec PASS (plans.ts and plans.test.ts byte-identical to the brief), quality
Approved, 0 Critical, 0 Important. Reviewer independently reconstructed the post-change pricing.ts
and diffed every string literal against the reference: the ONLY user-facing change is Pro's seat
bullet. 1206 tierTotal/overCap comparisons, zero mismatches. No non-ASCII introduced.
Task 2: minor (deferred): EXTRA_SEAT_ANNUAL_CENTS / 12 has no Math.round; exact today, fractional if
  the annual seat price ever stops dividing by 12.
Task 2: minor (deferred): COPY and PRICING_TIERS share one features array reference; nothing mutates it.
Task 2: minor (deferred): lookupKeyFor/seatLookupKeyFor use unchecked `as LookupKey` casts (safe, the
  parameter unions cover exactly the eight keys).
Task 2: minor (deferred): TRIAL_EXTENSION_DAYS, PLAN_TIERS and planChargeCents have no test coverage.
Task 2: complete (commits bbcaf99..e57f1e8, review clean)
Tasks 3+4: implementer DONE_WITH_CONCERNS (opus, batched). Task 3 = 87a98bb (flags.ts),
Task 4 = 45ab847 (access.ts + access.test.ts). access.test 22/22; test:unit 1654 pass with only the
known formDraft flake; tsc + eslint clean. Both files verbatim from the briefs including the
unconditional `none` -> trial_expired/frozen branch.

Task 4: Ruling (carried into Task 19): `handleSubscriptionUpsert` must NOT write
  subscription_status 'none' over an existing row. The implementer noticed that an unrecognized or
  initial Stripe status maps to 'none', which deriveBillingAccess freezes. The dangerous path is a
  mid-trial org whose subscription momentarily reports `incomplete`: the webhook would write 'none'
  and freeze a tenant that was still inside its trial and had just tried to pay. When
  mapSubscriptionStatus yields 'none', the webhook leaves the existing status untouched and mirrors
  only the other fields. Why: Stripe's initial and transient states are not access decisions, and
  the DB CHECK plus mapSubscriptionStatus already bound the column to six values, so the only way
  'none' reaches a live row is this transient path. Cost if wrong: an org whose subscription really
  did lapse into an unrecognized terminal state keeps its previous access until the next recognized
  event or the nightly reconcile corrects it. That is the right direction to fail.
  Note: hosted Checkout does not create a subscription until the session completes, so `incomplete`
  is unlikely in practice. The ruling is cheap insurance, not a fix for an observed bug.
Task 4: minor (deferred): canExtendTrial on the `none` path has no test.
Task 3: minor (deferred): flags.ts uses single quotes where src/lib/stripe/flags.ts uses double.
  Kept verbatim from the brief and consistent with the rest of src/lib/billing.
Tasks 3+4: review clean — spec PASS (exact, both files byte-faithful to the briefs), quality
Approved, 0 Critical, 0 Important. Reviewer verified ORG_BILLING_COLUMNS lists all ten declared
columns and that all ten exist in the schema; walked frozen-vs-state for all eight states; confirmed
the rounding boundary (exactly 0ms and 1ms ago both expire, 1ms left reads "1 day"); confirmed no
input throws for a well-typed row (a malformed trial_ends_at yields NaN, caught, and freezes).
Task 4: minor (deferred): `frozen` is computed three ways (hardcoded true on paused and none,
  !live on trialing, FROZEN_STATES on the tail). They agree today, but the set is not load-bearing
  for three of the four frozen states, so a future edit to it would silently not apply.
Task 4: minor (deferred): a paying org with a momentarily null seat_count falls back to the trial
  cap of 15. Note for Task 19: the status flip to `active` and the seat_count write must land in the
  same update, which the webhook mirror already does.
Task 4: minor (deferred): untested outputs — canExtendTrial on the none path, seatCap on the paused
  path, trialDaysLeft null on the Stripe-status path, the Number.isFinite guard, the 0ms boundary.
Task 4: reviewer note, already handled: deriveBillingAccess(null) would throw, so the caller must
  handle "row not found" first. Task 6's guard does exactly that (`if (!data) return WRITABLE`).
Task 4: reviewer note: billing_pause_resumes_at is selected and typed but never read, per the brief.
  A paused row stays frozen until something clears the stamp; Stripe clears pause_collection when
  resumes_at passes and the webhook mirrors it (Task 19).
Tasks 3+4: complete (commits e57f1e8..45ab847, review clean)
Tasks 5+6: implementer DONE (opus, batched). Task 5 = 7c6fbb5 (mapSubscriptionStatus gains 'unpaid'),
Task 6 = 4742acf (guard.ts + requireWritable on both auth helpers). guard 9/9, orgBilling 8/8,
full unit 1666/1667 (known formDraft flake only), 387 targeted integration tests green across
webhook/billing/platform/appointments. Billing check confirmed LAST in requireOrgAuth's success path,
after 400 org-id, 401 token, 500 membership-error, 403 not-a-member and 403 wrong-role, so an
outsider can never reach a 402.
Tasks 5+6: implementer proved the import-invariant test is not vacuous by planting a probe import in
  src/lib/payments (it failed), then deleting it. Also grepped that no service-role path imports
  either auth helper, so the transitive form of the invariant holds.
Tasks 5+6: implementer widened a pre-existing hardcoded allow-set in orgBilling.test.ts that did not
  include 'unpaid'. Disclosed, correct, matches migration 20260913032635's CHECK.
Tasks 5+6: full `npm run test` cannot go green on this machine before OR after the change. Local
  Supabase GoTrue infra fails ("Database error checking email", 87x teardown undefined.cleanup) and a
  stashed baseline fails the same files. This matches the known local-test-suite-instability note.
  CI arbitrates. Not a finding against this task.
Tasks 5+6: review clean — spec Compliant, quality Approved, 0 Critical, 0 Important. Reviewer traced
requireOrgAuth line by line and confirmed a non-member of a frozen org returns 403 at the membership
check and never reaches the billing query. Confirmed flag-off issues zero queries. Confirmed the 402
body matches exactly. Confirmed past_due/unpaid are now distinct and Stripe's own `paused` still maps
to none. Judged the widened allow-set in orgBilling.test.ts correct and not a weakening.
Tasks 5+6: reviewer note (intended): a manager lacking the permission flag in a frozen org now gets
  402 rather than 403. That caller is already a proven member with an allowed role, so nothing leaks.

Tasks 5+6: Ruling (acting now, folded into Task 7): three carried findings get fixed rather than
  deferred, because each closes a real gap cheaply and all three sit in code Task 7 already touches.
  (a) The import-invariant test can silently pass forever if a watched directory is renamed, since
      `walk` returns [] via existsSync. Add an assertion that it actually scanned files.
  (b) src/types/index.ts still types subscription_status without 'unpaid', so the TypeScript type now
      lies about what the database can hold. One-line union fix.
  (c) guard.ts hands every caller the same WRITABLE object by reference. Freeze it.
  Cost if wrong: three small edits land in the wiring commit rather than their own, which is a
  reviewability cost only.
Tasks 5+6: Ruling: do NOT add the reviewer's suggested shallow transitive-import hop to the invariant
  test. The transitive path runs through requireOrgAuth, and a service-role path importing that helper
  is harmless unless it also passes requireWritable: true, which is the thing a reviewer would catch
  anyway. A hop check keyed on the helper's filename would be brittle and would fail for the wrong
  reasons. Cost if wrong: a future change could gate a money path through the helper without CI
  noticing. Mitigated by the guard's own fail-open behavior and by the flag defaulting off.
Tasks 5+6: minor (deferred): the back office has no `unpaid` case. presenters.ts falls through to
  "No plan" and TenantRoster buckets it into "other/none". PR G must add it; unpaid is the freeze
  state an operator most needs to see.
Tasks 5+6: complete (commits 45ab847..4742acf, review clean)
Task 7: implementer DONE (sonnet), commit 5bcc465. 91 targeted integration tests (services 40,
checklists 29, checklist-items 8, services/route 14 including 4 new billing cases) + guard 9/9 +
requireOrgAuth 9/9; tsc and eslint clean.
Task 7: review — spec APPROVED, quality Approved. All three authorizers got requireWritable, the
errorMessage string is byte-unchanged, none of the six indirect route files were edited, and the
carried fixes (b) 'unpaid' in src/types/index.ts and (c) Object.freeze on WRITABLE are correct
(reviewer confirmed the freeze is real runtime protection in strict-mode ESM, not type-level only).
Reviewer verified the env-var cleanup cannot be skipped by a failing assertion, that the 402 test
asserts the body and not just the status, and that the flag-off test's org really is frozen.
Task 7: fix round 1 opened on two findings:
  (1) Important — the scanned-count assertion sums across all three roots, so renaming one root still
      leaves the total above zero and the test passes without checking it. Needs a per-root count.
  (2) The six indirect routes have no end-to-end 402 proof; everything rests on three one-line edits.
      Adding one integration case on a checklist route makes dropping requireWritable impossible to
      miss. The reviewer called this a fast-follow rather than a blocker; I folded it into this round
      because the round was already open and the test is cheap.
Task 7: fix round 1/5 (2 addressed, 0 open — per-root scanned assertion; end-to-end 402 on an
  authorizer-backed route; commits 5bcc465..06a7c82). Re-reviewer confirmed renaming any single root
  now fails the invariant test, and that the new checklist-items case really does traverse
  authorizeLineItem -> requireManagerPermission -> requireOrgAuth -> assertOrgWritable, landing in the
  genuine expired-trial branch rather than riding the fail-closed `none` default.
Task 7: complete (commits 4742acf..06a7c82, review clean)
Tasks 8+9: implementer DONE (sonnet, batched). Task 8 = 8819fe4 (6 booking/property routes),
Task 9 = fe4ff74 (8 settings/team routes). 148 targeted integration tests green across nine suites;
tsc and eslint clean on all 17 touched files.
Tasks 8+9: implementer concerns, both correct calls:
  - recurring-appointments has a second GET auth call (can_view_bookings) left unguarded. Correct:
    spec §11.3 keeps reads open so a frozen tenant can still see its own data.
  - added a local response-body type to the shared patch() helper in branding's test so the new 402
    assertion type-checks. Non-behavioral.
Tasks 8+9: review clean — spec PASS (all 14 routes confirmed against the briefs' lists, not the
implementer's table; none missed, none extra), quality Approved, 0 Critical, 0 Important, 0 Minor.
Reviewer verified onboarding is untouched, every allowedRoles list and errorMessage string is
byte-identical, no GET or read path received the option, update-cleaner's manager-flag block still
runs after the auth call unmoved, the properties test really uses a homeowner token and asserts the
body, and all three new describe blocks clean up the env var.
Tasks 8+9: complete (commits 06a7c82..fe4ff74, review clean)
Task 10: implementer DONE_WITH_CONCERNS (opus), commit ad64051. seats unit 8/8, billing unit 58/58,
send-invite integration 21/21, full unit 1674 pass (known formDraft flake only), tsc clean repo-wide.
Task 10: Ruling (fixing before review): the billing and seat checks move BELOW the request
  validation, so the missing-field 400 and the role-allowlist 400 still win. The brief said to place
  them right after the authorization gate, and the implementer correctly noticed that this makes a
  malformed request from a frozen org return 402 or 409 instead of 400. The decisive point is not
  which code is nicer: it is that every existing 400 test runs with the flag OFF, so the change would
  be invisible until the flag flips in production. A malformed request is malformed regardless of
  billing state, and 400 is the precise answer. The checks still sit before any invite is created.
  Cost if wrong: a frozen org sending a malformed request learns about the malformation one round
  trip before it learns it is frozen. Also asked for a test locking the new ordering in, and one
  proving a manager is subject to the cap too.
Task 10: implementer note: the inline gate returns 401, not the 403 the brief described. Anchor
  point unaffected; brief inaccuracy only.
Task 10: minor (deferred): body asymmetry is per spec — `tier` is the raw column ('starter') while
  `next_tier` is a display name ('Growth'). The common 409 (org under its tier ceiling) returns
  next_tier null, so PR F/G must render that as "add a seat", not "upgrade".
Task 10: implementer fix DONE, commit 010e24a. Paywall now sits after validation, the role ceiling
and both duplicate-account guards, immediately before the stale-invitee deleteUser, which is the
latest boundary still ahead of every mutation and email. Implementer verified the ordering test is a
real lock: it fails against ad64051's placement and passes on the new one, and it asserts 402 on a
valid body first so it cannot pass by the freeze silently breaking.
Task 10: review — spec Compliant, quality NOT APPROVED on two Important findings:
  (1) Resending a pending cleaner invite is refused at full occupancy. countSeatsInUse counts the very
      invite being resent, so an org at exactly its purchased seats is told to buy a seat for an
      invite that consumes none. Real user flow (the operator UI offers Resend on pending rows).
  (2) countSeatsInUse throws on a query error and the outer catch turns it into 500, blocking a
      legitimate invite on a transient blip, contradicting both of its immediate neighbours which
      fail open.
Task 10: Ruling on finding 2: fail OPEN on a count error, logged. The spec already accepts an
  over-cap race at cap-minus-one, so admitting a seat during a database incident is the same trade we
  already made, while blocking a paying customer's invite is a visible outage. Billing counts
  purchased seats, not used ones, so revenue is unaffected. Cost if wrong: an org could add a cleaner
  or two beyond its purchased seats during an incident; the next invite after recovery caps normally.
Task 10: minor (deferred): duplicate organizations read (assertOrgWritable and the seat block each
  fetch ORG_BILLING_COLUMNS). Brief-prescribed; the guard could return the row instead.
Task 10: minor (deferred): inviteTeamMember surfaces result.error straight into a toast, so at the
  flag flip an operator would see the literal strings seat_cap_reached and billing_frozen. PR F must
  map these codes to real copy.
Task 10: fix round 1/5 dispatched (2 findings).
Task 10: Ruling (carried into Task 16): the fail-open catch belongs to the INVITE route only.
  `countSeatsInUse` still throws, and the checkout route must NOT copy the catch. Failing open there
  would sell a plan with fewer seats than the organization is already using, which is a billing
  defect rather than a convenience. The invite route can afford to fail open because it only decides
  whether one more cleaner may join right now; checkout decides what the customer is charged for.
  Cost if wrong: a checkout during a database incident returns 500 instead of completing, which is
  the correct direction for a purchase.
Task 10: fix round 1/5 (2 addressed, 0 open — resend exclusion; fail-open count; commits
  010e24a..5186270). Re-reviewer confirmed the exclusion touches the invites query only (members has
  no email column and is commented as deliberately unfiltered), that the value passed is the same
  normalizedEmail used to supersede and promote, that the paired test proves the fix is narrow
  (a fresh address at the same occupancy still 409s with in_use 2), that a failed count leaves
  seatsInUse null so no false "0 in use" pass and no misleading 409, that the catch wraps only the
  count call, and that countSeatsInUse still throws so the checkout route cannot inherit fail-open.
  Also verified the vi.mock is file-scoped and that delegation to the real implementation survives
  restoreAllMocks.
Task 10: complete (commits fe4ff74..5186270, review clean)
Tasks 11+12: implementer DONE (sonnet, batched). Task 11 = dfe2e66 (provisioning stamps
trial_ends_at; withTestOrg defaults to a live 14-day trial and accepts a billing override),
Task 12 = 0a5aed5 (POST /api/billing/trial/extend, 8/8 integration, plus keys.billing).
Tasks 11+12: implementer widened vitest.config.mts's integration include glob to also match
  tests/**/*.integration.test.ts, because the brief placed the fixture test at a path no script
  would ever have run. Justified; asked for confirmation it cannot pull in the Playwright specs.
Tasks 11+12: the flag-on gate came back INCONCLUSIVE, not passing. Full integration suite was
  697 failed / 339 passed with the flag off and 715 / 321 with it on, but zero AssertionErrors in
  either run: essentially everything died in local GoTrue setup ("Database error checking email"),
  and the pass/fail churn between runs (212 one way, 230 the other) is nondeterministic infra noise.
  Ruling: this does not count as evidence either way. Re-running the gate as a per-file comparison
  over just the guarded-route suites, after `npx supabase db reset` to clear the accumulated auth
  users that are the likely cause of the degradation. A per-file table with identical numbers in both
  columns is the deliverable. Cost if wrong: we spend one more run to learn the same thing; the
  alternative was shipping the single most important safety property of PR D unverified.
Tasks 11+12: GATE PASSED. After `npx supabase db reset`, all 23 guarded-route suites (247 tests)
produced identical pass counts and ZERO failures in both the flag-off and flag-on runs. No file had
to be excluded. This is the single most important safety property of PR D: switching enforcement on
does not change the behavior of any existing test, because withTestOrg now creates organizations in
a live trial.
Tasks 11+12: side finding worth keeping — the local integration suite's chronic instability on this
  machine is caused by accumulated auth users across a long session, not by anything structural.
  `npx supabase db reset` cleared it completely (from ~697 setup failures to zero).
Tasks 11+12: review — spec Compliant, quality Approved CONDITIONAL on three Important items:
  (1) concurrent double-extend returns a false 200 with an unpersisted trial_ends_at plus a duplicate
      audit row, because supabase-js reports no error for a zero-row update;
  (2) withTestOrg().cleanup() omits tenant_subscription_events, whose FK has no cascade, so every
      successful extend test leaks an organization. Same shape as the Phase 1a service_types leak,
      and PR E will multiply it across checkout, plan, pause, cancel and the webhook;
  (3) an org still at the 'none' default burns its one-time extension and stays frozen anyway,
      because deriveBillingAccess fails closed on 'none' regardless of the clock.
  Reviewer independently confirmed: the fixture default is a live trial and not a comp, the override
  wins over the defaults and later admin-client updates still win over both, trial/extend carries no
  requireWritable, allowedRoles is exactly ['owner'] and the 403 test does not weaken it, the
  extend-from-today arithmetic is right, the audit columns match 065, the widened vitest glob cannot
  match the Playwright .spec.ts files, and the provisioning select addition breaks no consumer.
Tasks 11+12: minor (deferred): accept-invite's two test files insert raw organizations that keep the
  'none' default. Harmless today since neither route is guarded, but a trap for whoever guards them.
Tasks 11+12: minor (deferred): the fixture hardcodes 14 * 86_400_000 instead of importing TRIAL_DAYS.
Tasks 11+12: fix round 1/5 dispatched (3 findings).
Tasks 11+12: fix round 1/5 (3 addressed, 0 open — affected-row check with a matching 409 and no audit
  row; tenant_subscription_events added to fixture cleanup; subscription_status set to trialing in the
  same update; commits 0a5aed5..d84aab4). Re-reviewer confirmed the concurrency test issues two
  genuinely interleaved requests through Promise.all and asserts exactly one audit row, not just the
  status pair.
Tasks 11+12: complete (commits 5186270..d84aab4, review clean)
=== PR D implementation complete: Tasks 1-12 all done, all reviews clean. ===
=== PR D OPENED as #277 (feat/phase1b-billing-core, 18 commits, 49 files). ===
Controller-run gates before pushing: tsc --noEmit exit 0; lint has 23 problems but every one is in a
file this branch never touched (pre-existing); unit 1674/1675 with only the known formDraft flake;
the full local integration suite is saturated again (698 failures, of which 4084 log lines are
"Database error checking email" and exactly ONE is an AssertionError), so after a clean db reset the
billing, services and send-invite suites were re-run first-hand: 10 files, 105 tests, all passing.
=== Starting PR E on feat/phase1b-stripe-billing, stacked on D. ===
Tasks 13+14+15: implementer DONE_WITH_CONCERNS (opus, batched). T13 = 0d4ae14 (requireAppUrl +
portal-link fallback fix), T14 = 79da40f (resolvePrices, resolvePortalConfiguration), T15 = 33365fa
(diffSubscriptionItems). 20 new unit tests green with TDD red first on each, portal-link integration
3/3, full unit 1694/1695 (known formDraft flake), tsc and eslint clean.
Tasks 13+14+15: implementer dropped an unused `afterEach` import that the brief's test block carried,
  because it is an ESLint error in this repo. Correct.
Tasks 13+14+15: IMPORTANT for Tasks 16/17 — `APP_URL` is NOT present in .env.test.local, and the
  portal-link test always passes an explicit return_url so it never reaches requireAppUrl(). The
  checkout and plan routes call it unconditionally, so their tests must set it themselves. The briefs
  already do this with `process.env.APP_URL ||= 'https://app.test.local'`; carried into the dispatch.
Tasks 13+14+15: OPS NOTE for the PR E description and the rollout checklist — APP_URL must be set in
  the Vercel production environment before enforcement is switched on, or Checkout will throw the
  named error instead of redirecting. requireAppUrl deliberately throws rather than guessing.
Tasks 13+14+15: review clean — spec COMPLIANT, quality Approved, 0 Critical, 0 Important. Reviewer
confirmed a resolvePrices failure is never cached (the assignment sits after the throw, and no promise
is memoized), the missing-key error names every key and says what to run, `active: true` excludes
archived prices server-side, all four seat cases are right including delete-not-quantity-zero, the
interval switch moves base and seat together from one `target.period`, diffSubscriptionItems is
genuinely pure, requireAppUrl throws rather than guessing, and no caller can observe a partial price
map because the completeness check precedes both the cache write and the return.
Tasks 13+14+15: minor (deferred): Stripe caps `lookup_keys` at 10 and we send 8, so a fourth tier
  would make resolvePrices 400 at first checkout. Worth a comment at the call site.
Tasks 13+14+15: minor (deferred): the price cache never expires in-process, so rotating a price in
  the Dashboard with transfer_lookup_key is invisible to warm instances until redeploy. This is
  money-adjacent and matters for the pricing doc's 60-day-notice promise; a TTL is the follow-up.
Tasks 13+14+15: minor (deferred): no in-flight dedup on cold resolvePrices; duplicate active lookup
  keys would be silently last-wins; requireAppUrl accepts the degenerate value "https://"; the
  zero-quantity test is weakly targeted; appUrl.test's afterEach clears APP_URL process-wide.
Tasks 13+14+15: complete (commits d84aab4..33365fa, review clean)
Tasks 16+17: implementer DONE (opus, batched). T16 = cea10ae (checkout), T17 = 22b682c (plan change
+ shared planSelection.ts). checkout 12/12, plan 17/17, whole billing integration set 69/69,
stripe/billing 8/8, planSelection unit 14/14, tsc exit 0, lint clean.
Tasks 16+17: review — spec PASS, quality Approved with two Important items to close. Reviewer
confirmed neither route is guarded, roles are right and no test weakened a route, countSeatsInUse is
allowed to throw in both, Pro is uncapped, the seat line carries EXTRAS not the total, the
checkout-versus-update branch covers both a null subscription id and a non-live status,
readCurrentItems classifies by lookup key rather than array position and throws when no base line is
found, the mirror names the webhook as the real truth, and sharing the validation preserved Task 16's
exact check ordering (a unit test pins that bounds did not migrate ahead of auth).
Tasks 16+17: fix round 1/5 dispatched on two Important findings:
  (1) Nothing tests the actual Stripe payload. Both route specs mock the wrapper module wholesale, so
      billing_address_collection, the ABSENCE of payment_method_types and trial_period_days, the
      automatic_tax gate and proration_behavior have zero coverage. These are precisely the
      constraints the design rests on. Fix is ~30 lines in the existing stripe/billing.test.ts, which
      already mocks getStripe and captures params.
  (2) Checkout does not refuse an org that already has a live subscription, so a second subscription
      can be opened against the same customer; the webhook then overwrites subscription_id and
      orphans the first, which keeps billing. The one double-charge path in the diff.
  Plus: checkout_url is typed string | null and returned verbatim, so a 200 with a null URL is
  reachable. Throw instead.
Tasks 16+17: minor (deferred): readCurrentItems lets a second tier-matching line silently win;
  two customer-facing strings carry raw field names; 500s return raw error.message (house pattern,
  but a Postgres or Stripe string can reach a payer); no double-submit guard on the plan route.
Tasks 16+17: Ruling (carried into Task 19): the webhook's handleSubscriptionUpsert must not blindly
  overwrite organizations.subscription_id. If the row already carries a DIFFERENT subscription id
  whose status is live, that means a second subscription exists against the same customer and the
  first is about to be orphaned while it keeps billing. Raise a platform_alerts row rather than
  silently replacing it. The checkout 409 added in this fix closes the common case; this closes the
  concurrent one, which is the only remaining window and is exactly where it can be detected.
  Cost if wrong: an extra alert on a legitimate resubscribe after cancellation; the mirror still
  writes, so no customer is blocked.
Tasks 16+17: fix round 1/5 (3 addressed, 0 open — wrapper-level payload assertions; checkout 409 on a
  live subscription via a shared readLiveSubscription; buildBillingCheckoutSession throws on a null
  URL; commits 22b682c..2a4bd4b). Re-reviewer confirmed the payload assertions read the object handed
  to the Stripe SDK rather than the wrapper's own input and would fail if a forbidden key were added,
  that the 409 covers active/past_due/unpaid while still allowing canceled, that a test proves no
  Session is created on the refusal path, that the plan route's past_due and unpaid still take the
  update path, and that the 409 sits after auth so a non-member still gets 403.
Tasks 16+17: complete (commits 33365fa..2a4bd4b, review clean)
Tasks 18+19: implementer DONE_WITH_CONCERNS (opus, batched). T18 = 8b0c21b (pause/resume/cancel),
T19 = a034035 (webhook mirror + checkout.session.completed). Unit 23 + 22, integration 75 + 65,
tsc exit 0, eslint clean.
Tasks 18+19: implementer findings, all good calls:
  - platform_alerts has NO organization_id column, so the brief's literal insert would have failed.
    Used the house helper recordPlatformAlert with the org id inside details, which also respects
    migration 115's one-open-incident-per-alert_type unique index. Side effect worth knowing: dedupe
    is global per alert type, so two orgs can share one open incident row.
  - Reused the existing cancelStripeSubscription for when: 'now' instead of adding a second name for
    the same SDK call.
  - Added scope beyond the brief: customer.subscription.deleted for a subscription the org is NOT on
    no longer cancels the org. Without this, cleaning up an orphaned subscription would freeze a
    paying customer. Tested. This is exactly the failure the subscription_id ruling anticipated.
  - billing_paused_at keeps the FIRST pause stamp rather than re-stamping now() on every update
    while paused.
  - No cast needed for pause_collection: '' since the installed types are Emptyable.
Tasks 18+19: OPS follow-up: the production Stripe endpoint must be configured to send
  checkout.session.completed (already spec §20 step 4).
Tasks 18+19: review — spec PASS on both controller requirements, quality Approved. Reviewer confirmed
the seat arithmetic, that an unrecognized base key leaves the plan columns untouched, that the `none`
guard cannot block a legitimate `canceled`, that items are classified by anchored lookup-key match
rather than position, that the deleted-for-another-subscription guard is sound, that pause clears on
Stripe's resume and Task 18 writes neither pause column, and that re-delivery is idempotent through
claimWebhookEvent plus an upsert on stripe_event_id.
Tasks 18+19: fix round 1/5 on one Important finding: handleSubscriptionDeleted can freeze a TRIALING
  org. An incomplete subscription that Stripe expires fires a delete whose ids match, so the handler
  writes 'canceled' over a merely-trialing org and the access model freezes it. Same failure class as
  the `none` guard, arriving through the other door. Ruling: only write 'canceled' when the org's
  STORED status is already live (active, past_due, unpaid); otherwise the dying subscription never
  became live for us and its deletion is an abandoned purchase, not a cancellation of service.
  Cost if wrong: an org that genuinely cancelled from a non-live stored status keeps access until the
  next recognized event or the nightly reconcile. That is the right direction to fail.
  Context: the route that creates incomplete subscriptions is deleted in Task 22, so this is belt and
  braces for anything already in flight in production.
Tasks 18+19: minor (deferred): no ordering watermark, so a retried older `updated` event can regress
  the plan columns. The previous handler had the same exposure for id and status; this widens it.
Tasks 18+19: minor (deferred): resolveOrgForCheckoutSession trusts session metadata without
  confirming the row exists, matching the pre-existing resolveOrgForSubscription pattern.
Tasks 18+19: known consequence, accepted: recordPlatformAlert dedupes on alert_type alone and
  overwrites summary and details with the newest, so a second org's orphan alert hides the first's in
  the open-incident row. Every occurrence still reaches console.error with its org id. House contract.
Tasks 18+19: fix round 1/5 (2 addressed, 0 open — shared statusToMirror covering both doors; pause
  stamp test; commits a034035..9f9e982). Re-reviewer confirmed the rule keys on the STORED status not
  the incoming one, that both the deleted handler and the incomplete_expired path through updated go
  through the one helper, that a genuinely active org whose subscription is deleted STILL becomes
  canceled (the failure mode that mattered most, pinned by its own test), that the pause and cancel
  columns still clear and an audit row still records applied:false with a reason when the guard
  blocks, and that the new pause assertion compares against the original timestamp.
Tasks 18+19: complete (commits 2a4bd4b..9f9e982, review clean)
Tasks 20+21+22: implementer DONE_WITH_CONCERNS (opus, batched). T20 = 5ca1719 (reconcileBillingMirror
merged into the sweep as billing_mirror), T21 = 8448869 (scripts/stripe-billing-setup.ts),
T22 = 7206940 (start route, its test, startOrgSubscription and createStripeSubscription all deleted).
Unit 1746/1747 (known formDraft flake), tsc 0 errors, lint clean, guard import-invariant 9/9,
targeted integration green (billing 70, stripe 181, cron reconcile 29).
Tasks 20+21+22: Ruling on the deliberate deviation: the setup script MAY hold its own products.create,
  prices.create and portal-configuration calls rather than routing them through
  src/lib/stripe/billing.ts. That constraint exists so integration tests can mock the module the
  routes import; a standalone operator script is never integration-tested, and exporting Product and
  Price creators from a module the routes DO import would put catalog-mutating functions one import
  away from request-handling code. Everything still goes through getStripe(). Cost if wrong: the
  script's Stripe calls are not mockable, which matters only if we ever want to test the script
  itself, and it is designed to be run by a human against a real account.
Tasks 20+21+22: Task 21 was NEVER run against a real Stripe account, and nothing was created in any
  account. No real test key exists here (both env files hold the literal sk_test_fake). The
  implementer did verify the env guard, the live-key refusal, alias resolution under tsx, and that it
  reaches Stripe and dies on Stripe's own invalid-key error. The create-then-re-run idempotency proof
  is an OPS ITEM for whoever holds the key (spec §20 step 1).
Tasks 20+21+22: mirror comparison covers spec §16's four columns only (subscription_status, plan_tier,
  billing_period, seat_count). current_period_end, cancel_at and the pause columns are deliberately
  excluded. Matches the spec.
Tasks 20+21+22: review — spec PASS, quality Approved. Reviewer walked the import graph from both
reconcile.ts (46 files) and the cron route (50 files) and confirmed guard.ts is unreachable, which is
stronger than the repo's own textual direct-only invariant test. Confirmed the job reuses the
webhook's readPlanFromItems and statusToMirror rather than copying them, one retrieve per org, an
alert on every repair and none on a no-op, per-org try/catch proven by a test, the setup script is
idempotent and never deletes, annual amounts are 12x ($348/$948/$1,668), tax_behavior exclusive on
every price, live-key refusal, and that the deletion is surgical with zero remaining code references.
Tasks 20+21+22: fix round 1/5 on one Important finding: the sweep cannot see the very failure the
  spec says it exists for. §17's "Checkout completed but webhook late" leaves an org with a null
  subscription_id and status trialing, which the candidate filter excludes, so a customer who has
  PAID hits the paywall and nothing self-heals. The brief was too narrow, not the execution.
  Ruling: add a second pass over orgs holding a stripe_customer_id but no subscription_id, ask
  Stripe subscriptions.list for that customer, adopt the most recent non-terminal one and alert
  (a subscription learned this way means a webhook was lost). No subscription at Stripe means the
  ordinary abandoned-checkout case: do nothing, do not alert.
  Cost if wrong: one extra Stripe call per night per org that ever reached checkout, which is
  bounded because only those orgs have a customer id.
  Also folding in: reuse the exported LIVE_SUBSCRIPTION_STATUSES instead of re-declaring it.
Tasks 20+21+22: minor (deferred): the pause and cancel columns are unreconciled. This matches the
  spec's literal four columns, but both drive deriveBillingAccess, so a missed pause or resume leaves
  an org wrongly frozen or wrongly writable with nothing to catch it. Follow-up.
Tasks 20+21+22: minor (deferred): live-mode portal configuration creation generally needs privacy and
  terms URLs unless set in Dashboard branding; the script passes only a headline. It fails loudly and
  is re-runnable, so the cost is a retry during ops step 1.
Tasks 20+21+22: minor (deferred): BILLING_MIRROR_BATCH = 500 truncates silently past 500 paying orgs;
  findProductByPlanKey does four full catalog scans; Task 20's test was not written red-first.
Tasks 20+21+22: fix round 1/5 (2 addressed, 0 open — orphan-adoption second pass; shared status
  constant; commits 7206940..d64f9b1). Re-reviewer confirmed the two candidate sets are mutually
  exclusive by construction so healthy orgs are never double-fetched, that only non-terminal
  subscriptions are adopted, that both passes share one extracted mirror rather than a copy, that it
  alerts on adoption and stays silent on an abandoned checkout, and that pass 1's filter is unchanged.
  Noted one further intended change: pass 1's select error no longer early-returns from the whole
  function, so pass 2 still runs as an independent backstop.
Tasks 20+21+22: minor (deferred): an adopted `incomplete` or `paused` subscription keeps status
  trialing and then falls out of both passes. It alerts at adoption, and after Task 22 nothing in the
  codebase creates incomplete subscriptions.
Tasks 20+21+22: complete (commits 9f9e982..d64f9b1, review clean)
=== All 22 implementation tasks complete. Task 23 = stack and open PR E. ===
=== PR E OPENED as #278, stacked on #277 as stack #279. ===
Controller-run gates: tsc exit 0; unit 1753/1754 (known formDraft flake); after a clean db reset the
billing, stripe and cron integration suites ran 32 files / 309 tests, ALL PASSING.
=== FINAL WHOLE-BRANCH REVIEW (opus, 31 commits, 71 files): READY TO MERGE, no Critical. ===
Reviewer independently walked the transitive import graph and confirmed zero paths from
src/lib/payments, the cron routes or the webhook reach the billing guard. Confirmed the seat rule is
one rule in all three places, the annual amounts, the double-charge block, and that the paywall is
genuinely dark with the flag off.
Reviewer's sharpening worth recording: "the paywall is dark" is true, but "the diff is inert" is not.
Four things happen unconditionally at merge: the migration rewrites data, mapSubscriptionStatus emits
`unpaid`, reconcileBillingMirror joins the nightly cron and issues real Stripe reads, and portal-link
now throws instead of silently using a dead fallback domain. None gates access.
Four Important items, all before the FLAG FLIP rather than before merge. Ruling: three of them are in
PR E and each is a few lines, so I am fixing them now rather than carrying them:
  (1) The orphan backstop cannot see a REPURCHASE after cancellation. A canceled org keeps its old
      subscription_id, so it matches neither reconcile pass. It pays again, the creation webhook is
      lost, and it stays frozen with nothing to heal it or alert.
  (2) billing_paused_at freezes and has no backstop. It is written only by the webhook, and
      billingMirrorDiff deliberately skips the pause and cancel columns, so a lost resume webhook
      leaves a PAYING org frozen, possibly for a month. Re-running resume emits no further event.
  (3) resolvePortalConfiguration() is written, tested, and never called. getOrgPortalLink still omits
      the configuration, so "plan changes are in-app only" and the cancellation survey are
      unenforced. No UI calls the portal yet, which is why nothing caught it.
  (4) Live-mode portal creation needs privacy and terms URLs. Ops item, stays on the checklist.
Deferring #11 (a paying org with a null seat_count falls back to the trial cap): the webhook writes
  the status flip and seat_count in the SAME update, so the window is essentially nil.
Deferring #10 (frozen computed three ways): correct today, a robustness improvement rather than a bug.
Final fix wave: 3 addressed, 0 open (commits d64f9b1..da2747c). Re-reviewer verified the two reconcile
predicates are complementary from ONE shared list and that the status column is NOT NULL so no
three-valued hole opens, that pass 2 overwrites subscription_id only when it differs, that a `seen`
set gives belt-and-braces protection against double-fetching with its own test, that the pause helper
was extracted from the webhook rather than copied so webhook behavior is unchanged, that a still-paused
org produces zero updates (pinning no re-stamping by assertion rather than construction), and that the
portal configuration is asserted at the Stripe SDK boundary rather than one layer above.
Final fix wave: known follow-up, accepted: pass 2's candidate set grows without bound as canceled orgs
  accumulate, each costing one subscriptions.list nightly. The cap warns rather than truncating
  silently. A "last reconciled at" column is the proper fix. Not a merge blocker at the current
  tenant count.
=== BOTH PRs COMPLETE. #277 (PR D) and #278 (PR E), stack #279. ===
