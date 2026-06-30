# Sub-project 3: Homeowner "New conversation" flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add a "New conversation" entry point to the homeowner Messages tab: a sheet offering **Message office** (opens the shared office thread) or **a cleaning** -> a picker listing only appointments whose messaging window is currently open -> opens that cleaner's per-appointment thread. No free cleaner picker; cleaners are reachable only via an appointment.

**Architecture:** A pure derive (`messageableCleanings`) filters the homeowner's appointments to those with an open job-messaging window. A `NewConversationSheet` (vaul Drawer, like `CancelCleaningSheet`) presents the office option + the messageable-cleanings list. `HomeownerMessages` (container) computes the list + opens threads via the existing `useOpenMessageThread` (`openOffice`/`openJob`); `HomeownerMessagesView` renders the trigger. All existing thread plumbing (the layout-mounted thread host) is reused; this only adds an entry point.

**Tech Stack:** Next.js `(redesign)` route group, React 19, Tailwind v3 design system, Vitest.

## Global Constraints
- Design system only (`src/components/ui/*` + tokens); no raw hex; **no `primary-<number>`** (legacy yellow; bare `primary` = brand blue is fine); semantic shades `-50`/`-700`.
- **No em dashes** in user-facing copy. Homeowner-facing copy says **"office"**, never "operator".
- Reuse existing primitives + patterns (vaul `Drawer` from `src/components/ui/drawer.tsx`, as `CancelCleaningSheet` does; `Avatar`/`Button`). Do not invent one-offs.
- Independent of the office-chain sub-projects (1a/1b); uses the existing office + job thread open paths.

---

## Task 1: Pure `messageableCleanings` derive (TDD)

**Files:**
- Create: `src/components/redesign/homeowner/messages/messageableCleanings.ts`
- Test: `src/components/redesign/homeowner/messages/messageableCleanings.test.ts`

**Interfaces:**
- Consumes: `Appointment` (`@/hooks/useHomeownerData`), `isJobMessagingWindowOpen` (`@/lib/messaging/jobMessagingWindow`).
- Produces: `messageableCleanings(appointments: Appointment[], now: Date) => MessageableCleaning[]` where `MessageableCleaning = { appointmentId, cleanerName, dateLabel, serviceLabel }`.

- [ ] **Step 1: Write the failing test**

Create `messageableCleanings.test.ts`. Mirror the existing `deriveHomeownerInbox.test.ts` `appt()` factory shape (same fields: `id, scheduled_date, scheduled_time, status, cleaner_id, cleaner_confirmation_status, completed_at, cancelled_at, cleaner_profile.user_profile, service_type`). Assert:
1. an `in_progress` appt with a cleaner -> included (open window), with `cleanerName` from the joined profile, a `dateLabel`, and `serviceLabel` from `service_type.name`.
2. a `confirmed` + `cleaner_confirmation_status='approved'` appt -> included.
3. a `confirmed` + `cleaner_confirmation_status='awaiting'` appt -> excluded (window closed).
4. a `cancelled` appt -> excluded.
5. a `completed` appt past the 24h grace -> excluded; within grace -> included.
6. an appt with no `cleaner_id` -> excluded (no cleaner to message).
7. result sorted by `scheduled_date` ascending (soonest first).

Use `isJobMessagingWindowOpen` for the window decision (do not reimplement it). Exclude any appt with a null `cleaner_id` BEFORE the window check.

- [ ] **Step 2: Run it -> RED.** `npm run test -- src/components/redesign/homeowner/messages/messageableCleanings.test.ts` (module not found).

- [ ] **Step 3: Implement**

```typescript
import type { Appointment } from '@/hooks/useHomeownerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';

export interface MessageableCleaning {
  appointmentId: string;
  cleanerName: string;
  dateLabel: string;
  serviceLabel: string;
}

function cleanerName(a: Appointment): string {
  const u = a.cleaner_profile?.user_profile;
  const n = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
  return n || 'Your cleaner';
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** Appointments the homeowner can start/continue a cleaner thread on right now
 *  (a cleaner is assigned AND the job-messaging window is open), soonest first. */
export function messageableCleanings(appointments: Appointment[], now: Date): MessageableCleaning[] {
  return appointments
    .filter((a) => !!a.cleaner_id)
    .filter((a) =>
      isJobMessagingWindowOpen(
        {
          status: a.status,
          cleaner_confirmation_status: a.cleaner_confirmation_status ?? null,
          completed_at: a.completed_at ?? null,
          cancelled_at: a.cancelled_at ?? null,
        },
        now,
      ),
    )
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .map((a) => ({
      appointmentId: a.id,
      cleanerName: cleanerName(a),
      dateLabel: dateLabel(a.scheduled_date),
      serviceLabel: a.service_type?.name ?? 'Cleaning',
    }));
}
```

- [ ] **Step 4: Run -> GREEN.** Same command. Expected: all assertions pass.

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/homeowner/messages/messageableCleanings.ts src/components/redesign/homeowner/messages/messageableCleanings.test.ts
git commit -m "feat(homeowner-messages): messageableCleanings window-open derive"
```

---

## Task 2: NewConversationSheet + wire into the Messages tab

**Files:**
- Create: `src/components/redesign/homeowner/messages/NewConversationSheet.tsx`
- Modify: `src/components/redesign/homeowner/messages/HomeownerMessages.tsx`
- Modify: `src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx`

**Interfaces:**
- Consumes: `messageableCleanings`, `useHomeownerAppointments`, `useHomeownerOfficeContact`, `useOpenMessageThread`, the vaul `Drawer` primitive.

- [ ] **Step 1: Build `NewConversationSheet`**

Read `src/components/redesign/homeowner/cleanings/CancelCleaningSheet.tsx` first to copy the exact vaul `Drawer` usage (open/onOpenChange, header, content, safe-area). Build a presentational sheet:
```
Props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hasOffice: boolean;                       // an office contact exists
  cleanings: MessageableCleaning[];
  onPickOffice: () => void;                 // -> container calls openOffice
  onPickCleaning: (appointmentId: string) => void;  // -> container calls openJob
}
```
Layout (design-system only): a Drawer titled "New conversation". A first row/button **"Message office"** (calls `onPickOffice`, then closes) shown when `hasOffice`. A section header "Message about a cleaning"; for each `cleanings` entry a tappable row (>=44px button) showing cleaner Avatar/initials + `cleanerName` + `dateLabel` + `serviceLabel`, calling `onPickCleaning(appointmentId)` then closing. When `cleanings` is empty, a muted line "You can message a cleaner once a cleaning is confirmed." No em dashes; tokens only.

- [ ] **Step 2: Wire the container** (`HomeownerMessages.tsx`)

Add the sheet open state + compute the list:
```tsx
const [newOpen, setNewOpen] = useState(false);
const messageable = useMemo(() => messageableCleanings(appointments, new Date()), [appointments]);
// office contact already available via useHomeownerOfficeContact() -> { office }
```
Pass to the View a way to open the sheet (`onNewConversation={() => setNewOpen(true)}`) and render `<NewConversationSheet open={newOpen} onOpenChange={setNewOpen} hasOffice={!!office} cleanings={messageable} onPickOffice={() => { if (office) openOffice(office.id); }} onPickCleaning={(id) => openJob(id)} />`. (Reuse the existing `openOffice`/`openJob` from `useOpenMessageThread`; the layout-mounted thread host opens the takeover.)

- [ ] **Step 3: Add the trigger in the View** (`HomeownerMessagesView.tsx`)

Add an `onNewConversation: () => void` prop. Render a "New conversation" trigger consistent with the redesign (e.g. a compact `Button` with a `Plus`/`PenSquare` lucide icon in the header row beside the "Messages" title, or a small primary action). Keep it within the existing header layout; design-system tokens only; touch target >=44px; accessible label.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` (no new errors in touched files) + `npm run lint`. Grep the new files for `#` hex / `primary-<number>` / em dash / "operator" -> must be clean.

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/homeowner/messages/NewConversationSheet.tsx src/components/redesign/homeowner/messages/HomeownerMessages.tsx src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx
git commit -m "feat(homeowner-messages): New conversation sheet (office + window-open cleaning picker)"
```

---

## Self-Review
- **Spec coverage:** §5.1 "New conversation" (office + window-open appointment picker, no free cleaner picker) implemented; the picker shows only currently-messageable appointments (the user-confirmed "only ones you can message now").
- **Independence:** uses existing `useOpenMessageThread` (`openOffice`/`openJob`) + the layout thread host; touches no office-chain (1a/1b) files; safe to build/merge off master independently.
- **Reuse:** vaul `Drawer` (as `CancelCleaningSheet`), `isJobMessagingWindowOpen`, existing open hooks. No new primitives.
