# Quick-Wires Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every "quick wire" item from `docs/redesign/2026-07-09-functionality-audit.md`: dead controls, legacy deep-link repoints, the auth-redirect flag bug, and cleaner offer slot date labels — as four independent branches/PRs.

**Architecture:** No new surfaces. Every fix wires an existing control to an existing, verified deep-link target or mirrors an existing tested pattern (CleanerThread attachments, ErrorState retry, formatJobWhen). Four slices = four short-lived branches off master, one PR each.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query v5, Vitest 3.

## Global Constraints

- No em dashes in any user-facing copy (UI text, toasts, labels). Use commas/periods.
- Design system only: `src/components/ui/*` primitives + tokens. No raw hex, no `primary-*` yellow.
- Component unit tests are NOT possible (`@testing-library/react` is not installed). TDD applies to pure logic only (`derive*`/presenter files with co-located `*.test.ts`).
- Gates per slice before push: `npm run test:unit`, `npx tsc --noEmit` (no NEW errors vs master baseline), `npm run lint`. Integration suite unaffected (no API routes touched); CI runs it.
- Branch naming: `fix/<slice-name>` off current master. One PR per slice. Merges are user-gated.
- The four slices touch disjoint files; all branch from the same master commit.

## Verified deep-link facts (do not re-derive)

- Bookings detail: `/app/admin-dashboard/bookings?booking=<appointmentId>` (reader: `OperatorBookings.tsx:210` `useDetailParam("booking")`; only works on the bookings route).
- New-booking sheet: `?newbooking=1` on ANY operator route (global host `OperatorShell.tsx:77-81`, gated `canCreateBooking`); setter hook `useOpenOperatorBooking()`.
- Messages: `/app/admin-dashboard/messages` reads `?c=<convId>`, `?job=<apptId>`, `?to=<userId>` (auto-starts conversation), `?appointment=<id>` (stages booking chip with `?to=`).
- Customers person detail: `/app/admin-dashboard/customers?customer=<id>`; Cleaners: `/app/admin-dashboard/cleaners?cleaner=<id>` (cleaner id = user id).
- `QueueItem.id` in the overview IS the appointment id (`OperatorOverview.tsx:52`).

---

# Slice A — branch `fix/redesign-dead-controls`

### Task A0: Branch + commit the audit doc and this plan

- [ ] **Step 1:** `git checkout master && git pull origin master && git checkout -b fix/redesign-dead-controls`
- [ ] **Step 2:** `git add docs/redesign/2026-07-09-functionality-audit.md docs/superpowers/plans/2026-07-09-quick-wires-audit-fixes.md && git commit -m "docs: functionality audit + quick-wires plan"`
- [ ] **Step 3:** Capture the tsc baseline for later comparison: `npx tsc --noEmit 2>&1 | tail -5` (note the error count; pre-existing errors are expected).

### Task A1: Wire the Needs-you-now queue (rows + action buttons)

**Files:**
- Modify: `src/components/redesign/overview/OperatorOverview.tsx` (~line 30 imports, ~line 140 View props)
- Modify: `src/components/redesign/overview/OperatorOverviewView.tsx` (~lines 15-30 props, ~lines 59-64)
- Modify: `src/components/redesign/overview/NeedsYouNowQueue.tsx` (props, row div line 66, Button line 74)

**Interfaces:**
- Produces: `NeedsYouNowQueue` prop `onOpenBooking?: (appointmentId: string) => void`; threaded as `onOpenBooking` through `OperatorOverviewView`.

- [ ] **Step 1:** In `OperatorOverview.tsx`, add `useRouter` (from `next/navigation`) and `useCallback` if not imported, then inside the component:

```tsx
const router = useRouter();
const openBooking = useCallback(
  (id: string) => router.push(`/app/admin-dashboard/bookings?booking=${id}`),
  [router],
);
```

Pass `onOpenBooking={openBooking}` where the View is rendered (near lines 142-144).

- [ ] **Step 2:** In `OperatorOverviewView.tsx`, add `onOpenBooking?: (id: string) => void` to the props type and forward it: `<NeedsYouNowQueue ... onOpenBooking={onOpenBooking} />`.

- [ ] **Step 3:** In `NeedsYouNowQueue.tsx`, add `onOpenBooking?: (id: string) => void` to props. On the row div (line 66-69), add:

```tsx
role="button"
tabIndex={0}
onClick={() => onOpenBooking?.(it.id)}
onKeyDown={(e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onOpenBooking?.(it.id);
  }
}}
```

On the action Button (line 74):

```tsx
<Button
  size="sm"
  variant={g.kind === "counter" ? "secondary" : "default"}
  onClick={(e) => {
    e.stopPropagation();
    onOpenBooking?.(it.id);
  }}
>
```

Both open the booking detail sheet, which already has working Assign / accept-counter / status actions.

- [ ] **Step 4:** `npx tsc --noEmit` (no new errors) and visual sanity via lint: `npm run lint`.
- [ ] **Step 5:** `git add src/components/redesign/overview && git commit -m "fix(overview): wire Needs-you-now rows and action buttons to booking detail"`

### Task A2: Homeowner office-thread image attachments

**Files:**
- Modify: `src/components/redesign/homeowner/messages/HomeownerMessageThread.tsx` (state ~line 60, onSend office branch lines 64-77, composer config lines 114-129)

Mirror `CleanerThread.tsx` exactly (state line 61, wiring lines 120-134, send lines 84-105). Job threads stay content-only (`useSendJobMessage` has no attachment support; `showAddImage` already hides + for job threads).

- [ ] **Step 1:** Add state next to `draft`:

```tsx
const [pendingFiles, setPendingFiles] = useState<File[]>([]);
```

- [ ] **Step 2:** In `onSend`, office branch: change the empty-content guard so a files-only send is allowed for office threads (mirror CleanerThread: `if (!content && pendingFiles.length === 0) return;` — keep the job branch requiring content), pass `attachments: pendingFiles` in the `sendMessage({...})` call, and on success clear them (`setPendingFiles([])`) alongside `setDraft("")`.

- [ ] **Step 3:** In the composer config replace the stubs:

```tsx
pendingFiles,
onAddFiles: (f) => setPendingFiles((p) => [...p, ...f].slice(0, 5)),
onRemoveFile: (i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i)),
```

(`showAddImage: config.kind === 'office'` stays as is.)

- [ ] **Step 4:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5:** `git add src/components/redesign/homeowner/messages && git commit -m "fix(homeowner): wire image attachments in office message thread"`

### Task A3: Settings sections render load failures with retry

**Files:**
- Modify: `src/components/redesign/settings/useSettingsSection.ts`
- Modify (guard in each): `sections/ProfileSection.tsx:31`, `sections/OrganizationSection.tsx:43`, `sections/CancellationSection.tsx:61`, `sections/BusinessHoursSection.tsx:67`, `sections/PayoutSettingsSection.tsx:46`, `sections/CleanerExperienceSection.tsx:55`

**Interfaces:**
- Produces: `useSettingsSection` additionally returns `{ loadError: string | null; retry: () => void }` (loadError already returned, currently unconsumed).

- [ ] **Step 1:** In `useSettingsSection.ts`, add a reload counter and expose `retry`:

```ts
const [reloadKey, setReloadKey] = useState(0);
// in the load effect deps: [load, reloadKey]; at effect start: setLoadError(null);
const retry = useCallback(() => setReloadKey((k) => k + 1), []);
// add `retry` to the returned object
```

- [ ] **Step 2:** In each of the six sections, destructure `loadError, retry` and replace the guard:

```tsx
if (loading) return <SectionSkeleton />;
if (loadError || !value)
  return <ErrorState title="Couldn't load this section" onRetry={retry} />;
```

Import `ErrorState` from `@/components/ui/error-state`. Same two lines in all six files.

- [ ] **Step 3:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 4:** `git add src/components/redesign/settings && git commit -m "fix(settings): show error state with retry when a section fails to load"`

### Task A4: Self-pay company card rows display-only + honest charge highlight

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/BookingPaymentField.tsx` (CardRow lines 26-53, self-pay branch lines 119-137)

- [ ] **Step 1:** Make `onSelect` optional on `CardRow`. When absent, render a `div` (not a `button`) with the same layout but WITHOUT `hover:bg-muted`:

```tsx
function CardRow({ pm, selected, onSelect }: { pm: SavedPaymentMethod; selected: boolean; onSelect?: () => void }) {
  const Icon = pm.type === 'us_bank_account' ? Landmark : CreditCard;
  const inner = (/* existing icon + labels + Check JSX unchanged */);
  const base = 'flex w-full items-center gap-3 rounded-control border p-3 text-left transition-colors';
  const tone = selected ? 'border-brand-600 bg-brand-50' : 'border-border bg-card';
  if (!onSelect) return <div className={`${base} ${tone}`}>{inner}</div>;
  return (
    <button type="button" onClick={onSelect} className={`${base} ${tone} ${selected ? '' : 'hover:bg-muted'}`}>
      {inner}
    </button>
  );
}
```

- [ ] **Step 2:** In the self-pay branch, drop the no-op and mirror the server's charge choice (`methods.find(isDefault) ?? methods[0]`, see `chargeCompletedAppointment.ts:361`):

```tsx
const hasDefault = cards.some((c) => c.isDefault);
...
cards.map((pm, i) => (
  <CardRow key={pm.id} pm={pm} selected={pm.isDefault || (!hasDefault && i === 0)} />
))
```

- [ ] **Step 3:** Read the `onSelfPayChange` reporting block (lines ~98-105). If it reports only the default card and `null` when none is default, align it with the same `?? cards[0]` fallback so the summary reflects what will actually be charged. If it already falls back, leave it.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5:** `git add src/components/redesign/bookings/new-booking && git commit -m "fix(bookings): self-pay company card rows are display-only and show the card that will be charged"`

### Task A5: Marketing demo Fix card / Copy card link simulate like OverviewTab

**Files:**
- Modify: `src/components/marketing/CapabilityExplorer.tsx` (PaymentsTab, failed-charges card lines 249-269; mirror OverviewTab's toast pattern lines 40-53 and 115-121)

- [ ] **Step 1:** Give `PaymentsTab` local state at its top:

```tsx
const [cardFixed, setCardFixed] = React.useState(false)
const [toast, setToast] = React.useState<string | null>(null)
const say = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }
```

- [ ] **Step 2:** Wire the two buttons and make the row react:

```tsx
<Badge variant="secondary" className="px-2 py-0.5 text-[10px]">{cardFixed ? 0 : 1}</Badge>
...
{cardFixed ? (
  <span className="block truncate font-semibold text-positive-700">Chen home · $140 collected</span>
) : (
  /* existing failed row labels */
)}
...
<Button size="sm" className="h-7 px-2.5 text-[11px]" disabled={cardFixed}
  onClick={() => { setCardFixed(true); say('New card saved. Charge collected.') }}>
  Fix card
</Button>
<Button size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]"
  onClick={() => { navigator.clipboard?.writeText('https://demo.nexxus.app/card-link').catch(() => {});
    say('Card update link copied. Text it to the customer.') }}>
  Copy card link
</Button>
```

Render the toast with the same `AnimatePresence` + `role="status"` motion pattern OverviewTab uses (lines 115-121), placed under the failed-charges card. No em dashes in the copy.

- [ ] **Step 3:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 4:** `git add src/components/marketing && git commit -m "fix(marketing): make Payments demo Fix card and Copy card link buttons simulate like the Overview demo"`

### Task A6: Slice A gates + PR

- [ ] **Step 1:** `npm run test:unit` — expect all green (no pure logic touched in this slice; suite must stay green).
- [ ] **Step 2:** `npx tsc --noEmit` — no errors beyond the master baseline captured in A0.
- [ ] **Step 3:** `npm run lint` — clean for touched files.
- [ ] **Step 4:** `git push -u origin fix/redesign-dead-controls` and open a PR to master titled `fix(redesign): wire dead controls from the functionality audit` with a body listing A1-A5 and the audit-doc reference.

---

# Slice B — branch `fix/redesign-legacy-deeplinks`

### Task B1: Operator notification hrefs stay in the redesign shell (TDD)

**Files:**
- Test: `src/components/redesign/notifications/deriveNotifications.test.ts:47-80`
- Modify: `src/components/redesign/notifications/deriveNotifications.ts:79-102`

**Interfaces:**
- Consumes: `notificationTab(event_type, 'admin')` from `@/lib/notifications/navigation` (returns `'bookings' | 'payments' | 'home' | ...`).
- Produces: appointment-scoped operator hrefs of the form `/app/admin-dashboard/bookings?booking=<id>` (or `/app/admin-dashboard/payments` for payment events).

- [ ] **Step 1: Update the tests first** in the `operatorNotificationHref` block:

```ts
expect(operatorNotificationHref({ event_type: 'cleaner_accepted', appointment_id: 'a1' }))
  .toBe('/app/admin-dashboard/bookings?booking=a1');
expect(operatorNotificationHref({ event_type: 'charge_failed', appointment_id: 'a2' }))
  .toBe('/app/admin-dashboard/payments');
expect(operatorNotificationHref({ event_type: 'homeowner_request_submitted', appointment_id: 'a3' }))
  .toBe('/app/admin-dashboard/bookings?booking=a3');
```

(Keep the appointment-less cases unchanged.)

- [ ] **Step 2:** Run `npm run test:unit -- deriveNotifications` — expect the three updated cases to FAIL.
- [ ] **Step 3:** Implement in `operatorNotificationHref`:

```ts
if (item.appointment_id) {
  const tab = notificationTab(item.event_type, 'admin');
  if (tab === 'payments') return '/app/admin-dashboard/payments';
  return `/app/admin-dashboard/bookings?booking=${item.appointment_id}`;
}
```

Before finalizing, check whether `OperatorPayments.tsx` (imports `useSearchParams` at line 4) reads any appointment/payment param; if it does, append it to the payments href; if not, leave the plain route.

- [ ] **Step 4:** `npm run test:unit -- deriveNotifications` — PASS. Update the doc comment at `deriveNotifications.ts:70-78` (it documents the legacy-handoff convention that no longer applies to the operator).
- [ ] **Step 5:** `git add src/components/redesign/notifications && git commit -m "fix(notifications): operator appointment notifications deep-link into the redesign shell"`

### Task B2: Payments Message-cleaner buttons open the redesign thread

**Files:**
- Modify: `src/components/redesign/payments/usePaymentsTriage.ts:287-295` (`messageCleaner`)
- Modify: `src/components/redesign/payments/OperatorPayments.tsx:336-342` (`handleMessage`)

The messages screen's `?to=<userId>` reader (`OperatorMessages.tsx:199-210`) creates/opens the thread itself, so drop the local `startConversation` calls entirely:

- [ ] **Step 1:** In both files replace the handler body:

```ts
const messageCleaner = useCallback(
  (cleanerId: string | null) => {
    router.push(
      cleanerId
        ? `/app/admin-dashboard/messages?to=${cleanerId}`
        : "/app/admin-dashboard/messages",
    );
  },
  [router],
);
```

(same shape for `handleMessage` in `OperatorPayments.tsx`; handlers become synchronous).

- [ ] **Step 2:** Remove the now-unused `useStartConversation` import/wiring from each file IF nothing else in the file uses it (grep within the file first).
- [ ] **Step 3:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 4:** `git add src/components/redesign/payments && git commit -m "fix(payments): Message cleaner opens the redesign thread via ?to= deep link"`

### Task B3: Messages screen — open-booking, new-booking, profile deep links

**Files:**
- Modify: `src/components/redesign/messages/OperatorMessages.tsx:258-288`

- [ ] **Step 1:** `openBooking` → redesign bookings detail:

```ts
const openBooking = useCallback(
  (id: string) => router.push(`/app/admin-dashboard/bookings?booking=${id}`),
  [router],
)
```

- [ ] **Step 2:** `newBooking` → the global in-shell sheet. Import `useOpenOperatorBooking` from `@/components/redesign/bookings/new-booking/useOpenOperatorBooking`, call it at the component top (`const openNewBooking = useOpenOperatorBooking()`), and replace the handler body with `openNewBooking()`. (The shell host is mounted on the messages page and gated on `canCreateBooking`; the ContextPanel button is already gated on `canEditBookings`.)
- [ ] **Step 3:** `viewProfile` → person deep links. FIRST verify the customers id space: read `OperatorCustomers.tsx` around the `?customer=` seed (lines 298-316) and `CustomerDetailSheet` usage (449-465) to confirm the detail id is the customer's USER id (same space as `participant.id`). If it is:

```ts
const viewProfile = useCallback(() => {
  if (!participant) return
  const role = participant.role as UserRole
  if (role === 'cleaner') {
    router.push(`/app/admin-dashboard/cleaners?cleaner=${participant.id}`)
  } else if (role === 'homeowner') {
    router.push(`/app/admin-dashboard/customers?customer=${participant.id}`)
  } else {
    router.push('/app/admin-dashboard/customers')
  }
}, [participant, router])
```

If the customers screen is keyed by a DIFFERENT id (e.g. an org_customers row id), keep the homeowner branch as the plain list route and note it in the PR body — do not guess a mapping.

- [ ] **Step 4:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5:** `git add src/components/redesign/messages && git commit -m "fix(messages): booking chips, New booking, and Profile use redesign deep links"`

### Task B4: Reschedule carries the appointment into the legacy flow (interim)

**Files:**
- Modify: `src/components/redesign/bookings/OperatorBookings.tsx:382-384` (`handleReschedule`) and the `onReschedule` wiring (~line 476-504)

Reschedule intentionally stays on the legacy flow until the redesign reschedule ships (audit gap R2); this just stops dropping the booking:

- [ ] **Step 1:**

```ts
const handleReschedule = useCallback(
  (id: string) => {
    router.push(`/admin-dashboard?tab=bookings&appointment=${id}`);
  },
  [router],
);
```

and wire `onReschedule={() => detail && handleReschedule(detail.id)}` at the sheet. The legacy `useAppointmentPanel` reads `?appointment=` and auto-opens the side panel with its Reschedule action.

- [ ] **Step 2:** `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 3:** `git add src/components/redesign/bookings && git commit -m "fix(bookings): Reschedule hands off to legacy with the appointment id carried"`

### Task B5: Slice B gates + PR

- [ ] **Step 1:** `npm run test:unit` all green (includes the updated deriveNotifications tests).
- [ ] **Step 2:** `npx tsc --noEmit` no new errors; `npm run lint` clean.
- [ ] **Step 3:** Push + PR: `fix(redesign): repoint operator deep-links into the redesign shell`. PR body notes: payments "Fix card" deliberately stays on legacy until audit gap R6 (per-booking payment methods) ships.

---

# Slice C — branch `fix/auth-redirect-redesign-flag`

### Task C1: reset-password + accept-invite use the shared redesign-aware dashboard path

**Files:**
- Modify: `src/app/reset-password/page.tsx` (delete local `getDashboardPath` lines 17-30; usage line 157)
- Modify: `src/app/accept-invite/page.tsx` (delete local `getDashboardPath` lines 29-42; usage line 266)

Pattern to copy is `src/app/login/page.tsx:11-12,27-31`.

- [ ] **Step 1:** In both files: delete the local `getDashboardPath` function and add:

```ts
import { getDashboardPath } from "@/lib/redesign/dashboardPath";
import { redesignUiEnabled } from "@/lib/redesign/flags";
```

- [ ] **Step 2:** Update the call sites:

```ts
// reset-password/page.tsx:157
router.push(role ? getDashboardPath(role, { redesign: redesignUiEnabled() }) : "/");
// accept-invite/page.tsx:266
router.push(getDashboardPath(result.role, { redesign: redesignUiEnabled() }));
```

- [ ] **Step 3:** `npm run test:unit` (dashboardPath tests already cover the helper), `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 4:** Commit `fix(auth): post-success redirects honor the redesign flag via shared getDashboardPath`, push, PR.

---

# Slice D — branch `fix/cleaner-offer-slot-dates`

### Task D1: Pure slot-chip label helper (TDD)

**Files:**
- Modify: `src/components/redesign/cleaner/shared/job-presenters.ts` (add helper near `formatJobWhen`, lines 101-132)
- Test: `src/components/redesign/cleaner/shared/job-presenters.test.ts`

**Interfaces:**
- Consumes: existing `OfferSlot { slot_index; scheduled_date; scheduled_time }`, `formatJobWhen(dateStr, time)` → `"Sat, Jun 27 · 2:00 PM"`, `formatTimeParts(time)` → `{ h, ap }`.
- Produces: `offerSlotChipLabels(slots: OfferSlot[]): string[]` — aligned with input order; includes the date part only when the slots span more than one distinct `scheduled_date`.

- [ ] **Step 1: Write the failing tests** in `job-presenters.test.ts`:

```ts
describe("offerSlotChipLabels", () => {
  it("shows time only when all slots share a date", () => {
    expect(
      offerSlotChipLabels([
        { slot_index: 0, scheduled_date: "2026-03-05", scheduled_time: "10:00:00" },
        { slot_index: 1, scheduled_date: "2026-03-05", scheduled_time: "14:00:00" },
      ]),
    ).toEqual(["10:00 AM", "2:00 PM"]);
  });
  it("shows date and time when slots span days", () => {
    expect(
      offerSlotChipLabels([
        { slot_index: 0, scheduled_date: "2026-03-05", scheduled_time: "10:00:00" },
        { slot_index: 1, scheduled_date: "2026-03-06", scheduled_time: "10:00:00" },
      ]),
    ).toEqual(["Thu, Mar 5 · 10:00 AM", "Fri, Mar 6 · 10:00 AM"]);
  });
  it("single slot is time only", () => {
    expect(
      offerSlotChipLabels([
        { slot_index: 0, scheduled_date: "2026-03-05", scheduled_time: "09:30:00" },
      ]),
    ).toEqual(["9:30 AM"]);
  });
});
```

- [ ] **Step 2:** `npm run test:unit -- job-presenters` — FAIL (`offerSlotChipLabels` not defined).
- [ ] **Step 3:** Implement:

```ts
export function offerSlotChipLabels(slots: OfferSlot[]): string[] {
  const multiDay = new Set(slots.map((s) => s.scheduled_date)).size > 1;
  return slots.map((s) => {
    if (multiDay) return formatJobWhen(s.scheduled_date, s.scheduled_time);
    const t = formatTimeParts(s.scheduled_time);
    return `${t.h} ${t.ap}`;
  });
}
```

- [ ] **Step 4:** `npm run test:unit -- job-presenters` — PASS (verify the exact `formatJobWhen` output format against its existing test at `job-presenters.test.ts:101-108` and adjust the new expectations if the separator differs).
- [ ] **Step 5:** `git checkout master && git pull && git checkout -b fix/cleaner-offer-slot-dates` FIRST (before step 1), then commit: `feat(cleaner): offerSlotChipLabels presenter with date-aware slot labels`.

### Task D2: Render the labels in the offer UI

**Files:**
- Modify: `src/components/redesign/cleaner/shared/OfferActionsBar.tsx:56-74` (multi-slot chips)
- Modify: `src/components/redesign/cleaner/today/CleanerTodayView.tsx:147-161` (single-offer headline)

- [ ] **Step 1:** In `OfferActionsBar.tsx`, compute `const labels = offerSlotChipLabels(slots);` above the chip map and render `{labels[i]}` (map with `(s, i)`) instead of `{t.h} {t.ap}`. Remove the now-unused `formatTimeParts` call in the chip loop if nothing else uses it.
- [ ] **Step 2:** In `CleanerTodayView.tsx`, the single-offer card headline currently renders time only (`{t.h} {t.ap}`, line 158-161). Read the surrounding card: if the card already renders the date elsewhere (e.g. a `formatCardDate` line), leave it; if not, change the headline to `formatJobWhen(o.scheduled_date, o.scheduled_time)` so the offer's date is visible at accept time. Match whichever sibling pattern the Today view already uses for dates.
- [ ] **Step 3:** `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 4:** Commit `fix(cleaner): offer slot chips show dates when slots span days`, push, PR.

---

## Final verification (all slices)

- [ ] All four PRs open with green `CI / typecheck + lint` and `CI / unit + integration`; E2E (preview) green per PR.
- [ ] Adversarial review workflow over the four diffs; fix confirmed findings before handing to the user for merge.
- [ ] No `.env*.local` or `.claude/settings.local.json` in any `git status`.
