# Operator Booking Slice 2 (Recurring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reimagined "Repeat this cleaning" recurrence experience to the operator new-booking flow (Slice 1), so an operator can create a whole customer-billed series in one pass via the existing `POST /api/recurring-appointments`.

**Architecture:** Extend the existing single-component operator booking form (`OperatorBookingForm.tsx`) with a toggle-revealed, preset-driven recurrence section (customer-billed only). All recurrence math is pure and unit-tested; the create path branches to the existing recurring route (Bearer POST) for a series or the existing single-insert for a one-time booking. No migration, no new route, no backend change. The client date preview is timezone-safe so it matches the server's UTC generation exactly.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, design-system primitives in `src/components/ui/*`, `date-fns`, Vitest.

## Global Constraints

- **Design system only.** Implement from `src/components/ui/*` + tokens in `tailwind.config.js` / `src/app/globals.css`. Brand is `#0150FC` (referenced via `brand-*` / `primary` semantic classes only). NO raw hex, NO `primary-<number>` Tailwind classes (that ramp is legacy yellow), NO `#F7C41E`. Reuse the LOGIC of the legacy `AddAppointmentModal` recurrence form, never its styling.
- **No em dashes** (`—`) in any user-facing copy (labels, buttons, toasts, recap strings). Use periods, commas, parentheses, or "to" for ranges.
- **"Operator" is fine here** (this is an operator-facing surface). No cleaner/homeowner-facing copy is added in this slice.
- **No client import of `lib/supabase-admin.ts`.** The recurring create goes through `POST /api/recurring-appointments` with an `Authorization: Bearer <accessToken>` header (the route enforces org membership + role owner/admin/manager server-side).
- **Recurrence is customer-billed only.** The recurring route requires `homeownerId`; there is no self-pay recurring endpoint. The recurrence section is hidden when `billTo === 'self_pay'`, and `isRecurring()` returns false in self-pay.
- **No migration, no new route, no new schema.** Reuse `POST /api/recurring-appointments` and the pure `generateOccurrences` semantics.
- **Timezone-safe preview.** The shared `generateOccurrences` (`src/lib/appointments/recurrence.ts`) parses `new Date('YYYY-MM-DD')` as UTC midnight but formats with local getters, so calling it client-side in a US (negative-offset) timezone drifts one day earlier than the server (UTC) creates. The client preview MUST be timezone-safe (parse at local noon) so its date strings equal the server's UTC-generated dates.
- **UI implementation source:** the browser-companion mockups are UX/structure reference only. See `docs/superpowers/specs/2026-07-02-operator-new-booking-flow-design.md` (Slice 2 sections). Run `ui-ux-pro-max` at implementation for design-system conformance.

---

## File Structure

- **Modify** `src/components/redesign/bookings/new-booking/operator-booking-types.ts` — add the recurrence types + `recurrence` field + `DEFAULT_RECURRENCE`.
- **Create** `src/components/redesign/bookings/new-booking/deriveRecurrence.ts` — pure: cadence/end resolvers, TZ-safe `previewOccurrences`, `recurrenceRecap`, `isRecurring`, `parseYmdLocalNoon`, `weekdayOfYmd`, `cadencePhrase`.
- **Create** `src/components/redesign/bookings/new-booking/deriveRecurrence.test.ts` — unit tests for the above.
- **Create** `src/components/redesign/bookings/new-booking/buildRecurringPayload.ts` — pure: `OperatorBookingState` -> `CreateRecurringPayload` (mirrors the route contract).
- **Create** `src/components/redesign/bookings/new-booking/buildRecurringPayload.test.ts` — unit tests.
- **Modify** `src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts` — add shared `cardIdFromPaymentValue` + `canCreateBooking`.
- **Modify** `src/components/redesign/bookings/new-booking/buildBookingInsert.ts` — use the shared `cardIdFromPaymentValue` (behavior-identical).
- **Modify** `src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts` — branch single vs recurring; new return type `{ recurring, count }`.
- **Create** `src/components/redesign/bookings/new-booking/RecurrenceSection.tsx` — the design-system recurrence UI.
- **Modify** `src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx` — mount the section (customer-billed), recurrence-aware review + footer + create.

## Reference contract (verified from source)

`POST /api/recurring-appointments` request body (`src/app/api/recurring-appointments/route.ts:19-40`):

```typescript
interface CreateRecurringAppointmentInput {
  organizationId: string;          // REQUIRED
  homeownerId: string;             // REQUIRED (no self-pay recurring)
  cleanerId?: string | null;
  propertyId: string;              // REQUIRED
  serviceTypeId: string;           // REQUIRED
  checklistId?: string | null;
  startDate: string;               // YYYY-MM-DD
  startTime: string;               // HH:mm
  durationMinutes: number;         // > 0
  totalPrice: number;
  priceOverrideEnabled?: boolean;
  priceOverrideTotal?: number | null;
  recurrenceType: 'daily' | 'weekly' | 'monthly';
  interval: number;                // > 0 (every N)
  daysOfWeek?: number[];           // weekly only; 0=Sun..6=Sat
  endDate?: string | null;         // YYYY-MM-DD; clamped to 6-month horizon
  maxOccurrences?: number | null;  // clamped to 50
  specialRequests?: string | null;
  status?: string;                 // defaults 'pending'
  paymentMethodId?: string | null;
}
```

Auth: `Authorization: Bearer <token>`; role in `['owner','admin','manager']`; org membership. Server generates occurrences (caps: 50 / 6 months) via the pure `generateOccurrences` and bulk-inserts N `appointments` (each `series_id`, `cleaner_confirmation_status:'awaiting'`, own `response_deadline`). Success: `{ success: true, data: { series, appointmentsCreated, appointments } }`. Error: `{ success: false, error }` with 400/401/403/500.

Legacy payload mapping to mirror (`AddAppointmentModal.tsx:1104-1132`): `daysOfWeek` sent only for weekly (else `undefined`); `endDate` only for the on-date end (else `null`); `maxOccurrences` only for the after-N end (else `null`); `status:'pending'`; `paymentMethodId` is a concrete card id or null.

---

### Task 1: Recurrence state + TZ-safe preview generator + recap (pure)

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/operator-booking-types.ts`
- Create: `src/components/redesign/bookings/new-booking/deriveRecurrence.ts`
- Test: `src/components/redesign/bookings/new-booking/deriveRecurrence.test.ts`

**Interfaces:**
- Consumes: `OperatorBookingState`, `isSelfPay` (from `deriveOperatorBooking.ts`), `OccurrenceInput` + `getRecurrenceDescription` (from `@/lib/appointments/recurrence`), `formatTimeTo12h` (from `@/lib/formatTime`).
- Produces:
  - Types `CadencePreset = 'weekly'|'biweekly'|'every4'|'custom'`, `RecurrenceEnd = 'after'|'on_date'|'keep_going'`, `CustomRecurrenceType = 'daily'|'weekly'|'monthly'`, interface `OperatorRecurrence`, const `DEFAULT_RECURRENCE`, and `recurrence: OperatorRecurrence` on `OperatorBookingState` + in `EMPTY_OPERATOR_BOOKING`.
  - Functions `parseYmdLocalNoon(ymd: string): Date`, `weekdayOfYmd(ymd: string): number`, `isRecurring(s: OperatorBookingState): boolean`, `resolveCadence(rec, startYmd): { recurrenceType: CustomRecurrenceType; interval: number; daysOfWeek: number[] | undefined }`, `resolveEnd(rec): { endDate: string | null; maxOccurrences: number | null }`, `buildOccurrenceInput(s, durationMinutes): OccurrenceInput | null`, `previewOccurrences(input: OccurrenceInput): string[]`, `cadencePhrase(rec, startYmd): string`, `recurrenceRecap(rec, startYmd, startTime, dates): string`.

- [ ] **Step 1: Extend the state types.** In `operator-booking-types.ts`, add above `MAX_OPERATOR_SLOTS`:

```typescript
export type CadencePreset = 'weekly' | 'biweekly' | 'every4' | 'custom';
export type RecurrenceEnd = 'after' | 'on_date' | 'keep_going';
export type CustomRecurrenceType = 'daily' | 'weekly' | 'monthly';

export interface OperatorRecurrence {
  enabled: boolean;
  preset: CadencePreset;
  /** Only used when preset === 'custom'. */
  customType: CustomRecurrenceType;
  /** Only used when preset === 'custom'. Every N days/weeks/months. */
  customInterval: number;
  /** Explicit weekly day selection (0=Sun..6=Sat). Empty means "default to the start date's weekday". */
  daysOfWeek: number[];
  end: RecurrenceEnd;
  /** For end === 'after'. */
  count: number;
  /** For end === 'on_date' (YYYY-MM-DD). */
  endDate: string | null;
}

export const DEFAULT_RECURRENCE: OperatorRecurrence = {
  enabled: false,
  preset: 'weekly',
  customType: 'weekly',
  customInterval: 2,
  daysOfWeek: [],
  end: 'after',
  count: 8,
  endDate: null,
};
```

Add `recurrence: OperatorRecurrence;` to `OperatorBookingState` (after `method`), and `recurrence: DEFAULT_RECURRENCE,` to `EMPTY_OPERATOR_BOOKING`.

- [ ] **Step 2: Write the failing tests.** Create `deriveRecurrence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';
import {
  isRecurring,
  weekdayOfYmd,
  resolveCadence,
  resolveEnd,
  buildOccurrenceInput,
  previewOccurrences,
  cadencePhrase,
  recurrenceRecap,
} from './deriveRecurrence';

// 2026-07-20 is a Monday (weekday 1) in every timezone.
const MON = '2026-07-20';

function withRec(partial: Partial<OperatorBookingState['recurrence']>, base?: Partial<OperatorBookingState>): OperatorBookingState {
  return {
    ...EMPTY_OPERATOR_BOOKING,
    customerId: 'cust-1',
    slots: [{ date: MON, time: '10:00' }],
    ...base,
    recurrence: { ...EMPTY_OPERATOR_BOOKING.recurrence, ...partial },
  };
}

describe('isRecurring', () => {
  it('is false when disabled', () => {
    expect(isRecurring(withRec({ enabled: false }))).toBe(false);
  });
  it('is true when enabled and customer-billed', () => {
    expect(isRecurring(withRec({ enabled: true }))).toBe(true);
  });
  it('is false in self-pay even when enabled', () => {
    expect(isRecurring(withRec({ enabled: true }, { billTo: 'self_pay' }))).toBe(false);
  });
});

describe('weekdayOfYmd (TZ-safe)', () => {
  it('returns Monday for 2026-07-20 regardless of timezone', () => {
    expect(weekdayOfYmd('2026-07-20')).toBe(1);
  });
});

describe('resolveCadence', () => {
  it('weekly preset -> weekly interval 1, day defaults to start weekday', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'weekly' }, MON)).toEqual({
      recurrenceType: 'weekly', interval: 1, daysOfWeek: [1],
    });
  });
  it('biweekly preset -> weekly interval 2', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'biweekly' }, MON).interval).toBe(2);
  });
  it('every4 preset -> weekly interval 4', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'every4' }, MON).interval).toBe(4);
  });
  it('explicit daysOfWeek override the default and are sorted', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'weekly', daysOfWeek: [5, 1] }, MON).daysOfWeek).toEqual([1, 5]);
  });
  it('custom monthly -> daysOfWeek undefined', () => {
    const r = resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'custom', customType: 'monthly', customInterval: 3 }, MON);
    expect(r).toEqual({ recurrenceType: 'monthly', interval: 3, daysOfWeek: undefined });
  });
});

describe('resolveEnd', () => {
  it('after -> maxOccurrences set, endDate null', () => {
    expect(resolveEnd({ ...EMPTY_OPERATOR_BOOKING.recurrence, end: 'after', count: 6 })).toEqual({ endDate: null, maxOccurrences: 6 });
  });
  it('on_date -> endDate set, maxOccurrences null', () => {
    expect(resolveEnd({ ...EMPTY_OPERATOR_BOOKING.recurrence, end: 'on_date', endDate: '2026-09-01' })).toEqual({ endDate: '2026-09-01', maxOccurrences: null });
  });
  it('keep_going -> both null', () => {
    expect(resolveEnd({ ...EMPTY_OPERATOR_BOOKING.recurrence, end: 'keep_going' })).toEqual({ endDate: null, maxOccurrences: null });
  });
});

describe('previewOccurrences (TZ-safe, matches server UTC output)', () => {
  it('weekly, after 4, keeps the exact start date string', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'weekly', end: 'after', count: 4 }), 120)!;
    const dates = previewOccurrences(input);
    expect(dates).toEqual(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']);
  });
  it('biweekly, after 3', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'biweekly', end: 'after', count: 3 }), 120)!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-08-03', '2026-08-17']);
  });
  it('custom monthly interval 1, after 3', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'custom', customType: 'monthly', customInterval: 1, end: 'after', count: 3 }), 120)!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-08-20', '2026-09-20']);
  });
  it('respects the on-date end (inclusive)', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'weekly', end: 'on_date', endDate: '2026-08-03' }), 120)!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03']);
  });
  it('caps keep-going at 50 occurrences', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'custom', customType: 'daily', customInterval: 1, end: 'keep_going' }), 120)!;
    expect(previewOccurrences(input).length).toBe(50);
  });
});

describe('recurrenceRecap', () => {
  it('composes cadence + time + count + range with no em dashes', () => {
    const rec = { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true, preset: 'biweekly' as const, daysOfWeek: [1] };
    const dates = ['2026-07-20', '2026-08-03', '2026-08-17'];
    const recap = recurrenceRecap(rec, MON, '10:00', dates);
    expect(recap).toBe('Every 2 weeks on Mondays at 10:00 AM. 3 cleanings, Jul 20 to Aug 17.');
    expect(recap).not.toContain('—');
  });
  it('singularizes a single cleaning', () => {
    const rec = { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true, preset: 'weekly' as const };
    expect(recurrenceRecap(rec, MON, '09:00', ['2026-07-20'])).toBe('Every week on Mondays at 9:00 AM. 1 cleaning, Jul 20.');
  });
});

describe('cadencePhrase', () => {
  it('weekly interval 1', () => {
    expect(cadencePhrase({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'weekly' }, MON)).toBe('Every week on Mondays');
  });
  it('custom daily interval 3', () => {
    expect(cadencePhrase({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'custom', customType: 'daily', customInterval: 3 }, MON)).toBe('Every 3 days');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.** Run: `npm run test:unit -- deriveRecurrence` — Expected: FAIL ("Cannot find module './deriveRecurrence'").

- [ ] **Step 4: Implement `deriveRecurrence.ts`:**

```typescript
import type { OccurrenceInput } from '@/lib/appointments/recurrence';
import { formatTimeTo12h } from '@/lib/formatTime';
import type { OperatorBookingState, OperatorRecurrence, CustomRecurrenceType } from './operator-booking-types';
import { isSelfPay } from './deriveOperatorBooking';

const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MAX_OCCURRENCES_CAP = 50;
const MAX_HORIZON_MONTHS = 6;

/** Parse a YYYY-MM-DD as a LOCAL date at noon. TZ-safe: avoids the UTC-midnight day-shift so the
 *  produced date strings match the server's UTC generation across US (negative-offset) timezones. */
export function parseYmdLocalNoon(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function weekdayOfYmd(ymd: string): number {
  return parseYmdLocalNoon(ymd).getDay();
}

export function isRecurring(s: OperatorBookingState): boolean {
  return !isSelfPay(s) && s.recurrence.enabled;
}

export function resolveCadence(
  rec: OperatorRecurrence,
  startYmd: string,
): { recurrenceType: CustomRecurrenceType; interval: number; daysOfWeek: number[] | undefined } {
  let recurrenceType: CustomRecurrenceType;
  let interval: number;
  if (rec.preset === 'weekly') { recurrenceType = 'weekly'; interval = 1; }
  else if (rec.preset === 'biweekly') { recurrenceType = 'weekly'; interval = 2; }
  else if (rec.preset === 'every4') { recurrenceType = 'weekly'; interval = 4; }
  else { recurrenceType = rec.customType; interval = Math.max(1, rec.customInterval); }

  if (recurrenceType === 'weekly') {
    const days = rec.daysOfWeek.length > 0 ? [...rec.daysOfWeek].sort((a, b) => a - b) : [weekdayOfYmd(startYmd)];
    return { recurrenceType, interval, daysOfWeek: days };
  }
  return { recurrenceType, interval, daysOfWeek: undefined };
}

export function resolveEnd(rec: OperatorRecurrence): { endDate: string | null; maxOccurrences: number | null } {
  if (rec.end === 'after') return { endDate: null, maxOccurrences: Math.max(1, rec.count) };
  if (rec.end === 'on_date') return { endDate: rec.endDate, maxOccurrences: null };
  return { endDate: null, maxOccurrences: null };
}

export function buildOccurrenceInput(s: OperatorBookingState, durationMinutes: number): OccurrenceInput | null {
  const primary = s.slots[0];
  if (!primary) return null;
  const { recurrenceType, interval, daysOfWeek } = resolveCadence(s.recurrence, primary.date);
  const { endDate, maxOccurrences } = resolveEnd(s.recurrence);
  return { startDate: primary.date, startTime: primary.time, durationMinutes, recurrenceType, interval, daysOfWeek, endDate, maxOccurrences };
}

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysLocal(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * TZ-safe client preview of the dates the server will generate. Deliberately mirrors the branch
 * logic of src/lib/appointments/recurrence.ts:generateOccurrences (same caps, same day-stepping)
 * but parses/steps at LOCAL noon so the produced YYYY-MM-DD strings equal the server's UTC output.
 * The shared generator is local-TZ-coupled (UTC-midnight parse + local format) and drifts a day in
 * the Americas, so it cannot be reused directly for a client preview.
 */
export function previewOccurrences(input: OccurrenceInput): string[] {
  const { startDate, recurrenceType, interval, daysOfWeek, endDate, maxOccurrences } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const start = parseYmdLocalNoon(startDate);
  const hardCap = new Date(start);
  hardCap.setMonth(hardCap.getMonth() + MAX_HORIZON_MONTHS);
  const userEnd = endDate ? parseYmdLocalNoon(endDate) : null;
  const cutoff = userEnd && userEnd < hardCap ? userEnd : hardCap;
  const cap = maxOccurrences ? Math.min(maxOccurrences, MAX_OCCURRENCES_CAP) : MAX_OCCURRENCES_CAP;
  const out: string[] = [];

  if (recurrenceType === 'daily') {
    let cur = start;
    while (cur <= cutoff && out.length < cap) { out.push(fmtLocal(cur)); cur = addDaysLocal(cur, interval); }
  } else if (recurrenceType === 'monthly') {
    let cur = start;
    while (cur <= cutoff && out.length < cap) { out.push(fmtLocal(cur)); const x = new Date(cur); x.setMonth(x.getMonth() + interval); cur = x; }
  } else {
    const active = daysOfWeek && daysOfWeek.length > 0 ? [...daysOfWeek].sort((a, b) => a - b) : [start.getDay()];
    let weekStart = start;
    let firstWeek = true;
    while (weekStart <= cutoff && out.length < cap) {
      for (const wd of active) {
        if (out.length >= cap) break;
        const target = addDaysLocal(weekStart, wd - weekStart.getDay());
        if (firstWeek && target < start) continue;
        if (target > cutoff) continue;
        out.push(fmtLocal(target));
      }
      firstWeek = false;
      weekStart = addDaysLocal(weekStart, 7 * interval);
    }
  }
  return out;
}

export function cadencePhrase(rec: OperatorRecurrence, startYmd: string): string {
  const { recurrenceType, interval, daysOfWeek } = resolveCadence(rec, startYmd);
  if (recurrenceType === 'daily') return interval === 1 ? 'Every day' : `Every ${interval} days`;
  if (recurrenceType === 'monthly') return interval === 1 ? 'Every month' : `Every ${interval} months`;
  const every = interval === 1 ? 'Every week' : `Every ${interval} weeks`;
  const days = (daysOfWeek ?? []).map((d) => DAY_PLURAL[d]).join(', ');
  return days ? `${every} on ${days}` : every;
}

function shortDate(ymd: string): string {
  return parseYmdLocalNoon(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** e.g. "Every 2 weeks on Mondays at 10:00 AM. 12 cleanings, Jul 20 to Dec 27." */
export function recurrenceRecap(rec: OperatorRecurrence, startYmd: string, startTime: string, dates: string[]): string {
  const phrase = cadencePhrase(rec, startYmd);
  const at = ` at ${formatTimeTo12h(startTime)}`;
  if (dates.length === 0) return `${phrase}${at}.`;
  const n = dates.length;
  const range = n === 1 ? shortDate(dates[0]) : `${shortDate(dates[0])} to ${shortDate(dates[n - 1])}`;
  return `${phrase}${at}. ${n} cleaning${n === 1 ? '' : 's'}, ${range}.`;
}
```

- [ ] **Step 5: Run the tests to verify they pass.** Run: `npm run test:unit -- deriveRecurrence` — Expected: PASS (all cases). Then `npx tsc --noEmit` (no new errors in these files) and `npm run lint` on the two changed/created files.

- [ ] **Step 6: Commit.**

```bash
git add src/components/redesign/bookings/new-booking/operator-booking-types.ts src/components/redesign/bookings/new-booking/deriveRecurrence.ts src/components/redesign/bookings/new-booking/deriveRecurrence.test.ts
git commit -m "feat(redesign): operator recurring state + TZ-safe occurrence preview (Slice 2 T1)"
```

---

### Task 2: Recurring payload builder + shared card-id helper (pure)

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts`
- Modify: `src/components/redesign/bookings/new-booking/buildBookingInsert.ts`
- Create: `src/components/redesign/bookings/new-booking/buildRecurringPayload.ts`
- Test: `src/components/redesign/bookings/new-booking/buildRecurringPayload.test.ts`

**Interfaces:**
- Consumes: `effectiveTotalUsd` (existing in `deriveOperatorBooking.ts`), `resolveCadence` + `resolveEnd` (Task 1), `ServiceType` (`@/hooks/useServices`), `OperatorBookingState`.
- Produces: `cardIdFromPaymentValue(v: string | null): string | null` (exported from `deriveOperatorBooking.ts`), `canCreateBooking(s: OperatorBookingState, occurrenceCount: number): boolean` (exported from `deriveOperatorBooking.ts`), interface `CreateRecurringPayload` + `buildRecurringPayload(organizationId, s, service): CreateRecurringPayload`.

- [ ] **Step 1: Add the shared helpers to `deriveOperatorBooking.ts`.** Append:

```typescript
/** The concrete saved-card id to charge, or null for a send-link / defer / no selection. */
export function cardIdFromPaymentValue(v: string | null): string | null {
  return v && v.startsWith('pm_') ? v : null;
}

/**
 * Whether the booking can be created, recurrence-aware. When the booking is a recurring series,
 * at least one occurrence must be generated by the current cadence + end.
 */
export function canCreateBooking(s: OperatorBookingState, occurrenceCount: number): boolean {
  if (!canCreate(s)) return false;
  if (isSelfPay(s)) return true;
  if (!s.recurrence.enabled) return true;
  return occurrenceCount >= 1;
}
```

(Note: `canCreateBooking` treats a non-recurring customer-billed booking as `canCreate`. `isRecurring` logic is inlined here via `s.recurrence.enabled && !isSelfPay` to avoid importing from `deriveRecurrence` and creating a cycle.)

- [ ] **Step 2: Point `buildBookingInsert.ts` at the shared helper (behavior-identical).** Replace the local `isCardId` function and its use:
  - Remove the `function isCardId(...) {...}` block (lines 5-8).
  - Add to the imports on line 2: `import { effectiveTotalUsd, isSelfPay, cardIdFromPaymentValue } from './deriveOperatorBooking';`
  - Change the `payment_method_id` line to: `payment_method_id: self ? null : cardIdFromPaymentValue(s.paymentValue),`

- [ ] **Step 3: Write the failing tests.** Create `buildRecurringPayload.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';
import { buildRecurringPayload } from './buildRecurringPayload';
import type { ServiceType } from '@/hooks/useServices';

const service = { id: 'svc-1', name: 'Regular Cleaning', base_price: 150, duration_minutes: 120, is_active: true } as ServiceType;
const MON = '2026-07-20';

function baseState(partial: Partial<OperatorBookingState['recurrence']>, over?: Partial<OperatorBookingState>): OperatorBookingState {
  return {
    ...EMPTY_OPERATOR_BOOKING,
    customerId: 'home-1',
    propertyId: 'prop-1',
    serviceTypeId: 'svc-1',
    checklistId: 'chk-1',
    cleanerId: 'clnr-1',
    slots: [{ date: MON, time: '10:00' }],
    notes: '  wipe the fridge  ',
    ...over,
    recurrence: { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true, ...partial },
  };
}

describe('buildRecurringPayload', () => {
  it('weekly preset, after N -> maxOccurrences set, endDate null, weekly daysOfWeek from start', () => {
    const p = buildRecurringPayload('org-1', baseState({ preset: 'weekly', end: 'after', count: 6 }), service);
    expect(p).toMatchObject({
      organizationId: 'org-1', homeownerId: 'home-1', cleanerId: 'clnr-1', propertyId: 'prop-1',
      serviceTypeId: 'svc-1', checklistId: 'chk-1', startDate: MON, startTime: '10:00',
      durationMinutes: 120, totalPrice: 150, recurrenceType: 'weekly', interval: 1,
      daysOfWeek: [1], endDate: null, maxOccurrences: 6, specialRequests: 'wipe the fridge',
      status: 'pending', priceOverrideEnabled: false, priceOverrideTotal: null,
    });
  });
  it('biweekly on-date end -> interval 2, endDate set, maxOccurrences null', () => {
    const p = buildRecurringPayload('org-1', baseState({ preset: 'biweekly', end: 'on_date', endDate: '2026-09-01' }), service);
    expect(p.interval).toBe(2);
    expect(p.endDate).toBe('2026-09-01');
    expect(p.maxOccurrences).toBeNull();
  });
  it('custom monthly -> daysOfWeek undefined', () => {
    const p = buildRecurringPayload('org-1', baseState({ preset: 'custom', customType: 'monthly', customInterval: 1, end: 'keep_going' }), service);
    expect(p.recurrenceType).toBe('monthly');
    expect(p.daysOfWeek).toBeUndefined();
    expect(p.endDate).toBeNull();
    expect(p.maxOccurrences).toBeNull();
  });
  it('price override flows through', () => {
    const p = buildRecurringPayload('org-1', baseState({ preset: 'weekly', end: 'after', count: 4 }, { priceOverride: 199 }), service);
    expect(p).toMatchObject({ totalPrice: 199, priceOverrideEnabled: true, priceOverrideTotal: 199 });
  });
  it('paymentMethodId is a concrete card only', () => {
    const withCard = buildRecurringPayload('org-1', baseState({}, { paymentValue: 'pm_abc' }), service);
    expect(withCard.paymentMethodId).toBe('pm_abc');
    const deferred = buildRecurringPayload('org-1', baseState({}, { paymentValue: 'defer' }), service);
    expect(deferred.paymentMethodId).toBeNull();
  });
  it('empty notes -> null specialRequests', () => {
    const p = buildRecurringPayload('org-1', baseState({}, { notes: '   ' }), service);
    expect(p.specialRequests).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail.** Run: `npm run test:unit -- buildRecurringPayload` — Expected: FAIL ("Cannot find module './buildRecurringPayload'").

- [ ] **Step 5: Implement `buildRecurringPayload.ts`:**

```typescript
import type { ServiceType } from '@/hooks/useServices';
import type { OperatorBookingState } from './operator-booking-types';
import { effectiveTotalUsd, cardIdFromPaymentValue } from './deriveOperatorBooking';
import { resolveCadence, resolveEnd } from './deriveRecurrence';

/** Mirrors the POST /api/recurring-appointments request body (route.ts:19-40). */
export interface CreateRecurringPayload {
  organizationId: string;
  homeownerId: string;
  cleanerId: string | null;
  propertyId: string;
  serviceTypeId: string;
  checklistId: string | null;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  totalPrice: number;
  priceOverrideEnabled: boolean;
  priceOverrideTotal: number | null;
  recurrenceType: 'daily' | 'weekly' | 'monthly';
  interval: number;
  daysOfWeek?: number[];
  endDate: string | null;
  maxOccurrences: number | null;
  specialRequests: string | null;
  status: string;
  paymentMethodId: string | null;
}

/**
 * Build the recurring-series payload from operator booking state. Customer-billed only (the route
 * requires homeownerId); callers gate on isRecurring(). Mirrors the legacy AddAppointmentModal POST:
 * daysOfWeek only for weekly; endDate only for on-date; maxOccurrences only for after-N; pending status.
 */
export function buildRecurringPayload(
  organizationId: string,
  s: OperatorBookingState,
  service: ServiceType,
): CreateRecurringPayload {
  const primary = s.slots[0];
  const { recurrenceType, interval, daysOfWeek } = resolveCadence(s.recurrence, primary.date);
  const { endDate, maxOccurrences } = resolveEnd(s.recurrence);
  return {
    organizationId,
    homeownerId: s.customerId as string,
    cleanerId: s.cleanerId,
    propertyId: s.propertyId as string,
    serviceTypeId: s.serviceTypeId as string,
    checklistId: s.checklistId,
    startDate: primary.date,
    startTime: primary.time,
    durationMinutes: service.duration_minutes,
    totalPrice: effectiveTotalUsd(s, service),
    priceOverrideEnabled: s.priceOverride != null,
    priceOverrideTotal: s.priceOverride,
    recurrenceType,
    interval,
    daysOfWeek: recurrenceType === 'weekly' ? daysOfWeek : undefined,
    endDate,
    maxOccurrences,
    specialRequests: s.notes.trim() ? s.notes.trim() : null,
    status: 'pending',
    paymentMethodId: cardIdFromPaymentValue(s.paymentValue),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass, and re-run the neighbor test.** Run: `npm run test:unit -- buildRecurringPayload buildBookingInsert deriveOperatorBooking` — Expected: PASS (new payload tests + the existing `buildBookingInsert` tests still green after the helper swap). Then `npx tsc --noEmit` + `npm run lint` on the changed files.

- [ ] **Step 7: Commit.**

```bash
git add src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts src/components/redesign/bookings/new-booking/buildBookingInsert.ts src/components/redesign/bookings/new-booking/buildRecurringPayload.ts src/components/redesign/bookings/new-booking/buildRecurringPayload.test.ts
git commit -m "feat(redesign): operator recurring payload builder + shared card-id helper (Slice 2 T2)"
```

---

### Task 3: Recurring create branch in `useCreateOperatorBooking`

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts`

**Interfaces:**
- Consumes: `accessToken` (from `useAuth()`), `isRecurring` (Task 1), `buildRecurringPayload` (Task 2), existing single-insert path.
- Produces: `create` now resolves to `{ recurring: boolean; count: number }` (was `string`).

- [ ] **Step 1: Rewrite the mutation to branch.** Replace the body of `useCreateOperatorBooking.ts` with:

```typescript
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import type { ServiceType } from '@/hooks/useServices';
import { buildBookingInsert } from './buildBookingInsert';
import { buildRecurringPayload } from './buildRecurringPayload';
import { isRecurring } from './deriveRecurrence';
import type { OperatorBookingState } from './operator-booking-types';

export interface CreateBookingResult {
  recurring: boolean;
  count: number;
}

/**
 * Create an operator booking. A one-time booking inserts an `appointments` row (+ offered slots) via
 * the anon RLS client, mirroring the legacy AddAppointmentModal. A recurring booking (customer-billed
 * only) POSTs to the existing /api/recurring-appointments with a Bearer token; the route enforces
 * org membership + role and generates the series. No new route/schema.
 */
export function useCreateOperatorBooking() {
  const { currentOrganizationId, accessToken } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      state,
      service,
    }: {
      state: OperatorBookingState;
      service: ServiceType;
    }): Promise<CreateBookingResult> => {
      if (!currentOrganizationId) throw new Error('No organization');

      if (isRecurring(state)) {
        if (!accessToken) throw new Error('Not authenticated');
        const payload = buildRecurringPayload(currentOrganizationId, state, service);
        const res = await fetch('/api/recurring-appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Could not create the recurring series');
        }
        return { recurring: true, count: json.data?.appointmentsCreated ?? 0 };
      }

      const primary = state.slots[0];
      const deadline = computeResponseDeadlineISO(primary.date, primary.time);
      const { appointment, slots } = buildBookingInsert(currentOrganizationId, state, service, deadline);

      const { data, error } = await supabase
        .from('appointments')
        .insert(appointment)
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not create the booking');
      const appointmentId = (data as { id: string }).id;

      if (slots.length > 1) {
        const slotRows = slots.map((sl) => ({ appointment_id: appointmentId, ...sl }));
        await supabase.from('appointment_requested_slots').insert(slotRows);
      }

      return { recurring: false, count: 1 };
    },
    onSuccess: () => {
      if (currentOrganizationId) {
        queryClient.invalidateQueries({ queryKey: keys.appointments.byOrg(currentOrganizationId) });
      }
    },
  });

  return { create: mutation.mutateAsync, creating: mutation.isPending };
}
```

- [ ] **Step 2: Type-check and lint.** Run: `npx tsc --noEmit` — Expected: the only errors are the pre-existing ones unrelated to this file, PLUS a type error in `OperatorBookingForm.tsx` where `handleCreate` still treats the result as a string (that is fixed in Task 5; note it and proceed). Run `npm run lint` on the changed file. Confirm `OperatorBookingForm.tsx` is the ONLY new type error (Task 5 resolves it).

- [ ] **Step 3: Commit.**

```bash
git add src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts
git commit -m "feat(redesign): recurring vs single create branch in useCreateOperatorBooking (Slice 2 T3)"
```

---

### Task 4: RecurrenceSection component (design-system UI)

**Files:**
- Create: `src/components/redesign/bookings/new-booking/RecurrenceSection.tsx`

**Interfaces:**
- Consumes: primitives `Switch` (`@/components/ui/switch`), `Button` (`@/components/ui/button`), `Select` family (`@/components/ui/select`), `RadioGroup`/`RadioGroupItem` (`@/components/ui/radio-group`), `Input` (`@/components/ui/input`), `Badge` (`@/components/ui/badge`); helpers `recurrenceRecap`, `weekdayOfYmd`, `parseYmdLocalNoon`, `resolveCadence` (Task 1); types `OperatorRecurrence`, `OperatorBookingSlot`, `CadencePreset`, `RecurrenceEnd`, `CustomRecurrenceType`.
- Produces: `RecurrenceSection` React component with props `{ value: OperatorRecurrence; startSlot: OperatorBookingSlot | null; occurrences: string[]; onChange: (patch: Partial<OperatorRecurrence>) => void }`.

- [ ] **Step 1: Inspect two primitives to match their APIs.** Read `src/components/ui/switch.tsx`, `src/components/ui/radio-group.tsx`, and `src/components/ui/select.tsx` to confirm the exact prop names (`checked`/`onCheckedChange` on Switch; `value`/`onValueChange` + `RadioGroupItem value` on RadioGroup; `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` on Select). Also open a sibling redesign screen that already uses `Select`/`RadioGroup` (grep `src/components/redesign` for `SelectTrigger` and `RadioGroupItem`) and follow that usage pattern.

- [ ] **Step 2: Implement `RecurrenceSection.tsx`.** Build from the design system (no raw hex, no `primary-<number>`). Structure:
  - A header row: a bold section label "Repeat this cleaning" + a `Switch` (`checked={value.enabled}`, `onCheckedChange={(v) => onChange({ enabled: v })}`).
  - When `value.enabled`:
    - If `!startSlot`, render a muted hint `Pick a date and time first to set up a repeat.` and nothing else.
    - Else:
      - **Cadence** as a segmented row of four `Button`s (Weekly / Every 2 weeks / Every 4 weeks / Custom). The active one uses `variant="default"` (brand), the others `variant="outline"`. Clicking sets `{ preset }` (map labels: Weekly->'weekly', Every 2 weeks->'biweekly', Every 4 weeks->'every4', Custom->'custom').
      - **Custom controls** (only when `preset === 'custom'`): a `Select` for `customType` (Daily/Weekly/Monthly) + a numeric `Input` (min 1, max 12) for `customInterval`. The unit word next to it reflects the type ("days"/"weeks"/"months").
      - **Day chips** (only when the resolved cadence is weekly, i.e. `preset !== 'custom' || customType === 'weekly'`): seven pill buttons Sun..Sat. Highlight the effective set (`value.daysOfWeek.length ? value.daysOfWeek : [weekdayOfYmd(startSlot.date)]`). Toggling a day sets an explicit `daysOfWeek` array (add/remove the index; keep it sorted). Never allow removing the last day (if toggling would empty it, keep at least that day selected).
      - **Ends** as a `RadioGroup` with three options:
        - `after` — label "After" + an inline numeric `Input` (min 1, max 50) bound to `value.count`, then the word "cleanings".
        - `on_date` — label "On date" + an inline date `Input type="date"` bound to `value.endDate` (min = `startSlot.date`).
        - `keep_going` — label "Keep going" + a muted "up to 6 months".
        Only the active row shows its inline control.
      - **Recap + preview**: a soft card (`rounded-card border border-border bg-muted/40 p-3`) containing:
        - The recap line: `recurrenceRecap(value, startSlot.date, startSlot.time, occurrences)` in `text-sm font-semibold`.
        - The first five dates as `Badge variant="secondary"` chips (format each with `parseYmdLocalNoon(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })`), plus a trailing muted `+N more` chip when `occurrences.length > 5`.
        - If `occurrences.length === 0`, render a `text-critical` note: `This repeat does not produce any cleanings. Adjust the days or the end.`
  - Copy must contain no em dashes.

  Reference skeleton (fill in per the primitives' real APIs from Step 1):

```tsx
'use client';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CadencePreset, CustomRecurrenceType, OperatorBookingSlot, OperatorRecurrence, RecurrenceEnd } from './operator-booking-types';
import { recurrenceRecap, resolveCadence, weekdayOfYmd, parseYmdLocalNoon } from './deriveRecurrence';

const PRESETS: { key: CadencePreset; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'every4', label: 'Every 4 weeks' },
  { key: 'custom', label: 'Custom' },
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RecurrenceSection({
  value,
  startSlot,
  occurrences,
  onChange,
}: {
  value: OperatorRecurrence;
  startSlot: OperatorBookingSlot | null;
  occurrences: string[];
  onChange: (patch: Partial<OperatorRecurrence>) => void;
}) {
  const isWeekly = value.preset !== 'custom' || value.customType === 'weekly';
  const effectiveDays = value.daysOfWeek.length > 0 ? value.daysOfWeek : startSlot ? [weekdayOfYmd(startSlot.date)] : [];

  function toggleDay(idx: number) {
    const current = value.daysOfWeek.length > 0 ? value.daysOfWeek : effectiveDays;
    const next = current.includes(idx) ? current.filter((d) => d !== idx) : [...current, idx];
    onChange({ daysOfWeek: (next.length === 0 ? current : next).slice().sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-3 rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">Repeat this cleaning</span>
        <Switch checked={value.enabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label="Repeat this cleaning" />
      </div>

      {value.enabled && !startSlot && (
        <p className="text-sm text-muted-foreground">Pick a date and time first to set up a repeat.</p>
      )}

      {value.enabled && startSlot && (
        <div className="space-y-4">
          {/* Cadence presets */}
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                type="button"
                variant={value.preset === p.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => onChange({ preset: p.key })}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Custom controls */}
          {value.preset === 'custom' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every</span>
              <Input
                type="number"
                min={1}
                max={12}
                value={value.customInterval}
                onChange={(e) => onChange({ customInterval: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                className="w-20"
              />
              <Select value={value.customType} onValueChange={(v) => onChange({ customType: v as CustomRecurrenceType })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">days</SelectItem>
                  <SelectItem value="weekly">weeks</SelectItem>
                  <SelectItem value="monthly">months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Day chips (weekly) */}
          {isWeekly && (
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((d, idx) => {
                const on = effectiveDays.includes(idx);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={
                      'rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ' +
                      (on ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}

          {/* Ends */}
          <RadioGroup value={value.end} onValueChange={(v) => onChange({ end: v as RecurrenceEnd })} className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="after" /> <span>After</span>
              {value.end === 'after' && (
                <>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={value.count}
                    onChange={(e) => onChange({ count: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                    className="w-20"
                  />
                  <span className="text-muted-foreground">cleanings</span>
                </>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="on_date" /> <span>On date</span>
              {value.end === 'on_date' && (
                <Input
                  type="date"
                  min={startSlot.date}
                  value={value.endDate ?? ''}
                  onChange={(e) => onChange({ endDate: e.target.value || null })}
                  className="w-44"
                />
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="keep_going" /> <span>Keep going</span>
              {value.end === 'keep_going' && <span className="text-muted-foreground">up to 6 months</span>}
            </label>
          </RadioGroup>

          {/* Recap + preview */}
          <div className="space-y-2 rounded-card border border-border bg-muted/40 p-3">
            <p className="text-sm font-semibold">{recurrenceRecap(value, startSlot.date, startSlot.time, occurrences)}</p>
            {occurrences.length === 0 ? (
              <p className="text-xs font-medium text-critical">This repeat does not produce any cleanings. Adjust the days or the end.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {occurrences.slice(0, 5).map((d) => (
                  <Badge key={d} variant="secondary">
                    {parseYmdLocalNoon(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Badge>
                ))}
                {occurrences.length > 5 && <Badge variant="secondary">+{occurrences.length - 5} more</Badge>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify the `Badge` variant + `brand-600` chip class exist.** Confirm `Badge` supports `variant="secondary"` (grep `badge.tsx`); if not, use the closest neutral variant. Confirm `bg-brand-600` is used elsewhere in the new-booking folder (it is, in `OperatorBookingForm.tsx` bill-to toggle) so the day-chip active state matches the existing pattern.

- [ ] **Step 4: Type-check + lint + conformance.** Run: `npx tsc --noEmit` (no new errors from this file) and `npm run lint` on it. Run the conformance grep: `grep -nE "#[0-9A-Fa-f]{6}|primary-[0-9]|F7C41E|—" src/components/redesign/bookings/new-booking/RecurrenceSection.tsx` — Expected: empty.

- [ ] **Step 5: Commit.**

```bash
git add src/components/redesign/bookings/new-booking/RecurrenceSection.tsx
git commit -m "feat(redesign): RecurrenceSection design-system UI (Slice 2 T4)"
```

---

### Task 5: Wire RecurrenceSection into the form + recurrence-aware review/footer/create

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx`

**Interfaces:**
- Consumes: `RecurrenceSection` (Task 4), `isRecurring`, `buildOccurrenceInput`, `previewOccurrences`, `recurrenceRecap` (Task 1), `canCreateBooking` (Task 2), the new `create` return shape `{ recurring, count }` (Task 3).
- Produces: no new exports (internal wiring only).

- [ ] **Step 1: Add recurrence imports + derived occurrences.** In `OperatorBookingForm.tsx`:
  - Add imports:

```typescript
import { RecurrenceSection } from './RecurrenceSection';
import { isRecurring, buildOccurrenceInput, previewOccurrences, recurrenceRecap } from './deriveRecurrence';
import { canCreateBooking } from './deriveOperatorBooking';
```

  - After `const total = effectiveTotalUsd(state, service);` add:

```typescript
const recurring = isRecurring(state);
const occurrences = useMemo(() => {
  if (!recurring || !service) return [];
  const input = buildOccurrenceInput(state, service.duration_minutes);
  return input ? previewOccurrences(input) : [];
}, [recurring, state, service]);
const primarySlot = state.slots[0] ?? null;
```

- [ ] **Step 2: Reset recurrence on a bill-to flip to self-pay.** Change the bill-to toggle's `onClick` to also reset the recurrence sub-object so a customer-configured repeat cannot leak into self-pay:

```tsx
onClick={() => patch({ billTo: b, customerId: null, propertyId: null, cleanerId: null, recurrence: EMPTY_OPERATOR_BOOKING.recurrence })}
```

- [ ] **Step 3: Drop alternates + hide the alternate affordance when recurring.** In the "Times" block, change the add-slot guard so alternates only appear for a one-time booking:

```tsx
{state.slots.length < 3 && !recurring && (
  <TimePickerPopover
    label={state.slots.length === 0 ? 'Add a time' : 'Add an alternate'}
    onAdd={(slot) => patch({ slots: addSlot(state.slots, slot) })}
  />
)}
{state.slots.length === 0 && recurring && (
  <TimePickerPopover label="Add a time" onAdd={(slot) => patch({ slots: addSlot(state.slots, slot) })} />
)}
```

  (When recurring, only the first slot is used; the label stays "Add a time" and alternates are suppressed.)

- [ ] **Step 4: Render `RecurrenceSection` (customer-billed only), right after the Times block and before the Cleaner block:**

```tsx
{!self && (
  <RecurrenceSection
    value={state.recurrence}
    startSlot={primarySlot}
    occurrences={occurrences}
    onChange={(p) => patch({ recurrence: { ...state.recurrence, ...p } })}
  />
)}
```

- [ ] **Step 5: Make the form footer recurrence-aware.** Replace the form footer button block:

```tsx
<div className="flex shrink-0 items-center gap-3 border-t border-border p-4">
  <span className="shrink-0 text-lg font-extrabold tabular-nums">{money(total)}</span>
  <Button className="flex-1" disabled={!canReview(state)} onClick={() => setPage('review')}>
    {recurring ? 'Review & create' : 'Review & create'}
  </Button>
</div>
```

  (Keep the label "Review & create" for both; the count is confirmed on the review step. The `money(total)` badge stays the per-cleaning price.)

- [ ] **Step 6: Make the review page recurrence-aware.** In the review card, when `recurring`, replace the single "Preferred times" row with a "Starts" row (the primary slot only) and add a "Repeats" row + a "Cleanings" row; keep the "Total" row labeled per-cleaning. Concretely, swap the existing `<ReviewRow label="Preferred times">...</ReviewRow>` for:

```tsx
{recurring ? (
  <>
    <ReviewRow label="Starts">{primarySlot ? formatSlotLabel(primarySlot) : '-'}</ReviewRow>
    <ReviewRow label="Repeats">
      <span className="text-right">
        {primarySlot ? recurrenceRecap(state.recurrence, primarySlot.date, primarySlot.time, occurrences) : '-'}
      </span>
    </ReviewRow>
    <ReviewRow label="Cleanings">{occurrences.length}</ReviewRow>
  </>
) : (
  <ReviewRow label="Preferred times">
    <span className="flex flex-col items-end gap-0.5">
      {state.slots.map((s, i) => (
        <span key={i}>
          <span className="text-muted-foreground">{slotOrdinal(i)} </span>
          {formatSlotLabel(s)}
        </span>
      ))}
    </span>
  </ReviewRow>
)}
```

  And change the Total row label/value when recurring to make the per-cleaning basis explicit:

```tsx
<ReviewRow label={recurring ? 'Total each' : 'Total'}>{money(total)}</ReviewRow>
```

- [ ] **Step 7: Update the review footer create button + toast for a series.** Change the review footer create button:

```tsx
<Button
  className="flex-1"
  loading={creating}
  disabled={!canCreateBooking(state, occurrences.length)}
  onClick={handleCreate}
>
  {recurring ? `Create ${occurrences.length} cleaning${occurrences.length === 1 ? '' : 's'}` : 'Create booking'}
</Button>
```

  And update `handleCreate` to consume the new result shape:

```tsx
async function handleCreate() {
  if (!service) return;
  try {
    const result = await create({ state, service });
    toast.success(
      result.recurring ? `${result.count} cleaning${result.count === 1 ? '' : 's'} scheduled` : 'Booking created',
      {
        description: result.recurring
          ? 'The cleaner has been offered the whole series.'
          : 'The cleaner has been offered this job.',
      },
    );
    onDone();
  } catch (e) {
    toast.error('Could not create the booking', {
      description: e instanceof Error ? e.message : undefined,
    });
  }
}
```

- [ ] **Step 8: Type-check, lint, conformance, unit suite.** Run: `npx tsc --noEmit` (the Task 3 type error in this file is now resolved; no new errors) then `npm run lint` on the file, then `grep -nE "#[0-9A-Fa-f]{6}|primary-[0-9]|F7C41E|—" src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx` (Expected: empty), then `npm run test:unit -- new-booking` (Expected: all booking unit tests pass).

- [ ] **Step 9: Commit.**

```bash
git add src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx
git commit -m "feat(redesign): wire recurrence into operator booking form + review (Slice 2 T5)"
```

---

### Task 6: Conformance pass + visual verification + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run the ui-ux-pro-max implementation-phase check** over the new/changed files (`RecurrenceSection.tsx`, `OperatorBookingForm.tsx`) for design-system conformance (touch targets, raw-hex/off-system leaks, radio/select accessibility). Fix anything it flags in a follow-up commit.

- [ ] **Step 2: Full gates.** Run `npm run test` (all unit + integration), `npx tsc --noEmit`, `npm run lint`. Confirm no new failures introduced by this branch.

- [ ] **Step 3: Visual verification on dev** (as `admin@nexxus.com` on the redesign operator dashboard `/app/admin-dashboard`, open the new-booking sheet). At mobile width (390) AND desktop:
  - Toggle "Repeat this cleaning" on; verify presets switch, day chips reflect the picked date, Ends options show inline controls, the recap line reads correctly, and the first-5 date chips + "+N more" match the cadence.
  - Verify recurrence is hidden in "Company pays" (self-pay) mode.
  - Create a small series (e.g. Weekly, After 3) end to end and confirm the toast ("3 cleanings scheduled") and that the occurrences land in the Bookings list as "Awaiting cleaner".
  - Screenshot each state and send to the user.
  - Note in the ledger that a live test series is created on dev.

- [ ] **Step 4: Open the PR to master.**

```bash
git push -u origin feat/operator-booking-recurring
gh pr create --base master --title "feat(redesign): operator new-booking flow - Slice 2 (recurring)" --body-file <path>
```

  PR body: what the slice adds (reimagined recurrence: presets + day chips + friendly Ends + live recap/preview), that it reuses `POST /api/recurring-appointments` unchanged (no migration/route), the TZ-safe preview note, the customer-billed-only constraint, the test counts, and the deferred Slice 3 (cleaner series-accept). End with the two required trailers / generated-with footer.

---

## Self-Review

- **Spec coverage:** Presets + Custom (Task 1 `resolveCadence`, Task 4 UI); day chips carried from booking date (Task 1 `weekdayOfYmd`, Task 4); Ends After N / On a date / Keep going (Task 1 `resolveEnd`, Task 4); live recap (Task 1 `recurrenceRecap`, Task 4); real date preview first ~5 + count (Task 1 `previewOccurrences`, Task 4); cleaner carries across series (Task 2 payload uses `state.cleanerId`); self-pay hides recurrence (Task 1 `isRecurring`, Task 5 gate); series via `POST /api/recurring-appointments` (Task 2/3); caps 50/6mo (reused server-side + mirrored in preview). Covered.
- **Placeholder scan:** No TBD/TODO; every code step has complete code.
- **Type consistency:** `OperatorRecurrence` fields (`preset`, `customType`, `customInterval`, `daysOfWeek`, `end`, `count`, `endDate`) are used identically across Tasks 1, 2, 4, 5. `create` return `{ recurring, count }` is produced in Task 3 and consumed in Task 5. `previewOccurrences` returns `string[]` throughout. `canCreateBooking(state, occurrenceCount)` signature consistent (Task 2 def, Task 5 use).
- **Cross-task ordering:** Task 3 knowingly leaves one type error in `OperatorBookingForm.tsx` (documented) that Task 5 resolves; the reviewer for Task 3 is told this is expected.
