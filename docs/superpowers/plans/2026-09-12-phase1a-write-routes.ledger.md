# SDD ledger — plan: docs/superpowers/plans/2026-09-12-phase1a-write-routes.md

Worktree: .claude/worktrees/phase1a (branch feat/phase1a-services-routes off origin/master 4144de9). Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md (on docs/saas-billing-spec in the main checkout). Models: Sonnet implementers (plan text carries full code), Fable reviewers per build-model rule.

## Pre-flight scan (2026-09-12)

Method: extracted every `export` signature and every call site of the shared helpers from the plan (grep), compared producer vs consumer shapes; read each task's Files/Interfaces header for self-consistency.

| Tasks | Shared surface | Producer | Consumer(s) | Result |
|---|---|---|---|---|
| 1 -> 5, 11, 14, 17 | `apiFetch<T>(path, { method, body? })`, `ApiResult<T>` | plan L236 | L1366-1372, L2784-2808, L3791, L4279 | match |
| 2 -> 3, 4, 6, 12, 15 | `ParseResult<T> = { ok: true; value } \| { ok: false; error }`, `asRecord`, `isUuid`, `parseMoney(v,label)`, `parseRequiredText(v,label,max)`, `parseOptionalText(v,label)` | L465-496 | all call sites use `.ok/.value/.error`; imports at L1693, L3188, L3934 | match |
| 2 -> 3, 5 | `ChecklistSeed`, `parseServiceCreate`, `parseServiceUpdate` | L509-618 | L857/880, L1226/1243, L1350/1381 | match |
| 4 -> 7, 8, 9, 10 | `authorizeService(request, id)`, `CatalogAuth<T>`, exported `FLAG`/`MESSAGE`/`notFound` | L1198-1206 | L2015; Task 7 adds `authorizeChecklist`/`authorizeLineItem` beside them (L1965/1979) reusing FLAG/MESSAGE/notFound | match |
| 7 -> 8, 9, 10 | `authorizeChecklist(request, id)`, `authorizeLineItem(request, itemId)` | L1965, L1979 | L2207, 2238, 2481, 2522, 2550, 2704 | match |
| 6 -> 7, 8, 9, 10 | `parseChecklistCreate/Update`, `parseItemsCreate`, `parseItemUpdate`, `parseOrder`, `orderMatchesItems` | L1720-1786 | L2018, 2210, 2484, 2525, 2707, 2716 | match |
| 3, 4 -> 5 | route envelopes `{ success, data }` | L878, L1237, L1271 | services-api L1365-1372 | match |
| 7-10 -> 11 | route envelopes | L2012, 2204, 2235, 2478, 2519, 2547, 2701 | checklists-api L2780-2808 | match |
| 12 -> 13 | `parseOperatorBookingBody`, `selfPayCleanerBlockReason` from lib | L3035, L3254 | L3644 | match |
| 13 -> 14 | `POST /api/appointments` -> `{ id }` | L3642 | L3790 | match |
| 15 -> 16 -> 17 | `parsePropertyCreate`; `POST /api/properties` -> Property | L3962, L4169 | L4171, L4278 | match |
| 5 vs 11 | both modify hook files, disjoint (`useServices.ts` vs `useChecklists.ts`) | | | no overlap |
| 4 vs 7 | both modify `resolveCatalogOrg.ts` / `authorizeCatalog.ts`; 7 appends only | | | sequential, no conflict |

Per-task self-consistency: each task's tests reference only names its own code block defines (checked by name grep). Task 4 deliberately resolves the row before the token check (404 before 401 for unknown ids); recorded in the plan, may surface in review.

Conflict found: Global Constraints says "Task 6 updates their two call sites" for `updateService`/`toggleServiceActive`; Task 5's Files list and the file map assign the two `OperatorServices.tsx` call sites to Task 5.
Ruling: Task 5 updates the two call sites (the Global Constraints line is a stale cross-reference from an earlier numbering) — the file map and Task 5's own text agree, and Task 6 is a pure parser task with no component in its Files — cost if wrong: none beyond a one-line doc fix.

## Execution

Task 1: dispatched (BASE 4144de9, Sonnet implementer aa106503e223e0189)
Env check: worktree runs unit + integration tests against local Supabase (organizations/ suite green). Scripts: pass explicit OUTFILE under the main-repo workspace since cwd is now the worktree.
Task 1: implementer DONE (adffeb3, 6/6 unit, tsc+eslint clean); reviewer dispatched (Fable, af3e21ea296b89fc5) on review-4144de9..adffeb3.diff
Task 1: review clean (spec ✅, quality Approved). ⚠️ commit trailer: verified by controller via git log (both trailer lines present).
Task 1: minor (deferred): apiFetch awaits getAccessToken() outside the try, so a supabase-js lock AbortError could still throw despite the "never throws" doc (apiFetch.ts:21)
Task 1: minor (deferred): no tests for 2xx-with-{success:false} and non-2xx-non-JSON branches (coverage breadth)
Task 1: minor (deferred): a 204 response would read as failure because res.json() rejects on an empty body; no Phase 1a route returns 204 (apiFetch.ts:36-46)
Task 1: complete (commits 4144de9..adffeb3, review clean)
Task 2: dispatched (BASE adffeb3, Sonnet implementer)
Task 2: implementer DONE (8e2cd58, 16/16 unit, tsc+eslint clean, trailer verified); reviewer dispatched (Fable, a15105ff35c576838) on review-adffeb3..8e2cd58.diff
Task 2: review clean (spec ✅, quality Approved). ⚠️ tsc "zero errors project-wide" claim: controller spot-check below.
Task 2: minor (deferred, plan-mandated code): parseMoney passes Number.isFinite before multiplying, so ~1.8e306 yields value Infinity -> 500 not 400 (parse.ts:23-26)
Task 2: minor (deferred, plan-mandated code): parseChecklistSeeds position uses bare Number(); '' / [] / false become 0, negatives pass (serviceInput.ts:62)
Task 2: minor (deferred): duration Number.isInteger accepts 1e300 -> Postgres integer overflow 500 (serviceInput.ts:38)
Task 2: minor (deferred): non-string checklist seed name silently defaults to 'New Checklist'; no length cap on checklist name (serviceInput.ts:60)
Task 2: minor (deferred): serviceInput.test.ts:31-34 `r.ok && 'checklists' in r.value` is vacuous if parse fails; assert r.ok first
Task 2: minor (deferred): coverage gaps: checklists:null -> 400, seed error propagation, numeric-string duration, description:null on update
Task 2: complete (commits adffeb3..8e2cd58, review clean)
Task 3: dispatched (BASE 8e2cd58, Sonnet implementer)
Controller spot-check: `npx tsc --noEmit` exits clean on this branch (CLAUDE.md pre-existing-errors note is stale); implementers' "0 errors" claims are credible.
Task 3: implementer DONE (895b5d5, 10/10 integration, tsc+eslint clean); reviewer dispatched (Fable) on review-8e2cd58..895b5d5.diff
Task 3: review spec ❌ (1 Important, plan-mandated: the four 201 tests leak org + service + checklists because organizations.delete() in withTestOrg.cleanup() fails on service_types_organization_id_fkey (no cascade, 000_baseline.sql:2025) and the error is swallowed (fixtures.ts:175); verified 8 leaked "Deep Clean" rows in the local DB).
Task 3: Ruling: leak fix lands in tests/helpers/fixtures.ts withTestOrg.cleanup(), not in the route test — delete this org's service_types before deleting the org (checklist/item cascades handle the rest), fix the docstring, KEEP swallowing the org-delete error (making cleanup strict would fail existing tests that already leak via createTestAppointment) — cost if wrong: a teardown change every integration test runs; a failed service_types delete is swallowed exactly like today, so there is no new failure path. Tasks 4-11 inherit the fix automatically; carry a pointer in their dispatches.
Task 3: minor (deferred): owner-passes and homeowner-403 cases not exercised in the route test
Task 3: minor (deferred): rollback test passes vacuously if the service insert itself fails; pin with expect(error).toMatch(/numeric field overflow/) (test:141-154)
Task 3: minor (deferred, plan-mandated code): compensating delete result discarded at route.ts:63; log or append its error
Task 3: minor (deferred): checklistsOf orders by price_adder, so seed order is proven by coincidence (test:47)
Task 3: fix round 1/5 dispatched (FIX_BASE 895b5d5, resumed implementer a1e08527f2f25be7b)
Task 3: fix round 1 implementer DONE_WITH_CONCERNS (8f1fe4b; also removed cleaner_profiles rows in cleanup, same root cause; ~115 leaked local Test Org rows deleted by the implementer, local dev DB only). Ruling extended: cleaner_profiles delete accepted as the same fix; re-review to verify both deletes swallow errors. Re-review dispatched (Fable) on review-895b5d5..8f1fe4b.diff
Task 3: fix round 1/5 (1 addressed, 0 open — fixture leak closed for service_types AND cleaner_profiles, both deletes swallow errors, FK survey shows no RESTRICT on cleaner_profiles dependents; commits 895b5d5..8f1fe4b)
Task 3: minor (deferred): commit subject of 8f1fe4b names only service_types though it also removes cleaner_profiles (cosmetic; squash merge rewrites it)
Task 3: minor (deferred, out of scope): createTestAppointment users still leak (appointments_organization_id_fkey no cascade, service_type FK RESTRICT, no cleanup returned) — pre-existing; Task 4's brief already deletes appointments/properties in afterEach, Task 13's test must do the same
Task 3: complete (commits 8e2cd58..8f1fe4b, review clean after 1 fix round)
Task 4: dispatched (BASE 8f1fe4b, Sonnet implementer)
Task 4: implementer DONE (588cb49, 20/20 integration incl. Task 3 file, leak check 0, tsc+eslint clean); reviewer dispatched (Fable) on review-8f1fe4b..588cb49.diff
Task 4: review clean (spec ✅, quality Approved). ⚠️ FK claims (appointments.service_type_id RESTRICT, checklists CASCADE): already confirmed by the Task 3 re-review's baseline survey (000_baseline.sql:1795, :1805).
Task 4: minor (deferred, plan-mandated code): resolveServiceOrg discards the query error, so a DB failure during lookup becomes 404 instead of 500 (resolveCatalogOrg.ts:12-17)
Task 4: Ruling: when Task 7 extends resolveCatalogOrg.ts, all three resolvers throw on a query error (handlers' catch maps it to 500 with the message) instead of returning null; resolveServiceOrg is corrected in the same task — why: PR B would otherwise copy the 404-masks-DB-failure pattern twice more — cost if wrong: a rare DB failure surfaces as 500 rather than 404, which is the constraint's intended code anyway.
Task 4: minor (deferred): TOCTOU windows between resolve/count and update/delete surface as 500 (PGRST116 or 23503) rather than 404/409; FK backstops integrity
Task 4: minor (deferred): DELETE has no .select(), returns success on zero matched rows (only reachable in the race)
Task 4: minor (deferred): coverage: owner role not exercised; flagless-manager case asserts status only; recurring-series 409 branch untested (brief admits it)
Task 4: complete (commits 8f1fe4b..588cb49, review clean)
Task 5: dispatched (BASE 588cb49, Sonnet implementer)
Note: Task 5 brief has a manual browser walkthrough (create/rename/toggle/duplicate/delete a service); implementer told to skip it; controller does it with claude-in-chrome before PR A is pushed.
Task 5: implementer DONE (767254d; tsc/lint clean, 48 unit + 20 integration green; note: implementer fixed an exhaustive-deps lint warning beyond the brief); reviewer dispatched (Fable) on review-588cb49..767254d.diff
Smoke-test prep: port 3000 free; local operator login capqa-admin@test.local (org "Cap QA Cleaning" 943fe723-1f76-4b40-9bb3-6c95a5f0d49a); DB container supabase_db_nexxus-cleaning-platform (psql via docker exec).
Task 5: review clean (spec ✅, quality Approved). ⚠️ browser smoke (brief Step 5) pending controller; Step 6 push pending.
Task 5: minor (deferred): cleared description now stores null instead of "" (route normalization; form rehydrates with ?? "")
Task 5: minor (deferred): duplicateService 0-row source read surfaces the raw PostgREST .single() message as the toast (parity with old code)
Task 5: minor (deferred): npm run lint shows 23 pre-existing problems outside touched files (was 24)
Task 5: complete (commits 588cb49..767254d, review clean)
PR A: tasks 1-5 complete. PR-level review dispatched (Fable, code-reviewer template) on review-4144de9..767254d.diff; browser smoke + gates + push follow.
PR A: whole-branch review = "With fixes". Important: apiFetch awaits getAccessToken() outside the try (never-throws contract hole; handleToggleActive has no try, so a throw leaves the optimistic flip un-reverted). Fix-before-merge minors: log the POST /api/services compensating-delete error; pin the rollback test to /numeric field overflow/. Other minors triaged "leave deferred" (list in the review; 400/401 ordering, 403 message collapse, parse.ts location, FLAG/MESSAGE naming, checklistsOf ordering).
PR A: smoke test (Playwright, fixture login capqa-admin): create -> POST 201, default checklist visible; rename -> PATCH 200 with the new name in the body, but the page kept the old name: the edit branch of handleServiceSubmit never uses r.data and relies on the service_types realtime UPDATE, and service_types is NOT in the local supabase_realtime publication (pg_publication_tables empty; no migration adds it). Pre-existing behavior (4144de9's edit branch also ignored the returned row), not a PR A regression.
PR A: Ruling: fix wave adds replaceServiceInState(r.data) to the edit branch of handleServiceSubmit in OperatorServices.tsx (one line beyond the plan's "two call sites") — why: the route now returns the updated row, so the page should not depend on a realtime publication that no migration guarantees — cost if wrong: an extra cache patch with the row the server just returned; no behavior risk.
PR A: Ruling: 400-vs-401 ordering stays as the plan wrote each route (row-org routes authorize first; body-org routes parse first because the org is in the body) — why: the invariant is "know the org, then authorize"; reordering PR C's parsers is churn with no security gain — cost if wrong: an unauthenticated caller with a bad body sees 400 instead of 401 on the two body-org routes.
PR A: Ruling: apiFetch never-throws hole is fixed now in PR A (not deferred) — why: nine more write functions in B and C inherit the contract — cost if wrong: none; a throwing token fetch becomes the signed-out result.
PR A: fix wave dispatched (Sonnet, FIX_BASE 767254d): apiFetch try-wrap + test, compensating-delete log, rollback test pin, edit-branch replaceServiceInState. Smoke test re-run after the wave (toggle/duplicate/delete still unverified; script had a bug on its second run).
PR A: fix wave DONE (bd3c4ea: apiFetch try-wrap + 7th unit test, compensating-delete console.error, rollback test pinned, edit branch replaceServiceInState). Scoped re-review dispatched (Fable) on review-767254d..bd3c4ea.diff.
PR A: browser smoke PASS on bd3c4ea (Playwright, capqa-admin): create 201 + default checklist; rename PATCH 200 visible live; toggle true->false->true (two PATCH 200); duplicate POST 201 with "(copy)" carrying 1 Default Checklist; DELETE 200 x2; list clean. Screenshots in the session scratchpad (smoke-*.png).
PR A gates: unit 1526/1527 (only src/lib/formDraft.test.ts "no-ops safely when sessionStorage is unavailable" fails, deterministic locally, untouched by PR A, known pre-existing per memory; CI arbitrates); lint 23 pre-existing problems, none in touched files; integration api/services/ + organizations/ 99/99; tsc clean.
PR A: re-review clean (4/4 addressed, no new breakage). Pushing feat/phase1a-services-routes and opening the PR.
PR A: PUSHED. PR #270 https://github.com/bridgerdavidson/nexxus-cleaning-platform/pull/270 (head bd3c4ea, base master). Not merged; B and C stack on it.
PR B: branch feat/phase1a-checklist-routes created off bd3c4ea in the same worktree.
Task 6: dispatched (BASE bd3c4ea, Sonnet implementer)
Task 6: implementer DONE (f5f2ed0, 28/28 unit incl. PR A parsers, tsc+eslint clean, trailer verified); reviewer dispatched (Fable) on review-bd3c4ea..f5f2ed0.diff
PR #270 CI: typecheck+lint pass, E2E 1/2 + 2/2 pass, migrate-dev pass, Vercel preview ok; unit+integration pending at time of check.
Task 6: review clean (spec ✅, quality Approved).
Task 6: minor (deferred): orderMatchesItems docstring overclaims "permutation"; duplicates only excluded upstream by parseOrder (checklistInput.ts:205-210)
Task 6: minor (deferred): parseOrder(null)/([]) returns the item_ids error rather than NOT_OBJECT (brief code)
Task 6: minor (deferred): isUuid case-insensitive vs Set dedup case-sensitive in parseOrder; fail-closed downstream
Task 6: minor (deferred): non-string update name reported as "cannot be empty" (brief copy)
Task 6: minor (deferred): parseTasks duplicates serviceInput.ts:67-71 verbatim; candidate parseTextList in parse.ts for the whole-branch review
Task 6: minor (deferred): coverage: 120-char boundary, rounding via this module, task+tasks precedence
Task 6: complete (commits bd3c4ea..f5f2ed0, review clean)
Task 7: dispatched (BASE f5f2ed0, Sonnet implementer; carries the Task 4 ruling: resolvers throw on query error)
Task 7: implementer DONE (4cc9cc9, 27/27 integration incl. PR A files, ruling applied to all three resolvers, leak check ok, tsc+eslint clean); reviewer dispatched (Fable) on review-f5f2ed0..4cc9cc9.diff
Task 7: review clean (spec ✅, quality Approved). ⚠️ new authorizers/resolvers untested until Task 8 (by design; Tasks 8-10 exercise them); malformed-id 404 covered by the sibling PATCH test via the shared isUuid gate.
Task 7: minor (deferred, brief code): checklist route compensating delete discards its result (route.ts:44)
Task 7: minor (deferred, brief code): afterEach awaits cleanups sequentially without try/finally; a throwing mgr.cleanup() would skip org.cleanup()
Task 7: minor (deferred): authorizeService/Checklist/LineItem are three copies of seven lines; candidate private authorizeTarget for the whole-branch review
Task 7: minor (deferred): `let items: unknown[]` leaves the 201 payload untyped as ChecklistWithItems
Task 7: minor (deferred): report claimed the embed shape was observed; not evidenced (reviewer confirmed via baseline FK instead)
Task 7: complete (commits f5f2ed0..4cc9cc9, review clean)
Task 8: dispatched (BASE 4cc9cc9, Sonnet implementer)
PR #270 CI: ALL GREEN (unit+integration 10m43s, typecheck+lint, E2E 1/2 + 2/2, migrate-dev). Mergeable once B and C are ready (merge bottom-up).
Task 8: implementer DONE (be4800e, 6/6 integration, leak check ok, tsc+eslint clean); reviewer dispatched (Fable) on review-4cc9cc9..be4800e.diff
Task 8: review spec ❌ (1 Important, plan-shaped: the brief's six test cases omit manager-without-flag 403, manager-with-flag 200, and malformed-id 404, while Global Constraints require every route test to use addManagerToOrg; authorizeChecklist has no other test). Report also over-claimed malformed-id coverage.
Task 8: Ruling: add the three cases (manager without flag -> 403 with the exact message; manager with flag -> 200; 'not-a-uuid' -> 404) modeled on the sibling checklist-create test — why: Global Constraints outrank the brief's case list, and this is the first route exercising authorizeChecklist — cost if wrong: three extra integration cases (~2s).
Task 8: minor (deferred, brief code): PATCH/DELETE scope by id alone; authorizer returns serviceTypeId that could add a belt-and-braces .eq
Task 8: minor (deferred): row vanishing between authorize and update yields PGRST116 -> 500 not 404 (same as sibling)
Task 8: minor (deferred, product question for the whole-branch review): DELETE has no in-use guard; appointments/series checklist_id are ON DELETE SET NULL, so deleting a referenced checklist silently detaches it (parity with the old direct delete)
Task 8: minor (deferred): update test asserts on the RETURNING row only, no separate read-back
Task 8: fix round 1/5 dispatched (FIX_BASE be4800e, resumed implementer a7d6a3231c0a52769)
Task 8: fix round 1 implementer DONE (06c6bc4, 9/9); re-review dispatched (Fable) on review-be4800e..06c6bc4.diff
Ruling (extends Task 8): Tasks 9 and 10 briefs also omit manager cases and malformed ids; their dispatches carry the same three additions per route file (manager without flag 403 + exact message, manager with flag happy path, malformed id 404) — why: Global Constraints require addManagerToOrg in every route test — cost if wrong: a few extra integration cases. Tasks 13/16 already include manager cases; malformed id does not apply to body-org POSTs.
Task 8: fix round 1/5 (1 addressed, 0 open — three cases added; commits be4800e..06c6bc4)
Task 8: minor (deferred): DELETE handler has no manager-flag/malformed-id case of its own (coverage transitive via shared authorizeChecklist)
Task 8: complete (commits 4cc9cc9..06c6bc4, review clean after 1 fix round)
Task 9: dispatched (BASE 06c6bc4, Sonnet implementer; carries the coverage ruling)
Task 9: implementer DONE (4927b07, 24/24 integration across the three checklist route files, tsc+eslint clean; notes stray rows from other sessions sharing local Supabase, not its own); reviewer dispatched (Fable) on review-06c6bc4..4927b07.diff
Task 9: review clean (spec ✅, quality Approved).
Task 9: minor (deferred, plan code): bulk-insert response order relies on Postgres RETURNING processing order (holds in practice, undocumented); never split into insert-then-select
Task 9: minor (deferred): doc comment "null positions last by created_at" cannot tie-break rows inserted in one statement (client sort concern)
Task 9: minor (deferred): 400 tests assert message only, not status (items test:272-275)
Task 9: minor (deferred): DELETE item has no 403 case; POST items has no cross-org case
Task 9: complete (commits 06c6bc4..4927b07, review clean)
Task 10: dispatched (BASE 4927b07, Sonnet implementer; carries the coverage ruling)
Task 10: implementer DONE (ce52e6d, 22/22 integration across checklist files, tsc+eslint clean, leak check ok); reviewer dispatched (Fable) on review-4927b07..ce52e6d.diff
Task 10: review clean (spec ✅, quality Approved).
Task 10: minor (deferred): "foreign id" 400 case uses a nonexistent UUID rather than a sibling checklist's real id
Task 10: minor (deferred, brief-accepted): read-then-write reorder is not transactional; a concurrent item delete yields a position gap (idempotent, retry heals)
Task 10: minor (deferred): no 401 case in this file (covered by siblings); non-object body returns the item_ids message rather than NOT_OBJECT (Task 6 design)
Task 10: complete (commits 4927b07..ce52e6d, review clean)
Task 11: dispatched (BASE ce52e6d, Sonnet implementer)
Task 11: implementer DONE (0a2b107; tsc clean, lint clean on touched files, 28 unit + 57 integration green); reviewer dispatched (Fable) on review-ce52e6d..0a2b107.diff; PR B smoke test running in parallel
Task 11: review clean (spec ✅, quality Approved). ⚠️ browser walkthrough: controller smoke (below).
Task 11: minor (deferred): "<name> (copy)" can exceed CHECKLIST_NAME_MAX for 114+ char names -> 400 on duplicate (old client had no cap)
Task 11: minor (deferred): reorder is now strict-permutation; a concurrent add yields a developer-facing 400 string in the toast
Task 11: minor (deferred): old write bodies' console.error on failure is gone (parity with PR A)
Task 11: complete (commits ce52e6d..0a2b107, review clean)
PR B: tasks 6-11 complete. PR-level review dispatched (Fable) on review-bd3c4ea..0a2b107.diff. First smoke run: checklist create/edit/duplicate/delete all correct (201/200/201/200); task steps failed on the script's card locator (no task request sent), rerunning with a fixed locator.
PR B: browser smoke PASS on 0a2b107 (Playwright, capqa-admin): add checklist 201, edit 200, add two tasks 201, edit task 200, drag reorder PUT 200 (order persisted), delete task 200, duplicate checklist 201 carrying the task, delete checklist 200, service cleanup 200. Screenshots smokeB-*.png in the session scratchpad.
PR B gates: unit 1538/1539 (same pre-existing formDraft local-only failure; CI passed it on #270), lint 23 pre-existing, integration services+checklists+checklist-items+organizations 136/136, tsc clean (implementer). Awaiting the PR-level review before push.
PR B: whole-branch review = "With fixes". Fix-before-merge: log the compensating-delete error in POST /api/services/[id]/checklists (parity with the PR A ruling). Minor 2: the reorder 400 string reaches operators as a toast on a stale cache. All other minors triaged leave-deferred (list in the review). Product notes: PATCH price_adder fires the price-recalc trigger on future bookings (parity; flag for the billing guard); checklist DELETE has no in-use guard (SET NULL FKs, parity).
PR B: Ruling: fix wave also replaces the reorder mismatch 400 copy with user-readable text "This checklist changed since you loaded it. Please try again." (route + Task 10 test expectations; the strict permutation rule stays) — why: the string is shown verbatim in a toast and the old developer-facing wording names a JSON key — cost if wrong: one string and two test assertions; spec §12.2 wording updated when the docs PR lands.
PR B: fix wave dispatched (Sonnet, FIX_BASE 0a2b107).
PR B: fix wave DONE (c955d9d; 49/49 integration, tsc+eslint clean). Scoped re-review dispatched (Fable) on review-0a2b107..c955d9d.diff
PR B: re-review clean (2/2 addressed). Pushing feat/phase1a-checklist-routes and opening the PR against feat/phase1a-services-routes.
PR B: PUSHED. PR #273 https://github.com/bridgerdavidson/nexxus-cleaning-platform/pull/273 (head c955d9d, base feat/phase1a-services-routes). Not merged.
PR C: branch feat/phase1a-booking-property-routes created off c955d9d in the same worktree.
Task 12: dispatched (BASE c955d9d, Sonnet implementer)
Task 12: implementer DONE (0ef0bf9, 319 unit in scope green, tsc clean, eslint clean except a pre-existing flowType.ts error; note: JSDoc of the moved function follows the brief text, body identical); reviewer dispatched (Fable) on review-c955d9d..0ef0bf9.diff
PR #273 CI: typecheck+lint, E2E 1/2 + 2/2, Vercel pass; unit+integration pending; "Push migrations -> dev" RED = shared-dev drift (remote versions 20260912211148, 20260912211501 applied by another branch today; this stack has zero migrations, so nothing to fix and not a required check; never run migration repair against dev).
Task 12: review clean (spec ✅, quality Approved).
Task 12: minor (deferred, brief code): isHMM requires a two-digit hour; an unpadded ?time= deep link would 400 after Task 13 (see emitter check below)
Task 12: minor (deferred, brief code): isYMD/isHMM do not range-check (2026-13-45, 25:99 pass -> 500 with the Postgres message)
Task 12: minor (deferred, brief code): price_override_total carried through when price_override_enabled is false (client always sends a consistent pair)
Task 12: minor (deferred): duplicate slots pass (parity with client addSlot); a few parser branches unexercised by tests
Task 12: complete (commits c955d9d..0ef0bf9, review clean)
Task 12: Ruling: isHMM stays strict HH:MM as the brief wrote it — why: grep shows no code emits a ?time= deep link (OperatorBookingHost only reads it) and the picker pads hours, so nothing reaches the parser unpadded — cost if wrong: a hand-typed ?time=9:00 URL gets a 400 "scheduled_time must be HH:MM" instead of booking.
Task 13: dispatched (BASE 0ef0bf9, Sonnet implementer)
Task 13: implementer DONE_WITH_CONCERNS (40734e5, 11/11 integration twice, tsc+eslint clean, leak check ok). Concern: the brief's route code checked property-owner-mismatch before customer-membership, but the brief's own test expects "Customer is not a homeowner in this organization" for an invalid customer on a valid property.
Task 13: Ruling: validation order is property 404/403 -> customer membership 400 -> property-owner mismatch 400 -> service -> checklist -> cleaner -> self-pay gate (the implementer's reordering stands) — why: the membership error is the precise cause when the customer is invalid, it is the only order that satisfies all 11 specified cases, and no status code or string changes — cost if wrong: none at runtime; the plan's Task 13 header sentence and the spec's §12 order need a one-line docs fix when the docs PR lands.
Task 13: reviewer dispatched (Fable) on review-0ef0bf9..40734e5.diff
PR #273 CI: ALL REQUIRED GREEN (unit+integration 10m10s, typecheck+lint, E2E 1/2 + 2/2); migrate-dev red = shared-dev drift only.
Task 13: review quality Approved, 1 Important (plan-mandated): the five lookups (property, membership, service, checklist, cleaner) discard the query error, so a DB failure surfaces as 404/400 instead of 500 with the message (fails closed; infra failures only). Minor: doc comment dropped the "property must be the customer's, or org-owned when no customer" clause.
Task 13: Ruling: fix now — destructure { data, error } on each lookup and return 500 with error.message before the null check; restore the doc clause — why: same defect class the Task 4/7 resolver ruling already corrected, and PR C's routes should not ship the pattern PR B removed — cost if wrong: five extra branches; a lookup failure is reported as 500 (the constraint's intended code) instead of a misleading 404.
Task 13: fix round 1/5 dispatched (FIX_BASE 40734e5, resumed implementer a2da6615cd8f30519)
Task 13: fix round 1 implementer DONE (fe82817, 11/11); re-review dispatched (Fable) on review-40734e5..fe82817.diff
Ruling (extends Task 13): Task 16 brief line 156 (membership lookup for owner_id) also discards the query error; its dispatch carries the same fix (destructure error, 500 before the null check).
Task 13: fix round 1/5 (2 addressed, 0 open — five lookups return 500 on query error, doc clause restored; commits 40734e5..fe82817)
Task 13: complete (commits 0ef0bf9..fe82817, review clean after 1 fix round)
Task 14: dispatched (BASE fe82817, Sonnet implementer)
Task 14: implementer DONE (d955399; tsc/lint clean on touched files, 56/56 unit in new-booking); reviewer dispatched (Fable) on review-fe82817..d955399.diff
PR C smoke (partial, after Task 14): booking form -> pickers -> review -> submit reached POST /api/appointments; 500 "Price must be at least $1." because the script picked the $0 Custom service (DB rule, parity with the old direct insert; message passed through per constraints). Script now prefers Deep Clean. Property half ran against the old direct-insert path (Task 17 pending); any stray Smoke Cabin row deleted.
PR C smoke (booking half) PASS on d955399: form -> Bill the customer -> pickers (customer, Summit House, Deep Clean, Default Checklist, time, cleaner) -> review -> create => POST /api/appointments 201; DB row status=pending, cleaner_confirmation_status=awaiting, total_price=350, response_deadline set, 0 slot rows for a single slot; test appointment deleted via psql. Property half runs after Task 17.
Task 14: review clean (spec ✅, quality Approved). ⚠️ browser smoke: done by controller (booking half PASS, above).
Task 14: minor (deferred, plan shape): CreateBookingBody.appointment carries the server-owned fields the route discards; an Omit<> would make the wire contract honest
Task 14: minor (deferred): a legacy service with duration_minutes 0 would now 400 (parser requires > 0; DB has no CHECK) where the old direct insert accepted it
Task 14: complete (commits fe82817..d955399, review clean)
Task 15: dispatched (BASE d955399, Sonnet implementer)
Task 15: implementer DONE (119eb7e, 15 new unit, tsc+eslint clean); reviewer dispatched (Fable) on review-d955399..119eb7e.diff
Task 15: review spec ❌ (1 Important, plan-mandated): parser accepts fractional bathrooms (brief tests assert 2.5) but properties.bathrooms is integer (000_baseline.sql, never altered), so 1.5 passes the parser and fails at the DB as a 500 with a raw message.
Task 15: Ruling: bathrooms parses as a whole number (integer: true), error "Bathrooms must be a whole number of 0 or more"; the brief's two assertions change (2.5 -> 2; 'two' message) — why: Phase 1a has no migrations and the parser exists to keep its output insertable; a homeowner typing 1.5 now gets a clear 400 instead of a raw Postgres 500 (half-baths were already unsupported at the DB) — cost if wrong: if half-baths are wanted later, a numeric migration plus relaxing this one flag; spec/plan text gets a one-line docs fix.
Task 15: minor (deferred): whitespace-only numeric string becomes 0 (mirror parseMoney's trim guard); no upper bound on integer fields (1e10 -> DB 500); coverage gaps (non-object body, explicit owner_id null, access_instructions non-string, numeric-string bathrooms)
Task 15: fix round 1/5 dispatched (FIX_BASE 119eb7e, resumed implementer a22110c9ed00a2608)
Task 15: fix round 1 implementer DONE (2720abe, 16/16); re-review dispatched (Fable) on review-119eb7e..2720abe.diff
Task 15: fix round 1/5 (1 addressed, 0 open — bathrooms integer rule + tests; commits 119eb7e..2720abe)
Task 15: minor (deferred): parseOptionalNumber's non-integer branch now unreachable (all three callers pass true)
Task 15: complete (commits d955399..2720abe, review clean after 1 fix round)
Task 16: dispatched (BASE 2720abe, Sonnet implementer; carries the lookup-error ruling)
Task 16: implementer DONE (7b94e08, 6/6 integration, tsc+eslint clean, leak check ok); reviewer dispatched (Fable) on review-2720abe..7b94e08.diff
Task 16: review clean (spec ✅, quality Approved; ruling applied at route.ts:154-161).
Task 16: minor (deferred): flagless-manager case asserts status only, not the exact "Requires the Edit properties permission" string
Task 16: minor (deferred): no cross-org owner_id case (operator naming another org's homeowner -> 400); no owner-role case; negative cases have no zero-rows read-back
Task 16: minor (deferred, plan decision 5): migration 104 RLS also allows org-owned properties (owner_id null) but the route requires owner_id; no client caller today; org-owned creation needs a body flag or separate route when operators get property creation
Task 16: complete (commits 2720abe..7b94e08, review clean)
Task 17: dispatched (BASE 7b94e08, Sonnet implementer)
Task 17: implementer DONE (c3a6fbc; tsc/lint clean on touched files, 122 targeted unit + 17 integration green); reviewer dispatched (Fable) on review-7b94e08..c3a6fbc.diff; full PR C smoke running
PR C smoke PASS on c3a6fbc (Playwright): operator booking via the form -> POST /api/appointments 201 (Deep Clean, single slot); homeowner Add property -> POST /api/properties 201 with owner_id = caller, org correct, bathrooms 1, home visible in the list; both rows deleted via psql. Screenshots smokeC-*.png in the session scratchpad.
PR C gates: unit 1577/1578 (same pre-existing formDraft local-only failure), lint 23 pre-existing, integration all Phase 1a route files + organizations 153/153, tsc clean. Awaiting Task 17 review, then the PR-level review.
Task 17: review clean (spec ✅, quality Approved). ⚠️ browser smoke: done by controller (property PASS, above).
Task 17: minor (deferred): report listed 3 importers; a 4th textual reference is a doc comment only; brief Step 4 "with a photo" is inaccurate (add mode never had a photo)
Task 17: minor (deferred): client does not mirror the parser's length caps / whole-number rules; violations surface as a clear 400 in the banner
Task 17: complete (commits 7b94e08..c3a6fbc, review clean)
PR C: tasks 12-17 complete. PR-level review dispatched (Fable, code-reviewer template) on review-c955d9d..c3a6fbc.diff.
PR C: whole-branch review = "With fixes". Important (test-only): no case for a service from another org on POST /api/appointments (403 "Service type is in a different organization") and no case for an operator naming another org's homeowner as owner_id on POST /api/properties (400). All other minors triaged leave-deferred. Reviewer confirmed both routes are stricter than the RLS they replace and every PR B recommendation landed.
PR C: Ruling: body-size cap convention for Phase 1a parsers (recorded so PR D does not re-litigate) — required text fields carry a per-field cap (service/checklist name 120, property name 200, address 300, city 120, state 50, zip 20); optional free text (descriptions, special/access instructions, special requests) is uncapped; money goes through parseMoney (finite, >= 0, cents-rounded); integer fields are whole numbers >= 0 with no ceiling (a ceiling is a follow-up) — cost if wrong: an oversized body reaches Postgres and returns a 500 with the DB message instead of a 400.
PR C: follow-up for Bridger: the smoke's 500 "Price must be at least $1." on a $0 customer-billed booking comes from a rule NOT in supabase/migrations or src (reviewer grep); likely a trigger hand-applied to local/dev, i.e. schema drift prod may not share. Locate and commit it (or drop it) before the billing plan assumes it.
PR C: fix wave dispatched (Sonnet, FIX_BASE c3a6fbc): two cross-org test cases.
PR C: $1-floor RESOLVED: local DB has migration 20260912211501_require_min_price (trigger appointments_min_total_price -> enforce_min_total_price, plus enforce_min_service_base_price), one of the two versions another unmerged branch applied to dev today; not in this stack and not drift prod shares. The billing plan should treat a $1 minimum as a rule that lands when that branch merges.
PR C: fix wave DONE (b8cc3e3; 19/19 integration, tsc+eslint clean, no leak). Scoped re-review dispatched (Fable) on review-c3a6fbc..b8cc3e3.diff
PR C: re-review clean (1/1 addressed). Pushing feat/phase1a-booking-property-routes and opening the PR against feat/phase1a-checklist-routes.
PR C: PUSHED. PR #274 https://github.com/bridgerdavidson/nexxus-cleaning-platform/pull/274 (head b8cc3e3, base feat/phase1a-checklist-routes).
Stack: gh stack init A B C + submit run (see output). Task 18 merge step NOT run: merging to master is a production deploy during the live pilot, so it is handed to Bridger (merge bottom-up: #270, wait for #273's re-run, #273, wait, #274).
Plan complete: 17/17 tasks built, task-reviewed, PR-reviewed; 3 fix rounds at task level (3, 8, 13, 15) + 3 PR fix waves; browser smokes green for all three PRs. Workspace kept (git-ignored) until the stack merges.
Merge phase (Bridger go-ahead): migrate-dev drift was self-inflicted: the two remote versions (20260912211148 cron_http_timeout, 20260912211501 require_min_price) merged to master today as #271/#272 after our base 4144de9. Restacked all three branches onto e16a067 with gh stack rebase (one import conflict in deriveOperatorBooking.ts: kept #272 jobPriceError import, dropped the moved isCleanerPayable import); gates green (tsc, lint, 155 integration, unit minus the pre-existing formDraft local failure); gh stack push done. New heads recorded above. Merging bottom-up once CI is green.
MERGED #270 -> master 1ebe044 (2026-09-13T00:27Z). #273 auto-retargeted to master, new head d2f56d8; watching its checks, then merge; then #274.
MERGED #273 -> master 569eadb (2026-09-13T00:40Z); master CI + migrate-prod for 1ebe044 green. #274 auto-retargeted to master, new head 5aeb800; watching, then merge.
MERGED #274 -> master f220c03 (2026-09-13T00:51Z). Stack complete: 1ebe044 (A), 569eadb (B), f220c03 (C). Master CI + migrate-prod for 569eadb: DB Migrations success, CI in progress at last check; f220c03 being watched. Branch cleanup below.
