# Cleaner appointment card sorting & display (Today + Schedule)

- **Date:** 2026-06-27
- **Status:** Design approved (brainstorm). Folds into the Slice-2 branch (`feat/redesign-cleaner-app-slice2`, PR #95) so Slice 2 ships sorting-correct.
- **Scope:** how appointment cards are bucketed and displayed on the redesign cleaner **Today** and **Schedule** screens. UI/derivation only , no backend, no migration. The "Unfinished" card *actions* (mark-done / couldn't-do) are out of scope here (they ride the Slice-3 active-job work); this spec covers **sorting, surfacing, and display**.

## 1. Problem

Three issues in the current Slice-2 sort:

1. **Overdue jobs pile into "Today" forever (Schedule).** `scheduleGroupOf` falls through to `"today"` for any date `<= today`, so a `confirmed` job from last week that was never completed sits in the Today group indefinitely.
2. **The same job vanishes on the Today screen.** `deriveToday.todayJobs` is strict `scheduled_date === today`, so a past-day never-completed job appears nowhere on the cleaner's home; the two screens disagree and the company loses sight of it.
3. **Non-today cards show only the time, no date.** `JobRow` renders e.g. "10:57 PM" with no date, so a job next week under "Later" reads like tonight.

**Root gap:** the system has overdue-*response* handling (auto-defer re-routes offers nobody accepted) and a no-show *fee* concept, but no defined state for "a `confirmed`/`in_progress` job whose scheduled day passed and was never completed or cancelled." That undefined state is what leaks into Today. This spec gives it a home (a derived "Unfinished" treatment) without a backend status change.

## 2. Decisions (from the brainstorm)

- A never-completed job is **surfaced as "Needs attention" and stays actionable**, never silently mixed with completed jobs.
- "Needs attention" is **bounded by age**: an unfinished job stays there for a short window, then **auto-settles into Past badged "Unfinished"** (self-cleaning; works before resolve-actions exist).
- "Needs attention" lives on **both** Today and Schedule.
- A stale `in_progress` job (started, day passed) **drops out of "Active job"** into Needs attention.
- A job whose *time* passed but is **still scheduled for today stays in Today all day** (only the day rolling over moves it). No time-of-day comparison drives bucketing.

## 3. Core definitions

All date math is **local** (`ymd(localDate)` → `YYYY-MM-DD`), compared as strings (correct for the local calendar day).

- `todayStr` = local today.
- `tomorrowStr` = today + 1 day.
- `weekEndStr` = today + 6 days.
- `NEEDS_ATTENTION_DAYS = 3` (tunable constant).
- `graceFloorStr` = today - `NEEDS_ATTENTION_DAYS` days.

**Predicates (pure):**
- `isUnfinished(a)` = `(a.status === 'confirmed' || a.status === 'in_progress') && a.scheduled_date < todayStr`. (Committed jobs that did not complete and were not cancelled.)
- `isWithinGrace(a)` = `a.scheduled_date >= graceFloorStr` (i.e. dated within the last `NEEDS_ATTENTION_DAYS` days).
- `needsAttention(a)` = `isUnfinished(a) && isWithinGrace(a)`.
- `agedUnfinished(a)` = `isUnfinished(a) && !isWithinGrace(a)`.

## 4. Zone assignment , every scenario

| Status | When | Zone → badge |
|---|---|---|
| `pending` + awaiting (offer) | today / future | **Upcoming** (its day group) → "Needs response" |
| `pending` (any) | before today | **Past** → "Expired" *(rare; routing normally re-defers; treated as inactive history)* |
| `confirmed` | today | **Upcoming · Today** → "Upcoming" |
| `confirmed` | tomorrow / this week / later | **Upcoming · that group** → "Upcoming" |
| `confirmed`, never started | 1–`N` days ago (within grace) | **Needs attention** → amber "Unfinished" |
| `confirmed`, never started | > `N` days ago | **Past** → amber "Unfinished" |
| `in_progress` | today (or date ≥ today) | **Active job** (Today screen, pinned + Continue) / **Today group** (Schedule) → "In progress" (spinning) |
| `in_progress` | before today | **Needs attention** → amber "Unfinished" (started, finish or report) |
| `completed` | any | **Past** → green "Done" |
| `cancelled` | any | **Past** → "Cancelled" |

`N` = `NEEDS_ATTENTION_DAYS` (3).

## 5. Schedule screen (`deriveSchedule`)

Three zones, top to bottom:

1. **⚠ Needs attention** , a section pinned at the very top, rendered only when non-empty and **independent of the Upcoming/Past toggle**. Contents = `needsAttention(a)` jobs, sorted **most-recently-missed first** (`scheduled_date` desc, then time desc). Each row: the standard `JobRow` with an amber **"Unfinished"** badge and its date shown. (Row-level "Mark done / Couldn't do it" actions are a Slice-3 follow-up; the section + sort + badge ship now.)
2. **Upcoming** view (toggle) , `pending`/`confirmed`/`in_progress` with `scheduled_date >= todayStr`, date-grouped **Today / Tomorrow / This week / Later** (the existing `scheduleGroupOf`, which must no longer receive past-dated jobs). Status filter scoped to the view (already shipped). Every non-Today card shows its **date** (§7).
3. **Past** view (toggle) , the **complement**: every appointment that is neither Upcoming (`(pending|confirmed|in_progress) && date >= today`) nor Needs attention (`needsAttention`). Concretely that is `completed` (any date) ∪ `cancelled` (any date) ∪ `agedUnfinished` ∪ past-day `pending` ("Expired"). Defining Past as the complement guarantees every row lands in exactly one zone (no fall-through). Sorted most-recent-first, each badged distinctly: "Done" (green), "Cancelled", amber **"Unfinished"** for the aged-out never-completed case, and a quiet "Expired" for the rare past-day `pending`.

**`deriveSchedule` change:** the Upcoming bucketing must exclude past-dated jobs entirely (no `"today"` fallthrough for `date < today`). `scheduleGroupOf` already returns only future/today buckets after the §9 fix; the container now filters Upcoming to `date >= todayStr` and routes the rest to Needs attention / Past per §4. Add a `needsAttention` array and the aged-unfinished rows to the Past set. Co-located unit tests cover every row of the §4 matrix incl. the grace boundary (exactly `N` days vs `N+1`).

## 6. Today screen (`deriveToday`)

- **Active job** pins only `in_progress` with `scheduled_date >= todayStr` (today's active work). A stale `in_progress` (date < today) is **excluded** from Active and instead appears in Needs attention.
- **⚠ Needs attention** , a new section near the top (below the active job, above offers) listing `needsAttention(a)` jobs with the "Unfinished" badge, so unfinished work greets the cleaner on open. Sorted most-recently-missed first.
- **Today list** = `confirmed && scheduled_date === todayStr` (drop `in_progress` from this list , it is either the pinned Active job or, if stale, in Needs attention , removing the current double-display). Past-time-today jobs stay here.
- **Offers** and **Tomorrow peek**: unchanged.
- `isEmpty` accounts for the new Needs-attention section.

## 7. Card date display

`JobRow` must show the appointment **date** whenever the row is not in a "Today" context (Needs attention, Tomorrow, This week, Later, Past). For the Today group the date is implied and omitted.

- Add a pure presenter `formatCardDate(dateStr, todayStr): string | null` , returns `null` when `dateStr === todayStr`, else a compact label `"Tue, Jul 1"` (weekday + month + day; year omitted unless different from the current year). Local parse of `YYYY-MM-DD`.
- `JobRow` gains an optional date line: when `formatCardDate` is non-null, render it as a small muted label in the left/time column (above the time) or as a compact date chip , matching the operator "date-in-pill" treatment from the design system. Tabular figures; no raw hex.
- Optional polish (not required this pass): a subtle "running late" hint on a Today-group card whose `scheduled_time` is already past. Flagged, deferred.

## 8. Status badge

Extend the cleaner badge vocabulary (`jobBadge.ts` / `CleanerJobBadge`) with an **`unfinished`** key → amber **`caution`** variant, label "Unfinished", icon `AlertTriangle` (or `Clock`). The badge is **derived from zone**, not from `status` alone (an `in_progress` job that is stale renders "Unfinished", not "In progress"), so the badge function must accept the computed zone/`todayStr` rather than mapping raw status in isolation. Keep "Expired" for the rare past-day `pending` as a quiet `secondary`/`outline` badge.

## 9. Out of scope / follow-ups

- **Resolve actions** on a Needs-attention card (mark-done late → completion+charge; "couldn't do it" → report/cancel) , ride Slice 3.
- **System auto-resolution** of stale jobs (auto-cancel / no-show fee after a longer window) , a separate operator/lifecycle project; this spec is display-only and never mutates status.
- **Operator-side** surfacing of never-completed confirmed jobs (the operator `useAdminActionItems` covers the routing phase, not post-confirmation no-shows) , noted as a parallel gap, not addressed here.

## 10. Testing

- Unit: every §4 matrix row in `deriveSchedule.test.ts` and `deriveToday.test.ts`, incl. the grace boundary (`N` vs `N+1` days), the in_progress today-vs-stale split, and Past ordering. `formatCardDate` (today→null, weekday/month/day, year handling) in `job-presenters.test.ts`. `jobBadge` gains an `unfinished`/zone case.
- Visual (Playwright MCP, 390px): seed/observe an overdue confirmed job → it leaves Today, appears under Needs attention with date + Unfinished badge; a non-today upcoming card shows its date; an aged unfinished job appears in Past badged Unfinished.
