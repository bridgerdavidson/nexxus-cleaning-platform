# Cleaner App Slice 2 — Schedule + Job-Detail Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesign cleaner **Schedule** screen and a deep-linkable **Job-detail overview** takeover (read context + Start job + inline offer Accept/Decline), and rewire the Today feed + notifications off the legacy `?appointment=` bridge.

**Architecture:** UI rebuild on existing behavior (Approach B). New screens follow the slice-1 cleaner convention (`Cleaner<Screen>` container + `Cleaner<Screen>View` pure view + `derive<Screen>.ts` pure logic with a co-located `*.test.ts`). The job detail is a single full-screen **takeover overlay** (the `MobileThreadOverlay` pattern) mounted **once at the cleaner layout level**, reading `?job=<id>` via `useDetailParam`, so the notification bell deep-links into it from any tab. No new data layer: reuse `useCleanerAppointments`, the `/api/appointments/confirm` route (accept/decline), and `updateAppointmentStatus` (start). Shared per-job presenters + a system-token status badge are extracted so Today/Schedule/Job-detail render identically.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (redesign tokens), TanStack Query v5, Vitest (unit), Radix/vaul primitives in `src/components/ui/*`.

## Global Constraints

- **Flag-gating:** all new pages live under `src/app/(redesign)/app/cleaner-dashboard/**`; the `(redesign)/layout.tsx` gate already 404s in prod unless `NEXT_PUBLIC_REDESIGN_ENABLED === "true"`. No per-page flag code.
- **Design system only:** implement from `src/components/ui/*` primitives + tokens in `tailwind.config.js` / `src/app/globals.css`. Brand is `#0150FC` via `brand-*` tokens (NOT the legacy `primary` yellow). No raw hex, no one-off colors copied from any mockup. Status/urgency uses the badge/pill vocabulary, never decorative stripes/accents.
- **UI implementation & styling source:** there are no companion mockups for this slice; it is built from the approved design spec (`docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`) and the operator-screen patterns. Every screen is implemented from the design system; if a pattern has no primitive, build a reusable primitive, never an inline one-off.
- **Copy:** no em dashes (`—`) in any user-facing string. Use a period, comma, parentheses, or "to". Dollars in UI, never cents (N/A this slice — no money is shown to the cleaner here).
- **Column-name traps (from `src/types/index.ts` reminders):** `duration_minutes` not `estimated_duration`; `special_requests` not `special_instructions`; `cleaner_id` == `cleaner_profiles.id` == user id. Snake_case everywhere.
- **Slice boundary:** Slice 2 ends when "Start job" flips status to `in_progress`. Do NOT build the photo/checklist/Complete-charge active-job flow — that is Slice 3. For an `in_progress` job, the detail's "Continue job" bridges to the legacy active-job wizard until Slice 3.
- **TDD:** every `derive*.ts` / presenter / badge-config gets a co-located `*.test.ts` written first. Run `npm run test:unit` (worktree has deps installed). No new API routes → no new integration tests.
- **Verification:** `npx tsc --noEmit` clean for new code; `npm run test:unit` green; visual check via Playwright MCP at 375px; ui-ux-pro-max implementation conformance pass before PR.

---

## File Structure

**New — shared per-job atoms** (`src/components/redesign/cleaner/shared/`):
- `job-presenters.ts` (+ `.test.ts`) — pure formatting moved out of `today-presenters.ts` plus new helpers (address, maps URL, long date, duration, customer label).
- `jobBadge.ts` (+ `.test.ts`) — pure `jobBadgeKey(a)` + `CLEANER_JOB_BADGE` config (variant + Icon + spin), and `DeclineReason` is defined in the hook, not here.
- `CleanerJobBadge.tsx` — renders the badge through `ui/badge` (replaces slice-1 raw-hex tones).
- `JobRow.tsx` — the tappable job row (extracted from `CleanerTodayView`), used by Today + Schedule.
- `OfferActionsBar.tsx` — presentational Accept (+ slot chips) / Decline (+ reason drawer); used by Today offer cards and the job-detail action bar.

**New — Schedule** (`src/components/redesign/cleaner/schedule/`):
- `schedule-types.ts`, `deriveSchedule.ts` (+ `.test.ts`), `CleanerScheduleView.tsx`, `CleanerSchedule.tsx`.

**New — Job detail** (`src/components/redesign/cleaner/job/`):
- `job-detail-types.ts`, `deriveJobDetail.ts` (+ `.test.ts`), `useOpenJob.ts`, `CleanerJobDetailOverlay.tsx`, `CleanerJobDetailHost.tsx`.

**Modified:**
- `src/hooks/useCleanerData.ts` — add `useStartJob()`, `useRespondToOffer()`, export `DeclineReason`.
- `src/components/redesign/cleaner/today/CleanerToday.tsx` + `CleanerTodayView.tsx` — rewire taps + inline offer actions + use shared atoms; delete `today-presenters.ts` (+ test) after the move.
- `src/app/(redesign)/app/cleaner-dashboard/layout.tsx` — mount `<CleanerJobDetailHost/>` under `<Suspense>`.
- `src/app/(redesign)/app/cleaner-dashboard/schedule/page.tsx` — render `<CleanerSchedule/>`.
- `src/components/redesign/notifications/deriveNotifications.ts` (+ `.test.ts`) — cleaner job href → `/app/cleaner-dashboard?job=<id>`.

---

## Task 1: Shared job presenters (pure)

**Files:**
- Create: `src/components/redesign/cleaner/shared/job-presenters.ts`
- Test: `src/components/redesign/cleaner/shared/job-presenters.test.ts`

**Interfaces — Produces:**
- `formatTimeParts(time: string): { h: string; ap: string }`
- `propertyTitle(a: CleanerAppointment): string`
- `jobSubtitle(a: CleanerAppointment): string`
- `formatRespondBy(deadline?: string | null): string | null`
- `customerLabel(a: CleanerAppointment): string`
- `propertyAddress(a: CleanerAppointment): string | null`
- `mapsUrl(a: CleanerAppointment): string | null`
- `formatDateLong(dateStr: string): string`
- `formatDuration(minutes?: number | null): string | null`

- [ ] **Step 1: Write the failing test** `src/components/redesign/cleaner/shared/job-presenters.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  formatTimeParts, propertyTitle, jobSubtitle, formatRespondBy,
  customerLabel, propertyAddress, mapsUrl, formatDateLong, formatDuration,
} from "./job-presenters";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const base = {
  id: "a1", scheduled_date: "2026-06-01", scheduled_time: "09:00:00", status: "confirmed",
  cleaner_confirmation_status: "approved", total_price: 120,
  property: { name: "Maple House", address: "123 Main St", city: "Austin", state: "TX", zip_code: "78701" },
  homeowner: { first_name: "Jamie", last_name: "Lee", email: "j@x.co" },
  service_type: { name: "Deep clean", description: "", duration_minutes: 150 },
} as unknown as CleanerAppointment;

describe("formatTimeParts", () => {
  it("formats 24h to 12h parts", () => {
    expect(formatTimeParts("09:00:00")).toEqual({ h: "9:00", ap: "AM" });
    expect(formatTimeParts("13:30:00")).toEqual({ h: "1:30", ap: "PM" });
    expect(formatTimeParts("00:05:00")).toEqual({ h: "12:05", ap: "AM" });
  });
});

describe("propertyTitle / jobSubtitle / customerLabel", () => {
  it("prefers property name, falls back to address then Job", () => {
    expect(propertyTitle(base)).toBe("Maple House");
    expect(propertyTitle({ ...base, property: { ...base.property!, name: "" } } as CleanerAppointment)).toBe("123 Main St");
    expect(propertyTitle({ ...base, property: null } as unknown as CleanerAppointment)).toBe("Job");
  });
  it("joins service and customer with a middot", () => {
    expect(jobSubtitle(base)).toBe("Deep clean · Jamie Lee");
  });
  it("labels a self-pay (no homeowner) job as a company booking", () => {
    expect(customerLabel(base)).toBe("Jamie Lee");
    expect(customerLabel({ ...base, homeowner: null } as unknown as CleanerAppointment)).toBe("Company booking");
  });
});

describe("propertyAddress / mapsUrl", () => {
  it("builds a single-line address", () => {
    expect(propertyAddress(base)).toBe("123 Main St, Austin, TX 78701");
    expect(propertyAddress({ ...base, property: null } as unknown as CleanerAppointment)).toBeNull();
  });
  it("builds a maps search url or null", () => {
    expect(mapsUrl(base)).toBe("https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Austin%2C%20TX%2078701");
    expect(mapsUrl({ ...base, property: null } as unknown as CleanerAppointment)).toBeNull();
  });
});

describe("formatRespondBy", () => {
  it("returns null on missing/invalid deadline", () => {
    expect(formatRespondBy(null)).toBeNull();
    expect(formatRespondBy("not-a-date")).toBeNull();
  });
  it("prefixes 'Respond by'", () => {
    expect(formatRespondBy("2026-06-01T21:00:00Z")).toMatch(/^Respond by /);
  });
});

describe("formatDateLong / formatDuration", () => {
  it("formats an ISO date as a long local date", () => {
    expect(formatDateLong("2026-06-01")).toBe("Monday, June 1, 2026");
  });
  it("formats minutes as h/m", () => {
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- job-presenters`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/components/redesign/cleaner/shared/job-presenters.ts`**

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export function formatTimeParts(time: string): { h: string; ap: string } {
  const [hRaw = "0", mRaw = "00"] = (time ?? "").split(":");
  const hour = Number(hRaw);
  const ap = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { h: `${h12}:${mRaw.padStart(2, "0")}`, ap };
}

export function propertyTitle(a: CleanerAppointment): string {
  return a.property?.name || a.property?.address || "Job";
}

export function jobSubtitle(a: CleanerAppointment): string {
  const service = a.service_type?.name ?? "";
  const customer = a.homeowner ? [a.homeowner.first_name, a.homeowner.last_name].filter(Boolean).join(" ") : "";
  return [service, customer].filter(Boolean).join(" · ");
}

/** Homeowner full name, or a clear label when the org is the payer (self-pay). */
export function customerLabel(a: CleanerAppointment): string {
  if (!a.homeowner) return "Company booking";
  const name = [a.homeowner.first_name, a.homeowner.last_name].filter(Boolean).join(" ").trim();
  return name || "Customer";
}

/** Single-line address, or null when no property is attached. */
export function propertyAddress(a: CleanerAppointment): string | null {
  const p = a.property;
  if (!p) return null;
  const cityState = [p.city, p.state].filter(Boolean).join(", ");
  const line2 = [cityState, p.zip_code].filter(Boolean).join(" ");
  const full = [p.address, line2].filter(Boolean).join(", ");
  return full || null;
}

/** A Google Maps search link for the property address, or null. */
export function mapsUrl(a: CleanerAppointment): string | null {
  const addr = propertyAddress(a);
  if (!addr) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

/**
 * Label for an offer's response deadline, e.g. "Respond by 9:00 PM". Returns
 * null when there is no (or an invalid) deadline so the caller can omit the pill.
 */
export function formatRespondBy(deadline?: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Respond by ${time}`;
}

/** "Monday, June 1, 2026" from a YYYY-MM-DD string, parsed in local time. */
export function formatDateLong(dateStr: string): string {
  const [y, m, d] = (dateStr ?? "").split("-").map(Number);
  if (!y || !m || !d) return dateStr ?? "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

/** "2h 30m" / "1h" / "45 min" from minutes, or null. */
export function formatDuration(minutes?: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- job-presenters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/shared/job-presenters.ts src/components/redesign/cleaner/shared/job-presenters.test.ts
git commit -m "feat(cleaner-redesign): shared per-job presenters (slice 2)"
```

---

## Task 2: Shared status badge (pure config + component)

**Files:**
- Create: `src/components/redesign/cleaner/shared/jobBadge.ts`
- Test: `src/components/redesign/cleaner/shared/jobBadge.test.ts`
- Create: `src/components/redesign/cleaner/shared/CleanerJobBadge.tsx`

**Interfaces — Produces:**
- `type CleanerJobBadgeKey = "needs_response" | "upcoming" | "in_progress" | "completed" | "cancelled"`
- `jobBadgeKey(a: CleanerAppointment): CleanerJobBadgeKey`
- `CLEANER_JOB_BADGE: Record<CleanerJobBadgeKey, { label; variant; Icon; spin? }>`
- `<CleanerJobBadge appointment={a} />`

- [ ] **Step 1: Write the failing test** `jobBadge.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { jobBadgeKey } from "./jobBadge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const a = (over: Partial<CleanerAppointment>) => ({ status: "confirmed", cleaner_confirmation_status: "approved", ...over }) as CleanerAppointment;

describe("jobBadgeKey", () => {
  it("maps cancelled/completed/in_progress first", () => {
    expect(jobBadgeKey(a({ status: "cancelled" }))).toBe("cancelled");
    expect(jobBadgeKey(a({ status: "completed" }))).toBe("completed");
    expect(jobBadgeKey(a({ status: "in_progress" }))).toBe("in_progress");
  });
  it("maps an awaiting pending offer to needs_response", () => {
    expect(jobBadgeKey(a({ status: "pending", cleaner_confirmation_status: "awaiting" }))).toBe("needs_response");
  });
  it("defaults to upcoming", () => {
    expect(jobBadgeKey(a({ status: "confirmed" }))).toBe("upcoming");
    expect(jobBadgeKey(a({ status: "pending", cleaner_confirmation_status: "approved" }))).toBe("upcoming");
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npm run test:unit -- jobBadge` → FAIL.

- [ ] **Step 3: Write `jobBadge.ts`**

```ts
import type { ComponentType } from "react";
import { CalendarCheck, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type CleanerJobBadgeKey =
  | "needs_response" | "upcoming" | "in_progress" | "completed" | "cancelled";

export interface CleanerJobBadgeConfig {
  label: string;
  variant: BadgeProps["variant"];
  Icon: ComponentType<{ className?: string }>;
  /** Spin the icon for live work (respects reduced-motion). */
  spin?: boolean;
}

// Color hierarchy mirrors the operator badge vocabulary: amber = needs you,
// gray = settled (upcoming/confirmed), blue (spinning) = live, green = done,
// red = cancelled.
export const CLEANER_JOB_BADGE: Record<CleanerJobBadgeKey, CleanerJobBadgeConfig> = {
  needs_response: { label: "Needs response", variant: "caution", Icon: Clock },
  upcoming: { label: "Upcoming", variant: "secondary", Icon: CalendarCheck },
  in_progress: { label: "In progress", variant: "default", Icon: Loader2, spin: true },
  completed: { label: "Done", variant: "positive", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "critical", Icon: XCircle },
};

export function jobBadgeKey(a: CleanerAppointment): CleanerJobBadgeKey {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "completed") return "completed";
  if (a.status === "in_progress") return "in_progress";
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "needs_response";
  return "upcoming";
}
```

- [ ] **Step 4: Write `CleanerJobBadge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { CLEANER_JOB_BADGE, jobBadgeKey } from "./jobBadge";

export function CleanerJobBadge({ appointment }: { appointment: CleanerAppointment }) {
  const c = CLEANER_JOB_BADGE[jobBadgeKey(appointment)];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}
```

- [ ] **Step 5: Run test, verify pass; typecheck**

Run: `npm run test:unit -- jobBadge` → PASS. `npx tsc --noEmit` → no new errors in these files.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/cleaner/shared/jobBadge.ts src/components/redesign/cleaner/shared/jobBadge.test.ts src/components/redesign/cleaner/shared/CleanerJobBadge.tsx
git commit -m "feat(cleaner-redesign): system-token job status badge (slice 2)"
```

---

## Task 3: Extract `JobRow` + migrate Today to shared atoms

Removes the slice-1 raw-hex tone badge and centralizes the row + presenters. Today must look and behave identically (badge now renders via `ui/badge` tokens).

**Files:**
- Create: `src/components/redesign/cleaner/shared/JobRow.tsx`
- Modify: `src/components/redesign/cleaner/today/CleanerTodayView.tsx`
- Delete: `src/components/redesign/cleaner/today/today-presenters.ts` and `today-presenters.test.ts`

**Interfaces — Consumes:** `formatTimeParts/propertyTitle/jobSubtitle` (Task 1), `CleanerJobBadge` (Task 2).
**Produces:** `<JobRow appointment={a} onClick={() => ...} />`

- [ ] **Step 1: Write `JobRow.tsx`** (verbatim row markup lifted from `CleanerTodayView`)

```tsx
import { formatTimeParts, propertyTitle, jobSubtitle } from "./job-presenters";
import { CleanerJobBadge } from "./CleanerJobBadge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export function JobRow({ appointment, onClick }: { appointment: CleanerAppointment; onClick: () => void }) {
  const t = formatTimeParts(appointment.scheduled_time);
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-3 text-left shadow-soft-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-14 flex-none text-center">
        <div className="text-sm font-extrabold tabular-nums">{t.h}</div>
        <div className="text-[10px] font-bold text-muted-foreground">{t.ap}</div>
      </div>
      <div className="self-stretch w-px bg-border" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{propertyTitle(appointment)}</div>
        <div className="truncate text-xs text-muted-foreground">{jobSubtitle(appointment)}</div>
      </div>
      <CleanerJobBadge appointment={appointment} />
    </button>
  );
}
```

- [ ] **Step 2: Update `CleanerTodayView.tsx` imports + remove the local `TONE`/`Badge`/`JobRow`/`statusBadge`.** Replace the import line and delete the three local helpers (`TONE` map, local `Badge`, local `JobRow`). New top imports:

```tsx
import React from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { TodayData } from "./today-types";
import { formatTimeParts, propertyTitle, jobSubtitle, formatRespondBy } from "../shared/job-presenters";
import { JobRow } from "../shared/JobRow";
```
(Keep `SectionHeader` local. The today-job list now renders `<JobRow appointment={j} onClick={() => onOpenJob(j.id)} />`. The offer/active-card sections are reworked in Task 6 — for THIS task, leave the offer "Respond" button and active card as-is but swap the badge-bearing today rows to the shared `JobRow`, and replace the `cn`/`statusBadge` usage. Remove the now-unused `cn` import if nothing else uses it.)

- [ ] **Step 3: Delete the moved presenters**

```bash
git rm src/components/redesign/cleaner/today/today-presenters.ts src/components/redesign/cleaner/today/today-presenters.test.ts
```

- [ ] **Step 4: Verify** — `npm run test:unit` (job-presenters covers the moved fns), `npx tsc --noEmit` (no dangling imports of `today-presenters`), grep to confirm:

Run: `git grep -n "today-presenters" src` → Expected: no results.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/redesign/cleaner
git commit -m "refactor(cleaner-redesign): extract JobRow + drop raw-hex badge in Today (slice 2)"
```

---

## Task 4: Mutation hooks — `useStartJob` + `useRespondToOffer`

Thin glue over existing routes. No new pure logic to unit-test; verified by `tsc` + later visual use.

**Files:**
- Modify: `src/hooks/useCleanerData.ts`

**Interfaces — Produces:**
- `type DeclineReason = "sick" | "not_my_service" | "too_far" | "other"`
- `useStartJob(): UseMutationResult<..., string>` (mutate with `appointmentId`)
- `useRespondToOffer(): { accept: UseMutationResult<..., { appointmentId; slotIndex }>; decline: UseMutationResult<..., { appointmentId; reason; other? }> }`

- [ ] **Step 1: Add imports to `useCleanerData.ts`.** Already present: `useQueryClient` (from `@tanstack/react-query`), `useAuth`, `keys`, and `getAccessToken` (from `../lib/auth/clientAccessToken`). Add `useMutation` to the existing `@tanstack/react-query` import, and add `import { useToast } from '../contexts/ToastContext';`. (`updateAppointmentStatus` is already defined in this file.) Use the existing `getAccessToken()` helper for the Bearer token (NOT `useAuth().accessToken`).

- [ ] **Step 2: Append the hooks** (place near the other cleaner hooks, e.g. after `useCleanerStats`)

```ts
export type DeclineReason = "sick" | "not_my_service" | "too_far" | "other";

/** Start a confirmed job (status -> in_progress; fires the 'started' lifecycle
 * notification inside updateAppointmentStatus). */
export function useStartJob() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const r = await updateAppointmentStatus(appointmentId, "in_progress");
      if (!r.success) throw new Error(r.error || "Could not start the job");
      return r;
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
      }
      showToast("Job started", { variant: "success" });
    },
    onError: (e: Error) => showToast(e.message, { variant: "error" }),
  });
}

/** Accept or decline a job offer via POST /api/appointments/confirm. */
export function useRespondToOffer() {
  const { user, currentOrganizationId } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id;

  async function post(body: Record<string, unknown>) {
    const token = await getAccessToken();
    const res = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organizationId: currentOrganizationId, ...body }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !(data as { success?: boolean }).success) {
      const msg = (data as { error?: string; message?: string }).error
        || (data as { message?: string }).message
        || "Could not submit your response";
      throw new Error(msg);
    }
    return data;
  }

  function invalidate() {
    if (!userId) return;
    qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
    qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
  }

  const accept = useMutation({
    mutationFn: (v: { appointmentId: string; slotIndex: number }) =>
      post({ appointmentId: v.appointmentId, action: "accept", slotIndex: v.slotIndex }),
    onSuccess: () => { invalidate(); showToast("Job accepted", { variant: "success" }); },
    onError: (e: Error) => showToast(e.message, { variant: "error" }),
  });

  const decline = useMutation({
    mutationFn: (v: { appointmentId: string; reason: DeclineReason; other?: string }) =>
      post({ appointmentId: v.appointmentId, action: "decline", declineReason: v.reason, declineReasonOther: v.other }),
    onSuccess: () => { invalidate(); showToast("Offer declined", { variant: "info" }); },
    onError: (e: Error) => showToast(e.message, { variant: "error" }),
  });

  return { accept, decline };
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (confirm `keys.appointments.byCleaner` / `keys.stats.cleaner` exist as used elsewhere in the file; reuse the exact same calls already present in `useCleanerAppointments`). `npm run test:unit` still green.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCleanerData.ts
git commit -m "feat(cleaner-redesign): useStartJob + useRespondToOffer mutation hooks (slice 2)"
```

---

## Task 5: `OfferActionsBar` (presentational accept/decline + reason drawer)

**Files:**
- Create: `src/components/redesign/cleaner/shared/OfferActionsBar.tsx`

**Interfaces — Consumes:** `offeredSlots` is NOT needed here (Task 6 owns the detail); compute slots inline from `appointment.requested_slots`. `DeclineReason` (Task 4), `formatTimeParts` (Task 1), `Drawer*` (`@/components/ui/drawer`), `Button`, `RadioGroup/RadioGroupItem`, `Textarea`, `Label`.
**Produces:** `<OfferActionsBar appointment onAccept onDecline onDone? layout? />`

```ts
// props
{
  appointment: CleanerAppointment;
  onAccept: (slotIndex: number) => Promise<unknown> | void;
  onDecline: (reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onDone?: () => void;          // called after a successful accept/decline (e.g. close overlay)
  layout?: "inline" | "stacked"; // inline = Today card (mt-3); stacked = detail action bar (full width)
}
```

- [ ] **Step 1: Implement** `OfferActionsBar.tsx`

```tsx
"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
} from "@/components/ui/drawer";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { DeclineReason } from "@/hooks/useCleanerData";
import { formatTimeParts } from "./job-presenters";

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "sick", label: "I'm not available" },
  { value: "too_far", label: "Too far from me" },
  { value: "not_my_service", label: "Not a service I do" },
  { value: "other", label: "Other reason" },
];

type Slot = { slot_index: number; scheduled_date: string; scheduled_time: string };

function slotsOf(a: CleanerAppointment): Slot[] {
  const s = a.requested_slots;
  if (s && s.length > 0) return [...s].sort((x, y) => x.slot_index - y.slot_index);
  return [{ slot_index: 0, scheduled_date: a.scheduled_date, scheduled_time: a.scheduled_time }];
}

export function OfferActionsBar({
  appointment, onAccept, onDecline, onDone, layout = "inline",
}: {
  appointment: CleanerAppointment;
  onAccept: (slotIndex: number) => Promise<unknown> | void;
  onDecline: (reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onDone?: () => void;
  layout?: "inline" | "stacked";
}) {
  const slots = slotsOf(appointment);
  const multi = slots.length > 1;
  const [slotIndex, setSlotIndex] = useState(slots[0].slot_index);
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState<DeclineReason>("sick");
  const [other, setOther] = useState("");

  async function handleAccept() {
    setBusy("accept");
    try { await onAccept(slotIndex); onDone?.(); } catch { /* toast handled by hook */ } finally { setBusy(null); }
  }
  async function handleDecline() {
    setBusy("decline");
    try { await onDecline(reason, reason === "other" ? other.trim() || undefined : undefined); setDeclineOpen(false); onDone?.(); }
    catch { /* toast handled by hook */ } finally { setBusy(null); }
  }

  return (
    <div className={cn(layout === "inline" ? "mt-3" : "")}>
      {multi && (
        <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a time">
          {slots.map((s) => {
            const t = formatTimeParts(s.scheduled_time);
            const active = s.slot_index === slotIndex;
            return (
              <button
                key={s.slot_index}
                role="radio"
                aria-checked={active}
                onClick={() => setSlotIndex(s.slot_index)}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-border bg-card text-muted-foreground",
                )}
              >
                {t.h} {t.ap}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={handleAccept} loading={busy === "accept"} disabled={busy !== null} className="flex-1">
          <Check /> Accept
        </Button>
        <Button variant="outline" onClick={() => setDeclineOpen(true)} disabled={busy !== null} className="flex-1">
          <X /> Decline
        </Button>
      </div>

      <Drawer open={declineOpen} onOpenChange={setDeclineOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader>
            <DrawerTitle>Decline this job?</DrawerTitle>
            <DrawerDescription>Let the office know why so they can reassign it.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4">
            <RadioGroup value={reason} onValueChange={(v) => setReason(v as DeclineReason)}>
              {DECLINE_REASONS.map((r) => (
                <label key={r.value} className="flex items-center gap-3 rounded-control border border-border bg-card px-3 py-3 text-sm font-medium">
                  <RadioGroupItem value={r.value} id={`decline-${r.value}`} />
                  <span>{r.label}</span>
                </label>
              ))}
            </RadioGroup>
            {reason === "other" && (
              <div className="space-y-1.5">
                <Label htmlFor="decline-other">Tell us more</Label>
                <Textarea id="decline-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Optional details" rows={3} />
              </div>
            )}
          </div>
          <DrawerFooter>
            <Button variant="destructive" onClick={handleDecline} loading={busy === "decline"}>Decline job</Button>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)} disabled={busy !== null}>Keep it</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`. Confirm `Textarea` is exported from `@/components/ui/textarea` and `Label` from `@/components/ui/label` (both present in `ui/`). No test (pure presentational; covered by visual check in Task 7/9).

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/cleaner/shared/OfferActionsBar.tsx
git commit -m "feat(cleaner-redesign): reusable OfferActionsBar (accept slots + decline reasons) (slice 2)"
```

---

## Task 6: Wire inline offer actions into Today

**Files:**
- Modify: `src/components/redesign/cleaner/today/CleanerToday.tsx`
- Modify: `src/components/redesign/cleaner/today/CleanerTodayView.tsx`

**Interfaces — Consumes:** `useRespondToOffer` (Task 4), `OfferActionsBar` (Task 5), `useOpenJob` (Task 8 — but `onOpenJob` here can stay as the legacy bridge UNTIL Task 9; to keep this task self-contained, keep `onOpenJob` bridging to legacy and only swap the offer "Respond" button for `OfferActionsBar`). The Today rewire to `useOpenJob` happens in Task 9 after the detail exists.

> NOTE: To avoid a dead offer state, this task replaces the single "Respond" button with `OfferActionsBar` and removes `onRespondOffer`. `onOpenJob`/`onContinueActive` keep their slice-1 legacy bridge until Task 9.

- [ ] **Step 1: `CleanerToday.tsx`** — add `useRespondToOffer`; replace `onRespondOffer` with `onAcceptOffer`/`onDeclineOffer`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCleanerAppointments, useRespondToOffer } from "@/hooks/useCleanerData";
import { deriveToday } from "./deriveToday";
import { CleanerTodayView } from "./CleanerTodayView";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerToday() {
  const router = useRouter();
  const { appointments, loading } = useCleanerAppointments();
  const respond = useRespondToOffer();

  const now = new Date();
  const data = deriveToday(appointments, ymd(now), ymd(new Date(now.getTime() + 864e5)), "percentage_contractor");

  // Job-detail + active-job flow are not in-redesign yet here; bridge to legacy
  // until Task 9 (job detail) / Slice 3 (active-job flow).
  const openLegacy = (id: string) => router.push(`/cleaner-dashboard?appointment=${id}`);

  return (
    <CleanerTodayView
      data={data}
      loading={loading}
      onContinueActive={() => data.activeJob && openLegacy(data.activeJob.id)}
      onOpenJob={openLegacy}
      onAcceptOffer={(id, slotIndex) => respond.accept.mutateAsync({ appointmentId: id, slotIndex })}
      onDeclineOffer={(id, reason, other) => respond.decline.mutateAsync({ appointmentId: id, reason, other })}
      onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
    />
  );
}
```

- [ ] **Step 2: `CleanerTodayView.tsx`** — change the props (drop `onRespondOffer`, add `onAcceptOffer`/`onDeclineOffer`), import `OfferActionsBar`, `Badge`, `Clock`, `DeclineReason`. Rework the offer card so the text area is a button that opens the job (`onOpenJob(o.id)`), the deadline renders as a `caution` Badge, and `OfferActionsBar` provides Accept/Decline. Offer-count pill uses tokens.

New prop type + offer section:

```tsx
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { OfferActionsBar } from "../shared/OfferActionsBar";
import type { DeclineReason } from "@/hooks/useCleanerData";

// props:
//   onAcceptOffer: (id: string, slotIndex: number) => Promise<unknown> | void;
//   onDeclineOffer: (id: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
//   (remove onRespondOffer)

// offer count pill (SectionHeader trailing):
<span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-extrabold text-brand-700">
  {data.offers.length}
</span>

// each offer card:
<div key={o.id} className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
  <button
    onClick={() => onOpenJob(o.id)}
    className="block w-full rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm font-extrabold">{formatTimeParts(o.scheduled_time).h} {formatTimeParts(o.scheduled_time).ap}</div>
      {formatRespondBy(o.response_deadline) && (
        <Badge variant="caution"><Clock />{formatRespondBy(o.response_deadline)}</Badge>
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
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit`; `npm run test:unit` green; visual: run the dev server, open `/app/cleaner-dashboard`, confirm an offer card shows Accept/Decline and the decline drawer opens. (Visual covered in Task 9's screenshot pass.)

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/cleaner/today/CleanerToday.tsx src/components/redesign/cleaner/today/CleanerTodayView.tsx
git commit -m "feat(cleaner-redesign): inline offer accept/decline on Today (slice 2)"
```

---

## Task 7: `deriveJobDetail` (pure) + `useOpenJob`

**Files:**
- Create: `src/components/redesign/cleaner/job/job-detail-types.ts`
- Create: `src/components/redesign/cleaner/job/deriveJobDetail.ts`
- Test: `src/components/redesign/cleaner/job/deriveJobDetail.test.ts`
- Create: `src/components/redesign/cleaner/job/useOpenJob.ts`

**Interfaces — Produces:**
- `type JobActionMode = "offer" | "start" | "continue" | "done" | "none"`
- `deriveJobActionMode(a: CleanerAppointment): JobActionMode`
- `offeredSlots(a: CleanerAppointment): OfferSlot[]`
- `useOpenJob(): (id: string) => void`  // sets `?job=<id>` on the current path

- [ ] **Step 1: Write the failing test** `deriveJobDetail.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveJobActionMode, offeredSlots } from "./deriveJobDetail";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const a = (over: Partial<CleanerAppointment>) =>
  ({ id: "j1", scheduled_date: "2026-06-01", scheduled_time: "09:00:00", status: "confirmed", cleaner_confirmation_status: "approved", ...over }) as CleanerAppointment;

describe("deriveJobActionMode", () => {
  it("offer when pending+awaiting", () => expect(deriveJobActionMode(a({ status: "pending", cleaner_confirmation_status: "awaiting" }))).toBe("offer"));
  it("start when confirmed", () => expect(deriveJobActionMode(a({ status: "confirmed" }))).toBe("start"));
  it("continue when in_progress", () => expect(deriveJobActionMode(a({ status: "in_progress" }))).toBe("continue"));
  it("done when completed", () => expect(deriveJobActionMode(a({ status: "completed" }))).toBe("done"));
  it("none for cancelled / non-awaiting pending", () => {
    expect(deriveJobActionMode(a({ status: "cancelled" }))).toBe("none");
    expect(deriveJobActionMode(a({ status: "pending", cleaner_confirmation_status: "approved" }))).toBe("none");
  });
});

describe("offeredSlots", () => {
  it("sorts requested slots by index", () => {
    const slots = offeredSlots(a({ requested_slots: [
      { slot_index: 2, scheduled_date: "2026-06-03", scheduled_time: "10:00:00" },
      { slot_index: 0, scheduled_date: "2026-06-01", scheduled_time: "09:00:00" },
    ] } as Partial<CleanerAppointment>));
    expect(slots.map((s) => s.slot_index)).toEqual([0, 2]);
  });
  it("synthesizes a primary slot when none are attached", () => {
    expect(offeredSlots(a({}))).toEqual([{ slot_index: 0, scheduled_date: "2026-06-01", scheduled_time: "09:00:00" }]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm run test:unit -- deriveJobDetail` → FAIL.

- [ ] **Step 3: Write `job-detail-types.ts`**

```ts
export type JobActionMode = "offer" | "start" | "continue" | "done" | "none";

export interface OfferSlot {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}
```

- [ ] **Step 4: Write `deriveJobDetail.ts`**

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { JobActionMode, OfferSlot } from "./job-detail-types";

export function deriveJobActionMode(a: CleanerAppointment): JobActionMode {
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "offer";
  if (a.status === "confirmed") return "start";
  if (a.status === "in_progress") return "continue";
  if (a.status === "completed") return "done";
  return "none";
}

export function offeredSlots(a: CleanerAppointment): OfferSlot[] {
  const slots = a.requested_slots;
  if (slots && slots.length > 0) return [...slots].sort((x, y) => x.slot_index - y.slot_index);
  return [{ slot_index: 0, scheduled_date: a.scheduled_date, scheduled_time: a.scheduled_time }];
}
```

- [ ] **Step 5: Write `useOpenJob.ts`**

```ts
"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Open the job-detail overlay by setting `?job=<id>` on the current path.
 * Uses router.replace (no scroll) so closing restores list state; reads no
 * search params, so callers do not need a Suspense boundary. */
export function useOpenJob(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((id: string) => router.replace(`${pathname}?job=${id}`, { scroll: false }), [router, pathname]);
}
```

- [ ] **Step 6: Run, verify pass; typecheck.** `npm run test:unit -- deriveJobDetail` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/redesign/cleaner/job
git commit -m "feat(cleaner-redesign): deriveJobDetail + useOpenJob (slice 2)"
```

---

## Task 8: `CleanerJobDetailOverlay` (takeover view)

The full-screen white-surface slide-in that hides shell chrome. Mirror `MobileThreadOverlay` (in `OperatorMessagesView.tsx`): `redesign-overlay fixed inset-0 z-50`, `bg-card`, `pt-[env(safe-area-inset-top)]`, slide via `translate-x` with a `shown` flag, mount-only scroll-lock + focus, Escape closes, `onClosed` fires after the 300ms exit. Constrain the inner content to `mx-auto w-full max-w-lg` so it reads like the phone column on desktop (do NOT use `lg:hidden` — this is the only job-detail surface).

**Files:**
- Create: `src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx`

**Interfaces — Consumes:** `deriveJobActionMode` (Task 7), shared presenters (Task 1), `CleanerJobBadge` (Task 2), `OfferActionsBar` (Task 5), `Button`, `Separator`, `Skeleton`, `EmptyState`.
**Produces:** `<CleanerJobDetailOverlay appointment loading onClosed onStart starting onContinue onAcceptOffer onDeclineOffer />`

```ts
// props
{
  appointment: CleanerAppointment | null;  // null while loading or not found
  loading: boolean;
  onClosed: () => void;                     // called after the exit animation (clears ?job=)
  onStart: () => Promise<unknown> | void;   // mutateAsync(id)
  starting: boolean;
  onContinue: () => void;                   // bridge to legacy active-job flow
  onAcceptOffer: (slotIndex: number) => Promise<unknown> | void;
  onDeclineOffer: (reason: DeclineReason, other?: string) => Promise<unknown> | void;
}
```

- [ ] **Step 1: Implement** `CleanerJobDetailOverlay.tsx`

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, MapPin, Navigation, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { CleanerAppointment, DeclineReason } from "@/hooks/useCleanerData";
import {
  propertyTitle, customerLabel, propertyAddress, mapsUrl, jobSubtitle,
  formatDateLong, formatTimeParts, formatDuration,
} from "../shared/job-presenters";
import { CleanerJobBadge } from "../shared/CleanerJobBadge";
import { OfferActionsBar } from "../shared/OfferActionsBar";
import { deriveJobActionMode } from "./deriveJobDetail";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function CleanerJobDetailOverlay({
  appointment, loading, onClosed, onStart, starting, onContinue, onAcceptOffer, onDeclineOffer,
}: {
  appointment: CleanerAppointment | null;
  loading: boolean;
  onClosed: () => void;
  onStart: () => Promise<unknown> | void;
  starting: boolean;
  onContinue: () => void;
  onAcceptOffer: (slotIndex: number) => Promise<unknown> | void;
  onDeclineOffer: (reason: DeclineReason, other?: string) => Promise<unknown> | void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const closingRef = useRef(false);
  const closeRef = useRef<() => void>(() => {});

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    setTimeout(onClosed, 300);
  }
  closeRef.current = close;

  // Enter animation on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Mount-only: lock body scroll, focus the panel, bind Escape. Must be
  // mount-only so re-renders never steal focus (matches MobileThreadOverlay).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, []);

  async function handleStart() {
    try { await onStart(); close(); } catch { /* toast handled by hook */ }
  }

  const mode = appointment ? deriveJobActionMode(appointment) : "none";
  const addr = appointment ? propertyAddress(appointment) : null;
  const maps = appointment ? mapsUrl(appointment) : null;
  const duration = appointment ? formatDuration(appointment.service_type?.duration_minutes) : null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className={`redesign-overlay fixed inset-0 z-50 flex flex-col bg-card outline-none transition-transform duration-300 ease-out motion-reduce:transition-none ${shown ? "translate-x-0" : "translate-x-full"}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
        <button
          onClick={() => closeRef.current()}
          aria-label="Back"
          className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-6" />
        </button>
        <div className="min-w-0 flex-1 py-2">
          {appointment ? (
            <>
              <div className="truncate text-sm font-bold">{propertyTitle(appointment)}</div>
              <div className="truncate text-xs text-muted-foreground">{jobSubtitle(appointment)}</div>
            </>
          ) : (
            <div className="text-sm font-bold">Job</div>
          )}
        </div>
        {appointment && <CleanerJobBadge appointment={appointment} />}
        <div className="w-1" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-lg space-y-5 px-5 py-5">
          {loading && !appointment ? (
            <>
              <Skeleton className="h-16 w-full rounded-card" />
              <Skeleton className="h-16 w-full rounded-card" />
              <Skeleton className="h-16 w-full rounded-card" />
            </>
          ) : !appointment ? (
            <div className="pt-10">
              <EmptyState icon={<MapPin />} title="Job not available" description="This job may have been reassigned or is no longer on your schedule." />
            </div>
          ) : (
            <>
              <Field label="When">
                <div className="font-semibold">{formatDateLong(appointment.scheduled_date)}</div>
                <div className="text-muted-foreground">
                  {formatTimeParts(appointment.scheduled_time).h} {formatTimeParts(appointment.scheduled_time).ap}
                  {duration ? ` · ${duration}` : ""}
                </div>
              </Field>
              <Separator />
              <Field label="Where">
                <div className="font-semibold">{propertyTitle(appointment)}</div>
                {addr && <div className="text-muted-foreground">{addr}</div>}
                {maps && (
                  <a href={maps} target="_blank" rel="noopener noreferrer"
                     className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-control">
                    <Navigation className="size-4" /> Directions
                  </a>
                )}
              </Field>
              <Separator />
              <Field label="Customer">{customerLabel(appointment)}</Field>
              <Separator />
              <Field label="Service">
                <div className="font-semibold">{appointment.service_type?.name || "Cleaning"}</div>
                {appointment.checklist?.name && <div className="text-muted-foreground">{appointment.checklist.name}</div>}
              </Field>
              {appointment.special_requests && (<><Separator /><Field label="Special requests">{appointment.special_requests}</Field></>)}
            </>
          )}
        </div>
      </div>

      {/* Action bar */}
      {appointment && mode !== "none" && (
        <div
          className="border-t border-border bg-card px-5 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <div className="mx-auto w-full max-w-lg">
            {mode === "offer" && (
              <OfferActionsBar appointment={appointment} layout="stacked" onDone={() => close()}
                onAccept={onAcceptOffer} onDecline={onDeclineOffer} />
            )}
            {mode === "start" && (
              <Button onClick={handleStart} loading={starting} className="w-full" size="lg"><Play /> Start job</Button>
            )}
            {mode === "continue" && (
              <Button onClick={onContinue} className="w-full" size="lg"><ArrowRight /> Continue job</Button>
            )}
            {mode === "done" && (
              <div className="py-1 text-center text-sm font-semibold text-positive-700">This job is complete.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`. (`CleanerAppointment` has NO `notes` field, so there is no Notes Field; `checklist?.name`, `special_requests`, `service_type.duration_minutes`, `requested_slots`, `response_deadline` are all confirmed present.) `npm run test:unit` green.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx
git commit -m "feat(cleaner-redesign): job-detail takeover overlay (slice 2)"
```

---

## Task 9: `CleanerJobDetailHost` + mount in layout + rewire Today opens

**Files:**
- Create: `src/components/redesign/cleaner/job/CleanerJobDetailHost.tsx`
- Modify: `src/app/(redesign)/app/cleaner-dashboard/layout.tsx`
- Modify: `src/components/redesign/cleaner/today/CleanerToday.tsx`

**Interfaces — Consumes:** `useDetailParam` (`@/hooks/useDetailParam`), `useCleanerAppointments`/`useStartJob`/`useRespondToOffer` (Tasks 4), `CleanerJobDetailOverlay` (Task 8), `useOpenJob` (Task 7).

- [ ] **Step 1: Implement `CleanerJobDetailHost.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useDetailParam } from "@/hooks/useDetailParam";
import { useCleanerAppointments, useStartJob, useRespondToOffer } from "@/hooks/useCleanerData";
import { CleanerJobDetailOverlay } from "./CleanerJobDetailOverlay";

export function CleanerJobDetailHost() {
  const router = useRouter();
  const { paramId, setParam } = useDetailParam("job");
  const { appointments, loading } = useCleanerAppointments();
  const startJob = useStartJob();
  const respond = useRespondToOffer();

  if (!paramId) return null;
  const appointment = appointments.find((a) => a.id === paramId) ?? null;

  return (
    <CleanerJobDetailOverlay
      key={paramId}
      appointment={appointment}
      loading={loading}
      onClosed={() => setParam(null)}
      onStart={() => startJob.mutateAsync(paramId)}
      starting={startJob.isPending}
      onContinue={() => router.push(`/cleaner-dashboard?appointment=${paramId}`)}
      onAcceptOffer={(slotIndex) => respond.accept.mutateAsync({ appointmentId: paramId, slotIndex })}
      onDeclineOffer={(reason, other) => respond.decline.mutateAsync({ appointmentId: paramId, reason, other })}
    />
  );
}
```

- [ ] **Step 2: Mount in `layout.tsx`** — wrap the return in a fragment and add the Suspense-boxed host (because `useDetailParam` reads `useSearchParams`):

```tsx
import { type ReactNode, Suspense, useEffect } from "react";
// ...existing imports...
import { CleanerJobDetailHost } from "@/components/redesign/cleaner/job/CleanerJobDetailHost";

// ...inside the component, replace the final return:
return (
  <>
    <CleanerShell>{children}</CleanerShell>
    <Suspense fallback={null}>
      <CleanerJobDetailHost />
    </Suspense>
  </>
);
```

- [ ] **Step 3: Rewire `CleanerToday.tsx` opens to the redesign detail** — swap `onOpenJob` from `openLegacy` to `useOpenJob`. Keep `onContinueActive` bridging to legacy (active-job flow is Slice 3).

```tsx
import { useOpenJob } from "@/components/redesign/cleaner/job/useOpenJob";
// ...
const openJob = useOpenJob();
// ...
onOpenJob={openJob}
onContinueActive={() => data.activeJob && router.push(`/cleaner-dashboard?appointment=${data.activeJob.id}`)}
```

- [ ] **Step 4: Verify (visual)** — dev server up; at `/app/cleaner-dashboard`, tap a Today job row → the job-detail takeover slides in; Back closes it; URL shows `?job=<id>` while open. Tap an offer card body → opens detail with Accept/Decline in the action bar. `npx tsc --noEmit` + `npm run test:unit` green.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerJobDetailHost.tsx "src/app/(redesign)/app/cleaner-dashboard/layout.tsx" src/components/redesign/cleaner/today/CleanerToday.tsx
git commit -m "feat(cleaner-redesign): mount job-detail host + open Today jobs in-redesign (slice 2)"
```

---

## Task 10: `deriveSchedule` (pure)

**Files:**
- Create: `src/components/redesign/cleaner/schedule/schedule-types.ts`
- Create: `src/components/redesign/cleaner/schedule/deriveSchedule.ts`
- Test: `src/components/redesign/cleaner/schedule/deriveSchedule.test.ts`

**Interfaces — Produces:** the types in `schedule-types.ts` and `deriveSchedule(appointments, opts): ScheduleData` + the predicates `matchesScheduleSearch`, `matchesScheduleStatus`, `scheduleGroupOf`.

- [ ] **Step 1: Write `schedule-types.ts`**

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type ScheduleView = "upcoming" | "past";
export type ScheduleGroupKey = "today" | "tomorrow" | "this_week" | "later" | "past";
export type ScheduleStatusFilter =
  | "all" | "needs_response" | "confirmed" | "in_progress" | "completed" | "cancelled";

export interface ScheduleGroup {
  key: ScheduleGroupKey;
  label: string;
  jobs: CleanerAppointment[];
}

export interface ScheduleData {
  groups: ScheduleGroup[];
  total: number;
  isEmpty: boolean;
}

export interface DeriveScheduleOptions {
  search: string;
  statusFilter: ScheduleStatusFilter;
  view: ScheduleView;
  todayStr: string;
  tomorrowStr: string;
  weekEndStr: string;
}
```

- [ ] **Step 2: Write the failing test** `deriveSchedule.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveSchedule, scheduleGroupOf, matchesScheduleStatus, matchesScheduleSearch } from "./deriveSchedule";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-10", TMRW = "2026-06-11", WEND = "2026-06-16";
const appt = (over: Partial<CleanerAppointment>) =>
  ({ id: Math.random().toString(36).slice(2), scheduled_date: TODAY, scheduled_time: "09:00:00", status: "confirmed", cleaner_confirmation_status: "approved",
     property: { name: "House", address: "1 A St", city: "Austin", state: "TX", zip_code: "1" }, service_type: { name: "Clean", description: "", duration_minutes: 60 }, homeowner: { first_name: "Sam", last_name: "Roe", email: "" } }) as unknown as CleanerAppointment;

describe("scheduleGroupOf", () => {
  it("buckets by date", () => {
    expect(scheduleGroupOf(appt({ scheduled_date: TODAY }), TODAY, TMRW, WEND)).toBe("today");
    expect(scheduleGroupOf(appt({ scheduled_date: TMRW }), TODAY, TMRW, WEND)).toBe("tomorrow");
    expect(scheduleGroupOf(appt({ scheduled_date: "2026-06-14" }), TODAY, TMRW, WEND)).toBe("this_week");
    expect(scheduleGroupOf(appt({ scheduled_date: "2026-06-20" }), TODAY, TMRW, WEND)).toBe("later");
    expect(scheduleGroupOf(appt({ scheduled_date: "2026-06-01" }), TODAY, TMRW, WEND)).toBe("today"); // overdue-but-upcoming
  });
});

describe("matchesScheduleStatus / matchesScheduleSearch", () => {
  it("needs_response = pending+awaiting", () => {
    expect(matchesScheduleStatus(appt({ status: "pending", cleaner_confirmation_status: "awaiting" }), "needs_response")).toBe(true);
    expect(matchesScheduleStatus(appt({ status: "confirmed" }), "needs_response")).toBe(false);
  });
  it("search matches property/service/customer", () => {
    expect(matchesScheduleSearch(appt({}), "house")).toBe(true);
    expect(matchesScheduleSearch(appt({}), "sam")).toBe(true);
    expect(matchesScheduleSearch(appt({}), "zzz")).toBe(false);
  });
});

describe("deriveSchedule", () => {
  it("groups upcoming and orders groups", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-20" }), appt({ scheduled_date: TODAY }), appt({ scheduled_date: TMRW })],
      { search: "", statusFilter: "all", view: "upcoming", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND },
    );
    expect(data.groups.map((g) => g.key)).toEqual(["today", "tomorrow", "later"]);
    expect(data.total).toBe(3);
    expect(data.isEmpty).toBe(false);
  });
  it("past view is a single descending group of completed/cancelled", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-05", status: "completed" }), appt({ scheduled_date: "2026-06-08", status: "cancelled" }), appt({ scheduled_date: TODAY, status: "confirmed" })],
      { search: "", statusFilter: "all", view: "past", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND },
    );
    expect(data.groups.map((g) => g.key)).toEqual(["past"]);
    expect(data.groups[0].jobs.map((j) => j.scheduled_date)).toEqual(["2026-06-08", "2026-06-05"]);
    expect(data.total).toBe(2);
  });
  it("upcoming excludes completed/cancelled and is empty when none match", () => {
    const data = deriveSchedule([appt({ status: "completed" })], { search: "", statusFilter: "all", view: "upcoming", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND });
    expect(data.isEmpty).toBe(true);
    expect(data.groups).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, verify fail** — `npm run test:unit -- deriveSchedule` → FAIL.

- [ ] **Step 4: Write `deriveSchedule.ts`**

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type {
  DeriveScheduleOptions, ScheduleData, ScheduleGroup, ScheduleGroupKey, ScheduleStatusFilter,
} from "./schedule-types";

const keyOf = (a: CleanerAppointment) => `${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`;
const byTimeAsc = (a: CleanerAppointment, b: CleanerAppointment) => keyOf(a).localeCompare(keyOf(b));
const byTimeDesc = (a: CleanerAppointment, b: CleanerAppointment) => -byTimeAsc(a, b);

export function matchesScheduleSearch(a: CleanerAppointment, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const customer = a.homeowner ? `${a.homeowner.first_name ?? ""} ${a.homeowner.last_name ?? ""}` : "";
  const haystack = [a.property?.name, a.property?.address, a.property?.city, a.property?.state, a.service_type?.name, customer]
    .filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

export function matchesScheduleStatus(a: CleanerAppointment, filter: ScheduleStatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "needs_response": return a.status === "pending" && a.cleaner_confirmation_status === "awaiting";
    case "confirmed": return a.status === "confirmed";
    case "in_progress": return a.status === "in_progress";
    case "completed": return a.status === "completed";
    case "cancelled": return a.status === "cancelled";
    default: return true;
  }
}

const isUpcoming = (a: CleanerAppointment) =>
  a.status === "pending" || a.status === "confirmed" || a.status === "in_progress";
const isPast = (a: CleanerAppointment) => a.status === "completed" || a.status === "cancelled";

/** Upcoming-only bucket. Past-dated-but-still-active jobs fall under Today so
 * they are never hidden. Returns null only for non-upcoming statuses. */
export function scheduleGroupOf(
  a: CleanerAppointment, todayStr: string, tomorrowStr: string, weekEndStr: string,
): ScheduleGroupKey | null {
  const date = a.scheduled_date ?? "";
  if (date === todayStr) return "today";
  if (date === tomorrowStr) return "tomorrow";
  if (date > tomorrowStr && date <= weekEndStr) return "this_week";
  if (date > weekEndStr) return "later";
  return "today";
}

const GROUP_LABEL: Record<ScheduleGroupKey, string> = {
  today: "Today", tomorrow: "Tomorrow", this_week: "This week", later: "Later", past: "Past",
};

export function deriveSchedule(appointments: CleanerAppointment[], opts: DeriveScheduleOptions): ScheduleData {
  const { search, statusFilter, view, todayStr, tomorrowStr, weekEndStr } = opts;
  const base = appointments.filter(
    (a) => matchesScheduleSearch(a, search) && matchesScheduleStatus(a, statusFilter)
      && (view === "upcoming" ? isUpcoming(a) : isPast(a)),
  );

  if (view === "past") {
    const jobs = [...base].sort(byTimeDesc);
    return { groups: jobs.length ? [{ key: "past", label: GROUP_LABEL.past, jobs }] : [], total: jobs.length, isEmpty: jobs.length === 0 };
  }

  const order: ScheduleGroupKey[] = ["today", "tomorrow", "this_week", "later"];
  const buckets: Record<string, CleanerAppointment[]> = { today: [], tomorrow: [], this_week: [], later: [] };
  for (const a of base) {
    const k = scheduleGroupOf(a, todayStr, tomorrowStr, weekEndStr);
    if (k && buckets[k]) buckets[k].push(a);
  }
  const groups: ScheduleGroup[] = order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], jobs: buckets[k].sort(byTimeAsc) }));
  return { groups, total: base.length, isEmpty: base.length === 0 };
}
```

- [ ] **Step 5: Run, verify pass** — `npm run test:unit -- deriveSchedule` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/cleaner/schedule/schedule-types.ts src/components/redesign/cleaner/schedule/deriveSchedule.ts src/components/redesign/cleaner/schedule/deriveSchedule.test.ts
git commit -m "feat(cleaner-redesign): deriveSchedule grouping/search/filter (slice 2)"
```

---

## Task 11: Schedule screen (View + container + page)

**Files:**
- Create: `src/components/redesign/cleaner/schedule/CleanerScheduleView.tsx`
- Create: `src/components/redesign/cleaner/schedule/CleanerSchedule.tsx`
- Modify: `src/app/(redesign)/app/cleaner-dashboard/schedule/page.tsx`

**Interfaces — Consumes:** `deriveSchedule` + types (Task 10), `JobRow` (Task 3), `useOpenJob` (Task 7), `useCleanerAppointments`, `SegmentedControl`, `Select*`, `Input`, `EmptyState`, `Skeleton`.

- [ ] **Step 1: Implement `CleanerScheduleView.tsx`**

```tsx
"use client";

import { Search, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { JobRow } from "../shared/JobRow";
import type { ScheduleData, ScheduleStatusFilter, ScheduleView } from "./schedule-types";

const STATUS_OPTIONS: { value: ScheduleStatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "needs_response", label: "Needs response" },
  { value: "confirmed", label: "Upcoming" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function CleanerScheduleView({
  data, loading, search, onSearchChange, view, onViewChange, statusFilter, onStatusFilterChange, onOpenJob,
}: {
  data: ScheduleData;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  view: ScheduleView;
  onViewChange: (v: ScheduleView) => void;
  statusFilter: ScheduleStatusFilter;
  onStatusFilterChange: (v: ScheduleStatusFilter) => void;
  onOpenJob: (id: string) => void;
}) {
  return (
    <div className="space-y-4 pt-1">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search jobs" className="pl-9" aria-label="Search jobs" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          value={view}
          onChange={onViewChange}
          options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]}
        />
        <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as ScheduleStatusFilter)}>
          <SelectTrigger className="h-9 w-[150px] rounded-pill"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!loading && (
        <div className="px-0.5 text-xs font-medium text-muted-foreground">
          {data.total} {data.total === 1 ? "job" : "jobs"}
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
        </div>
      ) : data.isEmpty ? (
        <div className="pt-10">
          <EmptyState
            icon={<CalendarDays />}
            title={view === "upcoming" ? "No upcoming jobs" : "No past jobs"}
            description={view === "upcoming" ? "New jobs and offers will appear here." : "Completed and cancelled jobs will appear here."}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {data.groups.map((g) => (
            <section key={g.key}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <h2 className="text-sm font-bold">{g.label}</h2>
                <span className="ml-auto text-xs font-medium text-muted-foreground">{g.jobs.length}</span>
              </div>
              <div className="space-y-2.5">
                {g.jobs.map((j) => <JobRow key={j.id} appointment={j} onClick={() => onOpenJob(j.id)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `CleanerSchedule.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useCleanerAppointments } from "@/hooks/useCleanerData";
import { useOpenJob } from "../job/useOpenJob";
import { deriveSchedule } from "./deriveSchedule";
import { CleanerScheduleView } from "./CleanerScheduleView";
import type { ScheduleStatusFilter, ScheduleView } from "./schedule-types";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerSchedule() {
  const { appointments, loading } = useCleanerAppointments();
  const openJob = useOpenJob();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ScheduleView>("upcoming");
  const [statusFilter, setStatusFilter] = useState<ScheduleStatusFilter>("all");

  const dateStrs = useMemo(() => {
    const now = new Date();
    return {
      todayStr: ymd(now),
      tomorrowStr: ymd(new Date(now.getTime() + 864e5)),
      weekEndStr: ymd(new Date(now.getTime() + 6 * 864e5)),
    };
  }, []);

  const data = useMemo(
    () => deriveSchedule(appointments, { search, statusFilter, view, ...dateStrs }),
    [appointments, search, statusFilter, view, dateStrs],
  );

  return (
    <CleanerScheduleView
      data={data} loading={loading}
      search={search} onSearchChange={setSearch}
      view={view} onViewChange={setView}
      statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
      onOpenJob={openJob}
    />
  );
}
```

- [ ] **Step 3: Replace `schedule/page.tsx`**

```tsx
import { CleanerSchedule } from "@/components/redesign/cleaner/schedule/CleanerSchedule";

export default function CleanerSchedulePage() {
  return <CleanerSchedule />;
}
```

- [ ] **Step 4: Verify (visual)** — at `/app/cleaner-dashboard/schedule`: search filters live; Upcoming/Past toggles; status Select filters; group headers render; tapping a row opens the job-detail takeover (`?job=`). `npx tsc --noEmit` + `npm run test:unit` green.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/schedule "src/app/(redesign)/app/cleaner-dashboard/schedule/page.tsx"
git commit -m "feat(cleaner-redesign): Schedule screen (grouped list + search/filter) (slice 2)"
```

---

## Task 12: Rewire cleaner notification deep-link to `?job=`

**Files:**
- Modify: `src/components/redesign/notifications/deriveNotifications.ts:116`
- Modify: `src/components/redesign/notifications/deriveNotifications.test.ts` (the cleaner-href expectation)

- [ ] **Step 1: Update the test expectation** (line ~89): change `'/cleaner-dashboard?appointment=appt-42'` to `'/app/cleaner-dashboard?job=appt-42'`.

- [ ] **Step 2: Run, verify fail** — `npm run test:unit -- deriveNotifications` → FAIL on the cleaner href.

- [ ] **Step 3: Update `deriveNotifications.ts`** (the cleaner branch ~line 116):

```ts
    return `/app/cleaner-dashboard?job=${item.appointment_id}`;
```

- [ ] **Step 4: Run, verify pass** — `npm run test:unit -- deriveNotifications` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/notifications/deriveNotifications.ts src/components/redesign/notifications/deriveNotifications.test.ts
git commit -m "feat(cleaner-redesign): deep-link cleaner notifications to the in-redesign job detail (slice 2)"
```

---

## Final verification (not a code task)

- [ ] `npm run test:unit` — all green (new: job-presenters, jobBadge, deriveJobDetail, deriveSchedule; updated: deriveNotifications).
- [ ] `npx tsc --noEmit` — no errors introduced by Slice 2.
- [ ] `npm run lint`.
- [ ] Visual pass (Playwright MCP, 375px): Today (offer accept/decline + open job), Schedule (search/filter/toggle/groups), Job detail takeover (offer / confirmed-start / in-progress-continue), deep-link `?job=`, decline drawer, reduced-motion. Screenshot each for the user (mobile).
- [ ] ui-ux-pro-max implementation conformance pass (no raw hex / off-system styling; touch >= 44px; safe-area; deep-linking; back restores state).
- [ ] Codex review on the branch diff vs master; apply valid findings in a follow-up commit; then push + open PR.

## Self-Review

- **Spec coverage:** Schedule (§5.2) → Tasks 10-11. Job-detail overview read + Directions (§5.3, read+start subset) → Tasks 7-9. Offer Accept/Decline inline (§5.1, §9) → Tasks 4-6, reused in detail (Task 8). Deep-linking `?job=` (§4) → Tasks 7-9. Model-aware: offers already gated to `percentage_contractor` in `deriveToday`; Schedule shows all the cleaner's jobs (offers appear via `needs_response`), consistent. Message-operator (§5.3) is DEFERRED to Slice 5 (depends on the Messages screen) — explicitly out of this slice. Active-job sub-screens/photos/checklist/Complete/charge (§5.3 rest) → Slice 3.
- **Type consistency:** `CleanerAppointment` fields used (`status`, `cleaner_confirmation_status`, `scheduled_date/time`, `property.*`, `homeowner.*`, `service_type.{name,duration_minutes}`, `checklist?.name`, `special_requests`, `requested_slots`, `response_deadline`) all confirmed against `useCleanerData.ts`. `DeclineReason` defined once (Task 4) and imported by OfferActionsBar + Host. `keys.appointments.byCleaner` / `keys.stats.cleaner` reused exactly as in existing cleaner hooks.
- **Placeholder scan:** none — every step has real code or a concrete command.
- **Open risk:** `appointment.notes` may not be on the `CleanerAppointment` interface (Task 8 step 2 says omit that Field if so). `Textarea`/`Label` primitive imports confirmed present in `ui/`.
