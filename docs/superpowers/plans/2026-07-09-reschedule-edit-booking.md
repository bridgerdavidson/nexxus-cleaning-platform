# Reschedule + Edit Booking (R2/R3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native redesign Reschedule dialog + Edit-details form for the operator booking sheet, backed by two new server routes, killing the last `/admin-dashboard?tab=bookings&appointment=` escape.

**Architecture:** A pure shared module (`rescheduleOutcome.ts`) decides the reschedule outcome (auto-approve / employee-settled / unassigned / re-ask) and its notification plan; a new `POST /api/appointments/[appointmentId]/reschedule` route applies it atomically (conditional UPDATE + sibling-state cleanup: feedback, requested slots, routing log, request_state) and a new `PATCH .../details` route handles change-driven service/checklist/price/notes edits. The UI is a Dialog stacked over the existing `BookingDetailSheet` (reschedule) plus a body-swap form inside it (edit details), both wired in `OperatorBookingDetailHost`.

**Tech Stack:** Next.js 16 App Router route handlers (supabaseAdmin + requireManagerPermission), TanStack Query v5 mutation hooks, Radix ui primitives (`dialog`, `popover`, `calendar`, `command`), Vitest unit + integration tests via `tests/helpers/*`.

**Spec:** `docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md` (read it before starting any task; it is the behavioral contract).

## Global Constraints

- Branch: `feat/reschedule-edit-booking` (already exists, spec committed). Never commit to `master`.
- No em dashes in ANY user-facing copy (UI text, toasts, notifications). Use periods, commas, "to".
- Column traps: `appointments.scheduled_time` is stored `HH:MM:SS` (write `HH:MM` + `':00'`); `duration_minutes` not `estimated_duration`; `special_requests` on appointments; `cleaner_id` = `cleaner_profiles.id` = auth user id.
- All new user-visible UI from design-system primitives (`src/components/ui/*`); mockups are structure reference only.
- Gates before every push: `npm run test`, `npx tsc --noEmit` (12 pre-existing errors are known; introduce none), `npm run lint` (repo has 64 pre-existing errors; changed files must be clean). Integration tests need `npx supabase start` + `.env.test.local`.
- One pre-existing unit-test failure exists (`src/lib/formDraft.test.ts`); it is not yours to fix.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `https://claude.ai/code/session_01VREQVVDjhUtvYbz8jjDeBj`.
- Legacy dashboard files (`AppointmentSidePanel`, `RescheduleAppointmentModal`, `BookingsPage`, admin-dashboard pages) are NOT touched.

---

### Task 1: `rescheduleOutcome.ts` — shared outcome + matching module

**Files:**
- Create: `src/lib/appointments/rescheduleOutcome.ts`
- Test: `src/lib/appointments/rescheduleOutcome.test.ts`

**Interfaces:**
- Consumes: `computeResponseDeadline` from `@/lib/computeResponseDeadline`.
- Produces (used by Tasks 4, 10, 11): `normalizeTimeHHMM(time: string): string | null`; `matchesOwnedSuggestion(cleanerId, scheduledDate, scheduledTime, suggestions: SuggestionInputs): boolean`; `decideRescheduleOutcome(input: RescheduleDecisionInput): RescheduleOutcome`; `planRescheduleNotifications(outcome, cleanerChanged): RescheduleNotificationPlan`; `reaskTierHours(date, time, now?): 4 | 24 | null`; types `SuggestionInputs`, `RescheduleOutcome`, `RescheduleOutcomeKind`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/appointments/rescheduleOutcome.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeTimeHHMM,
  matchesOwnedSuggestion,
  decideRescheduleOutcome,
  planRescheduleNotifications,
  reaskTierHours,
  type SuggestionInputs,
} from './rescheduleOutcome';

const CLEANER = 'cleaner-1';
const OTHER = 'cleaner-2';

const suggestions: SuggestionInputs = {
  times: [{ feedbackCleanerId: CLEANER, suggestedDate: '2026-03-06', suggestedTime: '09:00:00' }],
  windows: [
    { feedbackCleanerId: CLEANER, windowDate: '2026-03-07', startTime: '13:00:00', endTime: '16:00:00' },
  ],
};

function decide(overrides: Partial<Parameters<typeof decideRescheduleOutcome>[0]> = {}) {
  return decideRescheduleOutcome({
    scheduledDate: '2026-03-06',
    scheduledTime: '09:00',
    targetCleanerId: CLEANER,
    currentCleanerId: CLEANER,
    orgDefaultPayoutModel: 'percentage_contractor',
    suggestions,
    ...overrides,
  });
}

describe('normalizeTimeHHMM', () => {
  it('normalizes HH:MM:SS and pads hours', () => {
    expect(normalizeTimeHHMM('9:00:00')).toBe('09:00');
    expect(normalizeTimeHHMM('13:30')).toBe('13:30');
    expect(normalizeTimeHHMM('bogus')).toBeNull();
  });
});

describe('matchesOwnedSuggestion', () => {
  it('matches an exact suggested time across HH:MM vs HH:MM:SS formats', () => {
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-06', '09:00', suggestions)).toBe(true);
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-06', '09:00:00', suggestions)).toBe(true);
  });
  it('rejects a suggestion owned by a different cleaner', () => {
    expect(matchesOwnedSuggestion(OTHER, '2026-03-06', '09:00', suggestions)).toBe(false);
  });
  it('window match is closed-interval at both boundaries', () => {
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '13:00', suggestions)).toBe(true); // start
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '16:00', suggestions)).toBe(true); // end (legacy parity)
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '16:01', suggestions)).toBe(false);
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '12:59', suggestions)).toBe(false);
  });
});

describe('decideRescheduleOutcome', () => {
  it('auto-approves same cleaner + owned suggestion', () => {
    const o = decide();
    expect(o).toMatchObject({ kind: 'auto_approve', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved', recomputeDeadline: false });
  });
  it('re-asks when the time matches no owned suggestion', () => {
    const o = decide({ scheduledTime: '10:00' });
    expect(o).toMatchObject({ kind: 'reask', settled: false, status: 'pending', cleanerConfirmationStatus: 'awaiting', recomputeDeadline: true });
  });
  it('re-asks when the suggestion belongs to another cleaner (no cross-owner auto-approve)', () => {
    const o = decide({
      suggestions: { times: [{ feedbackCleanerId: OTHER, suggestedDate: '2026-03-06', suggestedTime: '09:00' }], windows: [] },
    });
    expect(o.kind).toBe('reask');
  });
  it('settles for employee-model orgs even without a match', () => {
    const o = decide({ scheduledTime: '10:00', orgDefaultPayoutModel: 'hourly_external' });
    expect(o).toMatchObject({ kind: 'employee_settled', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved' });
  });
  it('auto-approve wins over employee-settled (match checked first)', () => {
    const o = decide({ orgDefaultPayoutModel: 'hourly_external' });
    expect(o.kind).toBe('auto_approve');
  });
  it('unassigned leaves status/confirmation untouched and clears the deadline', () => {
    const o = decide({ targetCleanerId: null, currentCleanerId: null });
    expect(o).toMatchObject({ kind: 'unassigned', settled: true, status: null, cleanerConfirmationStatus: null, recomputeDeadline: false });
  });
});

describe('planRescheduleNotifications', () => {
  it('auto-approve notifies the cleaner with the success event + homeowner', () => {
    expect(planRescheduleNotifications(decide(), false)).toEqual({
      cleanerEvent: 'cleaner_counter_accepted', requiresConfirmation: false, notifyHomeowner: true,
    });
  });
  it('re-ask same cleaner sends appointment_rescheduled with requires_confirmation, no homeowner event', () => {
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00' }), false)).toEqual({
      cleanerEvent: 'appointment_rescheduled', requiresConfirmation: true, notifyHomeowner: false,
    });
  });
  it('cleaner change re-ask sends cleaner_assigned; settled change sends cleaner_force_assigned', () => {
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00' }), true).cleanerEvent).toBe('cleaner_assigned');
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00', orgDefaultPayoutModel: 'hourly_external' }), true).cleanerEvent).toBe('cleaner_force_assigned');
  });
  it('employee settled same cleaner sends appointment_rescheduled FYI + homeowner event', () => {
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00', orgDefaultPayoutModel: 'hourly_external' }), false)).toEqual({
      cleanerEvent: 'appointment_rescheduled', requiresConfirmation: false, notifyHomeowner: true,
    });
  });
  it('unassigned sends no cleaner event but notifies the homeowner', () => {
    expect(planRescheduleNotifications(decide({ targetCleanerId: null, currentCleanerId: null }), false)).toEqual({
      cleanerEvent: null, requiresConfirmation: false, notifyHomeowner: true,
    });
  });
});

describe('reaskTierHours', () => {
  it('is 4 within 48h of the job and 24 beyond it', () => {
    const now = new Date(2026, 2, 5, 8, 0, 0); // Mar 5 2026 08:00 local
    expect(reaskTierHours('2026-03-06', '09:00', now)).toBe(4);
    expect(reaskTierHours('2026-03-20', '09:00', now)).toBe(24);
    expect(reaskTierHours('bogus', '09:00', now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/appointments/rescheduleOutcome.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/appointments/rescheduleOutcome.ts
/**
 * Shared decision logic for the operator reschedule flow (spec:
 * docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md).
 * Consumed by BOTH the RescheduleDialog (outcome line, button label,
 * constrained time pills) and /api/appointments/[appointmentId]/reschedule,
 * so client preview and server behavior cannot drift.
 *
 * Matching rules are defined HERE, deliberately (accept-counter-proposal has
 * no time-equality rule and its window check compares raw mixed-format
 * strings; the legacy modal's closed-interval window rule is what shipped):
 *   - all times normalized to HH:MM before comparing
 *   - exact match: same date + equal normalized times
 *   - window match: same date + start <= t <= end (closed interval)
 *   - a suggestion counts only when its feedback row belongs to the target cleaner
 */
import { computeResponseDeadline } from '@/lib/computeResponseDeadline';

export interface SuggestionInputs {
  times: Array<{ feedbackCleanerId: string; suggestedDate: string; suggestedTime: string }>;
  windows: Array<{ feedbackCleanerId: string; windowDate: string; startTime: string; endTime: string }>;
}

export function normalizeTimeHHMM(time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function matchesOwnedSuggestion(
  cleanerId: string,
  scheduledDate: string,
  scheduledTime: string,
  suggestions: SuggestionInputs,
): boolean {
  const t = normalizeTimeHHMM(scheduledTime);
  if (!t) return false;
  const timeHit = suggestions.times.some(
    (s) =>
      s.feedbackCleanerId === cleanerId &&
      s.suggestedDate === scheduledDate &&
      normalizeTimeHHMM(s.suggestedTime) === t,
  );
  if (timeHit) return true;
  return suggestions.windows.some((w) => {
    if (w.feedbackCleanerId !== cleanerId || w.windowDate !== scheduledDate) return false;
    const start = normalizeTimeHHMM(w.startTime);
    const end = normalizeTimeHHMM(w.endTime);
    return !!start && !!end && start <= t && t <= end;
  });
}

export type RescheduleOutcomeKind = 'auto_approve' | 'employee_settled' | 'unassigned' | 'reask';

export interface RescheduleOutcome {
  kind: RescheduleOutcomeKind;
  /** True for every outcome except a re-ask (the time is final immediately). */
  settled: boolean;
  /** Column values to write; null = leave the column untouched (unassigned). */
  status: 'pending' | 'confirmed' | null;
  cleanerConfirmationStatus: 'awaiting' | 'approved' | null;
  /** true → computeResponseDeadlineISO(newDate, newTime); false → write null. */
  recomputeDeadline: boolean;
}

export interface RescheduleDecisionInput {
  scheduledDate: string;
  scheduledTime: string;
  targetCleanerId: string | null;
  currentCleanerId: string | null;
  /** organizations.default_payout_model. Anything other than
   *  'percentage_contractor' means employees: no offer loop, changes settle. */
  orgDefaultPayoutModel: string | null | undefined;
  suggestions: SuggestionInputs;
}

export function decideRescheduleOutcome(input: RescheduleDecisionInput): RescheduleOutcome {
  const { targetCleanerId, currentCleanerId } = input;
  if (!targetCleanerId) {
    return { kind: 'unassigned', settled: true, status: null, cleanerConfirmationStatus: null, recomputeDeadline: false };
  }
  const sameCleaner = targetCleanerId === currentCleanerId;
  if (
    sameCleaner &&
    matchesOwnedSuggestion(targetCleanerId, input.scheduledDate, input.scheduledTime, input.suggestions)
  ) {
    return { kind: 'auto_approve', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved', recomputeDeadline: false };
  }
  const model = input.orgDefaultPayoutModel;
  if (model && model !== 'percentage_contractor') {
    return { kind: 'employee_settled', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved', recomputeDeadline: false };
  }
  return { kind: 'reask', settled: false, status: 'pending', cleanerConfirmationStatus: 'awaiting', recomputeDeadline: true };
}

export interface RescheduleNotificationPlan {
  cleanerEvent:
    | 'cleaner_counter_accepted'
    | 'cleaner_assigned'
    | 'cleaner_force_assigned'
    | 'appointment_rescheduled'
    | null;
  /** Payload flag on appointment_rescheduled: re-confirm ask vs FYI. */
  requiresConfirmation: boolean;
  /** Emit appointment_time_changed to the homeowner (when homeowner_id set). */
  notifyHomeowner: boolean;
}

export function planRescheduleNotifications(
  outcome: RescheduleOutcome,
  cleanerChanged: boolean,
): RescheduleNotificationPlan {
  if (outcome.kind === 'unassigned') {
    return { cleanerEvent: null, requiresConfirmation: false, notifyHomeowner: true };
  }
  if (cleanerChanged) {
    return {
      cleanerEvent: outcome.settled ? 'cleaner_force_assigned' : 'cleaner_assigned',
      requiresConfirmation: false,
      notifyHomeowner: outcome.settled,
    };
  }
  if (outcome.kind === 'auto_approve') {
    return { cleanerEvent: 'cleaner_counter_accepted', requiresConfirmation: false, notifyHomeowner: true };
  }
  return {
    cleanerEvent: 'appointment_rescheduled',
    requiresConfirmation: outcome.kind === 'reask',
    notifyHomeowner: outcome.settled,
  };
}

/**
 * The SLA tier a re-ask would give the cleaner, for the dialog's outcome line
 * ("They will have 24 hours to respond"). Duration, not a clock time: the real
 * deadline is computed server-side at save time and a client-side absolute
 * time could drift across the 48h tier boundary.
 */
export function reaskTierHours(
  scheduledDate: string,
  scheduledTime: string,
  now: Date = new Date(),
): 4 | 24 | null {
  const d = computeResponseDeadline(scheduledDate, scheduledTime, now);
  if (!d) return null;
  const hours = Math.round((d.getTime() - now.getTime()) / (60 * 60 * 1000));
  return hours <= 4 ? 4 : 24;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/appointments/rescheduleOutcome.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/appointments/rescheduleOutcome.ts src/lib/appointments/rescheduleOutcome.test.ts
git commit -m "feat(appointments): shared reschedule outcome + suggestion-matching module"
```

---

### Task 2: Notification catalog — `appointment_time_changed` + `appointment_rescheduled` variant

**Files:**
- Modify: `src/lib/notifications/eventTypes.ts` (union at lines 12-36)
- Modify: `src/lib/notifications/labels.ts` (build() cases near line 161; KNOWN_TYPES at lines 359-384)
- Test: `src/lib/notifications/labels.test.ts` (extend)

**Interfaces:**
- Produces: event type `'appointment_time_changed'` (homeowner recipient) usable by Tasks 4 and 6; `appointment_rescheduled` renders re-confirm vs FYI from `payload.requires_confirmation`.
- Note: `src/lib/notifications/navigation.ts` needs NO change (homeowner bell routing is generic, `deriveNotifications.ts` deep-links any appointment-scoped row).

- [ ] **Step 1: Write failing tests** — add to `src/lib/notifications/labels.test.ts` (match the file's existing describe/import style):

```ts
describe('appointment_time_changed', () => {
  it('tells the homeowner the new time', () => {
    const d = describeNotification('appointment_time_changed', {
      audience: 'homeowner',
      scheduled_date: '2026-03-06',
      scheduled_time: '09:00',
      property_label: '124 Elm St',
    });
    expect(d.title).toContain('Your cleaning moved to');
    expect(d.tone).toBe('info');
  });
  it('falls back gracefully with no payload', () => {
    const d = describeNotification('appointment_time_changed');
    expect(d.title).toBe('Your cleaning was moved');
  });
});

describe('appointment_rescheduled variants', () => {
  it('asks for re-confirmation when requires_confirmation is true', () => {
    const d = describeNotification('appointment_rescheduled', { requires_confirmation: true, scheduled_date: '2026-03-06', scheduled_time: '09:00' });
    expect(d.detail).toContain('Please re-confirm');
    expect(d.tone).toBe('warning');
  });
  it('is a neutral FYI otherwise', () => {
    const d = describeNotification('appointment_rescheduled', { requires_confirmation: false, scheduled_date: '2026-03-06', scheduled_time: '09:00' });
    expect(d.detail ?? '').not.toContain('Please re-confirm');
    expect(d.tone).toBe('info');
  });
  it('keeps warning tone for historical rows without the flag', () => {
    const d = describeNotification('appointment_rescheduled', { scheduled_date: '2026-03-06', scheduled_time: '09:00' });
    expect(d.tone).toBe('warning');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/notifications/labels.test.ts` → FAIL ('Update' fallback / missing case).

- [ ] **Step 3: Implement.**

In `eventTypes.ts`, change line 17 and append to the union (before `'member_joined'`):

```ts
  | 'appointment_rescheduled'       // recipient: cleaner (moved to a new time; payload.requires_confirmation: re-confirm ask vs FYI)
  ...
  | 'appointment_time_changed'      // recipient: homeowner (operator moved the time and it is settled)
```

In `labels.ts`, replace the `appointment_rescheduled` case (lines 161-167) and add the new case after it. `when` and `property` are the existing locals at lines 84-87; the payload flag is read directly (payload values are `unknown`):

```ts
    case 'appointment_rescheduled': {
      // Historical rows have no flag; treat missing as the old re-confirm meaning.
      const requiresConfirmation = payload?.['requires_confirmation'] !== false;
      return {
        title: 'A job was rescheduled',
        detail: requiresConfirmation ? joinDetail(when, 'Please re-confirm') : joinDetail(when, property),
        tone: requiresConfirmation ? 'warning' : 'info',
        icon: CalendarClock,
      };
    }

    case 'appointment_time_changed':
      return {
        title: when ? `Your cleaning moved to ${when}` : 'Your cleaning was moved',
        detail: property,
        tone: 'info',
        icon: CalendarClock,
      };
```

Add `'appointment_time_changed',` to `KNOWN_TYPES` (this is load-bearing: a type missing from the set silently renders as the generic "Update" fallback).

- [ ] **Step 4: Run** — `npx vitest run src/lib/notifications/` → PASS. Also `npx tsc --noEmit` → no NEW errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/eventTypes.ts src/lib/notifications/labels.ts src/lib/notifications/labels.test.ts
git commit -m "feat(notifications): appointment_time_changed event + rescheduled re-confirm/FYI variants"
```

---

### Task 3: Test-helper extensions (`fixtures.ts`)

**Files:**
- Modify: `tests/helpers/fixtures.ts` (`WithTestOrgOptions` at lines 61-65; org insert at lines 79-83; `createTestAppointment` args at lines 337-349 and insert at ~line 389)

**Interfaces:**
- Produces (used by Tasks 4, 7): `withTestOrg({ defaultPayoutModel: 'hourly_external' })`; `createTestAppointment({ ..., cleanerId: null })`.

- [ ] **Step 1: Edit.** Add to `WithTestOrgOptions`:

```ts
export interface WithTestOrgOptions {
  payoutPercent?: number;
  stripeConnectOnboardingComplete?: boolean;
  stripeConnectAccountId?: string;
  /** organizations.default_payout_model (default 'percentage_contractor'). */
  defaultPayoutModel?: 'percentage_contractor' | 'hourly_external';
}
```

Change the org insert:

```ts
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: orgName,
      ...(opts.defaultPayoutModel ? { default_payout_model: opts.defaultPayoutModel } : {}),
    })
    .select('id')
    .single();
```

In `createTestAppointment`, change the arg type `cleanerId: string;` → `cleanerId: string | null;` (the insert already passes it through verbatim).

- [ ] **Step 2: Verify nothing broke** — `npm run test:integration -- accept-counter-proposal` (any one existing suite) → same pass/fail as before your change (all passing).

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/fixtures.ts
git commit -m "test(helpers): org payout model + nullable cleaner for appointment fixtures"
```

---

### Task 4: `POST /api/appointments/[appointmentId]/reschedule`

**Files:**
- Create: `src/app/api/appointments/[appointmentId]/reschedule/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/reschedule/route.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's module; Task 2's event type; Task 3's fixtures; `requireManagerPermission` (`src/lib/auth/requireManagerPermission.ts:19`), `findConflicts` (`src/lib/appointmentConflicts.ts:60`), `usesRequestState` (`src/lib/appointments/flowType.ts:39`), `computeResponseDeadlineISO`, `recordNotificationEvent` + `loadNotificationContext`.
- Produces (used by Tasks 10-11): `POST` body `{ organizationId, scheduledDate, scheduledTime, cleanerId, force? }`; responses `200 { success: true, outcome: 'settled' | 'awaiting' }`, `409 { stale: true }`, `409 { conflict: true, details: { appointmentId, scheduledTime, durationMinutes, customerName } }`, `400`/`403`/`404` with `{ error }`.

- [ ] **Step 1: Write the failing integration tests.** Follow the structure of `src/app/api/appointments/accept-counter-proposal/route.integration.test.ts` (seed helpers, `callRoute(POST, { method: 'POST', body, headers: bearerHeader(token) })`, afterEach cleanup). Full file:

```ts
// route.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg, createTestAppointment, addManagerToOrg,
  type TestOrgFixture, type ManagerMemberHandle,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const admin = createTestSupabaseClient();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function seedOrg(opts: Parameters<typeof withTestOrg>[0] = {}) {
  const org = await withTestOrg(opts);
  cleanups.push(() => org.cleanup());
  return org;
}

function call(appointmentId: string, token: string, body: Record<string, unknown>) {
  return callRoute<Record<string, unknown>>((req) => POST(req, { params: Promise.resolve({ appointmentId }) }), {
    method: 'POST',
    body,
    headers: bearerHeader(token),
  });
}

async function seedFeedback(appointmentId: string, cleanerId: string, opts: { time?: { date: string; time: string }; window?: { date: string; start: string; end: string } }) {
  const { data: fb } = await admin
    .from('cleaner_availability_feedback')
    .insert({ appointment_id: appointmentId, cleaner_id: cleanerId, reason: null })
    .select('id').single();
  const feedbackId = (fb as { id: string }).id;
  if (opts.time) {
    await admin.from('cleaner_suggested_times').insert({ feedback_id: feedbackId, suggested_date: opts.time.date, suggested_time: opts.time.time });
  }
  if (opts.window) {
    await admin.from('cleaner_suggested_windows').insert({ feedback_id: feedbackId, window_date: opts.window.date, start_time: opts.window.start, end_time: opts.window.end });
  }
  return feedbackId;
}

async function getAppt(id: string) {
  const { data } = await admin.from('appointments')
    .select('status, cleaner_confirmation_status, cleaner_id, scheduled_date, scheduled_time, response_deadline, request_state')
    .eq('id', id).single();
  return data as Record<string, unknown>;
}

async function eventsFor(id: string) {
  const { data } = await admin.from('notification_events')
    .select('event_type, recipient_user_id, payload').eq('appointment_id', id);
  return (data ?? []) as Array<{ event_type: string; recipient_user_id: string; payload: Record<string, unknown> }>;
}

describe('POST /api/appointments/[appointmentId]/reschedule', () => {
  it('re-asks the cleaner on a plain time change (deadline, notification, cleanup)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'confirmed' });
    await admin.from('appointments').update({ cleaner_confirmation_status: 'approved' }).eq('id', appt.id);
    await seedFeedback(appt.id, org.cleaner.userId, { time: { date: '2026-06-08', time: '11:00' } });
    await admin.from('appointment_requested_slots').insert([
      { appointment_id: appt.id, slot_index: 0, scheduled_date: '2026-06-01', scheduled_time: '10:00' },
      { appointment_id: appt.id, slot_index: 1, scheduled_date: '2026-06-02', scheduled_time: '10:00' },
    ]);
    await admin.from('appointment_routing_log').insert({ appointment_id: appt.id, cleaner_id: org.cleaner.userId, attempt_index: 1, deadline_at: new Date().toISOString() });

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, outcome: 'awaiting' });

    const row = await getAppt(appt.id);
    expect(row).toMatchObject({ status: 'pending', cleaner_confirmation_status: 'awaiting', scheduled_date: '2026-06-10', scheduled_time: '14:00:00' });
    expect(row.response_deadline).toBeTruthy();

    const { data: fb } = await admin.from('cleaner_availability_feedback').select('id').eq('appointment_id', appt.id);
    expect(fb).toHaveLength(0);
    const { data: slots } = await admin.from('appointment_requested_slots').select('slot_index').eq('appointment_id', appt.id);
    expect(slots).toHaveLength(0);
    const { data: log } = await admin.from('appointment_routing_log').select('response').eq('appointment_id', appt.id);
    expect((log ?? []).every((r) => (r as { response: string }).response === 'expired')).toBe(true);

    const events = await eventsFor(appt.id);
    const resched = events.filter((e) => e.event_type === 'appointment_rescheduled');
    expect(resched).toHaveLength(1);
    expect(resched[0].recipient_user_id).toBe(org.cleaner.userId);
    expect(resched[0].payload.requires_confirmation).toBe(true);
    expect(events.some((e) => e.event_type === 'appointment_time_changed')).toBe(false);
  });

  it('auto-approves a pick matching the current cleaner suggestion and notifies homeowner', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'pending' });
    await admin.from('appointments').update({ cleaner_confirmation_status: 'rejected' }).eq('id', appt.id);
    await seedFeedback(appt.id, org.cleaner.userId, { time: { date: '2026-06-08', time: '11:00' } });

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-08', scheduledTime: '11:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt.id)).toMatchObject({
      status: 'confirmed', cleaner_confirmation_status: 'approved', response_deadline: null, scheduled_time: '11:00:00',
    });
    const events = await eventsFor(appt.id);
    expect(events.some((e) => e.event_type === 'cleaner_counter_accepted' && e.recipient_user_id === org.cleaner.userId)).toBe(true);
    expect(events.some((e) => e.event_type === 'appointment_time_changed' && e.recipient_user_id === org.homeowner.userId)).toBe(true);
  });

  it('does NOT auto-approve on another cleaner\'s suggestion', async () => {
    const org = await seedOrg();
    const other = await addManagerToOrg(org.organizationId); // any second user works as feedback owner
    cleanups.push(() => other.cleanup());
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'pending' });
    await seedFeedback(appt.id, other.userId, { time: { date: '2026-06-08', time: '11:00' } });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-08', scheduledTime: '11:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'awaiting' });
  });

  it('settles for employee-model orgs and notifies homeowner + cleaner FYI', async () => {
    const org = await seedOrg({ defaultPayoutModel: 'hourly_external' });
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'confirmed' });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-12', scheduledTime: '09:00', cleanerId: org.cleaner.userId,
    });
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt.id)).toMatchObject({ status: 'confirmed', cleaner_confirmation_status: 'approved', response_deadline: null });
    const events = await eventsFor(appt.id);
    const fyi = events.find((e) => e.event_type === 'appointment_rescheduled');
    expect(fyi?.payload.requires_confirmation).toBe(false);
    expect(events.some((e) => e.event_type === 'appointment_time_changed')).toBe(true);
  });

  it('cleaner change requires can_handle_requests and emits cleaner_assigned', async () => {
    const org = await seedOrg();
    const editOnly = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    cleanups.push(() => editOnly.cleanup());
    const both = await addManagerToOrg(org.organizationId, { can_edit_bookings: true, can_handle_requests: true });
    cleanups.push(() => both.cleanup());
    const org2 = await seedOrg(); // unused cleaner source is org's own second cleaner below
    // second cleaner in the same org:
    const cleaner2 = org2.cleaner; // wrong org on purpose for the org-check test later
    const { data: c2 } = await admin.from('cleaner_profiles').select('id').eq('id', org.cleaner.userId).single();
    expect(c2).toBeTruthy();

    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'pending' });

    // Need a second cleaner in-org: promote the homeowner is invalid; create via second appointment fixture is heavy.
    // Simplest: another org member with a cleaner_profiles row.
    const { data: cp } = await admin.from('cleaner_profiles')
      .insert({ id: editOnly.userId, organization_id: org.organizationId, is_available: true })
      .select('id').single();
    const newCleanerId = (cp as { id: string }).id;

    const denied = await call(appt.id, editOnly.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: newCleanerId,
    });
    expect(denied.status).toBe(403);

    const ok = await call(appt.id, both.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: newCleanerId,
    });
    expect(ok.status).toBe(200);
    const events = await eventsFor(appt.id);
    expect(events.some((e) => e.event_type === 'cleaner_assigned' && e.recipient_user_id === newCleanerId)).toBe(true);

    // wrong-org cleaner rejected
    const bad = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '15:00', cleanerId: cleaner2.userId,
    });
    expect(bad.status).toBe(400);
  });

  it('manager without can_edit_bookings is rejected', async () => {
    const org = await seedOrg();
    const none = await addManagerToOrg(org.organizationId, { can_handle_requests: true });
    cleanups.push(() => none.cleanup());
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const res = await call(appt.id, none.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(403);
  });

  it('409 conflict with details unless force', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, scheduledDate: '2026-06-01', scheduledTime: '10:00' });
    const blocker = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, scheduledDate: '2026-06-10', scheduledTime: '14:00' });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:30', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ conflict: true });
    expect((res.body as { details: { appointmentId: string } }).details.appointmentId).toBe(blocker.id);

    const forced = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:30', cleanerId: org.cleaner.userId, force: true,
    });
    expect(forced.status).toBe(200);
  });

  it('409 stale when the booking is no longer pending/confirmed', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'cancelled' });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ stale: true });
  });

  it('cannot unassign; unassigned stays unassigned + homeowner notified', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const bad = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: null,
    });
    expect(bad.status).toBe(400);

    const un = await createTestAppointment({ organizationId: org.organizationId, cleanerId: null, homeownerId: org.homeowner.userId });
    const res = await call(un.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-11', scheduledTime: '09:00', cleanerId: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(un.id)).toMatchObject({ status: 'pending', cleaner_id: null, scheduled_date: '2026-06-11' });
    const events = await eventsFor(un.id);
    expect(events.some((e) => e.event_type === 'appointment_time_changed')).toBe(true);
  });

  it('homeowner_request: re-ask sets request_state routing + inserts a routing row; settled sets completed', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: null, homeownerId: org.homeowner.userId });
    await admin.from('appointments').update({ flow_type: 'homeowner_request', homeowner_initiated: true, request_state: 'awaiting_admin' }).eq('id', appt.id);

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'awaiting' });
    expect(await getAppt(appt.id)).toMatchObject({ request_state: 'routing', cleaner_confirmation_status: 'awaiting' });
    const { data: log } = await admin.from('appointment_routing_log').select('response, cleaner_id').eq('appointment_id', appt.id);
    expect((log ?? []).some((r) => (r as { response: string | null }).response === null || (r as { response: string }).response === 'pending')).toBe(true);

    // settled variant on an employee org
    const org2 = await seedOrg({ defaultPayoutModel: 'hourly_external' });
    const appt2 = await createTestAppointment({ organizationId: org2.organizationId, cleanerId: org2.cleaner.userId, homeownerId: org2.homeowner.userId });
    await admin.from('appointments').update({ flow_type: 'homeowner_request', homeowner_initiated: true, request_state: 'awaiting_admin' }).eq('id', appt2.id);
    const res2 = await call(appt2.id, org2.admin.accessToken, {
      organizationId: org2.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org2.cleaner.userId,
    });
    expect(res2.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt2.id)).toMatchObject({ request_state: 'completed' });
  });

  it('cross-org caller gets 403/404', async () => {
    const org = await seedOrg();
    const org2 = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const res = await call(appt.id, org2.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect([403, 404]).toContain(res.status);
  });
});
```

Note on the routing-log assertion: check the actual `appointment_routing_log.response` column default before finalizing (`\d appointment_routing_log` or grep migrations); assign-cleaner inserts rows WITHOUT `response` for the pending case, so pending is either NULL or `'pending'` by column default. Mirror whatever assign-cleaner produces (`src/app/api/appointments/assign-cleaner/route.ts:142-152`) in both the route (Step 3) and this assertion, and make the reschedule route's "close pending rows" filter match it (the auto-defer sweep filters `response = 'pending'`, so if the default is `'pending'`, filter on that).

- [ ] **Step 2: Run to verify failure** — `npm run test:integration -- reschedule` → FAIL (route module missing).

- [ ] **Step 3: Implement the route.**

```ts
// src/app/api/appointments/[appointmentId]/reschedule/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { findConflicts, type ScheduleAppointment } from '@/lib/appointmentConflicts';
import { usesRequestState } from '@/lib/appointments/flowType';
import {
  decideRescheduleOutcome,
  planRescheduleNotifications,
  normalizeTimeHHMM,
  type SuggestionInputs,
} from '@/lib/appointments/rescheduleOutcome';

/**
 * Operator reschedule (spec: docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md).
 * Atomically moves a pending/confirmed booking to a new date/time (and optionally
 * a new cleaner), applying the re-confirmation policy via rescheduleOutcome and
 * cleaning up EVERY piece of stale sibling state (feedback, requested slots,
 * pending routing rows, request_state) so the auto-defer sweep and stale cleaner
 * accepts cannot clobber the operator's change.
 */
interface RescheduleBody {
  organizationId: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM (HH:MM:SS tolerated)
  cleanerId: string | null;
  force?: boolean;
}

type FeedbackRow = {
  id: string;
  cleaner_id: string;
  cleaner_suggested_times: Array<{ id: string; suggested_date: string; suggested_time: string }> | null;
  cleaner_suggested_windows: Array<{ id: string; window_date: string; start_time: string; end_time: string }> | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = (await request.json()) as RescheduleBody;
    const { organizationId, scheduledDate, cleanerId, force } = body;

    if (!organizationId || !scheduledDate || !body.scheduledTime) {
      return NextResponse.json(
        { success: false, error: 'organizationId, scheduledDate, and scheduledTime are required' },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      return NextResponse.json({ success: false, error: 'scheduledDate must be YYYY-MM-DD' }, { status: 400 });
    }
    const scheduledTime = normalizeTimeHHMM(body.scheduledTime);
    if (!scheduledTime) {
      return NextResponse.json({ success: false, error: 'scheduledTime must be HH:MM' }, { status: 400 });
    }

    const auth = await requireManagerPermission(request, organizationId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
    });
    if (!auth.ok) return auth.response;

    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select(
        `
        id, organization_id, cleaner_id, homeowner_id, scheduled_date, scheduled_time,
        duration_minutes, status, cleaner_confirmation_status, flow_type, homeowner_initiated,
        request_state, series_id,
        cleaner_availability_feedback (
          id, cleaner_id,
          cleaner_suggested_times ( id, suggested_date, suggested_time ),
          cleaner_suggested_windows ( id, window_date, start_time, end_time )
        )
      `,
      )
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }

    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking can no longer be rescheduled' },
        { status: 409 },
      );
    }

    const currentCleanerId = (appt.cleaner_id as string | null) ?? null;
    if (!cleanerId && currentCleanerId) {
      return NextResponse.json(
        { success: false, error: 'Reschedule cannot unassign the cleaner' },
        { status: 400 },
      );
    }
    const cleanerChanged = !!cleanerId && cleanerId !== currentCleanerId;

    if (cleanerChanged) {
      // Changing the cleaner escalates to can_handle_requests (route-level defense,
      // mirroring reassign-cleaner's flag; RLS itself only distinguishes can_edit_bookings).
      if (auth.role === 'manager') {
        const { data: perm } = await supabaseAdmin
          .from('manager_permissions')
          .select('can_handle_requests')
          .eq('manager_id', auth.userId)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (!(perm as { can_handle_requests: boolean } | null)?.can_handle_requests) {
          return NextResponse.json(
            { success: false, error: 'Changing the cleaner requires the Handle Requests permission' },
            { status: 403 },
          );
        }
      }
      const { data: cleanerProfile } = await supabaseAdmin
        .from('cleaner_profiles')
        .select('id, organization_id')
        .eq('id', cleanerId!)
        .maybeSingle();
      if (!cleanerProfile || cleanerProfile.organization_id !== organizationId) {
        return NextResponse.json({ success: false, error: 'Cleaner not in this organization' }, { status: 400 });
      }
    }

    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('default_payout_model')
      .eq('id', organizationId)
      .maybeSingle();
    const orgDefaultPayoutModel = (orgRow as { default_payout_model: string | null } | null)?.default_payout_model ?? null;

    // Conflict check on the target cleaner (server-side backstop; the dialog
    // pre-warns from cache and sends force:true once the warning is visible).
    if (cleanerId && !force) {
      const { data: sameDay } = await supabaseAdmin
        .from('appointments')
        .select(
          'id, status, scheduled_date, scheduled_time, duration_minutes, homeowner:user_profiles!homeowner_id(first_name,last_name), property:properties(name,address)',
        )
        .eq('organization_id', organizationId)
        .eq('cleaner_id', cleanerId)
        .eq('scheduled_date', scheduledDate);
      const rows = (sameDay ?? []) as unknown as Array<
        ScheduleAppointment & {
          homeowner: { first_name: string; last_name: string } | null;
          property: { name: string | null; address: string | null } | null;
        }
      >;
      const conflicts = findConflicts(
        rows,
        { date: scheduledDate, time: scheduledTime, durationMinutes: (appt.duration_minutes as number) || 60 },
        { excludeAppointmentId: appointmentId },
      );
      if (conflicts.length > 0) {
        const hit = rows.find((r) => r.id === conflicts[0].id) ?? null;
        const customerName = hit?.homeowner
          ? `${hit.homeowner.first_name ?? ''} ${hit.homeowner.last_name ?? ''}`.trim()
          : hit?.property?.name || hit?.property?.address || 'another job';
        return NextResponse.json(
          {
            success: false,
            error: 'Cleaner has a conflicting appointment at that time',
            conflict: true,
            details: {
              appointmentId: conflicts[0].id,
              scheduledTime: conflicts[0].scheduled_time,
              durationMinutes: conflicts[0].duration_minutes,
              customerName,
            },
          },
          { status: 409 },
        );
      }
    }

    const feedback = ((appt as { cleaner_availability_feedback?: FeedbackRow[] | null }).cleaner_availability_feedback ?? []) as FeedbackRow[];
    const suggestions: SuggestionInputs = {
      times: feedback.flatMap((f) =>
        (f.cleaner_suggested_times ?? []).map((t) => ({
          feedbackCleanerId: f.cleaner_id,
          suggestedDate: t.suggested_date,
          suggestedTime: t.suggested_time,
        })),
      ),
      windows: feedback.flatMap((f) =>
        (f.cleaner_suggested_windows ?? []).map((w) => ({
          feedbackCleanerId: f.cleaner_id,
          windowDate: w.window_date,
          startTime: w.start_time,
          endTime: w.end_time,
        })),
      ),
    };

    const outcome = decideRescheduleOutcome({
      scheduledDate,
      scheduledTime,
      targetCleanerId: cleanerId ?? null,
      currentCleanerId,
      orgDefaultPayoutModel,
      suggestions,
    });
    const deadline = outcome.recomputeDeadline ? computeResponseDeadlineISO(scheduledDate, scheduledTime) : null;
    const isRequest = usesRequestState(appt);

    const update: Record<string, unknown> = {
      scheduled_date: scheduledDate,
      scheduled_time: `${scheduledTime}:00`,
      cleaner_id: cleanerId ?? null,
      response_deadline: deadline,
      updated_at: new Date().toISOString(),
    };
    if (outcome.status) update.status = outcome.status;
    if (outcome.cleanerConfirmationStatus) update.cleaner_confirmation_status = outcome.cleanerConfirmationStatus;
    if (isRequest && outcome.kind !== 'unassigned') {
      update.request_state = outcome.settled ? 'completed' : 'routing';
    }

    // Atomic status gate: the conditional .in() makes a concurrent cancel/accept
    // fail this write (0 rows) instead of silently resurrecting the booking.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('appointments')
      .update(update)
      .eq('id', appointmentId)
      .in('status', ['pending', 'confirmed'])
      .select('id');
    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking changed. Refresh and try again.' },
        { status: 409 },
      );
    }

    // Stale-sibling cleanup AFTER the write succeeds (legacy deleted feedback
    // first and could lose it on a failed save). Non-fatal but logged.
    const nowIso = new Date().toISOString();
    try {
      await supabaseAdmin.from('cleaner_availability_feedback').delete().eq('appointment_id', appointmentId);
      await supabaseAdmin.from('appointment_requested_slots').delete().eq('appointment_id', appointmentId);
      // Close pending routing rows or the auto-defer sweep later re-routes this
      // booking over the operator's reschedule. NOTE: match assign-cleaner's
      // pending representation (response NULL vs 'pending') — see the task note.
      await supabaseAdmin
        .from('appointment_routing_log')
        .update({ response: 'expired', responded_at: nowIso })
        .eq('appointment_id', appointmentId)
        .eq('response', 'pending');
    } catch (cleanupErr) {
      console.error('reschedule: sibling-state cleanup failed (non-fatal):', cleanupErr);
    }

    // Homeowner-request re-ask re-enters the routing machine so the SLA sweep
    // governs the new deadline (mirrors assign-cleaner; no chain-cap check here,
    // an explicit operator action may always re-offer).
    if (isRequest && outcome.kind === 'reask' && cleanerId) {
      try {
        const { data: existingLog } = await supabaseAdmin
          .from('appointment_routing_log')
          .select('attempt_index')
          .eq('appointment_id', appointmentId)
          .order('attempt_index', { ascending: true });
        const nextAttempt = (((existingLog ?? []) as Array<{ attempt_index: number }>).at(-1)?.attempt_index ?? 0) + 1;
        await supabaseAdmin.from('appointment_routing_log').insert({
          appointment_id: appointmentId,
          cleaner_id: cleanerId,
          attempt_index: nextAttempt,
          deadline_at: deadline,
        });
      } catch (logErr) {
        console.error('reschedule: routing-log insert failed (non-fatal):', logErr);
      }
    }

    // Notifications, best-effort (recordNotificationEvent semantics).
    const plan = planRescheduleNotifications(outcome, cleanerChanged);
    try {
      const ctx = await loadNotificationContext(supabaseAdmin, {
        appointmentId,
        ...(cleanerId ? { cleanerId } : {}),
      });
      if (plan.cleanerEvent && cleanerId) {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: plan.cleanerEvent,
          appointment_id: appointmentId,
          organization_id: organizationId,
          recipient_user_id: cleanerId,
          payload: {
            ...ctx,
            audience: 'cleaner',
            scheduled_date: scheduledDate,
            scheduled_time: scheduledTime,
            ...(plan.cleanerEvent === 'appointment_rescheduled'
              ? { requires_confirmation: plan.requiresConfirmation, response_deadline: deadline }
              : {}),
          },
        });
      }
      if (plan.notifyHomeowner && appt.homeowner_id) {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: 'appointment_time_changed',
          appointment_id: appointmentId,
          organization_id: organizationId,
          recipient_user_id: appt.homeowner_id as string,
          payload: { ...ctx, audience: 'homeowner', scheduled_date: scheduledDate, scheduled_time: scheduledTime },
        });
      }
    } catch (notifyErr) {
      console.error('reschedule: notification failed (non-fatal):', notifyErr);
    }

    return NextResponse.json({ success: true, outcome: outcome.settled ? 'settled' : 'awaiting' });
  } catch (error) {
    console.error('Error in appointments/[appointmentId]/reschedule POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run** — `npm run test:integration -- reschedule` → PASS. Fix the routing-log pending-representation note first if the first run shows the close/assert mismatch.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/appointments/\[appointmentId\]/reschedule
git commit -m "feat(api): operator reschedule route with outcome policy + sibling-state cleanup"
```

---

### Task 5: Confirm-route hardening (stale accepts)

**Files:**
- Modify: `src/app/api/appointments/confirm/route.ts` (select at line 83; accept branch lines 102-174; counter/decline update at lines 304-307)
- Test: `src/app/api/appointments/confirm/route.integration.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new. Produces: accept/counter responses gain `409 { stale: true }`.

- [ ] **Step 1: Failing tests.** Add to the existing confirm integration suite (reuse its seeding helpers):

```ts
it('409s an accept whose slotIndex no longer matches any offered slot', async () => {
  // seed appointment with NO appointment_requested_slots rows, then accept with slotIndex: 2
  // (models: operator rescheduled and the route deleted the slot rows mid-flight)
  const res = await callConfirm({ appointmentId, organizationId, action: 'accept', slotIndex: 2 }, cleanerToken);
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ stale: true });
});

it('still accepts a synthesized single-slot offer with slotIndex 0 and no slot rows', async () => {
  const res = await callConfirm({ appointmentId, organizationId, action: 'accept', slotIndex: 0 }, cleanerToken);
  expect(res.status).toBe(200);
});
```

(Adapt names to the file's existing helpers; every other existing test must keep passing.)

- [ ] **Step 2: Run to verify the first fails** (`npm run test:integration -- confirm`).

- [ ] **Step 3: Implement.** Three edits:

(a) Add `updated_at` to the appointment select at line 83.

(b) In the accept branch after `slots` is built (line 120), replace the multi-slot guard block with:

```ts
      // The redesign shell always sends slotIndex; for a booking with no slot
      // rows offeredSlots() synthesizes a single slot_index 0, so 0 (or no
      // slotIndex) with zero rows means "accept the appointment row as-is".
      // Anything else points at an offered slot that no longer exists (e.g. an
      // operator reschedule deleted the rows) — reject instead of silently
      // confirming the cleaner onto a time they never saw.
      if (slots.length === 0 && body.slotIndex !== undefined && body.slotIndex !== 0) {
        return NextResponse.json(
          { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
          { status: 409 },
        );
      }
      if (slots.length > 1) {
        if (body.slotIndex === undefined) {
          return NextResponse.json(
            { success: false, error: 'slotIndex is required when accepting a multi-slot request' },
            { status: 400 },
          );
        }
        const chosen = slots.find((s) => s.slot_index === body.slotIndex);
        if (!chosen) {
          return NextResponse.json(
            { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
            { status: 409 },
          );
        }
        acceptedDate = chosen.scheduled_date;
        acceptedTime = chosen.scheduled_time;
        acceptedSlotIndex = chosen.slot_index;
      } else if (usesRequestState(appointment) && slots.length === 1) {
```

(c) Make BOTH appointment updates conditional on `updated_at` (closes the reschedule-vs-accept write race; the reschedule route always bumps `updated_at`). Accept branch (lines 163-166):

```ts
      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from('appointments')
        .update(baseUpdate)
        .eq('id', appointmentId)
        .eq('updated_at', appointment.updated_at as string)
        .select('id');
      if (updateError) { /* existing 500 */ }
      if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
          { status: 409 },
        );
      }
```

Apply the identical `.eq('updated_at', ...)` + zero-rows-409 pattern to the counter/decline update at lines 304-307 (it could otherwise flip a just-auto-approved reschedule back to rejected).

- [ ] **Step 4: Run the full confirm suite** → all pass (old + new).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/appointments/confirm
git commit -m "fix(api): confirm route rejects stale slot accepts and races with reschedules"
```

---

### Task 6: `accept-counter-proposal` notifies the homeowner

**Files:**
- Modify: `src/app/api/appointments/accept-counter-proposal/route.ts` (select at line 53; after the cleaner event at line 206)
- Test: `src/app/api/appointments/accept-counter-proposal/route.integration.test.ts` (extend)

- [ ] **Step 1: Failing test** (in the existing suite):

```ts
it('notifies the homeowner that the time is settled', async () => {
  const { org, appointmentId, suggestedTimeId } = await seedCounterProposal();
  await callAccept({ appointmentId, organizationId: org.organizationId, suggestedTimeId }, org.admin.accessToken);
  const { data } = await admin.from('notification_events')
    .select('event_type, recipient_user_id').eq('appointment_id', appointmentId);
  expect((data ?? []).some((e) => e.event_type === 'appointment_time_changed' && e.recipient_user_id === org.homeowner.userId)).toBe(true);
});
```

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**: add `homeowner_id` to the select on line 53, and after the existing `cleaner_counter_accepted` emit (line 206):

```ts
    // Decision 4 (spec): both settle paths tell the homeowner the final time.
    if ((appointment as { homeowner_id: string | null }).homeowner_id) {
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'appointment_time_changed',
        appointment_id: appointmentId,
        organization_id: organizationId,
        recipient_user_id: (appointment as { homeowner_id: string }).homeowner_id,
        payload: {
          ...cleanerCtx,
          audience: 'homeowner',
          scheduled_date: pickedDate,
          scheduled_time: pickedTime,
        },
      });
    }
```

- [ ] **Step 4: Run** the suite → PASS. **Step 5: Commit** (`fix(api): accept-counter-proposal tells the homeowner the settled time`).

---

### Task 7: `PATCH /api/appointments/[appointmentId]/details`

**Files:**
- Create: `src/app/api/appointments/[appointmentId]/details/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/details/route.integration.test.ts`

**Interfaces:**
- Produces (used by Task 12): `PATCH` body `{ organizationId, serviceTypeId, checklistId, priceOverrideEnabled, priceOverrideTotal, specialRequests, notes }`; responses `200 { success: true }`, `409 { stale: true }`, `409 { paidGuard: true }`, `400`/`403`/`404`.

- [ ] **Step 1: Failing integration tests** (same harness as Task 4; `PATCH` handler called with `method: 'PATCH'`):

```ts
describe('PATCH /api/appointments/[appointmentId]/details', () => {
  it('a notes-only save never touches price or duration (change-driven recompute)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, totalPrice: 77 });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: 'Gate code 4482', notes: 'prefers mornings',
    });
    expect(res.status).toBe(200);
    const row = await getRow(appt.id);
    expect(row).toMatchObject({ total_price: 77, duration_minutes: 60, special_requests: 'Gate code 4482', notes: 'prefers mornings' });
  });

  it('a service change reprices (base + adder) and re-durations', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const { data: svc } = await admin.from('service_types').insert({
      organization_id: org.organizationId, name: 'Deep', base_price: 160, duration_minutes: 120, service_type: 'deep',
    }).select('id').single();
    const { data: cl } = await admin.from('checklists').insert({
      service_type_id: (svc as { id: string }).id, name: 'Standard deep', price_adder: 20,
    }).select('id').single();
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: (svc as { id: string }).id, checklistId: (cl as { id: string }).id,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: null,
    });
    expect(res.status).toBe(200);
    expect(await getRow(appt.id)).toMatchObject({ total_price: 180, duration_minutes: 120, checklist_id: (cl as { id: string }).id });
  });

  it('rejects a checklist that belongs to a different service', async () => { /* seed second service + its checklist; expect 400 */ });

  it('override on requires a valid total; off nulls price_override_total', async () => {
    // enabled + null total → 400; enabled + 250 → total_price 250, pair consistent;
    // then disabled → price_override_total null, total back to system total.
  });

  it('paid guard blocks price-affecting edits (legacy NULL charge_kind counts; cancellation_fee does not)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    await admin.from('payments').insert({
      organization_id: org.organizationId, appointment_id: appt.id, amount: 100,
      payment_method: 'manual', payment_type: 'revenue', status: 'paid',
    });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: true, priceOverrideTotal: 250, specialRequests: null, notes: null,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ paidGuard: true });
    // notes-only save still works with the paid row present:
    const notesOnly = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, serviceTypeId: appt.serviceTypeId, checklistId: null,
      priceOverrideEnabled: false, priceOverrideTotal: null, specialRequests: null, notes: 'ok',
    });
    expect(notesOnly.status).toBe(200);
    // a cancellation_fee row alone must NOT block (flip charge_kind and retry the price edit → 200)
  });

  it('gates: manager needs can_edit_bookings; completed booking is 409 stale', async () => { /* mirror Task 4 patterns */ });
});
```

Write all the abbreviated cases as full tests in the actual file (each comment line above becomes real seeding + assertions following the shown patterns).

- [ ] **Step 2: Verify failure.** **Step 3: Implement:**

```ts
// src/app/api/appointments/[appointmentId]/details/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';

/**
 * Edit-details save for the redesign booking sheet (spec: docs/superpowers/specs/
 * 2026-07-09-reschedule-edit-booking-design.md). Never touches schedule, cleaner,
 * or confirmation state. Recompute is CHANGE-DRIVEN: total_price/duration_minutes
 * are rewritten only when service/checklist/override actually differ from the
 * stored row, so a notes-only save can never silently reprice a booking.
 */
interface DetailsBody {
  organizationId: string;
  serviceTypeId: string;
  checklistId: string | null;
  priceOverrideEnabled: boolean;
  priceOverrideTotal: number | null;
  specialRequests: string | null;
  notes: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = (await request.json()) as DetailsBody;
    const { organizationId, serviceTypeId, checklistId } = body;
    if (!organizationId || !serviceTypeId) {
      return NextResponse.json(
        { success: false, error: 'organizationId and serviceTypeId are required' },
        { status: 400 },
      );
    }
    if (body.priceOverrideEnabled && !(Number.isFinite(body.priceOverrideTotal) && (body.priceOverrideTotal as number) >= 0)) {
      return NextResponse.json(
        { success: false, error: 'priceOverrideTotal must be a number >= 0 when the override is enabled' },
        { status: 400 },
      );
    }

    const auth = await requireManagerPermission(request, organizationId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
    });
    if (!auth.ok) return auth.response;

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, status, service_type_id, checklist_id, price_override_enabled, price_override_total, total_price')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking can no longer be edited' },
        { status: 409 },
      );
    }

    const { data: service } = await supabaseAdmin
      .from('service_types')
      .select('id, organization_id, base_price, duration_minutes')
      .eq('id', serviceTypeId)
      .maybeSingle();
    if (!service || service.organization_id !== organizationId) {
      return NextResponse.json({ success: false, error: 'Service not in this organization' }, { status: 400 });
    }

    // checklists have NO organization_id column; org scoping is transitive via
    // the service, and the service-match check also blocks cross-service adder
    // corruption (mirrors /api/appointments/request).
    let checklistAdder = 0;
    if (checklistId) {
      const { data: checklist } = await supabaseAdmin
        .from('checklists')
        .select('id, service_type_id, price_adder')
        .eq('id', checklistId)
        .maybeSingle();
      if (!checklist || checklist.service_type_id !== serviceTypeId) {
        return NextResponse.json(
          { success: false, error: 'Checklist does not match the selected service type' },
          { status: 400 },
        );
      }
      checklistAdder = Number(checklist.price_adder) || 0;
    }

    const serviceChanged = serviceTypeId !== appt.service_type_id;
    const checklistChanged = (checklistId ?? null) !== ((appt.checklist_id as string | null) ?? null);
    const storedOverrideEnabled = !!appt.price_override_enabled;
    const storedOverrideTotal = appt.price_override_total == null ? null : Number(appt.price_override_total);
    const overrideChanged =
      body.priceOverrideEnabled !== storedOverrideEnabled ||
      (body.priceOverrideEnabled && Number(body.priceOverrideTotal) !== storedOverrideTotal);
    const priceAffecting = serviceChanged || checklistChanged || overrideChanged;

    if (priceAffecting) {
      // Reconcile-parity predicate: a collected or in-flight revenue charge locks
      // the money fields. NULL charge_kind must block (legacy Stripe charges and
      // manual recorded payments carry no charge_kind); only cancellation_fee
      // rows are exempt.
      const { data: paidRows } = await supabaseAdmin
        .from('payments')
        .select('id, status, payment_type, charge_kind')
        .eq('appointment_id', appointmentId)
        .eq('payment_type', 'revenue')
        .in('status', ['paid', 'processing']);
      const blocking = ((paidRows ?? []) as Array<{ charge_kind: string | null }>).filter(
        (p) => p.charge_kind !== 'cancellation_fee',
      );
      if (blocking.length > 0) {
        return NextResponse.json(
          { success: false, paidGuard: true, error: 'A payment already exists for this booking, so its price cannot change' },
          { status: 409 },
        );
      }
    }

    const update: Record<string, unknown> = {
      special_requests: body.specialRequests?.trim() ? body.specialRequests.trim() : null,
      notes: body.notes?.trim() ? body.notes.trim() : null,
      updated_at: new Date().toISOString(),
    };
    if (priceAffecting) {
      update.service_type_id = serviceTypeId;
      update.checklist_id = checklistId ?? null;
      update.price_override_enabled = body.priceOverrideEnabled;
      update.price_override_total = body.priceOverrideEnabled ? body.priceOverrideTotal : null;
      update.total_price = body.priceOverrideEnabled
        ? body.priceOverrideTotal
        : Number(service.base_price) + checklistAdder;
      if (serviceChanged) update.duration_minutes = service.duration_minutes;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('appointments')
      .update(update)
      .eq('id', appointmentId)
      .in('status', ['pending', 'confirmed'])
      .select('id');
    if (updErr) return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { success: false, stale: true, error: 'This booking changed. Refresh and try again.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in appointments/[appointmentId]/details PATCH:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** (`feat(api): change-driven booking details route with paid-charge guard`).

---

### Task 8: Create-flow price fix (checklist adder)

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts:21-24` (`effectiveTotalUsd`)
- Modify: `src/components/redesign/bookings/new-booking/buildBookingInsert.ts` (call site), `buildRecurringPayload.ts:53`, `useCreateOperatorBooking.ts` (thread the checklist), `OperatorBookingForm.tsx` (price display/seed + pass checklist)
- Modify: `src/app/api/appointments/request/route.ts` (checklist select + `total_price`)
- Test: `deriveOperatorBooking.test.ts`, `buildBookingInsert.test.ts`, `buildRecurringPayload.test.ts`, `src/app/api/appointments/request/route.integration.test.ts` (extend each)

- [ ] **Step 1: Failing tests.** New cases: `effectiveTotalUsd` adds the adder when no override (`expect(effectiveTotalUsd(state, service, { price_adder: 20 })).toBe(120)`), override still wins; `buildBookingInsert`/`buildRecurringPayload` write `total_price`/`totalPrice` = base + adder; request route inserts `total_price` = base + adder when a checklist is sent.

- [ ] **Step 2: Verify failures.** **Step 3: Implement:**

`effectiveTotalUsd` gains an optional third param (all callers updated in the same commit):

```ts
/** The price charged: an operator override if set, else service base + checklist adder (dollars). */
export function effectiveTotalUsd(
  s: OperatorBookingState,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): number {
  if (s.priceOverride != null) return s.priceOverride;
  return (service?.base_price ?? 0) + (checklist?.price_adder ?? 0);
}
```

Thread `checklist` through: `buildBookingInsert(orgId, state, service, deadline, checklist)` and `buildRecurringPayload(orgId, state, service, checklist)` (add the param, pass to `effectiveTotalUsd`); `useCreateOperatorBooking`'s `mutationFn` input gains `checklist: { price_adder: number } | null`; `OperatorBookingForm` finds it (`const checklist = checklists.find((c) => c.id === state.checklistId) ?? null` from its existing `useChecklists` data) and passes it to the create call, the footer total, and the price input's placeholder seed.

In `src/app/api/appointments/request/route.ts`: the checklist lookup already exists (select gains `price_adder`); change the insert's `total_price: serviceType.base_price` to `total_price: serviceType.base_price + (checklistAdder ?? 0)` with `checklistAdder` captured from the lookup.

- [ ] **Step 4: Run** `npm run test:unit` + `npm run test:integration -- request` → PASS; `npx tsc --noEmit` no new errors.

- [ ] **Step 5: Commit** (`fix(bookings): create flows include the checklist price adder in total_price`).

---

### Task 9: Data layer — feedback `cleaner_id`, VM raw fields, `useRankedCleaners` exclusion

**Files:**
- Modify: `src/hooks/useAdminData.ts` (type lines 95-109; select lines 250-255)
- Modify: `src/components/redesign/bookings/booking-vm.ts` (export `fmtTime`/`monthDay`; raw fields on proposals/windows), `src/components/redesign/bookings/bookings-types.ts` (`CounterProposal`, `CounterWindow`)
- Modify: `src/components/redesign/bookings/new-booking/useRankedCleaners.ts`
- Test: `src/components/redesign/bookings/booking-vm.test.ts` (extend)

- [ ] **Step 1: Failing test** — extend `booking-vm.test.ts`: `toDetailVM` counter proposals carry `{ date: '2026-03-06', time: '09:00:00' }` raw fields and windows carry `{ date, startTime, endTime }`.

- [ ] **Step 2 → 3: Implement.**
  - `useAdminData.ts`: add `cleaner_id: string;` to the feedback entry type and `cleaner_id,` to the select's feedback join.
  - `booking-vm.ts`: add `export` to `fmtTime` and `monthDay`; extend the `counterProposals` mapper to `{ id, label, date: t.suggested_date, time: t.suggested_time }` and `counterWindows` to `{ id, label, date: w.window_date, startTime: w.start_time, endTime: w.end_time }`.
  - `bookings-types.ts`: extend `CounterProposal` with `date: string; time: string;` and `CounterWindow` with `date: string; startTime: string; endTime: string;`.
  - `useRankedCleaners.ts`: add a third param and thread it:

```ts
export function useRankedCleaners<C extends CleanerLike>(
  cleaners: C[],
  candidate: RankCandidate | null,
  excludeAppointmentId?: string | null,
): CleanerAvailability<C>[] {
```

Include it in the queryKey (`excludeAppointmentId ?? 'none'` as a fifth element — a filtered cache entry must never be served to the new-booking flow) and skip the row while grouping: `if (!row.cleaner_id || row.id === excludeAppointmentId) continue;`.

- [ ] **Step 4: Run** `npx vitest run src/components/redesign/bookings` → PASS; `npx tsc --noEmit` clean of new errors (existing `useRankedCleaners` callers are unaffected by the optional param).

- [ ] **Step 5: Commit** (`feat(bookings): suggestion ownership + raw times in VM, self-excluding cleaner ranking`).

---

### Task 10: `deriveReschedule` + `useRescheduleBooking`

**Files:**
- Create: `src/components/redesign/bookings/reschedule/deriveReschedule.ts`
- Create: `src/components/redesign/bookings/reschedule/useRescheduleBooking.ts`
- Test: `src/components/redesign/bookings/reschedule/deriveReschedule.test.ts`

**Interfaces:**
- Consumes: Task 1 module, Task 9 raw VM/`cleaner_id`, `bookableTimeOptions` (`src/components/redesign/homeowner/booking/time-options.ts`), `findConflicts`, `fmtTime`/`monthDay` from `../booking-vm`, `keys` from `@/lib/queryKeys`.
- Produces (Task 11): `suggestionInputsFor(a: AdminAppointment): SuggestionInputs`; `ownedChips(a): RescheduleChip[]`; `timePillOptions(constraint): Array<{ value; label }>`; `conflictFor(appointments, sel, excludeId): { label } | null`; `outcomeLine(...)`, `primaryLabel(...)`; hook `useRescheduleBooking(appointmentId)` → `{ reschedule(body): Promise<{ outcome }> , saving }` throwing errors tagged `{ conflict?, stale? }`.

- [ ] **Step 1: Failing tests** covering: chips include only the current cleaner's suggestions; `timePillOptions` with window `13:15-15:40` starts with `13:15` then `14:00`, `15:00` (closed interval, start always present); `outcomeLine` renders all six spec variants + the series line and `primaryLabel` returns "Confirm reschedule" / "Send to Maria" / "Reschedule anyway"; `conflictFor` finds an overlap and excludes the booking itself.

- [ ] **Step 2 → 3: Implement.** Pure module (no React). Key functions:

```ts
export interface RescheduleSelection { date: string | null; time: string | null; cleanerId: string | null }
export interface RescheduleChip {
  kind: 'time' | 'window';
  id: string;
  label: string;           // "Mar 6 at 9:00am" / "Mar 7, 1:00pm to 4:00pm" (booking-vm vocabulary)
  date: string;
  time?: string;           // exact-time chips
  startTime?: string; endTime?: string; // window chips
}

export function suggestionInputsFor(a: AdminAppointment): SuggestionInputs { /* flatten a.cleaner_availability_feedback with cleaner_id */ }

export function ownedChips(a: AdminAppointment): RescheduleChip[] {
  const fb = (a.cleaner_availability_feedback ?? []).filter((f) => f.cleaner_id === a.cleaner_id);
  // times → { kind:'time', label: `${monthDay(d)} at ${fmtTime(t)}` , date, time }
  // windows → { kind:'window', label: `${monthDay(d)}, ${fmtTime(s)} to ${fmtTime(e)}`, date, startTime, endTime }
}

export function timePillOptions(constraint: { startTime: string; endTime: string } | null) {
  const base = bookableTimeOptions();
  if (!constraint) return base;
  const start = normalizeTimeHHMM(constraint.startTime)!;
  const end = normalizeTimeHHMM(constraint.endTime)!;
  const clipped = base.filter((t) => t.value >= start && t.value <= end);
  if (!clipped.some((t) => t.value === start)) {
    clipped.unshift({ value: start, label: fmtTime(`${start}:00`) });
  }
  return clipped; // the window's exact start is ALWAYS offered (auto-approve guaranteed)
}

export function conflictFor(
  appointments: AdminAppointment[], sel: RescheduleSelection, excludeId: string,
): { label: string } | null { /* build ScheduleAppointment[] for sel.cleanerId, findConflicts, label from the hit's property/customer + fmtTime */ }

export function outcomeFor(a, sel, payoutModel) { /* decideRescheduleOutcome over suggestionInputsFor(a) */ }

export function outcomeLine(args: {
  outcome: RescheduleOutcome; cleanerName: string | null; cleanerChanged: boolean;
  escalatedUnassigned: boolean; tier: 4 | 24 | null;
}): string { /* the six spec variants; re-ask: `${name} will be asked to re-confirm this time. They will have ${tier} hours to respond.` */ }

export function seriesLine(a: AdminAppointment): string | null {
  return a.series_id ? 'Part of a repeating series. This change applies to this cleaning only.' : null;
}

export function primaryLabel(outcome: RescheduleOutcome, hasConflict: boolean, cleanerFirstName: string | null): string {
  if (hasConflict) return 'Reschedule anyway';
  if (!outcome.settled) return cleanerFirstName ? `Send to ${cleanerFirstName}` : 'Send to cleaner';
  return 'Confirm reschedule';
}
```

`useRescheduleBooking.ts` mirrors `useCreateOperatorBooking`'s shape:

```ts
export function useRescheduleBooking(appointmentId: string) {
  const { currentOrganizationId, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (body: { scheduledDate: string; scheduledTime: string; cleanerId: string | null; force?: boolean }) => {
      const res = await fetch(`/api/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ organizationId: currentOrganizationId, ...body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw Object.assign(new Error(json?.error || 'Could not reschedule'), {
          conflict: !!json?.conflict, stale: !!json?.stale,
        });
      }
      return json as { success: true; outcome: 'settled' | 'awaiting' };
    },
    onSuccess: () => {
      if (currentOrganizationId) {
        // Sibling keys: byOrg does NOT cascade to action items.
        queryClient.invalidateQueries({ queryKey: keys.appointments.byOrg(currentOrganizationId) });
        queryClient.invalidateQueries({ queryKey: keys.appointments.actionItemsByOrg(currentOrganizationId) });
      }
    },
  });
  return { reschedule: mutation.mutateAsync, saving: mutation.isPending };
}
```

- [ ] **Step 4: Run** unit tests → PASS. **Step 5: Commit** (`feat(bookings): reschedule derivation + mutation hook`).

---

### Task 11: `RescheduleDialog` + sheet affordances + host wiring

**Files:**
- Create: `src/components/redesign/bookings/reschedule/RescheduleDialog.tsx`
- Modify: `src/components/redesign/bookings/BookingDetailSheet.tsx` (props lines 40-60; action grid lines 255-276; proposal rows 195-221; window rows 223-243)
- Modify: `src/components/redesign/bookings/OperatorBookingDetailHost.tsx` (`handleAssign` 107-120; `handleReschedule` 147-151 DELETED; new dialog state)

**Interfaces:**
- Consumes: Tasks 9-10; `Dialog/DialogContent` (`@/components/ui/dialog`), `Popover` + `Calendar`, `EntityPickerField`, `ConfirmDialog`, `useRankedCleaners(cleaners, candidate, excludeAppointmentId)`, `useAuth().currentOrganization?.default_payout_model` (verify the exact field CleanerToday uses at `src/components/redesign/cleaner/today/CleanerToday.tsx:30` and mirror it).
- Produces: `<RescheduleDialog appointment={AdminAppointment} appointments={AdminAppointment[]} cleaners={CleanerOption[]} canHandleRequests init={{date?,time?,windowId?} | null} onOpenChange onDone />`.

- [ ] **Step 1: Build the dialog** (structure per spec Surface 1; every visual from ui primitives):

```tsx
// RescheduleDialog.tsx (skeleton showing every section; complete the obvious JSX)
export function RescheduleDialog({ appointment: a, appointments, cleaners, canHandleRequests, init, onOpenChange, onDone }) {
  const open = init !== null;
  const { currentOrganization } = useAuth();
  const payoutModel = currentOrganization?.default_payout_model ?? null;
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { reschedule, saving } = useRescheduleBooking(a.id);

  // Seed from init each time the dialog opens (init identity changes per open).
  useEffect(() => {
    if (init) {
      const w = init.windowId ? ownedChips(a).find((c) => c.kind === 'window' && c.id === init.windowId) : null;
      setDate(init.date ?? w?.date ?? a.scheduled_date);
      setTime(init.time ?? (w ? normalizeTimeHHMM(w.startTime!) : normalizeTimeHHMM(a.scheduled_time)));
      setWindowId(init.windowId ?? null);
      setCleanerId(a.cleaner_id ?? null);
    }
  }, [init]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = ownedChips(a);
  const constraint = windowId ? chips.find((c) => c.kind === 'window' && c.id === windowId) ?? null : null;
  const pills = timePillOptions(constraint ? { startTime: constraint.startTime!, endTime: constraint.endTime! } : null);
  const ranked = useRankedCleaners(cleaners, date && time ? { date, time, durationMinutes: a.duration_minutes || 60 } : null, a.id);
  const conflict = date && time && cleanerId ? conflictFor(appointments, { date, time, cleanerId }, a.id) : null;
  const outcome = date && time ? outcomeFor(a, { date, time, cleanerId }, payoutModel) : null;
  const dirty = !!date && (date !== a.scheduled_date || time !== normalizeTimeHHMM(a.scheduled_time) || cleanerId !== (a.cleaner_id ?? null));

  const submit = async () => {
    if (!date || !time) return;
    try {
      const r = await reschedule({ scheduledDate: date, scheduledTime: time, cleanerId, force: !!conflict });
      toast.success(r.outcome === 'settled' ? 'Booking rescheduled' : 'Sent to the cleaner to confirm');
      onDone();
    } catch (e) {
      const err = e as Error & { conflict?: boolean; stale?: boolean };
      if (err.stale) { toast.error('This booking changed. Refresh and try again.'); onDone(); }
      else toast.error(err.message);
    }
  };
  // JSX: Dialog > DialogContent (sm:max-w-md):
  //  - context line: `${a.property?.name || a.property?.address || 'Property'} · ${a.service_type?.name ?? 'Cleaning'} · currently ${monthDay(a.scheduled_date)} at ${fmtTime(a.scheduled_time)}`
  //  - chips row (chips.length > 0): pill buttons; time-chip onClick → setDate/setTime/setWindowId(null); window-chip → setDate(c.date), setTime(normalizeTimeHHMM(c.startTime)), setWindowId(c.id)
  //  - date: Popover trigger button showing monthDay(date) + Calendar (mode single, past disabled), onSelect → setDate(toYMD(d)) and setWindowId(null) when the date leaves the window's date
  //  - time: flex-wrap pill grid from `pills` (+ an extra selected pill when `time` is off-grid), styling copied from TimePickerPopover's pills
  //  - cleaner: canHandleRequests ? <EntityPickerField label="Cleaner" items={ranked.map(...)Free/Busy sublabel} value={cleanerId} onSelect={setCleanerId} /> : read-only Field row with the current cleaner name
  //  - conflict ? warning row (AlertTriangle icon + text; tone via existing badge/muted tokens, refined in Task 13): `${cleanerName} already has a job ${conflict.label}. You can still save.`
  //  - outcome line paragraph: outcomeLine({...}) + seriesLine(a)
  //  - footer: Button variant outline "Cancel" (dirty ? setConfirmDiscard(true) : onDone()) + Button primary {primaryLabel(outcome, !!conflict, firstName)} loading={saving} disabled={!date || !time} onClick={submit}
  //  - <ConfirmDialog open={confirmDiscard} ... title="Discard changes?" confirmLabel="Discard" onConfirm={() => { setConfirmDiscard(false); onDone(); }} />
}
```

Write the full JSX following the sketch; no raw hex, tokens/primitives only; no em dashes in copy.

- [ ] **Step 2: Sheet changes.** In `BookingDetailSheet.tsx`:
  - Props: add `onEditDetails: () => void;` and replace `onReschedule: () => void;` with `onOpenReschedule: (init?: { date?: string; time?: string; windowId?: string }) => void;`.
  - Gates: `const editable = detail ? (detail.status === 'pending' || detail.status === 'confirmed') && canEdit : false;` — the Reschedule button renders on `editable` (Cancel keeps `cancellable`), and a new "Edit details" outline button (icon `Pencil`) joins the action grid on `editable`.
  - Proposal rows (195-221): when `editable`, make the row a `<button type="button">` with `onClick={() => onOpenReschedule({ date: cp.date, time: cp.time })}` (keep the inner Accept button, add `e.stopPropagation()` in its onClick); otherwise keep the static div.
  - Window rows (223-243): replace the hint copy with a per-row "Pick a time" `Button size="sm" variant="secondary"` (`onClick={() => onOpenReschedule({ windowId: w.id })}`), rendered only when `editable`; when not editable keep the static row without the hint sentence.

- [ ] **Step 3: Host wiring.** In `OperatorBookingDetailHost.tsx` `HostInner`:
  - Add `const raw = useMemo(() => appointments.find((x) => x.id === appointmentId) ?? null, [appointments, appointmentId]);` and reuse it inside the existing `detail` memo.
  - Add `const [reschedInit, setReschedInit] = useState<{ date?: string; time?: string; windowId?: string } | null>(null);` and reset it when the sheet closes: `useEffect(() => { if (!open) setReschedInit(null); }, [open]);` (prevents an orphaned dialog when `?booking=` is cleared by navigation).
  - DELETE `handleReschedule` (lines 147-151) and the now-unused `router` usages it held (keep `router` for the message pushes).
  - Repoint `handleAssign` at the reschedule route (decision 9): call `useRescheduleBooking(appointmentId).reschedule({ scheduledDate: raw.scheduled_date, scheduledTime: normalizeTimeHHMM(raw.scheduled_time)!, cleanerId })`; on `err.conflict` → `toast.error('That cleaner has a conflicting job at that time. Use Reschedule to override.')`; on success `toast.success('Cleaner assigned')` + `refetch()`.
  - Render `<RescheduleDialog appointment={raw} appointments={appointments} cleaners={cleanerOptions} canHandleRequests={canHandleRequests} init={reschedInit} onOpenChange={(o) => { if (!o) setReschedInit(null); }} onDone={() => { setReschedInit(null); void refetch(); }} />` beside the ConfirmDialog (only when `raw`).
  - Sheet props: `onOpenReschedule={(init) => setReschedInit(init ?? {})}`, `onEditDetails` (Task 12 fills it; wire a no-op `() => {}` + TODO-free placeholder by passing the Task 12 state setter now if executing sequentially, else land Tasks 11+12 together — both tasks touch the same files; keep them as separate commits but run the full gate after Task 12).
  - Stale one-click accepts (spec Errors section): in `handleAcceptCounter`, when `acceptCounterProposal` fails after a concurrent reschedule deleted the suggestion (its 404 "Suggested time not found" / 409 "not awaiting counter-proposal acceptance"), show the friendly toast `'This booking changed. Refresh and try again.'` instead of the raw server message (branch on `r.error` containing `'Suggested time'` or `'not awaiting'`, or preferably on a `status` field if the helper exposes one), then `void refetch()`.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` (no new errors), `npm run test`, and a manual click-through with `npm run dev`: bookings row → sheet → Reschedule opens the dialog prefilled with the current schedule; a proposal row prefills its time; the window row's "Pick a time" constrains pills and the start time is offered; a conflicting pick shows the warning and "Reschedule anyway"; saving closes the dialog, keeps the sheet, refreshes the row.

- [ ] **Step 5: Commit** (`feat(operator): native reschedule dialog replaces the legacy escape`).

---

### Task 12: Edit details — seed/build/hook/form + sheet body swap

**Files:**
- Create: `src/components/redesign/bookings/edit/seedEditDetails.ts` (+ `.test.ts`), `buildDetailsPatch.ts` (+ `.test.ts`), `useEditBookingDetails.ts`, `EditBookingDetailsForm.tsx`
- Modify: `src/components/redesign/bookings/BookingDetailSheet.tsx` (body swap), `OperatorBookingDetailHost.tsx` (pass `appointment` raw prop)

**Interfaces:**
- Consumes: Task 7 route; `useServices()` / `useChecklists(serviceTypeId)`; `EntityPickerField`; `ConfirmDialog`.
- Produces: `seedEditDetails(a: AdminAppointment): EditDetailsState`; `buildDetailsPatch(state: EditDetailsState): DetailsPatchBody`; `useEditBookingDetails(appointmentId)`; `<EditBookingDetailsForm appointment onDone />`.

- [ ] **Step 1: Failing unit tests.**

```ts
// seedEditDetails.test.ts — key cases:
it('seeds override from the stored pair', () => { /* enabled + 250 → { overrideEnabled: true, overrideTotal: 250 } */ });
it('treats enabled=true with null total as override OFF seeded from total_price', () => {
  const s = seedEditDetails({ ...base, price_override_enabled: true, price_override_total: null, total_price: 120 });
  expect(s).toMatchObject({ overrideEnabled: false, overrideTotal: null });
});
it('carries service/checklist/requests/notes through', () => { /* ... */ });

// buildDetailsPatch.test.ts:
it('trims requests/notes to null and nulls the override total when disabled', () => { /* ... */ });
```

- [ ] **Step 2 → 3: Implement.**

```ts
// seedEditDetails.ts
export interface EditDetailsState {
  serviceTypeId: string | null;
  checklistId: string | null;
  overrideEnabled: boolean;
  overrideTotal: number | null;
  specialRequests: string;
  notes: string;
}
export function seedEditDetails(a: AdminAppointment): EditDetailsState {
  const overrideEnabled = !!a.price_override_enabled && a.price_override_total != null;
  return {
    serviceTypeId: a.service_type_id ?? null,
    checklistId: a.checklist_id ?? null,
    overrideEnabled,
    overrideTotal: overrideEnabled ? Number(a.price_override_total) : null,
    specialRequests: a.special_requests ?? '',
    notes: a.notes ?? '',
  };
}

// buildDetailsPatch.ts
export interface DetailsPatchBody { serviceTypeId: string; checklistId: string | null; priceOverrideEnabled: boolean; priceOverrideTotal: number | null; specialRequests: string | null; notes: string | null }
export function buildDetailsPatch(s: EditDetailsState): DetailsPatchBody { /* trim-to-null, override pair consistency */ }
```

`useEditBookingDetails(appointmentId)`: same shape as `useRescheduleBooking` but `PATCH /api/appointments/${appointmentId}/details`, tagging `{ stale, paidGuard }` on errors; invalidates the same two keys. `paidGuard` error message shown verbatim: "A payment already exists for this booking, so its price cannot change."

`EditBookingDetailsForm.tsx`: seeds `useState(seedEditDetails(appointment))`; `useServices()` + `useChecklists(state.serviceTypeId)` supply `EntityPickerField` items — prepend the appointment's current service/checklist when missing from the fetched list, labeled `"<name> (inactive)"`; the checklist picker gets a leading `{ id: '__none__', label: 'No checklist' }` item mapping to `null`; service change clears the checklist; the price block mirrors `OperatorBookingForm`'s (system total = base + adder, override `Input` + Reset ghost button; helper copy exactly: "Changing the service or checklist updates the price, and the service updates the duration, unless you override."); textareas for requests/notes; header line with the read-only schedule + "use Reschedule to change"; footer Cancel (dirty → ConfirmDialog "Discard changes?") + "Save changes" (loading); on success `toast.success('Booking updated')` + `onDone()`.

Sheet body swap in `BookingDetailSheet.tsx`: extract the current body children (everything inside the `SheetContent` when `detail` exists) into a `DetailBody` component defined in the same file, which holds `const [page, setPage] = useState<'view' | 'edit'>('view')`. Because `DetailBody` is a child of `SheetContent`, Radix unmounts it on close so a reopened sheet always starts in view mode (this is the load-bearing reason for the extraction; do NOT hold the page state on `BookingDetailSheet` itself). `page === 'edit'` renders `<EditBookingDetailsForm appointment={appointment} onDone={() => setPage('view')} />` instead of the view body; the "Edit details" button does `setPage('edit')`. New sheet prop: `appointment: AdminAppointment | null` (the raw row, passed from the host's `raw`).

- [ ] **Step 4: Verify.** Unit tests pass; `npx tsc --noEmit`; manual: Edit details swaps the body, a notes-only save round-trips without changing the displayed total, service change updates price+duration, closing and reopening the sheet lands in view mode, dirty guard fires.

- [ ] **Step 5: Commit** (`feat(operator): edit-details body swap in the booking sheet`).

---

### Task 13: Conformance pass, docs, gates, PR

**Files:**
- Modify: `docs/redesign/2026-07-09-functionality-audit.md` (R2 line 46, R3 line 47 → `✅ Fixed (this PR)`; §2 Reschedule row line 30 → resolved; R12 line 56 note: only the Fix card (R6) still escapes; §7 item 3 note)

- [ ] **Step 1: ui-ux-pro-max implementation-phase pass** (required by ui-feature-workflow): run the skill's checklist against the two new surfaces — no raw hex or off-system styling (grep the new files for `#[0-9a-fA-F]{3,6}`), touch targets, visible labels, error placement, `loading` states on async buttons, focus states from primitives, no em dashes (`grep -rn "—" src/components/redesign/bookings/reschedule src/components/redesign/bookings/edit` must return nothing). Refine the conflict-warning and outcome-line tones to existing badge/token vocabulary (`bookings-presenters.tsx`) if Task 11 used placeholders.
- [ ] **Step 2: Full gates.** `npm run test` (all), `npx tsc --noEmit` (no new errors), `npm run lint` (changed files clean), `npx supabase start` + `npm run test:integration` green.
- [ ] **Step 3: Update the audit doc** rows listed above; commit (`docs: mark R2/R3 shipped in the functionality audit`).
- [ ] **Step 4: Push + PR** to `master` titled `feat(operator): native reschedule + edit-booking surfaces (R2/R3)`, body summarizing: the two surfaces, the outcome policy, the three latent bugs fixed (routing-log clobber, stale-slot accept, create-flow adder), flag that `?booking=` deep-links now never leave the shell. End the body with the required generation footer. Wait for the four required checks; do NOT merge without Bridger's approval.
- [ ] **Step 5: After checks are green**, report status to Bridger with a click-through list (reschedule from a proposal row, window pick, conflict override, employee-org copy, edit-details notes-only save).

## Self-review notes (already applied)

- Spec coverage: every spec section maps to a task (Surface 1 → 10/11; Surface 2 → 12; route 1 → 4; confirm hardening → 5; accept-counter homeowner → 6; route 2 → 7; create-flow fix → 8; data layer → 9; notifications → 2; helpers → 3; audit/PR → 13).
- The `onEditDetails`/`onOpenReschedule` prop names, `EditDetailsState`, `DetailsPatchBody`, `RescheduleChip`, and hook signatures are consistent across Tasks 10-12.
- Open verification points called out inline (routing-log pending representation in Task 4; `currentOrganization.default_payout_model` accessor in Task 11; synthesized slot index confirmed = 0 in `job-presenters.ts:128-132`).
