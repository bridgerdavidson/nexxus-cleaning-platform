# Homeowner New-Booking ("Request a cleaning") Flow , Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `RequestAppointmentModal` with a phone-first, on-brand "Request a cleaning" flow (Flow C: a picks page, a focused calendar sheet, and a review-and-send page), built from the redesign design system and reusing the request-model backend unchanged.

**Architecture:** A `useOpenBooking()` write-only opener sets `?book=1` (+ optional `&bookService=` / `&bookProperty=` prefill); a `BookingFlowHost` in the homeowner layout reads it and mounts `BookingFlow` as a `MobileTakeover`. `BookingFlow` holds all form state and switches between two internal pages (picks / review) plus a success view, orchestrating focused vaul `Drawer` sheets for the heavy inputs (property, service, time, card). Submit calls the existing `POST /api/appointments/request`. All pure logic lives in tested `deriveBooking.ts` / `useSubmitBookingRequest` helpers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, vaul `Drawer`, `react-day-picker` (`ui/calendar`), Stripe SetupIntent (reused Slice 4 brand card components).

## Global Constraints

- No migration, no new API route, no RLS change. Reuse `POST /api/appointments/request` (payload below) unchanged.
- No em dashes (`—`) in any user-facing copy (labels, buttons, hints, toasts, success text). Use periods/commas/parentheses.
- The homeowner never sees the word "operator"; use "office".
- No legacy yellow `#F7C41E`; no `primary-<number>` Tailwind classes (that numbered ramp is legacy yellow). Bare `primary` / `brand-600` / `brand-700` / `bg-primary/10` and semantic shades (`brand-50`, `positive-700`, `critical`, etc.) are allowed.
- Implement every screen from the design system (`src/components/ui/*` + tokens). Do NOT reuse the presentation of `RequestAppointmentModal`, `SlotPicker`, `HomeownerCardPicker`, `BookingTotalSummary`, or `AddPaymentMethodPanel` , logic/values only. Run `ui-ux-pro-max` at implementation for conformance.
- Never import `@/lib/supabase-admin` from client components.
- All new files live under `src/components/redesign/homeowner/booking/`. Card requirement is gated by `homeownerCardPickerAvailable()` from `@/components/HomeownerCardPicker`.
- Branch: `feat/homeowner-new-booking-flow` (spec already committed there, c1139fb).

## Reused interfaces (verified in the codebase)

- **Submit route** `POST /api/appointments/request`, body: `{ organizationId, propertyId, serviceTypeId, checklistId?, slots: {scheduled_date: "YYYY-MM-DD", scheduled_time: "HH:MM"}[] (1-3), specialRequests?: string|null, paymentMethodId?: string|null }` → `{ success: true, appointmentId }`. Auth: `requireOrgAuth` (homeowner allowed). We pass no `checklistId`.
- **Fee math** `computeChargeBreakdown(method: 'card'|'us_bank_account', baseCents: number) => { baseCents, method, feeCents, chargeCents }` from `@/lib/payments/processingFee`. Service `base_price` is in **dollars**; multiply by 100 for cents.
- **Request list hook** `useHomeownerRequests()` → `{ requests, loading, ... }`, keyed `keys.appointments.requestsByHomeowner(homeownerId)`. Invalidate that + `keys.appointments.byHomeowner(homeownerId)` after submit.
- **Data hooks:** `useHomeownerProperties()` → `{ properties, loading }` (Property: `id, name, address, city, state, ...`); `useServices()` → `{ services, loading }` (service: `id, name, base_price, duration_minutes, is_active`).
- **Slice 4 card reuse:** `useSavedPaymentMethods()` → `{ cards, loading, error, refetch, setDefault, remove }`; `AccountAddCardPanel({ createSetupIntent, onSaved, onSavingChange })` (brand Stripe Elements); `SavedPaymentMethod` type + `paymentMethodTitle`/`paymentMethodSubtitle` from `src/components/redesign/homeowner/account/payment-methods/`. Create-SetupIntent: `POST /api/stripe/create-setup-intent` `{ homeowner_id }` → `{ client_secret }`. `homeownerCardPickerAvailable(): boolean` from `@/components/HomeownerCardPicker`.
- **Primitives:** `MobileTakeover({ onClosed, ariaLabel, keyboardAware, children:(close)=>node })`; `useDetailParam(key)` → `{ paramId, setParam }`; `Calendar` (`mode="single" selected onSelect` + `disabled` for min-date) from `@/components/ui/calendar`; `Drawer*` from `@/components/ui/drawer`; `Button`, `Badge`, `Textarea`, `RadioGroup`, `EmptyState`, `Skeleton`.
- **Formatting:** `formatTimeTo12h(hhmm)` from `@/lib/formatTime`; date via `toLocaleDateString`.
- **Entry points to swap (redesign only):** `HomeownerHome.tsx` (inline button line 31-34 + FAB line 55-58), `HomeownerServiceDetail.tsx` (line 131). Also add "Book again" to `RecentCleaningCard.tsx` + `HomeownerCleaningDetail.tsx`.

---

## Task 1: Opener + Host + entry-point wiring (shell)

**Files:**
- Create: `src/components/redesign/homeowner/booking/useOpenBooking.ts`
- Create: `src/components/redesign/homeowner/booking/useOpenBooking.test.ts`
- Create: `src/components/redesign/homeowner/booking/BookingFlowHost.tsx`
- Create: `src/components/redesign/homeowner/booking/BookingFlow.tsx` (temporary shell; replaced in Task 8)
- Modify: `src/app/(redesign)/app/homeowner-dashboard/layout.tsx` (mount host in the existing Suspense boundary next to `HomeownerCleaningDetailHost`)
- Modify: `src/components/redesign/homeowner/home/HomeownerHome.tsx` (replace both `RequestAppointmentButton` with buttons calling `useOpenBooking()`)
- Modify: `src/components/redesign/homeowner/account/services/HomeownerServiceDetail.tsx` (replace `RequestAppointmentButton` with a button calling `useOpenBooking({ serviceTypeId: serviceId })`)

**Interfaces:**
- Produces: `bookingParams(opts?: { serviceTypeId?: string; propertyId?: string }): Record<string,string>`; `useOpenBooking(): (opts?: { serviceTypeId?: string; propertyId?: string }) => void`; `<BookingFlowHost/>`; `<BookingFlow initialServiceTypeId={string|null} initialPropertyId={string|null} onClose={()=>void} />`.

- [ ] **Step 1: Write the failing test** , `useOpenBooking.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { bookingParams } from './useOpenBooking';

describe('bookingParams', () => {
  it('always sets book=1', () => {
    expect(bookingParams()).toEqual({ book: '1' });
  });
  it('adds the service prefill', () => {
    expect(bookingParams({ serviceTypeId: 'svc_1' })).toEqual({ book: '1', bookService: 'svc_1' });
  });
  it('adds both prefills', () => {
    expect(bookingParams({ serviceTypeId: 'svc_1', propertyId: 'prop_2' })).toEqual({
      book: '1', bookService: 'svc_1', bookProperty: 'prop_2',
    });
  });
});
```
- [ ] **Step 2: Run it, verify it fails** , `npx vitest run src/components/redesign/homeowner/booking/useOpenBooking.test.ts` (fails: module not found).
- [ ] **Step 3: Implement `useOpenBooking.ts`:**
```ts
'use client';
import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export function bookingParams(opts?: { serviceTypeId?: string; propertyId?: string }): Record<string, string> {
  const p: Record<string, string> = { book: '1' };
  if (opts?.serviceTypeId) p.bookService = opts.serviceTypeId;
  if (opts?.propertyId) p.bookProperty = opts.propertyId;
  return p;
}

/** Open the "Request a cleaning" flow by setting ?book=1 (+ optional prefill). Reads no
 *  search params, so callers need no Suspense boundary (mirrors useOpenCleaning). */
export function useOpenBooking(): (opts?: { serviceTypeId?: string; propertyId?: string }) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (opts) => {
      const qs = new URLSearchParams(bookingParams(opts)).toString();
      router.replace(`${pathname}?${qs}`, { scroll: false });
    },
    [router, pathname],
  );
}
```
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Implement `BookingFlow.tsx` (temporary shell)** , a `MobileTakeover` with a header ("Request a cleaning" + a close button calling `close`) and a placeholder body. `onClosed` calls the `onClose` prop. Props exactly as in Interfaces. Mirror the header markup of `HomeownerCleaningDetail.tsx` (back chevron, title). `keyboardAware` = true.
- [ ] **Step 6: Implement `BookingFlowHost.tsx`:**
```tsx
'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useDetailParam } from '@/hooks/useDetailParam';
import { BookingFlow } from './BookingFlow';

export function BookingFlowHost() {
  const { paramId } = useDetailParam('book');
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (!paramId) return null;
  return (
    <BookingFlow
      initialServiceTypeId={sp.get('bookService')}
      initialPropertyId={sp.get('bookProperty')}
      onClose={() => router.replace(pathname, { scroll: false })}
    />
  );
}
```
- [ ] **Step 7: Mount `<BookingFlowHost/>` in `layout.tsx`** inside the same `<Suspense>` boundary that wraps `<HomeownerCleaningDetailHost/>` (it reads search params). Import and place directly beside it.
- [ ] **Step 8: Swap entry points.** In `HomeownerHome.tsx`, replace both `RequestAppointmentButton` usages: add `const openBooking = useOpenBooking();`, render the SAME styled `<button onClick={() => openBooking()}>` (keep the existing brand classNames verbatim, they are already design-system: the outline "Request a cleaning" and the FAB `bg-brand-600`). In `HomeownerServiceDetail.tsx`, replace `RequestAppointmentButton` with a `<button onClick={() => openBooking({ serviceTypeId: serviceId })} className={REQUEST_CTA_CLASS}>Request this cleaning</button>` and `const openBooking = useOpenBooking();`. Remove the now-unused `RequestAppointmentButton` imports.
- [ ] **Step 9: Verify** , `npx tsc --noEmit` (no new errors in touched files), `npx eslint <touched files>`, and a visual check: tapping any "Request a cleaning" / FAB / "Request this cleaning" opens the takeover; close returns and clears the params.
- [ ] **Step 10: Commit** , `git add` the booking dir + modified files; `git commit` "feat(redesign): booking flow opener + host + entry-point wiring".

---

## Task 2: Booking state + pure derivations

**Files:**
- Create: `src/components/redesign/homeowner/booking/booking-types.ts`
- Create: `src/components/redesign/homeowner/booking/deriveBooking.ts`
- Create: `src/components/redesign/homeowner/booking/deriveBooking.test.ts`

**Interfaces:**
- Produces: `BookingSlot { date: string; time: string }`; `BookingState { propertyId, serviceTypeId, slots: BookingSlot[], notes, paymentMethodId, method: 'card'|'us_bank_account' }`; `EMPTY_BOOKING`; `MAX_SLOTS = 3`; `addSlot`, `removeSlotAt`, `canReview(s)`, `canSend(s, paymentRequired)`, `slotOrdinal(idx)`, `formatSlotLabel(slot)`, `bookingTotal(baseUsd, method): { baseUsd, feeUsd, totalUsd }`.

- [ ] **Step 1: Write the failing test** , `deriveBooking.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { addSlot, removeSlotAt, canReview, canSend, slotOrdinal, formatSlotLabel, bookingTotal } from './deriveBooking';
import { EMPTY_BOOKING, type BookingState } from './booking-types';

const filled = (over: Partial<BookingState> = {}): BookingState => ({
  ...EMPTY_BOOKING, propertyId: 'p', serviceTypeId: 's', slots: [{ date: '2026-07-05', time: '10:00' }], ...over,
});

describe('slots', () => {
  it('adds up to 3 and no more', () => {
    let s = [{ date: '2026-07-05', time: '10:00' }];
    s = addSlot(s, { date: '2026-07-06', time: '11:00' });
    s = addSlot(s, { date: '2026-07-07', time: '12:00' });
    expect(s).toHaveLength(3);
    expect(addSlot(s, { date: '2026-07-08', time: '13:00' })).toHaveLength(3);
  });
  it('removes by index', () => {
    expect(removeSlotAt([{ date: 'a', time: '1' }, { date: 'b', time: '2' }], 0)).toEqual([{ date: 'b', time: '2' }]);
  });
});

describe('gating', () => {
  it('canReview needs property + service + >=1 slot', () => {
    expect(canReview(EMPTY_BOOKING)).toBe(false);
    expect(canReview(filled())).toBe(true);
    expect(canReview(filled({ slots: [] }))).toBe(false);
  });
  it('canSend honors the payment requirement', () => {
    expect(canSend(filled(), false)).toBe(true);
    expect(canSend(filled(), true)).toBe(false);
    expect(canSend(filled({ paymentMethodId: 'pm_1' }), true)).toBe(true);
  });
});

describe('labels + total', () => {
  it('slotOrdinal', () => { expect(slotOrdinal(0)).toBe('1st'); expect(slotOrdinal(2)).toBe('3rd'); });
  it('formatSlotLabel', () => {
    const l = formatSlotLabel({ date: '2026-07-05', time: '10:00' });
    expect(l).toContain('Jul 5');
    expect(l).toMatch(/10:00\s?AM/i);
  });
  it('bookingTotal grosses up the card fee', () => {
    const t = bookingTotal(100, 'card'); // $100 base
    expect(t.baseUsd).toBe(100);
    expect(t.totalUsd).toBeGreaterThan(100);
    expect(Math.round((t.feeUsd) * 100)).toBe(Math.round((t.totalUsd - t.baseUsd) * 100));
  });
  it('bookingTotal caps the ACH fee', () => {
    const t = bookingTotal(1000, 'us_bank_account'); // cap $5
    expect(t.feeUsd).toBeLessThanOrEqual(5);
  });
});
```
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement `booking-types.ts`:**
```ts
import type { PaymentMethodKind } from '@/lib/payments/processingFee';

export interface BookingSlot { date: string; time: string } // date YYYY-MM-DD, time HH:MM
export interface BookingState {
  propertyId: string | null;
  serviceTypeId: string | null;
  slots: BookingSlot[];
  notes: string;
  paymentMethodId: string | null;
  method: PaymentMethodKind; // for the fee-aware total; defaults to 'card' (costlier)
}
export const MAX_SLOTS = 3;
export const EMPTY_BOOKING: BookingState = {
  propertyId: null, serviceTypeId: null, slots: [], notes: '', paymentMethodId: null, method: 'card',
};
```
- [ ] **Step 4: Implement `deriveBooking.ts`:**
```ts
import { computeChargeBreakdown, type PaymentMethodKind } from '@/lib/payments/processingFee';
import { formatTimeTo12h } from '@/lib/formatTime';
import { MAX_SLOTS, type BookingSlot, type BookingState } from './booking-types';

export function addSlot(slots: BookingSlot[], slot: BookingSlot): BookingSlot[] {
  return slots.length >= MAX_SLOTS ? slots : [...slots, slot];
}
export function removeSlotAt(slots: BookingSlot[], idx: number): BookingSlot[] {
  return slots.filter((_, i) => i !== idx);
}
export function canReview(s: BookingState): boolean {
  return !!s.propertyId && !!s.serviceTypeId && s.slots.length >= 1;
}
export function canSend(s: BookingState, paymentRequired: boolean): boolean {
  return canReview(s) && (!paymentRequired || !!s.paymentMethodId);
}
const ORDINALS = ['1st', '2nd', '3rd'];
export function slotOrdinal(idx: number): string { return ORDINALS[idx] ?? `${idx + 1}th`; }
export function formatSlotLabel(slot: BookingSlot): string {
  const [y, m, d] = slot.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const datePart = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${datePart} · ${formatTimeTo12h(slot.time)}`;
}
export interface BookingTotal { baseUsd: number; feeUsd: number; totalUsd: number }
export function bookingTotal(baseUsd: number, method: PaymentMethodKind): BookingTotal {
  const b = computeChargeBreakdown(method, Math.round(baseUsd * 100));
  return { baseUsd: b.baseCents / 100, feeUsd: b.feeCents / 100, totalUsd: b.chargeCents / 100 };
}
```
- [ ] **Step 5: Run the tests, verify all pass.**
- [ ] **Step 6: Commit** , "feat(redesign): booking state + pure derivations".

---

## Task 3: Submit hook (+ payload builder)

**Files:**
- Create: `src/components/redesign/homeowner/booking/useSubmitBookingRequest.ts`
- Create: `src/components/redesign/homeowner/booking/useSubmitBookingRequest.test.ts`

**Interfaces:**
- Consumes: `BookingState` (Task 2), `keys.appointments.requestsByHomeowner/byHomeowner`.
- Produces: `toRequestPayload(orgId: string, s: BookingState)` (pure); `useSubmitBookingRequest(): { submit(state): Promise<string /* appointmentId */>, submitting: boolean }`.

- [ ] **Step 1: Failing test** , `useSubmitBookingRequest.test.ts` (pure builder only):
```ts
import { describe, it, expect } from 'vitest';
import { toRequestPayload } from './useSubmitBookingRequest';
import { EMPTY_BOOKING } from './booking-types';

describe('toRequestPayload', () => {
  it('maps slots to scheduled_date/time and trims notes', () => {
    const p = toRequestPayload('org1', {
      ...EMPTY_BOOKING, propertyId: 'p1', serviceTypeId: 's1',
      slots: [{ date: '2026-07-05', time: '10:00' }], notes: '  hi  ', paymentMethodId: 'pm_1',
    });
    expect(p).toEqual({
      organizationId: 'org1', propertyId: 'p1', serviceTypeId: 's1',
      slots: [{ scheduled_date: '2026-07-05', scheduled_time: '10:00' }],
      specialRequests: 'hi', paymentMethodId: 'pm_1',
    });
  });
  it('sends null for empty notes / no card', () => {
    const p = toRequestPayload('org1', {
      ...EMPTY_BOOKING, propertyId: 'p1', serviceTypeId: 's1', slots: [{ date: '2026-07-05', time: '10:00' }],
    });
    expect(p.specialRequests).toBeNull();
    expect(p.paymentMethodId).toBeNull();
  });
});
```
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement `useSubmitBookingRequest.ts`:**
```ts
'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import type { BookingState } from './booking-types';

export function toRequestPayload(orgId: string, s: BookingState) {
  return {
    organizationId: orgId,
    propertyId: s.propertyId!,
    serviceTypeId: s.serviceTypeId!,
    slots: s.slots.map((sl) => ({ scheduled_date: sl.date, scheduled_time: sl.time })),
    specialRequests: s.notes.trim() ? s.notes.trim() : null,
    paymentMethodId: s.paymentMethodId ?? null,
  };
}

export function useSubmitBookingRequest() {
  const { user, currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (state: BookingState): Promise<string> => {
      if (!currentOrganizationId) throw new Error('No organization');
      const token = await getAccessToken();
      const res = await fetch('/api/appointments/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(toRequestPayload(currentOrganizationId, state)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not send your request');
      return data.appointmentId as string;
    },
    onSuccess: () => {
      if (!user?.id) return;
      queryClient.invalidateQueries({ queryKey: keys.appointments.requestsByHomeowner(user.id) });
      queryClient.invalidateQueries({ queryKey: keys.appointments.byHomeowner(user.id) });
    },
  });
  return { submit: mutation.mutateAsync, submitting: mutation.isPending };
}
```
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** , "feat(redesign): booking submit hook + payload builder".

---

## Task 4: Property + Service picker sheets

**Files:**
- Create: `src/components/redesign/homeowner/booking/PropertyPickerSheet.tsx`
- Create: `src/components/redesign/homeowner/booking/ServicePickerSheet.tsx`

**Interfaces:**
- Produces: `<PropertyPickerSheet open onOpenChange selectedId onSelect(id) />`; `<ServicePickerSheet open onOpenChange selectedId onSelect(serviceTypeId) />`.

- [ ] **Step 1: Implement `PropertyPickerSheet.tsx`** , a vaul `Drawer` (mirror `AddCardSheet.tsx` structure). Body: `useHomeownerProperties()`; a radio-style list of the homeowner's properties (each row shows `name` + `address`, selected state uses `border-brand-600 bg-brand-50`, mirror `PaymentMethodRow` selected styling but as a tappable row); tapping calls `onSelect(id)` then `onOpenChange(false)`. Loading → `Skeleton` rows; empty → an "Add a home" `Button` that opens the existing `PropertyFormSheet` (from `../account/properties/PropertyFormSheet`) with `onSaved` selecting the created property (invalidate is internal to that sheet; on save, refetch via the hook and select the newest by created_at). Always render an "Add a home" affordance at the bottom.
- [ ] **Step 2: Implement `ServicePickerSheet.tsx`** , a vaul `Drawer`. Body: `useServices()`, filter `is_active`; list rows showing `name` + `"$" + base_price + " · about " + Math.round(duration_minutes/60) + " hrs"` (or minutes when < 60); tap → `onSelect(id)` + close. Loading → `Skeleton`; empty → `EmptyState` ("No services available", "Please contact your office."). Use only design-system tokens.
- [ ] **Step 3: Verify** , `npx tsc --noEmit`, `npx eslint`, and a visual check once mounted in Task 8 (defer live check). Confirm no `primary-<number>` / hex.
- [ ] **Step 4: Commit** , "feat(redesign): booking property + service picker sheets".

---

## Task 5: Time picker sheet (calendar)

**Files:**
- Create: `src/components/redesign/homeowner/booking/TimePickerSheet.tsx`
- Create: `src/components/redesign/homeowner/booking/time-options.ts`
- Create: `src/components/redesign/homeowner/booking/time-options.test.ts`

**Interfaces:**
- Produces: `bookableTimeOptions(): { value: string /* HH:MM */, label: string }[]` (pure, 8:00 to 18:00 on the hour); `toYMD(d: Date): string`; `<TimePickerSheet open onOpenChange onAdd(slot: BookingSlot) minYMD />`.

- [ ] **Step 1: Failing test** , `time-options.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { bookableTimeOptions, toYMD } from './time-options';

describe('bookableTimeOptions', () => {
  it('runs 8:00 to 18:00 on the hour with 12h labels', () => {
    const opts = bookableTimeOptions();
    expect(opts[0]).toEqual({ value: '08:00', label: '8:00 AM' });
    expect(opts.at(-1)).toEqual({ value: '18:00', label: '6:00 PM' });
    expect(opts).toHaveLength(11);
  });
});
describe('toYMD', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(toYMD(new Date(2026, 6, 5))).toBe('2026-07-05');
  });
});
```
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement `time-options.ts`:**
```ts
import { formatTimeTo12h } from '@/lib/formatTime';

export function bookableTimeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 8; h <= 18; h++) {
    const value = `${String(h).padStart(2, '0')}:00`;
    out.push({ value, label: formatTimeTo12h(value) });
  }
  return out;
}
export function toYMD(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
```
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Implement `TimePickerSheet.tsx`** , a vaul `Drawer` titled "Pick a preferred time". Body: `Calendar` (`mode="single"`, `selected={selectedDate}`, `onSelect={setSelectedDate}`, `disabled={{ before: new Date() }}`) from `@/components/ui/calendar`; below it a label "Time on <selected date>" and a wrap of time pills from `bookableTimeOptions()` (selected pill = `bg-brand-600 text-white`, others = `border border-input`); an "Add this time" `Button` (disabled until both date + time chosen) that calls `onAdd({ date: toYMD(selectedDate), time })`, then `onOpenChange(false)` and resets local state. Keep local `selectedDate`/`time` state; reset on open.
- [ ] **Step 6: Verify** , `tsc`, `eslint`, conformance grep. Live check deferred to Task 8.
- [ ] **Step 7: Commit** , "feat(redesign): booking time picker sheet + time options".

---

## Task 6: Card picker sheet (reuses Slice 4 brand card components)

**Files:**
- Create: `src/components/redesign/homeowner/booking/CardPickerSheet.tsx`

**Interfaces:**
- Consumes: `useSavedPaymentMethods`, `AccountAddCardPanel`, `paymentMethodTitle/paymentMethodSubtitle`, `SavedPaymentMethod` (all from `../account/payment-methods/`); `create-setup-intent`.
- Produces: `<CardPickerSheet open onOpenChange selectedId onSelect(pmId: string, method: 'card'|'us_bank_account') />`.

- [ ] **Step 1: Implement `CardPickerSheet.tsx`** , a vaul `Drawer` titled "Payment method". Body: `useSavedPaymentMethods()` → a radio list of saved cards (reuse `paymentMethodTitle`/`paymentMethodSubtitle`; selected row = `border-brand-600 bg-brand-50`; on tap call `onSelect(pm.id, pm.type)` + close). Below the list, an "Add a card" affordance that reveals `AccountAddCardPanel` with `createSetupIntent` = `POST /api/stripe/create-setup-intent { homeowner_id: user.id }` → `client_secret` (copy the memoized `createSetupIntent` from `AddCardSheet.tsx`), and `onSaved` = refetch the list, select the new card (`onSelect(pmId, 'card')`), close. Empty list → lead with the add panel. Do NOT use the legacy `HomeownerCardPicker`/`AddPaymentMethodPanel`.
- [ ] **Step 2: Verify** , `tsc`, `eslint`, conformance grep (no `#F7C41E`, no `primary-<number>`). Live check in Task 8.
- [ ] **Step 3: Commit** , "feat(redesign): booking card picker sheet (brand)".

---

## Task 7: Picks / Review / Sent views (presentational)

**Files:**
- Create: `src/components/redesign/homeowner/booking/BookingPicksView.tsx`
- Create: `src/components/redesign/homeowner/booking/BookingReviewView.tsx`
- Create: `src/components/redesign/homeowner/booking/BookingSentView.tsx`

**Interfaces:** (all presentational; state + handlers passed in from `BookingFlow`)
- `<BookingPicksView state property service onOpenProperty onOpenService onAddTime onRemoveTime(idx) onNotesChange onReview />` , renders the picks page (mirror the mockup + `HomeownerCleaningDetail` field styling): Home row (property?.name/address or "Choose a home"), Service row (service name + price/duration or "Choose a service"), Preferred times as chips (`slotOrdinal` + `formatSlotLabel`, each removable) + an "Add a backup time" / "Add a time" row that calls `onAddTime`, a `Textarea` for notes, and a footer `Button` "Review request" disabled unless `canReview(state)`.
- `<BookingReviewView state property service paymentRequired card total onOpenCard onBack onSend submitting />` , summary card (Home, Service, Preferred [all slots], Notes if any), a payment row (only when `paymentRequired`: `paymentMethodTitle(card)` + "Charged when the job is done", tap `onOpenCard`), a total box using `bookingTotal(service.base_price, state.method)` (Service base, "Card processing fee" when `feeUsd > 0`, "Total when completed", and the line "You are not charged now" + a `Badge` "No upfront hold"), and a footer `Button` "Send request" (`loading={submitting}`, disabled unless `canSend(state, paymentRequired)`).
- `<BookingSentView onDone />` , centered success (check icon, "Request sent", "The office will confirm a time and assign your cleaner. You will get a notification.", a "Done" `Button` calling `onDone`).

- [ ] **Step 1:** Implement the three views from the design system (tokens + `ui/*`), copying field/label styling from `HomeownerCleaningDetail.tsx` and chip styling from the approved mockup (rebuilt, not copied hex). No em dashes; use "office".
- [ ] **Step 2: Verify** , `tsc`, `eslint`, conformance grep. Live check in Task 8.
- [ ] **Step 3: Commit** , "feat(redesign): booking picks + review + sent views".

---

## Task 8: BookingFlow container (assemble + replace the shell)

**Files:**
- Modify: `src/components/redesign/homeowner/booking/BookingFlow.tsx` (replace the Task 1 shell)

**Interfaces:**
- Consumes: everything from Tasks 2-7.
- Props unchanged from Task 1: `{ initialServiceTypeId, initialPropertyId, onClose }`.

- [ ] **Step 1: Implement `BookingFlow.tsx`:** a `MobileTakeover` (`ariaLabel="Request a cleaning"`, `keyboardAware`). Internal state: `const [state, setState] = useState<BookingState>({ ...EMPTY_BOOKING, propertyId: initialPropertyId, serviceTypeId: initialServiceTypeId })`; `const [page, setPage] = useState<'picks'|'review'|'sent'>('picks')`; four boolean sheet-open flags. Auto-select the single property when there is exactly one and none is set (effect over `useHomeownerProperties`). Resolve `property` and `service` objects from `useHomeownerProperties` + `useServices` for display. `paymentRequired = homeownerCardPickerAvailable()`. Wire the sheets (Property/Service/Time/Card) to update `state` (times via `addSlot`/`removeSlotAt`; card via `onSelect(pmId, method)` setting `paymentMethodId` + `method`). Render `BookingPicksView` (page picks), `BookingReviewView` (page review; `onSend` = `useSubmitBookingRequest().submit(state)` then `setPage('sent')` on success, `toast.error` on failure), `BookingSentView` (page sent; `onDone` = `close()` then `router.push` to `/app/homeowner-dashboard/cleanings`). Back on review returns to picks; back/close on picks calls `close`.
- [ ] **Step 2: Verify (full visual walkthrough on dev, phone viewport)** , open from Home + FAB + service detail (prefilled); pick property/service; add 2 times via the calendar sheet; add notes; Review; (payments on) add/select a card; Send; see the Sent view; land on Cleanings with the new pending request. Also verify the payments-off path (no card row/requirement). Screenshot each step for the user.
- [ ] **Step 3: Commit** , "feat(redesign): booking flow container (full request flow)".

---

## Task 9: Book again from a completed cleaning

**Files:**
- Modify: `src/components/redesign/homeowner/home/RecentCleaningCard.tsx` (add a "Book again" action on the interactive variant)
- Modify: `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx` (add a "Book again" button for completed cleanings)

**Interfaces:**
- Consumes: `useOpenBooking` (Task 1); the appointment's `property_id` + `service_type_id`.

- [ ] **Step 1:** In `HomeownerCleaningDetail.tsx`, when `appointment.status === 'completed'`, add a `Button variant="outline"` "Book again" (near the message buttons) calling `useOpenBooking()({ propertyId: appointment.property_id, serviceTypeId: appointment.service_type_id })` then `close()`. In `RecentCleaningCard.tsx` (the `interactive` branch only), add a small secondary "Book again" affordance in the footer that calls the same opener with the appointment's ids (stop propagation so it does not also trigger the card's open-detail). Confirm `Appointment` exposes `property_id` + `service_type_id` (add to the `useHomeownerAppointments` select if missing).
- [ ] **Step 2: Verify** , from a completed cleaning, "Book again" opens the flow with home + service pre-filled; the homeowner only picks a time. Screenshot.
- [ ] **Step 3: Commit** , "feat(redesign): Book again from a completed cleaning".

---

## Final (post-tasks)

- Run the full unit suite (`npx vitest run --project unit`) + `npx tsc --noEmit` + `npx eslint .` for the branch.
- `ui-ux-pro-max` implementation conformance pass over `src/components/redesign/homeowner/booking/**` (no raw hex / `primary-<number>` / em dashes / "operator"; 44px tap targets; reused primitives).
- Independent adversarial review over the whole branch (auth/tenancy of the reused route call, payload correctness, query invalidation, gating, sheet dismissal during Stripe confirm).
- Full mobile screenshot walkthrough for the user, then open the PR to master (user-gated merge).

## Self-Review

- **Spec coverage:** Flow C two pages + sheets (T7/T8), calendar sheet (T5), card required when payments on (T6/T8 via `homeownerCardPickerAvailable` + `canSend`), Book again (T9), entry points + prefill (T1), reuse of `/api/appointments/request` + fee math + request hook (T3/T2), no migration/route/RLS (constraints). All covered.
- **Placeholders:** none , pure logic and hooks carry full code; presentational tasks name the exact primitives/patterns to mirror and the exact copy.
- **Type consistency:** `BookingSlot {date,time}` used everywhere; mapped to `{scheduled_date,scheduled_time}` only in `toRequestPayload`. `method: 'card'|'us_bank_account'` matches `PaymentMethodKind`. `bookingTotal` takes dollars, converts to cents for `computeChargeBreakdown`.
