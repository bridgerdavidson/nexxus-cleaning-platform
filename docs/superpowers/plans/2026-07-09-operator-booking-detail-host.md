# Operator Booking-Detail Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount a `?booking=` booking-detail host at the OperatorShell level (modeled on the cleaner shell's `?job=` host) so the BookingDetailSheet opens in place on ANY operator page, then repoint overview/messages/notifications to open it in place instead of navigating to the Bookings screen.

**Architecture:** `OperatorBookings` currently owns `BookingDetailSheet` (state, `?booking=` sync, handlers). We extract the VM builders into a pure module, build `OperatorBookingDetailHost` (param-owning outer + data/handlers inner, mounted in `OperatorShell` behind `can_view_bookings`, exactly like `OperatorBookingHost`), strip sheet ownership out of `OperatorBookings` in the same commit (single param owner — two owners would stack two sheets), then convert the interim `router.push('/app/admin-dashboard/bookings?booking=…')` call sites to in-place opens.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query v5, existing hooks (`useAdminAppointments`, `useAdminCleaners`, `useManagerPermissions`, `useDetailParam`), Vitest for pure logic.

## Global Constraints

- No em dashes in any user-facing copy (UI text, toasts, labels).
- Design-system-only styling; this plan adds NO new visual surface (reuses `BookingDetailSheet`, `ConfirmDialog` as-is).
- `@testing-library/react` is NOT installed: unit tests only for pure logic (`deriveNotifications`, `booking-vm`).
- Baselines: `npx tsc --noEmit` has 12 pre-existing errors; `npm run test:unit` has 1 pre-existing failure (`src/lib/formDraft.test.ts`); introduce zero new ones.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the session link `https://claude.ai/code/session_01VREQVVDjhUtvYbz8jjDeBj`.
- Branch: `feat/operator-booking-detail-host` off current master.
- Reschedule and the Payments "Fix card" action deliberately STAY on the legacy dashboard (gaps R2/R3 and R6); do not touch them.

## Key context for a zero-context engineer

- `useDetailParam(key)` (`src/hooks/useDetailParam.ts`) reads one query param and returns `{ paramId, setParam }`; `setParam` uses `router.replace(..., { scroll: false })` and PRESERVES all other params. It calls `useSearchParams()`, so any component using it must render under `<Suspense>`.
- `OperatorShell` (`src/components/redesign/shell/OperatorShell.tsx`) already mounts `OperatorBookingHost` (the `?newbooking=1` new-booking sheet) behind `canCreateBooking` + `Suspense` (lines 77-81). Our host follows that mount pattern with `canViewBookings`.
- The cleaner-side write-only opener precedent is `useOpenJob` (`src/components/redesign/cleaner/job/useOpenJob.ts`): it reads NO search params (so call sites need no Suspense) at the cost of replacing the whole query string. We mirror it; the one call site where sibling params matter (Messages, `?c=` thread selection) uses an in-place `URLSearchParams` set instead.
- `useAdminAppointments()` is the heavy full-org list query. The host must NOT run it on every page load: the inner component (which calls the hook) mounts only after a booking has been opened once.

---

### Task 1: Extract booking VM builders into `booking-vm.ts`

Pure code move so the host and the bookings screen share one VM module. `OperatorBookings.tsx` lines 37-191 (all formatting helpers + `toRowVM` + `toDetailVM`) move verbatim into a new file; only `export` keywords are added.

**Files:**
- Create: `src/components/redesign/bookings/booking-vm.ts`
- Create: `src/components/redesign/bookings/booking-vm.test.ts`
- Modify: `src/components/redesign/bookings/OperatorBookings.tsx` (delete lines 37-191, add import)

**Interfaces:**
- Consumes: `AdminAppointment` from `@/hooks/useAdminData`, `deriveBookingBadge` from `./deriveBookings`, types from `./bookings-types`.
- Produces: `export function toRowVM(a: AdminAppointment, today: string, canViewPayments: boolean, avatarById: Map<string, string | null>): BookingRowVM` and `export function toDetailVM(a: AdminAppointment, canViewPayments: boolean): BookingDetailVM` (signatures unchanged). Tasks 2-3 import `toDetailVM` from this module.

- [ ] **Step 1: Create `booking-vm.ts`**

Copy `OperatorBookings.tsx` lines 37-191 verbatim into the new file with this header and exports (`export` added to `toRowVM` and `toDetailVM` only; helpers stay module-private):

```ts
import {
  type AdminAppointment,
} from "@/hooks/useAdminData";
import { deriveBookingBadge } from "./deriveBookings";
import type {
  BookingDetailVM,
  BookingPayment,
  BookingRowVM,
  BookingStatusKey,
  CounterProposal,
} from "./bookings-types";

// --- formatting helpers (AdminAppointment -> view-model) ---
// Moved verbatim from OperatorBookings.tsx so the shell-level booking-detail
// host and the bookings screen share one VM builder.

function fmtTime(t: string | undefined): string {
  const [hh, mm] = (t ?? "").split(":");
  let h = parseInt(hh ?? "0", 10);
  if (Number.isNaN(h)) return t ?? "";
  const m = mm ?? "00";
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m}${ap}`;
}
```

…then `monthDay`, `weekday`, `longDate`, `durationLabel`, `propertyAddress`, `serviceLabel`, `customerLabel`, `cleanerLabel`, `paymentVM`, `priceLabel`, `counterProposals`, `counterWindows` exactly as they are in `OperatorBookings.tsx` lines 49-135, and finally `export function toRowVM(...)` (lines 137-162) and `export function toDetailVM(...)` (lines 164-191), bodies unchanged.

- [ ] **Step 2: Write `booking-vm.test.ts`** (guards the move + the host's dependency)

```ts
import { describe, it, expect } from "vitest";
import { toDetailVM, toRowVM } from "./booking-vm";
import type { AdminAppointment } from "@/hooks/useAdminData";

function appt(over: Partial<AdminAppointment> = {}): AdminAppointment {
  return {
    id: "a1",
    scheduled_date: "2026-03-05",
    scheduled_time: "14:30",
    status: "confirmed",
    homeowner_id: "ho-1",
    cleaner_id: "cl-1",
    duration_minutes: 90,
    total_price: 120,
    is_self_pay: false,
    payment_status: "paid",
    homeowner: { first_name: "Sarah", last_name: "Miller", email: "s@x.com" },
    cleaner_profile: { user_profile: { first_name: "Jo", last_name: "Lee" } },
    property: { address: "12 Oak St" },
    service_type: { name: "Deep clean" },
    special_requests: null,
    notes: null,
    cleaner_availability_feedback: [],
    ...over,
  } as unknown as AdminAppointment;
}

describe("toDetailVM", () => {
  it("maps an appointment to the detail view-model", () => {
    const vm = toDetailVM(appt(), true);
    expect(vm.id).toBe("a1");
    expect(vm.title).toBe("12 Oak St");
    expect(vm.service).toBe("Deep clean");
    expect(vm.timeLabel).toBe("2:30pm");
    expect(vm.durationLabel).toBe("1h 30m");
    expect(vm.customer).toBe("Sarah Miller");
    expect(vm.cleaner).toBe("Jo Lee");
    expect(vm.payment).toEqual({ tone: "paid", label: "Paid" });
    expect(vm.priceLabel).toBe("$120.00");
    expect(vm.isUnassigned).toBe(false);
  });

  it("hides payment data when canViewPayments is false", () => {
    const vm = toDetailVM(appt(), false);
    expect(vm.payment).toBeNull();
    expect(vm.priceLabel).toBeNull();
  });

  it("surfaces counter-proposed times with readable labels", () => {
    const vm = toDetailVM(
      appt({
        cleaner_availability_feedback: [
          {
            reason: "conflict",
            cleaner_suggested_times: [{ id: "st1", suggested_date: "2026-03-06", suggested_time: "09:00" }],
            cleaner_suggested_windows: [],
          },
        ],
      } as unknown as Partial<AdminAppointment>),
      true,
    );
    expect(vm.counterProposals).toEqual([{ id: "st1", label: "Mar 6 at 9:00am" }]);
    expect(vm.declinedReason).toBe("conflict");
  });
});

describe("toRowVM", () => {
  it("maps an appointment to a row view-model with today flag and avatar", () => {
    const vm = toRowVM(appt(), "2026-03-05", true, new Map([["cl-1", "http://a/x.png"]]));
    expect(vm.id).toBe("a1");
    expect(vm.isToday).toBe(true);
    expect(vm.cleanerAvatarUrl).toBe("http://a/x.png");
    expect(vm.dateLabel).toBe("Mar 5");
    expect(vm.payment).toEqual({ tone: "paid", label: "Paid" });
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `npx vitest run src/components/redesign/bookings/booking-vm.test.ts`
Expected: PASS (4 tests). If a label expectation mismatches the real output, fix the TEST to pin actual current behavior (this is a move, not a behavior change).

- [ ] **Step 4: Strip the moved code from `OperatorBookings.tsx`**

Delete lines 37-191 (the `// --- formatting helpers …` block through the end of `toDetailVM`). Add to the imports:

```ts
import { toDetailVM, toRowVM } from "./booking-vm";
```

Remove now-unused type imports from `./bookings-types` (keep only what the remaining code uses: `BookingRowAction`, `BookingRowVM`, `BookingSegment`, `StatusFilter`; `BookingDetailVM`, `BookingPayment`, `BookingStatusKey`, `CounterProposal` were only used by the moved code — the `detail` memo's type is inferred).

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expected `12` (baseline). Run: `npm run test:unit` → only the pre-existing `formDraft.test.ts` failure. Run: `npx eslint src/components/redesign/bookings/`.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/bookings/booking-vm.ts src/components/redesign/bookings/booking-vm.test.ts src/components/redesign/bookings/OperatorBookings.tsx
git commit -m "refactor(operator): extract booking view-model builders into booking-vm"
```

---

### Task 2: `useOpenBookingDetail` opener + `OperatorBookingDetailHost` (not yet mounted)

**Files:**
- Create: `src/components/redesign/bookings/useOpenBookingDetail.ts`
- Create: `src/components/redesign/bookings/OperatorBookingDetailHost.tsx`

**Interfaces:**
- Consumes: `toDetailVM` from `./booking-vm` (Task 1); `BookingDetailSheet` props as-is (`src/components/redesign/bookings/BookingDetailSheet.tsx:40-60`); mutation helpers `assignCleanerToAppointment`, `updateAppointmentStatus`, `acceptCounterProposal`, `cancelAppointment`, `deleteAppointment` from `@/hooks/useAdminData`.
- Produces: `export function useOpenBookingDetail(): (id: string) => void` and `export function OperatorBookingDetailHost(): JSX.Element | null` — Task 3 mounts the host in `OperatorShell`; Task 4 uses the opener in overview/shell.

- [ ] **Step 1: Create `useOpenBookingDetail.ts`**

```ts
"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Open the operator booking-detail sheet by setting `?booking=<id>` on the
 * current path. Uses router.replace (no scroll) so closing restores list state;
 * reads no search params, so callers do not need a Suspense boundary (mirrors
 * the cleaner useOpenJob). Note: this replaces the whole query string; screens
 * that must preserve sibling params (e.g. Messages `?c=`) set the param in
 * place themselves instead of using this hook. */
export function useOpenBookingDetail(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?booking=${id}`, { scroll: false }),
    [router, pathname],
  );
}
```

- [ ] **Step 2: Create `OperatorBookingDetailHost.tsx`**

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useDetailParam } from "@/hooks/useDetailParam";
import {
  useAdminAppointments,
  useAdminCleaners,
  assignCleanerToAppointment,
  cancelAppointment,
  deleteAppointment,
  updateAppointmentStatus,
  acceptCounterProposal,
} from "@/hooks/useAdminData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BookingDetailSheet } from "./BookingDetailSheet";
import { toDetailVM } from "./booking-vm";

/**
 * Shell-level `?booking=<id>` host: opens the booking detail sheet in place on
 * ANY operator page (overview queue, notifications, message chips), mirroring
 * the cleaner shell's `?job=` host. Mounted once in OperatorShell behind
 * can_view_bookings + Suspense (useDetailParam reads search params). The inner
 * component owns the heavy org-appointments query, so it only mounts after a
 * booking has been opened at least once.
 */
export function OperatorBookingDetailHost() {
  const { paramId, setParam } = useDetailParam("booking");
  // Retain the last id after the param clears so the sheet stays mounted
  // through its exit animation instead of vanishing mid-close.
  const [lastId, setLastId] = useState<string | null>(null);
  if (paramId && paramId !== lastId) setLastId(paramId);
  if (!lastId) return null;
  return (
    <HostInner
      key={lastId}
      appointmentId={lastId}
      open={!!paramId}
      onClose={() => setParam(null)}
    />
  );
}

type ConfirmKind = "cancel" | "delete";

function HostInner({
  appointmentId,
  open,
  onClose,
}: {
  appointmentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { currentOrgRole, currentOrganizationId, accessToken } = useAuth();
  const { appointments, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  const canManagePayments = privileged || !!permissions?.can_manage_payments;
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;
  const canDelete = privileged;

  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useMemo(() => {
    const a = appointments.find((x) => x.id === appointmentId);
    return a ? toDetailVM(a, canViewPayments) : null;
  }, [appointments, appointmentId, canViewPayments]);

  const cleanerOptions = useMemo(
    () =>
      cleaners.map((c) => ({
        id: c.id,
        name: `${c.user_profile?.first_name ?? ""} ${c.user_profile?.last_name ?? ""}`.trim() || "Cleaner",
      })),
    [cleaners],
  );

  const runStatus = useCallback(
    async (status: "in_progress" | "completed") => {
      setBusy(true);
      try {
        const r = await updateAppointmentStatus(appointmentId, status);
        await refetch();
        if (r.success) {
          toast.success(status === "completed" ? "Booking completed" : "Booking started",
            r.paymentError ? { description: `Payment: ${r.paymentError}` } : undefined);
        } else {
          toast.error(r.error || "Could not update the booking");
        }
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, refetch],
  );

  const handleAssign = useCallback(
    async (cleanerId: string) => {
      setBusy(true);
      try {
        const r = await assignCleanerToAppointment(appointmentId, cleanerId);
        await refetch();
        if (r.success) toast.success("Cleaner assigned");
        else toast.error(r.error || "Could not assign cleaner");
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, refetch],
  );

  const handleAcceptCounter = useCallback(
    async (suggestedTimeId: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const r = await acceptCounterProposal({
          appointmentId,
          suggestedTimeId,
          organizationId: currentOrganizationId,
          accessToken,
        });
        await refetch();
        if (r.success) {
          toast.success("Proposed time accepted");
          onClose();
        } else {
          toast.error(r.error || "Could not accept the time");
        }
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, currentOrganizationId, accessToken, refetch, onClose],
  );

  // Interim: reschedule still lives on the legacy dashboard (no redesign flow yet).
  // Carrying ?appointment= auto-opens the legacy side panel on the right booking.
  const handleReschedule = useCallback(() => {
    router.push(`/admin-dashboard?tab=bookings&appointment=${appointmentId}`);
  }, [router, appointmentId]);

  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "cancel") {
        const r = await cancelAppointment(appointmentId);
        await refetch();
        if (r.success) { toast.success("Booking cancelled"); onClose(); }
        else { toast.error(r.error || "Could not cancel"); }
      } else {
        const r = await deleteAppointment(appointmentId);
        await refetch();
        if (r.success) { toast.success("Booking deleted"); onClose(); }
        else { toast.error(r.error || "Could not delete"); }
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, appointmentId, refetch, onClose]);

  const confirmCopy =
    confirm === "delete"
      ? { title: "Delete this booking?", description: "This permanently removes the booking. This cannot be undone.", confirmLabel: "Delete", destructive: true }
      : { title: "Cancel this booking?", description: "The customer and cleaner will be notified.", confirmLabel: "Cancel booking", destructive: false };

  return (
    <>
      <BookingDetailSheet
        open={open && !!detail}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        detail={detail}
        cleanerOptions={cleanerOptions}
        canViewPayments={canViewPayments}
        canManagePayments={canManagePayments}
        canEdit={canEdit}
        canHandleRequests={canHandleRequests}
        canDelete={canDelete}
        busy={busy}
        onAssign={handleAssign}
        onAcceptCounter={handleAcceptCounter}
        onStart={() => runStatus("in_progress")}
        onComplete={() => runStatus("completed")}
        onReschedule={handleReschedule}
        onCancel={() => setConfirm("cancel")}
        onDelete={() => setConfirm("delete")}
        onMessageCustomer={() => {
          if (detail?.customerId)
            router.push(`/app/admin-dashboard/messages?to=${detail.customerId}&appointment=${detail.id}`);
        }}
        onMessageCleaner={() => {
          if (detail?.cleanerId)
            router.push(`/app/admin-dashboard/messages?to=${detail.cleanerId}&appointment=${detail.id}`);
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        destructive={confirmCopy.destructive}
        loading={busy}
        onConfirm={runConfirm}
      />
    </>
  );
}
```

Notes for the implementer:
- `open={open && !!detail}`: on a cold deep link the sheet opens once the org list query resolves and the id is found; an id not in the org list (deleted/foreign) never opens, matching today's behavior on the bookings page.
- The setState-during-render in the outer host is React's sanctioned "derived state from props" pattern (bail-out re-render, no loop) — it exists solely to keep the sheet mounted for its exit animation after the param clears.
- Handlers are the single-id versions of `OperatorBookings.tsx:320-424`; behavior (toasts, refetch, close-on-success) is identical. `refetch` hits the same `keys.appointments.byOrg(orgId)` query the bookings list uses, so the list stays fresh.

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `12`. Run: `npx eslint src/components/redesign/bookings/`.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/bookings/useOpenBookingDetail.ts src/components/redesign/bookings/OperatorBookingDetailHost.tsx
git commit -m "feat(operator): booking-detail host + write-only opener (unmounted)"
```

---

### Task 3: The swap — mount the host in OperatorShell, strip sheet ownership from OperatorBookings

Single commit: two `?booking=` owners would stack two sheets on the bookings page.

**Files:**
- Modify: `src/components/redesign/shell/OperatorShell.tsx`
- Modify: `src/components/redesign/bookings/OperatorBookings.tsx`

**Interfaces:**
- Consumes: `OperatorBookingDetailHost` from Task 2.
- Produces: any operator page can now open the sheet by setting `?booking=<id>` (Task 4 relies on this).

- [ ] **Step 1: Mount the host in `OperatorShell.tsx`**

Add imports:

```ts
import { OperatorBookingDetailHost } from "@/components/redesign/bookings/OperatorBookingDetailHost";
```

After line 63 (`const canCreateBooking = …`) add:

```ts
  // The booking-detail sheet is a global surface too: notifications, message
  // chips, and the overview queue all open it in place via ?booking=<id>.
  // Mirror the bookings route's gate (useRequireManagerFlag can_view_bookings)
  // so a restricted manager can never open it anywhere.
  const canViewBookings = privileged || !!permissions?.can_view_bookings;
```

After the existing `OperatorBookingHost` mount (lines 77-81) add:

```tsx
        {canViewBookings ? (
          <Suspense fallback={null}>
            <OperatorBookingDetailHost />
          </Suspense>
        ) : null}
```

- [ ] **Step 2: Strip sheet ownership from `OperatorBookings.tsx`**

All edits to `src/components/redesign/bookings/OperatorBookings.tsx` (post-Task-1 line numbers shift up by ~155; anchors given as code):

1. Imports: remove `BookingDetailSheet`; remove `assignCleanerToAppointment`, `updateAppointmentStatus`, `acceptCounterProposal` from the `useAdminData` import (keep `useAdminAppointments`, `useAdminCleaners`, `cancelAppointment`, `deleteAppointment`, `type AdminAppointment`); remove `toDetailVM` from the `./booking-vm` import (keep `toRowVM`); remove `useRouter` import and the `const router = useRouter();` line (the sheet's message/reschedule pushes were its only users).
2. `useAuth()` destructure: keep only `currentOrgRole` (`currentOrganizationId` and `accessToken` were only used by `acceptCounterProposal`).
3. Remove `canManagePayments` (sheet-only).
4. Remove the `detailId` state and the `useEffect(() => { setDetailId(bookingParam); }, [bookingParam])` sync; change the `useDetailParam` destructure to `const { setParam: setBookingParam } = useDetailParam("booking");`.
5. Replace `openDetail`/`closeDetail` with:

```ts
  // Row click just sets ?booking=<id>; the shell-level OperatorBookingDetailHost
  // owns the param and renders the sheet.
  const openDetail = useCallback((id: string) => setBookingParam(id), [setBookingParam]);
```

6. Remove the `detail` memo.
7. Remove `runStatus`, `handleAssign`, `handleAcceptCounter`, `handleReschedule` (all sheet-only).
8. In `runConfirm`, remove both `closeDetail();` calls (keep the toasts); update the dependency array to `[confirm, refetch, clearSelection]`.
9. Delete the entire `<BookingDetailSheet …/>` JSX block. Keep `<OperatorBookingsView …/>` and `<ConfirmDialog …/>` untouched (row-level and bulk cancel/delete still confirm here).
10. Update the component doc comment: the detail sheet now lives in the shell host; this component owns the list, filters, selection, and row/bulk confirms.

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `12`. Run: `npm run test:unit` → only the formDraft baseline failure. Run: `npx eslint src/components/redesign/bookings/ src/components/redesign/shell/` → no new errors (unused-var errors here mean a missed removal from Step 2).

- [ ] **Step 4: Manual smoke (dev server)**

With `npm run dev` running, on `/app/admin-dashboard/bookings`: click a row → sheet opens, URL gains `?booking=<id>`; Escape/backdrop close → param clears, exit animation plays; reload with `?booking=<id>` → sheet reopens after load. On `/app/admin-dashboard` (overview): manually append `?booking=<same id>` to the URL → sheet opens in place over the overview.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/shell/OperatorShell.tsx src/components/redesign/bookings/OperatorBookings.tsx
git commit -m "feat(operator): shell-level booking-detail host owns ?booking= everywhere"
```

---

### Task 4: Repoint in-place openers (overview, messages, notifications)

**Files:**
- Modify: `src/components/redesign/overview/OperatorOverview.tsx`
- Modify: `src/components/redesign/messages/OperatorMessages.tsx`
- Modify: `src/components/redesign/notifications/deriveNotifications.ts`
- Modify: `src/components/redesign/notifications/deriveNotifications.test.ts`
- Modify: `src/components/redesign/notifications/NotificationBell.tsx`
- Modify: `src/components/redesign/shell/OperatorTopBar.tsx`
- Modify: `src/components/redesign/shell/OperatorShell.tsx`

**Interfaces:**
- Consumes: `useOpenBookingDetail` (Task 2), the mounted host (Task 3).
- Produces: `NotificationItemVM.bookingId: string | null` (new field); `NotificationBell` prop `onOpenBooking?: (id: string) => void`; `OperatorTopBar` prop `onOpenBooking?: (id: string) => void`.
- NOT touched (deliberate): `deriveCommandResults.ts` booking hrefs (palette intent is "go to booking", and the href now lands on a page where the host opens the sheet); `usePaymentsTriage.fixCard` (legacy until R6); payments `messageCleaner` (already a real navigation to Messages).

- [ ] **Step 1: Overview opens in place**

In `OperatorOverview.tsx`: add `import { useOpenBookingDetail } from "@/components/redesign/bookings/useOpenBookingDetail";`. Replace lines 88-91:

```ts
  // Opens the booking sheet in place via the shell-level host (?booking=<id>);
  // no navigation away from the overview.
  const openBooking = useOpenBookingDetail();
```

Remove the `useRouter` import and `const router = useRouter();` if `router` has no other users in the file (verify with a search for `router.` first). The existing `canViewBookings ? openBooking : undefined` gating at line 157 stays exactly as is.

- [ ] **Step 2: Messages booking chips open in place (preserving `?c=`)**

In `OperatorMessages.tsx`, replace the `openBooking` callback (lines 259-263):

```ts
  // Open the booking sheet in place via the shell host, preserving the open
  // thread's ?c= selection (the write-only opener would wipe it).
  const openBooking = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("booking", id);
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
```

- [ ] **Step 3 (TDD): failing tests for `bookingId` on notification VMs**

Append to the `operatorNotificationHref` describe block's file (`deriveNotifications.test.ts`), as a new describe:

```ts
describe('bookingId (in-place booking open)', () => {
  it('sets bookingId for operator appointment events that target the booking detail', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: 'a1', event_type: 'cleaner_accepted' })],
      NOW,
      'admin',
    );
    expect(g.latest.bookingId).toBe('a1');
  });

  it('leaves bookingId null for payment-routed and appointment-less events', () => {
    const [pay] = deriveNotificationGroups(
      [item({ appointment_id: 'a2', event_type: 'charge_failed' })],
      NOW,
      'admin',
    );
    expect(pay.latest.bookingId).toBeNull();
    const [solo] = deriveNotificationGroups(
      [item({ appointment_id: null, event_type: 'member_joined' })],
      NOW,
      'admin',
    );
    expect(solo.latest.bookingId).toBeNull();
  });

  it('leaves bookingId null for cleaner and homeowner roles', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: 'a3', event_type: 'job_completed' })],
      NOW,
      'cleaner',
    );
    expect(g.latest.bookingId).toBeNull();
  });
});
```

Run: `npx vitest run src/components/redesign/notifications/deriveNotifications.test.ts`
Expected: FAIL (property `bookingId` undefined / type error).

- [ ] **Step 4: Implement `bookingId` in `deriveNotifications.ts`**

Add to `NotificationItemVM` (after `href`):

```ts
  /** For operator roles: the booking the row targets, when the destination is
   * the booking detail. The bell opens the sheet in place via the shell host
   * instead of navigating to `href`. Null when the row routes elsewhere. */
  bookingId: string | null;
```

Add the helper next to `operatorNotificationHref`:

```ts
/** The booking a click should open in place (operator roles only): the same
 * appointment-scoped rows operatorNotificationHref sends to the booking
 * detail; payment-routed and appointment-less rows return null. */
function operatorBookingId(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
  role: NotificationRole,
): string | null {
  if (role === 'cleaner' || role === 'homeowner') return null;
  if (!item.appointment_id) return null;
  return notificationTab(item.event_type, 'admin') === 'payments' ? null : item.appointment_id;
}
```

In `toItemVM`, add `bookingId: operatorBookingId(item, role),` after `href`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/redesign/notifications/deriveNotifications.test.ts`
Expected: PASS (all, including the pre-existing ones).

- [ ] **Step 6: Thread `onOpenBooking` through bell + top bar + shell**

`NotificationBell.tsx`: change the signature to

```ts
export function NotificationBell({
  role = 'admin',
  onOpenBooking,
}: { role?: NotificationRole; onOpenBooking?: (id: string) => void } = {}) {
```

and replace `handleOpen` with:

```ts
  const handleOpen = useCallback(
    (item: NotificationItemVM, unreadIds: string[]) => {
      if (unreadIds.length > 0) markManyRead(unreadIds);
      setOpen(false);
      // Booking-targeted rows open the detail sheet in place via the shell
      // host when the viewer may see bookings; otherwise fall back to the href.
      if (item.bookingId && onOpenBooking) {
        onOpenBooking(item.bookingId);
        return;
      }
      router.push(item.href);
    },
    [markManyRead, router, onOpenBooking],
  );
```

`OperatorTopBar.tsx`: add `onOpenBooking` to the props type (`onOpenBooking?: (id: string) => void;`) and pass it: `<NotificationBell onOpenBooking={onOpenBooking} />`.

`OperatorShell.tsx`: add `import { useOpenBookingDetail } from "@/components/redesign/bookings/useOpenBookingDetail";`, add `const openBookingDetail = useOpenBookingDetail();` next to `openBooking`, and change the top bar line to:

```tsx
          <OperatorTopBar
            onNewBooking={onNewBooking}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenBooking={canViewBookings ? openBookingDetail : undefined}
          />
```

(A restricted manager gets `undefined` → the bell falls back to `router.push(href)`, whose destination route-guard bounces exactly as today; no new leak.)

- [ ] **Step 7: Gates**

Run: `npm run test:unit` → only the formDraft baseline failure. Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `12`. Run: `npx eslint src/components/redesign/ | tail -5` → no new errors (pre-existing warnings in Settings/Message files are known).

- [ ] **Step 8: Manual smoke (dev server)**

On `/app/admin-dashboard/payments`: open the bell, click an appointment notification (non-payment event) → sheet opens IN PLACE (URL stays on /payments with `?booking=`). On `/app/admin-dashboard/messages` with a thread open (`?c=`): click a booking chip → sheet opens, `?c=` still present; close → thread still selected. Overview: click a "Needs you now" row → sheet opens in place.

- [ ] **Step 9: Commit**

```bash
git add src/components/redesign/overview/OperatorOverview.tsx src/components/redesign/messages/OperatorMessages.tsx src/components/redesign/notifications/ src/components/redesign/shell/
git commit -m "feat(operator): overview, messages, and notifications open booking detail in place"
```

---

### Task 5: Audit-doc checkoff, full gates, PR

**Files:**
- Modify: `docs/redesign/2026-07-09-functionality-audit.md` (§2 legacy-escape rows now resolved by the host; §7 item 2 done)

- [ ] **Step 1: Update the audit doc**

In §7 sequencing, mark item 2 (operator-shell booking-detail host) done with a one-line note: shell host owns `?booking=` on every operator page; overview/messages/notifications open it in place; reschedule + Fix card remain legacy pending R2/R3 and R6. In §2, annotate the rows this resolves (notification clicks, message booking chips, overview queue navigation) as fixed by the host, leaving Reschedule and Fix card rows open.

- [ ] **Step 2: Full local gates**

Run: `npm run test:unit` (only formDraft baseline fails), `npx tsc --noEmit` (12 baseline errors), `npm run lint` (no new errors). If local Supabase is running, also `npm run test:integration` (no API routes were touched; this is belt-and-braces).

- [ ] **Step 3: Push and open the PR**

```bash
git add docs/redesign/2026-07-09-functionality-audit.md docs/superpowers/plans/2026-07-09-operator-booking-detail-host.md
git commit -m "docs: check off operator booking-detail host in redesign audit"
git push -u origin feat/operator-booking-detail-host
gh pr create --title "feat(operator): shell-level booking-detail host (?booking= opens in place everywhere)" --body "..."
```

PR body summarizes: single param owner moved from OperatorBookings to a shell host (model: CleanerJobDetailHost), gated on can_view_bookings; in-place opens from overview/messages/notifications; VM builders extracted to booking-vm; reschedule + Fix card deliberately still legacy (R2/R3, R6). Wait for the 4 required checks (CI typecheck+lint, CI unit+integration, E2E 1/2, E2E 2/2).

---

## Self-Review (done at authoring time)

- Spec coverage: host (§7 item 2) → Tasks 2-3; "repoint the interim deep links" → Task 4; can_view_bookings gating (review finding from slice A) → Task 3 Step 1 + Task 4 Step 6; heavy-query concern → inner-mount design; exit-animation concern → lastId retention.
- Placeholders: none; every code step carries the actual code.
- Type consistency: `useOpenBookingDetail(): (id: string) => void` used in Tasks 2/4; `bookingId: string | null` matches VM field and tests; `OperatorTopBar`/`NotificationBell` prop names identical (`onOpenBooking`).
- Known accepted behaviors: cold deep link opens after list load (matches today); bogus id never opens (matches today); write-only opener wipes sibling params (only used where none matter; Messages uses in-place set).
