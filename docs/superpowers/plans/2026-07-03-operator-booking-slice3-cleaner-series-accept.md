# Operator New-Booking Flow , Slice 3 (Cleaner series-accept) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the phone-first redesign cleaner app, show a recurring offer (N appointments sharing a `series_id`, all `awaiting` for this cleaner) as ONE grouped offer with **Accept all** (bulk-confirm every occurrence) or **Pick dates** (per-occurrence accept/decline; declined/timed-out occurrences route to the next cleaner independently).

**Architecture:** Reuse everything. The series is already N independent `appointments` rows sharing `series_id` (created by Slice 2's `POST /api/recurring-appointments`); each is offered to the cleaner exactly like a single job (`cleaner_confirmation_status: 'awaiting'`). Accept/decline is the existing per-appointment `POST /api/appointments/confirm` (accept flips to approved/confirmed; decline synthesizes a declined `routing_log` row and calls `advanceAppointmentRouting`, which routes that one occurrence independently). "Accept all" loops that route **sequentially** over the series' occurrences (no new bulk route; sequential avoids the client-side pool-saturation that concurrent bulk writes cause , see [[project_bulk_action_pool_saturation]]). A pure `deriveSeriesOffers` presenter groups the flat offers list into singles + series view-models. UI is built from the design system on the cleaner app's existing offer surface (Today , "Needs your response").

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, Supabase (anon client reads + Bearer-auth route writes). `(redesign)` cleaner app under `src/components/redesign/cleaner/**`.

## Global Constraints

- **No migration, no new API route, no RLS change.** `series_id` already exists on `appointments`; accept/decline is the existing `POST /api/appointments/confirm`. (Spec line 11 + Out of scope.)
- **Cleaner-facing copy says "office", never "operator".** (Spec line 105; [[feedback_operator_is_internal_term]].)
- **No em dashes** in any user-facing copy (labels, buttons, toasts). Use a period, comma, parentheses, or "to" for ranges.
- **Implement from the design system only** (`src/components/ui/*` primitives + tokens in `tailwind.config.js` / `globals.css`: brand `#0150FC` via the `brand-*` / semantic token classes, Plus Jakarta Sans, `rounded-card`/`rounded-pill`/`rounded-control`, `shadow-soft-*`). No raw hex, no `primary-<number>` (that ramp is the legacy yellow , [[project_operator_dashboard_polish]]), no `#F7C41E`, no legacy-component style bleed ([[feedback_no_legacy_style_bleed]]). Signal status via the badge/pill vocabulary, not decorative accents ([[feedback_redesign_status_signals]]).
- **Percentage-contractor model only.** Series offers already only appear when `payoutModel === 'percentage_contractor'` (`deriveToday` returns `offers: []` for `hourly_external`); the grouping runs on that already-gated list, so employees never see it. Stay model-aware.
- **"pay" deviation (flag, do not silently add):** the spec's occurrence line reads "date + time + pay", but the redesign offer cards (`CleanerTodayView` / `CleanerJobDetailOverlay`) have NEVER shown a dollar figure, and cleaner pay visibility is gated by `organizations.cleaner_pay_display` (migration 096). Introducing a per-occurrence pay number only on the series card would be inconsistent and would leak the customer charge (`total_price`) rather than the cleaner's cut. This plan matches the existing offer vocabulary (date + time + property + service) and honors "pay" at the series level via the "N cleanings" summary + date range. Call this out in the PR body so the user can decide whether to add a real pay line (which would be a separate, app-wide pay-display change).

---

## File structure

- **Modify** `src/hooks/useCleanerData.ts` , add `series_id` to `CleanerAppointment` + the `useCleanerAppointments` select; add `useRespondToSeries` (sequential accept-all hook) + `summarizeSeriesAccepts` pure helper.
- **Create** `src/components/redesign/cleaner/today/deriveSeriesOffers.ts` , pure grouping presenter (flat offers -> `{ singles, series }`).
- **Create** `src/components/redesign/cleaner/today/deriveSeriesOffers.test.ts` , unit tests for grouping.
- **Create** `src/hooks/summarizeSeriesAccepts.test.ts` , unit test for the partial-success summarizer (co-located next to the hook file per repo convention would be `useCleanerData` , but the helper is exported from `useCleanerData.ts`; put the test at `src/hooks/summarizeSeriesAccepts.test.ts` importing from `./useCleanerData`).
- **Create** `src/components/redesign/cleaner/today/SeriesOfferCard.tsx` , the grouped summary card (Accept all + Pick dates).
- **Create** `src/components/redesign/cleaner/today/SeriesOfferSheet.tsx` , the cherry-pick sheet (per-occurrence accept/decline with an in-sheet decline-reason step).
- **Modify** `src/components/redesign/cleaner/today/CleanerTodayView.tsx` , render singles as today + series as `SeriesOfferCard`; add series handlers to props.
- **Modify** `src/components/redesign/cleaner/today/CleanerToday.tsx` , wire `useRespondToSeries` + pass series handlers.
- **Modify** `src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx` , minimal read-only "Repeating series" hint when `appointment.series_id` is set.

**Interfaces produced (used across tasks):**
```ts
// deriveSeriesOffers.ts
export interface SeriesOffer {
  seriesId: string;
  occurrences: CleanerAppointment[]; // sorted by (date,time) asc, length >= 2
  count: number;
  first: CleanerAppointment;         // occurrences[0]; source of shared property/service/customer labels
  soonestDeadline: string | null;    // min non-null response_deadline across occurrences
  startDate: string;                 // occurrences[0].scheduled_date
  endDate: string;                   // occurrences[count-1].scheduled_date
}
export interface GroupedOffers { singles: CleanerAppointment[]; series: SeriesOffer[]; }
export function deriveSeriesOffers(offers: CleanerAppointment[]): GroupedOffers;

// useCleanerData.ts
export interface SeriesAcceptResult { total: number; accepted: number; failed: number; }
export function summarizeSeriesAccepts(results: { ok: boolean }[]): SeriesAcceptResult;
export function useRespondToSeries(): {
  acceptAll: (occurrences: { appointmentId: string; slotIndex: number }[]) => Promise<SeriesAcceptResult>;
  accepting: boolean;
  progress: { done: number; total: number } | null;
};
```

---

### Task 1: Add `series_id` to the cleaner appointment shape

**Files:**
- Modify: `src/hooks/useCleanerData.ts` (interface ~line 16-62; select ~line 137-186; mapper ~line 205-222)

**Interfaces:**
- Produces: `CleanerAppointment.series_id?: string | null`, now populated from the DB.

- [ ] **Step 1: Add the field to the interface.** In `CleanerAppointment`, after `cancelled_at`, add:

```ts
  /** Non-null when this appointment is one occurrence of a recurring series
   *  (Slice 2). All occurrences of the same series share this id. */
  series_id?: string | null;
```

- [ ] **Step 2: Select the column.** In `useCleanerAppointments`'s `.select(...)`, add `series_id,` right after the `cancelled_at,` line (before `job_progress,`). The spread `...appointment` in the mapper already carries it through, so no mapper change is needed.

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 4: Commit.**

```bash
git add src/hooks/useCleanerData.ts
git commit -m "feat(cleaner): carry series_id on cleaner appointments"
```

---

### Task 2: `deriveSeriesOffers` grouping presenter (TDD)

**Files:**
- Create: `src/components/redesign/cleaner/today/deriveSeriesOffers.ts`
- Test: `src/components/redesign/cleaner/today/deriveSeriesOffers.test.ts`

**Interfaces:**
- Consumes: `CleanerAppointment` (with `series_id`).
- Produces: `deriveSeriesOffers`, `SeriesOffer`, `GroupedOffers` (signatures above).

Grouping rules (locked):
- An offer with a falsy `series_id` is a **single**.
- Offers sharing a `series_id` group into a `SeriesOffer` **only when >= 2 occurrences** remain in the list. A series group with exactly 1 remaining occurrence degrades to a **single** (no "series of 1" card; handles the cherry-pick tail).
- `occurrences` sorted ascending by `(scheduled_date, scheduled_time)`.
- `singles` sorted ascending by `(scheduled_date, scheduled_time)`.
- `series` sorted ascending by each series' `startDate` (soonest series first).
- `soonestDeadline` = the minimum non-null `response_deadline` across the group's occurrences (string compare on ISO is chronological), else `null`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { deriveSeriesOffers } from "./deriveSeriesOffers";

function offer(p: Partial<CleanerAppointment> & { id: string }): CleanerAppointment {
  return {
    scheduled_date: "2026-07-20",
    scheduled_time: "10:00",
    status: "pending",
    total_price: 80,
    cleaner_confirmation_status: "awaiting",
    homeowner: { first_name: "John", last_name: "Doe", email: "j@x.com" },
    property: { name: "Maple", address: "1 A St", city: "Reno", state: "NV", zip_code: "89501" },
    service_type: { name: "Regular Cleaning", description: "", duration_minutes: 120 },
    ...p,
  } as CleanerAppointment;
}

describe("deriveSeriesOffers", () => {
  it("keeps a non-series offer as a single", () => {
    const g = deriveSeriesOffers([offer({ id: "a" })]);
    expect(g.singles.map((s) => s.id)).toEqual(["a"]);
    expect(g.series).toHaveLength(0);
  });

  it("groups >= 2 occurrences sharing a series_id and sorts them by date", () => {
    const g = deriveSeriesOffers([
      offer({ id: "b2", series_id: "S1", scheduled_date: "2026-07-27" }),
      offer({ id: "b1", series_id: "S1", scheduled_date: "2026-07-20" }),
    ]);
    expect(g.singles).toHaveLength(0);
    expect(g.series).toHaveLength(1);
    const s = g.series[0];
    expect(s.seriesId).toBe("S1");
    expect(s.count).toBe(2);
    expect(s.occurrences.map((o) => o.id)).toEqual(["b1", "b2"]);
    expect(s.first.id).toBe("b1");
    expect(s.startDate).toBe("2026-07-20");
    expect(s.endDate).toBe("2026-07-27");
  });

  it("degrades a lone remaining series occurrence to a single", () => {
    const g = deriveSeriesOffers([offer({ id: "c", series_id: "S9" })]);
    expect(g.series).toHaveLength(0);
    expect(g.singles.map((s) => s.id)).toEqual(["c"]);
  });

  it("computes the soonest non-null deadline across the group", () => {
    const g = deriveSeriesOffers([
      offer({ id: "d1", series_id: "S1", scheduled_date: "2026-07-20", response_deadline: "2026-07-19T18:00:00.000Z" }),
      offer({ id: "d2", series_id: "S1", scheduled_date: "2026-07-27", response_deadline: "2026-07-26T18:00:00.000Z" }),
      offer({ id: "d3", series_id: "S1", scheduled_date: "2026-08-03", response_deadline: null }),
    ]);
    expect(g.series[0].soonestDeadline).toBe("2026-07-19T18:00:00.000Z");
  });

  it("sorts multiple series by their start date and separates singles", () => {
    const g = deriveSeriesOffers([
      offer({ id: "late1", series_id: "LATE", scheduled_date: "2026-09-01" }),
      offer({ id: "late2", series_id: "LATE", scheduled_date: "2026-09-08" }),
      offer({ id: "single", scheduled_date: "2026-07-15" }),
      offer({ id: "early1", series_id: "EARLY", scheduled_date: "2026-07-20" }),
      offer({ id: "early2", series_id: "EARLY", scheduled_date: "2026-07-27" }),
    ]);
    expect(g.singles.map((s) => s.id)).toEqual(["single"]);
    expect(g.series.map((s) => s.seriesId)).toEqual(["EARLY", "LATE"]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (module not found).

Run: `npm run test:unit -- deriveSeriesOffers`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export interface SeriesOffer {
  seriesId: string;
  /** Occurrences of this series still awaiting the cleaner, sorted by (date,time) asc. Length >= 2. */
  occurrences: CleanerAppointment[];
  count: number;
  /** occurrences[0]; source of the shared property/service/customer labels. */
  first: CleanerAppointment;
  /** Soonest non-null response_deadline (ISO) across occurrences, or null. */
  soonestDeadline: string | null;
  startDate: string;
  endDate: string;
}

export interface GroupedOffers {
  singles: CleanerAppointment[];
  series: SeriesOffer[];
}

const byDateTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  `${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`.localeCompare(
    `${b.scheduled_date ?? ""} ${b.scheduled_time ?? ""}`,
  );

/**
 * Group a flat list of pending offers (the cleaner's `awaiting` appointments) into
 * standalone singles + recurring series. A series shows as one grouped offer only
 * when >= 2 of its occurrences are still awaiting; a lone remaining occurrence
 * degrades to a single (no "series of 1"). Occurrences and singles are date-sorted;
 * series are ordered by their soonest occurrence.
 */
export function deriveSeriesOffers(offers: CleanerAppointment[]): GroupedOffers {
  const singles: CleanerAppointment[] = [];
  const groups = new Map<string, CleanerAppointment[]>();

  for (const o of offers) {
    const sid = o.series_id;
    if (!sid) {
      singles.push(o);
      continue;
    }
    const arr = groups.get(sid);
    if (arr) arr.push(o);
    else groups.set(sid, [o]);
  }

  const series: SeriesOffer[] = [];
  for (const [seriesId, occ] of groups) {
    if (occ.length < 2) {
      // Lone remaining occurrence: treat as a single offer.
      singles.push(occ[0]);
      continue;
    }
    const occurrences = [...occ].sort(byDateTime);
    const deadlines = occurrences
      .map((o) => o.response_deadline)
      .filter((d): d is string => !!d)
      .sort();
    series.push({
      seriesId,
      occurrences,
      count: occurrences.length,
      first: occurrences[0],
      soonestDeadline: deadlines[0] ?? null,
      startDate: occurrences[0].scheduled_date,
      endDate: occurrences[occurrences.length - 1].scheduled_date,
    });
  }

  singles.sort(byDateTime);
  series.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { singles, series };
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `npm run test:unit -- deriveSeriesOffers`
Expected: 5 pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/redesign/cleaner/today/deriveSeriesOffers.ts src/components/redesign/cleaner/today/deriveSeriesOffers.test.ts
git commit -m "feat(cleaner): deriveSeriesOffers grouping presenter (+tests)"
```

---

### Task 3: `useRespondToSeries` accept-all hook + `summarizeSeriesAccepts` (TDD on the summarizer)

**Files:**
- Modify: `src/hooks/useCleanerData.ts` (add after `useRespondToOffer`, ~line 1055)
- Test: `src/hooks/summarizeSeriesAccepts.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`, `useAuth`, `useToast`, `useQueryClient`, `keys` (all already imported in the file).
- Produces: `summarizeSeriesAccepts`, `SeriesAcceptResult`, `useRespondToSeries` (signatures above).

Design: accept-all posts the existing confirm route **sequentially** (one occurrence at a time) so a 50-occurrence series never fires 50 concurrent writes at the shared PostgREST pool. Each call is the same `action: 'accept'` body `useRespondToOffer.accept` uses. Partial failures are tolerated (an occurrence that already timed out and re-routed away returns non-ok); the summarizer reports `{ total, accepted, failed }` and the toast is success-only when `failed === 0`.

- [ ] **Step 1: Write the failing test for the pure summarizer.**

```ts
import { describe, it, expect } from "vitest";
import { summarizeSeriesAccepts } from "./useCleanerData";

describe("summarizeSeriesAccepts", () => {
  it("counts all-ok", () => {
    expect(summarizeSeriesAccepts([{ ok: true }, { ok: true }, { ok: true }])).toEqual({
      total: 3, accepted: 3, failed: 0,
    });
  });
  it("counts partial failure", () => {
    expect(summarizeSeriesAccepts([{ ok: true }, { ok: false }, { ok: true }])).toEqual({
      total: 3, accepted: 2, failed: 1,
    });
  });
  it("handles empty", () => {
    expect(summarizeSeriesAccepts([])).toEqual({ total: 0, accepted: 0, failed: 0 });
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (export not found).

Run: `npm run test:unit -- summarizeSeriesAccepts`
Expected: FAIL.

- [ ] **Step 3: Implement the summarizer + hook.** Add to `src/hooks/useCleanerData.ts`. First, ensure `useState` is imported from `react` (the file currently imports `{ useCallback }`; change to `{ useCallback, useState }`). Then append after `useRespondToOffer`:

```ts
export interface SeriesAcceptResult {
  total: number;
  accepted: number;
  failed: number;
}

/** Pure: fold per-occurrence accept results into a summary for the toast. */
export function summarizeSeriesAccepts(results: { ok: boolean }[]): SeriesAcceptResult {
  const accepted = results.filter((r) => r.ok).length;
  return { total: results.length, accepted, failed: results.length - accepted };
}

/**
 * Accept every occurrence of a recurring offer by looping the existing
 * per-appointment confirm route SEQUENTIALLY. No bulk route (spec: no new route)
 * and deliberately sequential: a series can hold up to 50 occurrences, and firing
 * them concurrently would saturate the shared PostgREST pool (see the bulk-action
 * 504 postmortem). Tolerates partial failure (an occurrence that already timed out
 * and re-routed returns non-ok) and reports { total, accepted, failed }.
 */
export function useRespondToSeries() {
  const { user, currentOrganizationId } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: async (
      occurrences: { appointmentId: string; slotIndex: number }[],
    ): Promise<SeriesAcceptResult> => {
      setProgress({ done: 0, total: occurrences.length });
      const results: { ok: boolean }[] = [];
      for (const occ of occurrences) {
        let ok = false;
        try {
          const token = await getAccessToken();
          const res = await fetch("/api/appointments/confirm", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              organizationId: currentOrganizationId,
              appointmentId: occ.appointmentId,
              action: "accept",
              slotIndex: occ.slotIndex,
            }),
          });
          const data = await res.json().catch(() => ({} as Record<string, unknown>));
          ok = res.ok && !!(data as { success?: boolean }).success;
        } catch {
          ok = false;
        }
        results.push({ ok });
        setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
      }
      return summarizeSeriesAccepts(results);
    },
    onSuccess: (r) => {
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
      }
      if (r.failed === 0) {
        showToast(`Accepted ${r.accepted} ${r.accepted === 1 ? "cleaning" : "cleanings"}`, { variant: "success" });
      } else if (r.accepted === 0) {
        showToast("Could not accept these cleanings. Please try again.", { variant: "error" });
      } else {
        showToast(`Accepted ${r.accepted} of ${r.total}. ${r.failed} could not be accepted.`, { variant: "info" });
      }
    },
    onError: (e: Error) => showToast(e.message || "Could not accept the series", { variant: "error" }),
    onSettled: () => setProgress(null),
  });

  return {
    acceptAll: mutation.mutateAsync,
    accepting: mutation.isPending,
    progress,
  };
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `npm run test:unit -- summarizeSeriesAccepts`
Expected: 3 pass.

- [ ] **Step 5: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit.**

```bash
git add src/hooks/useCleanerData.ts src/hooks/summarizeSeriesAccepts.test.ts
git commit -m "feat(cleaner): useRespondToSeries sequential accept-all (+summarizer test)"
```

---

### Task 4: `SeriesOfferCard` + `SeriesOfferSheet` UI (design system)

**Files:**
- Create: `src/components/redesign/cleaner/today/SeriesOfferCard.tsx`
- Create: `src/components/redesign/cleaner/today/SeriesOfferSheet.tsx`

**Interfaces:**
- Consumes: `SeriesOffer`, `offeredSlots`, `formatTimeParts`, `formatCardDate`/`formatDateLong`, `formatRespondBy`, `propertyTitle`, `jobSubtitle`, `customerLabel`, `Button`, `Badge`, `Drawer*`, `RadioGroup`, `Textarea`, `Label`, `DeclineReason`.
- Produces: `SeriesOfferCard` (rendered by `CleanerTodayView`).

Card copy (office, no em dash): title from `propertyTitle(first)`, subtitle `jobSubtitle(first)`, a `Badge` line "{count} cleanings" + a range line "{Mon D} to {Mon D}", a caution `Badge` "Respond by {time}" when `soonestDeadline` yields one. Primary button "Accept all {count}"; secondary outline button "Pick dates". Framing line: "The office offered you this repeating cleaning." An offer that routes if declined is the existing model; keep copy calm.

The **`SeriesOfferSheet`** is a bottom `Drawer` listing every occurrence with a per-row Accept and Decline. It has an internal 2-mode body: `list` (default) and `decline` (scoped to one occurrence). Declining swaps the body to a reason picker (no nested drawer). "Accept all {count}" pinned at the top of the list mode too.

- [ ] **Step 1: Create `SeriesOfferSheet.tsx`.**

```tsx
"use client";

import { useState } from "react";
import { Check, X, ChevronLeft } from "lucide-react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DeclineReason } from "@/hooks/useCleanerData";
import type { SeriesOffer } from "./deriveSeriesOffers";
import { offeredSlots, formatTimeParts, formatDateLong } from "../shared/job-presenters";

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "sick", label: "I'm not available" },
  { value: "too_far", label: "Too far from me" },
  { value: "not_my_service", label: "Not a service I do" },
  { value: "other", label: "Other reason" },
];

export function SeriesOfferSheet({
  series, open, onOpenChange, onAcceptAll, onAcceptOne, onDeclineOne, accepting,
}: {
  series: SeriesOffer;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAcceptAll: () => Promise<unknown> | void;
  onAcceptOne: (appointmentId: string, slotIndex: number) => Promise<unknown> | void;
  onDeclineOne: (appointmentId: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  accepting: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<{ id: string; date: string } | null>(null);
  const [reason, setReason] = useState<DeclineReason>("sick");
  const [other, setOther] = useState("");
  // Ids acted on locally so a row leaves the list immediately (the query refetch confirms).
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const remaining = series.occurrences.filter((o) => !resolved.has(o.id));

  function markResolved(id: string) {
    setResolved((s) => new Set(s).add(id));
  }

  async function acceptOne(id: string, slotIndex: number) {
    setBusyId(id);
    try { await onAcceptOne(id, slotIndex); markResolved(id); }
    catch { /* toast handled by hook */ }
    finally { setBusyId(null); }
  }

  async function confirmDecline() {
    if (!declining) return;
    setBusyId(declining.id);
    try {
      await onDeclineOne(declining.id, reason, reason === "other" ? other.trim() || undefined : undefined);
      markResolved(declining.id);
      setDeclining(null);
      setReason("sick");
      setOther("");
    } catch { /* toast handled by hook */ }
    finally { setBusyId(null); }
  }

  async function acceptAll() {
    try { await onAcceptAll(); onOpenChange(false); }
    catch { /* toast handled by hook */ }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh]">
        {declining ? (
          <>
            <DrawerHeader>
              <button
                onClick={() => setDeclining(null)}
                className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-control"
              >
                <ChevronLeft className="size-4" /> Back
              </button>
              <DrawerTitle>Decline {formatDateLong(declining.date)}?</DrawerTitle>
              <DrawerDescription>Let the office know why so they can offer it to someone else.</DrawerDescription>
            </DrawerHeader>
            <div className="space-y-3 px-4">
              <RadioGroup value={reason} onValueChange={(v) => setReason(v as DeclineReason)}>
                {DECLINE_REASONS.map((r) => (
                  <label
                    key={r.value}
                    htmlFor={`series-decline-${r.value}`}
                    className="flex items-center gap-3 rounded-control border border-border bg-card px-3 py-3 text-sm font-medium"
                  >
                    <RadioGroupItem value={r.value} id={`series-decline-${r.value}`} />
                    <span>{r.label}</span>
                  </label>
                ))}
              </RadioGroup>
              {reason === "other" && (
                <div className="space-y-1.5">
                  <Label htmlFor="series-decline-other">Tell us more</Label>
                  <Textarea id="series-decline-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Optional details" rows={3} />
                </div>
              )}
            </div>
            <DrawerFooter>
              <Button variant="destructive" onClick={confirmDecline} loading={busyId === declining.id}>Decline this date</Button>
              <Button variant="ghost" onClick={() => setDeclining(null)} disabled={busyId !== null}>Keep it</Button>
            </DrawerFooter>
          </>
        ) : (
          <>
            <DrawerHeader>
              <DrawerTitle>Pick your dates</DrawerTitle>
              <DrawerDescription>
                Accept the whole series, or take just the dates that work. The office offers any you decline to someone else.
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              <Button onClick={acceptAll} loading={accepting} className="w-full" size="lg">
                <Check /> Accept all {remaining.length}
              </Button>
            </div>
            <div className="mt-3 max-h-[52dvh] space-y-2 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
              {remaining.map((o) => {
                const t = formatTimeParts(o.scheduled_time);
                const slot = offeredSlots(o)[0].slot_index;
                return (
                  <div key={o.id} className="flex items-center gap-2 rounded-card border border-border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{formatDateLong(o.scheduled_date)}</div>
                      <div className="text-xs text-muted-foreground">{t.h} {t.ap}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setDeclining({ id: o.id, date: o.scheduled_date })} disabled={busyId !== null || accepting} aria-label={`Decline ${o.scheduled_date}`}>
                      <X /> Decline
                    </Button>
                    <Button size="sm" onClick={() => acceptOne(o.id, slot)} loading={busyId === o.id} disabled={(busyId !== null && busyId !== o.id) || accepting} aria-label={`Accept ${o.scheduled_date}`}>
                      <Check /> Accept
                    </Button>
                  </div>
                );
              })}
              {remaining.length === 0 && (
                <div className="py-6 text-center text-sm font-semibold text-positive-700">
                  You have responded to every date.
                </div>
              )}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 2: Create `SeriesOfferCard.tsx`.**

```tsx
"use client";

import { useState } from "react";
import { CalendarClock, Check, Clock, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeclineReason } from "@/hooks/useCleanerData";
import type { SeriesOffer } from "./deriveSeriesOffers";
import { propertyTitle, jobSubtitle, formatRespondBy, formatCardDate, offeredSlots } from "../shared/job-presenters";
import { SeriesOfferSheet } from "./SeriesOfferSheet";

/** "Jul 20 to Sep 14", or a single date, from a series' start/end. */
function seriesRange(start: string, end: string, todayStr: string): string {
  const s = formatCardDate(start, "") ?? start;
  const e = formatCardDate(end, "") ?? end;
  return start === end ? s : `${s} to ${e}`;
}

export function SeriesOfferCard({
  series, onAcceptAll, onAcceptOne, onDeclineOne, accepting, todayStr,
}: {
  series: SeriesOffer;
  onAcceptAll: (occurrences: { appointmentId: string; slotIndex: number }[]) => Promise<unknown> | void;
  onAcceptOne: (appointmentId: string, slotIndex: number) => Promise<unknown> | void;
  onDeclineOne: (appointmentId: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  accepting: boolean;
  todayStr: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const respondBy = formatRespondBy(series.soonestDeadline);

  const allOccurrenceArgs = () =>
    series.occurrences.map((o) => ({ appointmentId: o.id, slotIndex: offeredSlots(o)[0].slot_index }));

  async function acceptAll() {
    try { await onAcceptAll(allOccurrenceArgs()); }
    catch { /* toast handled by hook */ }
  }

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-brand-600" aria-hidden />
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand-700">Repeating cleaning</span>
          </div>
          <div className="mt-1 text-sm font-extrabold">{propertyTitle(series.first)}</div>
          <div className="text-xs text-muted-foreground">{jobSubtitle(series.first)}</div>
        </div>
        {respondBy && <Badge variant="caution"><Clock />{respondBy}</Badge>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{series.count} cleanings</Badge>
        <span className="text-xs font-medium text-muted-foreground">{seriesRange(series.startDate, series.endDate, todayStr)}</span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">The office offered you this repeating cleaning. Take all of it or just the dates that work.</p>

      <div className="mt-3 flex gap-2">
        <Button onClick={acceptAll} loading={accepting} className="flex-1">
          <Check /> Accept all {series.count}
        </Button>
        <Button variant="outline" onClick={() => setSheetOpen(true)} disabled={accepting} className="flex-1">
          <ListChecks /> Pick dates
        </Button>
      </div>

      <SeriesOfferSheet
        series={series}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onAcceptAll={acceptAll}
        onAcceptOne={onAcceptOne}
        onDeclineOne={onDeclineOne}
        accepting={accepting}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors. (If `Badge` has no `secondary` variant, use the neutral variant the codebase exposes , verify against `src/components/ui/badge.tsx` and pick the existing neutral/muted variant.)

- [ ] **Step 4: Commit.**

```bash
git add src/components/redesign/cleaner/today/SeriesOfferCard.tsx src/components/redesign/cleaner/today/SeriesOfferSheet.tsx
git commit -m "feat(cleaner): SeriesOfferCard + cherry-pick SeriesOfferSheet"
```

---

### Task 5: Wire grouped offers into Today

**Files:**
- Modify: `src/components/redesign/cleaner/today/CleanerTodayView.tsx`
- Modify: `src/components/redesign/cleaner/today/CleanerToday.tsx`

**Interfaces:**
- Consumes: `deriveSeriesOffers`, `SeriesOfferCard`, `useRespondToSeries`.

- [ ] **Step 1: Update `CleanerTodayView` props + render.** Add three handler props and render singles + series in the "Needs your response" section. Replace the existing `{data.offers.length > 0 && (...)}` section.

Add to imports:
```tsx
import { useMemo } from "react";
import { deriveSeriesOffers } from "./deriveSeriesOffers";
import { SeriesOfferCard } from "./SeriesOfferCard";
```
(Change the existing `import React from "react";` to `import React, { useMemo } from "react";`.)

Add to the component's prop type (after `onDeclineOffer`):
```tsx
  onAcceptSeries: (occurrences: { appointmentId: string; slotIndex: number }[]) => Promise<unknown> | void;
  acceptingSeries: boolean;
```

Inside the component body (before `return`), compute:
```tsx
  const grouped = useMemo(() => deriveSeriesOffers(data.offers), [data.offers]);
  const offerCount = grouped.singles.length + grouped.series.length;
```

Replace the whole `{data.offers.length > 0 && ( ... )}` block with:
```tsx
      {offerCount > 0 && (
        <section>
          <SectionHeader
            title="Needs your response"
            trailing={
              <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-extrabold text-brand-700">
                {offerCount}
              </span>
            }
          />
          <div className="space-y-3">
            {grouped.series.map((s) => (
              <SeriesOfferCard
                key={s.seriesId}
                series={s}
                todayStr={todayStr}
                accepting={acceptingSeries}
                onAcceptSeries={undefined as never}
                onAcceptAll={onAcceptSeries}
                onAcceptOne={(id, slot) => onAcceptOffer(id, slot)}
                onDeclineOne={(id, reason, other) => onDeclineOffer(id, reason, other)}
              />
            ))}
            {grouped.singles.map((o) => {
              const t = formatTimeParts(o.scheduled_time);
              const respondBy = formatRespondBy(o.response_deadline);
              return (
                <div
                  key={o.id}
                  className="rounded-card border border-border bg-card p-4 shadow-soft-sm"
                >
                  <button
                    onClick={() => onOpenJob(o.id)}
                    className="block w-full rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-extrabold">
                        {t.h} {t.ap}
                      </div>
                      {respondBy && (
                        <Badge variant="caution"><Clock />{respondBy}</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{propertyTitle(o)}</div>
                    <div className="text-xs text-muted-foreground">{jobSubtitle(o)}</div>
                  </button>
                  <OfferActionsBar
                    appointment={o}
                    onAccept={(slot) => onAcceptOffer(o.id, slot)}
                    onDecline={(reason, other) => onDeclineOffer(o.id, reason, other)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
```

Note: remove the stray `onAcceptSeries={undefined as never}` line , `SeriesOfferCard` takes `onAcceptAll`, not `onAcceptSeries`. Final `SeriesOfferCard` usage:
```tsx
              <SeriesOfferCard
                key={s.seriesId}
                series={s}
                todayStr={todayStr}
                accepting={acceptingSeries}
                onAcceptAll={onAcceptSeries}
                onAcceptOne={(id, slot) => onAcceptOffer(id, slot)}
                onDeclineOne={(id, reason, other) => onDeclineOffer(id, reason, other)}
              />
```

- [ ] **Step 2: Wire the container `CleanerToday`.** Add the series hook + pass handlers.

```tsx
import { useCleanerAppointments, useRespondToOffer, useRespondToSeries } from "@/hooks/useCleanerData";
```
In the body:
```tsx
  const respond = useRespondToOffer();
  const series = useRespondToSeries();
```
Add to the `<CleanerTodayView ... />` props:
```tsx
      onAcceptSeries={(occurrences) => series.acceptAll(occurrences)}
      acceptingSeries={series.accepting}
```

- [ ] **Step 3: Type-check + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Run the cleaner Today unit tests (deriveToday untouched, still green).**

Run: `npm run test:unit -- deriveToday deriveSeriesOffers summarizeSeriesAccepts`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/redesign/cleaner/today/CleanerTodayView.tsx src/components/redesign/cleaner/today/CleanerToday.tsx
git commit -m "feat(cleaner): group recurring offers into one card on Today"
```

---

### Task 6: "Repeating series" hint on the single-occurrence job detail

**Files:**
- Modify: `src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx`

Rationale: an occurrence opened from Schedule shows the single-job detail. A subtle read-only line tells the cleaner it belongs to a repeating series (so accepting/declining here is one date of many; the grouped Accept-all lives on Today). No new action here , keeps Slice 3 focused.

**Interfaces:**
- Consumes: `appointment.series_id`.

- [ ] **Step 1: Add the hint.** In the detail body, after the `Service` field block and before the `special_requests` block, add:

```tsx
                  {appointment.series_id && (
                    <>
                      <Separator />
                      <Field label="Repeating">
                        <div className="text-muted-foreground">
                          This is one date in a repeating cleaning. See all the dates under Needs your response on your Today tab.
                        </div>
                      </Field>
                    </>
                  )}
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx
git commit -m "feat(cleaner): repeating-series hint on the job detail"
```

---

### Task 7: Conformance, review, visual verification, PR

- [ ] **Step 1: Design-system conformance grep** across the new/changed files. There must be no raw hex, no `primary-<number>`, no `#F7C41E`, no em dash in user-facing strings.

Run:
```bash
grep -nE "#[0-9a-fA-F]{6}|primary-[0-9]|F7C41E|—" \
  src/components/redesign/cleaner/today/SeriesOfferCard.tsx \
  src/components/redesign/cleaner/today/SeriesOfferSheet.tsx \
  src/components/redesign/cleaner/today/CleanerTodayView.tsx \
  src/components/redesign/cleaner/today/deriveSeriesOffers.ts
```
Expected: no matches.

- [ ] **Step 2: Run `ui-ux-pro-max` at implementation** (per the guardrail) over the two new components for design-system conformance + touch-target sizes (accept/decline row buttons must be >= 44px; `Button size="sm"` may need a min-height check , use the default `size` if `sm` is under 44px on the sheet rows).

- [ ] **Step 3: Full gates.**

Run: `npx tsc --noEmit && npm run lint && npm run test:unit`
Expected: clean; new tests green.

- [ ] **Step 4: Independent adversarial review** over the whole branch (background Agent, opus). Focus: the sequential accept-all loop (partial-failure handling, no concurrent pool saturation), the grouping presenter edge cases (lone-occurrence degrade, deadline min), copy ("office" not "operator", no em dash), and design-system conformance. Fix Critical/Important; document Minors.

- [ ] **Step 5: Visual verification on dev** as the cleaner (Wanda Jones, the cleaner offered the Slice 2 dev test series John Doe -> Jul 20 + Jul 27). Log in `cleaner@nexxus.com` / `Cleaner123!` at phone width (390). Confirm: Today "Needs your response" shows ONE "Repeating cleaning" card ("2 cleanings, Jul 20 to Jul 27") not two separate offer cards; "Accept all 2" bulk-accepts (toast "Accepted 2 cleanings"; both leave the offers list and appear as confirmed jobs); re-create a test series and verify "Pick dates" -> accept one + decline one (declined routes away, accepted becomes confirmed). Screenshots to the user (mobile).

- [ ] **Step 6: Push + open PR to master** (user-gated merge). PR body: the accept-all-is-sequential rationale, the "pay" deviation (flagged for the user), no migration/route, the dev test-series side effects. Honor the codex pre-push review per [[feedback_codex_prepush_review]].

---

## Self-review

- **Spec coverage:** §77 grouped offer listing occurrences -> T2 presenter + T4/T5 card. Accept all -> T3 hook + card button. Cherry-pick per-occurrence accept/decline routing independently -> T4 sheet + existing confirm route. §80 admin sees the series fill in -> satisfied by the existing per-appointment admin surface (no work; each occurrence is an independent row with its own `cleaner_confirmation_status`). "office not operator" + no em dash + design system -> global constraints + T7.
- **Placeholder scan:** none; all steps carry complete code.
- **Type consistency:** `SeriesOffer`/`GroupedOffers`/`SeriesAcceptResult` defined in T2/T3, consumed in T4/T5 with matching field names (`seriesId`, `occurrences`, `count`, `first`, `soonestDeadline`, `startDate`, `endDate`). Handler prop names align: container `onAcceptSeries` -> View -> `SeriesOfferCard.onAcceptAll`. The stray `onAcceptSeries={undefined as never}` in the first draft of Step 1 is explicitly removed in the final usage block.
- **Ambiguity:** "pay" resolved explicitly (match existing offer vocabulary; flag). Accept-all mechanism resolved explicitly (sequential loop over the existing route; no new route).
