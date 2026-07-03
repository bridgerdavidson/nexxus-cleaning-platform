# Operator Booking , Slice 1 (Single Booking) , Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy operator "New booking" (which routes to the legacy `AddAppointmentModal`) with a redesigned single-booking flow , a right-side `Sheet` on the operator dashboard (full-screen on mobile) covering bill-to/self-pay, customer, property, service, price (+override), date/time (+2 alternates), cleaner offer, notes, payment, and review & create.

**Architecture:** `useOpenOperatorBooking()` sets `?newbooking=1`; an `OperatorBookingHost` mounted inside `OperatorShell` reads it and renders `OperatorBookingSheet` (a right-anchored `Sheet`, responsive by width). The sheet holds all form state and orchestrates focused sub-pickers (customer, property, service, time, cleaner). Create is a new `useCreateOperatorBooking` that mirrors the legacy insert (appointments row + offered slots) , no schema/route change. Slice 1 is single bookings only (recurrence = Slice 2; cleaner series-accept = Slice 3).

**Tech Stack:** Next.js 16, React 19, TS, Tailwind v3, TanStack Query v5, Radix `Sheet`, reused admin hooks + `computeResponseDeadlineISO` + `rankCleanersByAvailability` + the payment sections.

## Global Constraints

- No migration, no new API route. Create = a direct `supabase` insert (org-scoped, via the RLS client) mirroring the legacy `AddAppointmentModal` insert. DB CHECK: `is_self_pay = true OR homeowner_id IS NOT NULL`.
- No em dashes in user-facing copy. This is an operator surface, so "operator" is fine here; Slice 3 (cleaner) copy must say "office".
- No legacy yellow `#F7C41E`; no `primary-<number>` classes. Reuse the LOGIC of `AddAppointmentModal` / `AppointmentPaymentSection` / `OrgPaymentMethodPicker` / `SlotPicker`, but rebuild presentation from the design system. Bare `primary`/`brand-600`/`brand-700` + semantic shades allowed.
- Container = the operator's existing right-anchored `Sheet` pattern (`BookingDetailSheet`): `<SheetContent side="right" className="w-full ... sm:max-w-lg">`. Responsive by width; no new container.
- Never import `@/lib/supabase-admin` from client code (create uses the anon RLS client `@/lib/supabase`).
- All new files under `src/components/redesign/bookings/new-booking/`.
- Branch: `feat/operator-new-booking-flow` (spec committed there).

## Verified reuse (exact signatures)

- **Insert (mirror, build a helper):** `appointments.insert({ organization_id, homeowner_id (null only if self-pay+org-owned), cleaner_id, property_id, service_type_id, checklist_id, scheduled_date 'YYYY-MM-DD', scheduled_time 'HH:mm', duration_minutes, total_price, price_override_enabled, price_override_total (number|null), special_requests (string|null), payment_method_id (concrete card id only; null for self-pay/send-link/defer), is_self_pay, status: 'pending', cleaner_confirmation_status: 'awaiting', response_deadline (ISO|null) })` then `appointment_requested_slots.insert([{ appointment_id, slot_index (0=primary,1+=alt), scheduled_date, scheduled_time }])` (primary first). Alternate-slot failure is non-fatal. (`AddAppointmentModal.tsx:1163-1210`.)
- `computeResponseDeadlineISO(scheduledDate: string, scheduledTime: string, now?: Date): string | null` , `src/lib/computeResponseDeadline.ts`.
- `useAdminCustomers(): { customers: AdminCustomer[]; loading; ... }` , `AdminCustomer` = `{ id, first_name, last_name, email, phone, avatar_url, properties_count, ... }` (`useAdminData.ts:1447`).
- `useAdminCleaners(): { cleaners: AdminCleaner[]; loading; ... }` , `AdminCleaner` = `{ id, user_profile { first_name, last_name, email, phone, avatar_url }, payout_percent, stripe_connect_onboarding_complete, ... }` (`useAdminData.ts:364`).
- `rankCleanersByAvailability<C>(cleaners: C[], schedulesByCleaner: Record<string, ScheduleAppointment[]>, candidate: { date: string; time: string; durationMinutes: number } | null): CleanerAvailability<C>[]` , returns `{ cleaner, isAvailable, conflicts, nextFreeSlot }` (`src/lib/cleanerAvailability.ts:48`). `schedulesByCleaner` is built from the org appointments (`useAdminAppointments`) grouped by `cleaner_id`.
- Properties by owner: query `properties` where `owner_id = <customerId>` (org-scoped); self-pay uses org-owned properties. (Legacy `fetchProperties(ownerId)`, `AddAppointmentModal.tsx:709`.)
- `useServices(): { services: ServiceType[]; ... }` , `ServiceType` = `{ id, name, base_price, duration_minutes, is_active, ... }`.
- `AppointmentPaymentSection` props: `{ homeownerId: string|null; organizationId: string|null; value: string|null; onChange: (value: string|null)=>void }` (value = a card id, or a `send-link`/defer sentinel).
- `OrgPaymentMethodPicker` props: `{ organizationId: string; onChargedMethodChange?: (info: { hasMethod: boolean; method: PaymentMethodKind })=>void; onChanged?: ()=>void }`.
- `computeSelfPayAmounts({ jobGrossCents, payoutPercent, method='card' }): { cleanerCutCents, chargeCents, estimatedFeeCents, ... }` , `src/lib/payments/selfPayMath.ts`.
- `BookingTotalSummary` props: `{ servicePrice?, method?, breakdown?, timingNote?, className? }`.
- `Sheet`/`SheetContent side="right"` , `src/components/ui/sheet.tsx` (`right: 'inset-y-0 right-0 h-full w-3/4 ... sm:max-w-sm'`; pass `className="sm:max-w-lg"` for the wider booking form).
- `OperatorShell({ active, onNewBooking, children })` , provided by the admin-dashboard pages (currently `onNewBooking={() => router.push('/admin-dashboard?tab=bookings')}`). Slice 1 changes these to open the sheet.

---

## Task 1: Opener + Host + Sheet shell + wiring

**Files:**
- Create: `src/components/redesign/bookings/new-booking/useOpenOperatorBooking.ts` (+ `.test.ts`)
- Create: `src/components/redesign/bookings/new-booking/OperatorBookingSheet.tsx` (temporary shell; replaced in Task 9)
- Create: `src/components/redesign/bookings/new-booking/OperatorBookingHost.tsx`
- Modify: `src/components/redesign/shell/OperatorShell.tsx` (mount `<OperatorBookingHost/>` so it exists on every operator page)
- Modify: the operator pages that pass `onNewBooking` , `src/app/(redesign)/app/admin-dashboard/page.tsx` + the shared `goNewBooking` used by `settings/services/payments` pages , to call the opener instead of `router.push` to the legacy dashboard.

**Interfaces:**
- Produces: `operatorBookingParams(): { newbooking: '1' }`; `useOpenOperatorBooking(): () => void`; `<OperatorBookingHost/>`; `<OperatorBookingSheet open onOpenChange />`.

- [ ] **Step 1: Failing test** , `useOpenOperatorBooking.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { operatorBookingParams } from './useOpenOperatorBooking';
describe('operatorBookingParams', () => {
  it('sets newbooking=1', () => {
    expect(operatorBookingParams()).toEqual({ newbooking: '1' });
  });
});
```
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement `useOpenOperatorBooking.ts`:**
```ts
'use client';
import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
export function operatorBookingParams(): Record<string, string> {
  return { newbooking: '1' };
}
/** Open the operator new-booking sheet by setting ?newbooking=1. Reads no params (no Suspense). */
export function useOpenOperatorBooking(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    const qs = new URLSearchParams(operatorBookingParams()).toString();
    router.replace(`${pathname}?${qs}`, { scroll: false });
  }, [router, pathname]);
}
```
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Implement `OperatorBookingSheet.tsx` (temporary shell)** , a right-anchored `Sheet`:
```tsx
'use client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
export function OperatorBookingSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>New booking</SheetTitle>
        </SheetHeader>
        <div className="p-4 text-sm text-muted-foreground">Operator booking flow coming together.</div>
      </SheetContent>
    </Sheet>
  );
}
```
- [ ] **Step 6: Implement `OperatorBookingHost.tsx`** , reads `?newbooking` via `useDetailParam('newbooking')`; renders `OperatorBookingSheet` with `open` bound to the param, closing clears it via `router.replace(pathname)`. Mirror `HomeownerCleaningDetailHost`/`BookingFlowHost` but with the Sheet (not MobileTakeover). It reads search params, so it must sit under a Suspense boundary , wrap the mount in `<Suspense fallback={null}>`.
- [ ] **Step 7: Mount in `OperatorShell.tsx`** , render `<Suspense fallback={null}><OperatorBookingHost/></Suspense>` inside `OperatorShell` (so it's present on every operator page).
- [ ] **Step 8: Wire the entry points** , in `admin-dashboard/page.tsx` and wherever `goNewBooking` is defined, replace the `router.push('/admin-dashboard?tab=bookings')` body with `const openBooking = useOpenOperatorBooking(); ... onNewBooking={openBooking}`. (Keep the legacy dashboard reachable directly; only the redesign button changes.)
- [ ] **Step 9: Verify** , `tsc`, `eslint`; visually: on desktop the "New booking" button + Cmd+K "New booking" open a right-side sheet with the dashboard dimmed behind; on a narrow viewport it is full-screen. Close clears `?newbooking`.
- [ ] **Step 10: Commit** , "feat(redesign): operator booking opener + host + sheet shell + wiring (Slice 1 T1)".

---

## Task 2: Booking state + pure derivations

**Files:**
- Create: `src/components/redesign/bookings/new-booking/operator-booking-types.ts`
- Create: `src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts` (+ `.test.ts`)

**Interfaces:**
- Produces: `OperatorBookingState { billTo: 'customer'|'self_pay'; customerId, propertyId, serviceTypeId, checklistId, priceOverride: number|null, slots: {date,time}[] (1-3), cleanerId, notes, paymentValue: string|null }`; `EMPTY_OPERATOR_BOOKING`; `canReview(s)`, `canCreate(s, { paymentRequired })`, `effectiveTotalUsd(s, service)`, `isSelfPay(s)`.

- [ ] **Step 1: Failing test** covering: `canReview` requires (self-pay ? true : customerId) + propertyId + serviceTypeId + checklistId + slots[0] filled; `canCreate` additionally requires a valid payment selection when `paymentRequired`; `effectiveTotalUsd` returns `priceOverride ?? service.base_price`. (Full test in the file.)
- [ ] **Step 2-4:** implement + pass. `effectiveTotalUsd(s, service) = s.priceOverride ?? service.base_price`. `isSelfPay(s) = s.billTo === 'self_pay'`. Validation mirrors the constraints above.
- [ ] **Step 5: Commit** , "feat(redesign): operator booking state + derivations (Slice 1 T2)".

---

## Task 3: Insert payload builder + create hook

**Files:**
- Create: `src/components/redesign/bookings/new-booking/buildBookingInsert.ts` (+ `.test.ts`)
- Create: `src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts`

**Interfaces:**
- Produces: `buildBookingInsert(orgId, s: OperatorBookingState, service: ServiceType): { appointment: <insert fields>, slots: {slot_index,scheduled_date,scheduled_time}[] }` (pure , maps state to the exact insert field list; `homeowner_id` null only when self-pay, `payment_method_id` = a concrete card id from `paymentValue` else null, `total_price = priceOverride ?? base_price`, `price_override_enabled = priceOverride != null`); `useCreateOperatorBooking(): { create(state): Promise<string /* appointmentId */>, creating }`.

- [ ] **Step 1: Failing test** for `buildBookingInsert` , assert the exact appointment fields (status 'pending', cleaner_confirmation_status 'awaiting', is_self_pay, homeowner_id null in self-pay, payment_method_id null for a send-link/defer sentinel, slots array with slot_index 0 primary + alternates). (Full cases in the file.)
- [ ] **Step 2-4:** implement `buildBookingInsert` + pass. Then `useCreateOperatorBooking` , a `useMutation` that: computes `response_deadline` via `computeResponseDeadlineISO(primary.date, primary.time)`, inserts the appointment (RLS client), inserts the slots (non-fatal), and `onSuccess` invalidates `keys.appointments.byOrg(orgId)`. Uses `useAuth().currentOrganizationId`.
- [ ] **Step 5: Commit** , "feat(redesign): operator booking insert builder + create hook (Slice 1 T3)".

---

## Task 4: Customer + Property pickers

**Files:** `CustomerPickerSheet.tsx`, `PropertyPickerField.tsx` (+ a small `usePropertiesByOwner(ownerId)` query hook or inline query).

- [ ] Build a searchable customer picker (vaul `Drawer` on mobile / nested `Sheet`, reuse `useAdminCustomers`, filter by name/email) that sets `customerId` and clears `propertyId`. Build the property field that loads the chosen customer's properties (`owner_id = customerId`, org-scoped) or org-owned properties in self-pay, and sets `propertyId`. Design-system styling; empty states. **Verify + commit** ("Slice 1 T4").

---

## Task 5: Service + Checklist + Price

**Files:** `ServicePickerField.tsx`, `ChecklistField.tsx`, `PriceField.tsx`.

- [ ] Service picker (`useServices`, active only) sets `serviceTypeId` + resets `checklistId`; checklist field loads the service's checklists (reuse `useChecklists`) and sets `checklistId`; price field shows `service.base_price` with an "Override" affordance that reveals a numeric input writing `priceOverride` (null to clear). **Verify + commit** ("Slice 1 T5").

---

## Task 6: Date/time (primary + up to 2 alternates)

**Files:** `BookingTimesField.tsx` + reuse the calendar time sheet from the homeowner flow (`redesign/homeowner/booking/TimePickerSheet` , extract/share it, or a sibling operator copy) to add each slot.

- [ ] Primary time + "Add alternate" (max 3 slots total), each a removable chip added via the calendar/time sheet (`ui/calendar` + time options, min today). Writes `slots`. **Verify + commit** ("Slice 1 T6").

---

## Task 7: Cleaner offer picker

**Files:** `CleanerPickerSheet.tsx` + `CleanerField.tsx`.

- [ ] Build the cleaner offer picker: `useAdminCleaners()` for the list, build `schedulesByCleaner` from `useAdminAppointments` grouped by `cleaner_id`, rank via `rankCleanersByAvailability(cleaners, schedulesByCleaner, { date, time, durationMinutes } from the primary slot + service)`. Show available-first with conflict reasons; selecting sets `cleanerId`. Copy sets the offer expectation ("We'll offer this to <name>; if they decline it routes to the next cleaner."). In self-pay, gate on the cleaner being payout-ready (`payout_percent` + `stripe_connect_onboarding_complete`). **Verify + commit** ("Slice 1 T7").

---

## Task 8: Payment section

**Files:** `BookingPaymentField.tsx`.

- [ ] For `billTo === 'customer'`: render a design-system wrapper around `AppointmentPaymentSection` (`homeownerId = customerId`, `organizationId`, `value = paymentValue`, `onChange` sets `paymentValue`). For `billTo === 'self_pay'`: render `OrgPaymentMethodPicker` (`organizationId`, `onChargedMethodChange` feeds the total's `method`) and compute the self-pay itemization via `computeSelfPayAmounts({ jobGrossCents: effectiveTotal*100, payoutPercent: cleaner.payout_percent, method })`. Show the total via a rebuilt total summary (reuse `BookingTotalSummary` logic, design-system styling). Do not copy the legacy `primary-<number>` styling. **Verify + commit** ("Slice 1 T8").

---

## Task 9: Assemble container + Review & create (replace the shell)

**Files:** Modify `OperatorBookingSheet.tsx` (full assembly); create `OperatorBookingReview.tsx`.

- [ ] Replace the T1 shell with the full sheet: bill-to segmented control, then the fields (customer [hidden in org-owned self-pay], property, service, checklist, price, times, cleaner, notes, payment), a sticky footer with the effective total + "Review & create". "Review & create" swaps the body to `OperatorBookingReview` (a read-only summary) with a final "Create booking" that calls `useCreateOperatorBooking().create(state)`, then closes the sheet + toasts success (the new appointment appears in the bookings list via the invalidation). Progressive disclosure: self-pay hides customer/recurrence; payment options reveal appropriately.
- [ ] **Verify (full visual walkthrough on dev, desktop + mobile widths):** open from the dashboard button + Cmd+K; create a customer-billed booking end-to-end (customer -> property -> service -> checklist -> time -> cleaner -> card -> review -> create) and see it land in the bookings list as pending/awaiting; then a self-pay booking. Screenshot both widths for the user.
- [ ] **Commit** , "feat(redesign): operator booking sheet assembly + review & create (Slice 1 T9)".

---

## Final (post-tasks)

- Full unit suite + `tsc --noEmit` + `eslint`.
- `ui-ux-pro-max` conformance over `new-booking/**` (no hex / `primary-<number>` / em dashes; 44px targets; reused primitives).
- Independent adversarial review (payload correctness vs the DB CHECK + legacy insert, self-pay gating, cleaner-offer routing expectation, payment selection mapping, org-scoping of the insert/queries).
- PR to master (user-gated). Recurrence (Slice 2) + cleaner series-accept (Slice 3) follow.

## Self-Review

- **Spec coverage (Slice 1):** shape C sheet (T1/T9), bill-to + self-pay (T2/T8/T9), customer/property (T4), service/checklist/price+override (T5), date/time + alternates (T6), cleaner-as-offer (T7), payment reuse (T8), create mirroring the legacy insert with no schema/route change (T3). Recurrence + cleaner-accept correctly deferred to Slices 2/3.
- **Placeholders:** pure logic (param builder, derivations, insert builder) carries full code/signatures; pickers name the exact hooks + patterns to mirror.
- **Type consistency:** `OperatorBookingState` fields flow into `buildBookingInsert` -> the exact insert list; `effectiveTotalUsd` feeds both the summary and `computeSelfPayAmounts` (dollars*100 -> cents).
