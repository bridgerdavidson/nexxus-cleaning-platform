# Redesign Homeowner — Slice 1a (Shell + Home static) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the phone-first Homeowner experience shell + a static Home screen (lifecycle hero for Confirmed/Complete/empty states, pending-request cards, request-a-cleaning entry, notifications bell) in the flag-gated `(redesign)` route group, with **no database migration**.

**Architecture:** Mirror the cleaner app's shell pattern (a `max-w-lg` single column with a sticky top bar + fixed bottom nav). Reuse the existing headless homeowner hooks unchanged. Keep all view logic in pure, unit-tested presenter modules; keep React components thin and verify them visually with Playwright MCP (the redesign fidelity loop). The in-progress live-tracking hero state and its migration are deliberately deferred to Slice 1b.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (design-system tokens in `tailwind.config.js` + `src/app/globals.css`), Vitest, Playwright MCP, TanStack Query, Supabase.

## Global Constraints

- **Design system only.** Build from `src/components/ui/*` primitives + tokens (brand via `brand-600`/`brand-500` etc., Plus Jakarta Sans, warm canvas, `shadow-soft-*`, `rounded-card`/`rounded-pill`). **No raw hex, no mockup styling.** Status/urgency = the Badge/pill vocabulary, never decorative stripes.
- **No em dashes** in any user-facing copy (labels, buttons, toasts). Use a period, comma, parentheses, or "to".
- **Reuse, don't refork:** mirror `CleanerShell`/`CleanerBottomNav`/`CleanerTopBar` structure; reuse `useHomeownerAppointments`, `useHomeownerRequests`, `useHomeownerStats`, `NotificationBell`, `RequestAppointmentButton` unchanged.
- **Path alias:** `@/*` → `./src/*`.
- **Phone-first:** single column `max-w-lg`, touch targets ≥44px, bottom-nav safe-area inset, test at 375px width.
- **No migration in this slice.** Pure UI + routing + presenters.
- **Gates before PR:** `npm run test`, `npx tsc --noEmit`, `npm run lint`; Playwright MCP screenshots vs. the homeowner mockup; one Codex review (`/codex:review --scope branch --base master --wait`) right before push.

## Testing approach

- **Unit (Vitest)** for all pure logic: routing (`dashboardPath`), notification href (`deriveNotifications`), nav-active derivation, and the Home presenters. Co-located `*.test.ts`.
- **Visual (Playwright MCP)** for components: run `npm run dev`, log in as the seed homeowner, navigate to `/app/homeowner-dashboard`, screenshot at 375px, compare to `docs/redesign/mockups/homeowner-shell.html`, iterate with `ui-ux-pro-max` until it matches. (The repo does not use React Testing Library for these screens; do not add it.)

## File structure

**Create:**
- `src/components/redesign/homeowner/shell/homeowner-nav-items.ts` — nav model + `deriveHomeownerActive(pathname)`.
- `src/components/redesign/homeowner/shell/HomeownerBottomNav.tsx` — fixed bottom nav (mirror of `CleanerBottomNav`).
- `src/components/redesign/homeowner/shell/HomeownerTopBar.tsx` — sticky top bar: greeting + `NotificationBell role="homeowner"` + profile menu.
- `src/components/redesign/homeowner/shell/HomeownerShell.tsx` — `max-w-lg` column wrapping top bar + main + bottom nav.
- `src/components/redesign/homeowner/home/home-presenters.ts` — pure: `pickHeroAppointment`, `deriveHeroState`, `homeownerStatusLabel`, `cleanerDisplayName`, `formatCleaningWhen`.
- `src/components/redesign/homeowner/HomeownerCleaningHero.tsx` — lifecycle hero (empty / upcoming / in_progress / complete).
- `src/components/redesign/homeowner/home/PendingRequestCard.tsx` — one pending request + cancel.
- `src/components/redesign/homeowner/home/HomeownerHome.tsx` — Home composition.
- `src/app/(redesign)/app/homeowner-dashboard/layout.tsx` — role guard + `HomeownerShell`.
- `src/app/(redesign)/app/homeowner-dashboard/page.tsx` — renders `HomeownerHome`.
- `src/app/(redesign)/app/homeowner-dashboard/{cleanings,messages,account}/page.tsx` — minimal "Coming soon" stubs so the bottom nav never 404s.
- Tests: `homeowner-nav-items.test.ts`, `home-presenters.test.ts`.

**Modify:**
- `src/lib/redesign/dashboardPath.ts` (+ `dashboardPath.test.ts`) — homeowner redesign path.
- `src/components/redesign/notifications/deriveNotifications.ts` (+ `deriveNotifications.test.ts`) — homeowner href branch.

---

### Task 1: Routing — homeowner redesign path

**Files:**
- Modify: `src/lib/redesign/dashboardPath.ts:1-17`
- Test: `src/lib/redesign/dashboardPath.test.ts:18`

**Interfaces:**
- Produces: `getDashboardPath('homeowner', { redesign: true }) === '/app/homeowner-dashboard'`.

- [ ] **Step 1: Update the failing test.** In `dashboardPath.test.ts`, change the homeowner redesign expectation (line 18) from legacy to redesign:

```ts
    expect(getDashboardPath("homeowner", { redesign: true })).toBe("/app/homeowner-dashboard");
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- dashboardPath`
Expected: FAIL (`expected '/homeowner-dashboard' to be '/app/homeowner-dashboard'`).

- [ ] **Step 3: Implement.** In `dashboardPath.ts`, make the homeowner case redesign-aware and update the doc comment:

```ts
/** Post-login destination for a user role. When redesign is on, admin, cleaner,
 *  and homeowner route to new screens (other redesign screens don't exist yet). */
export function getDashboardPath(role: string, opts?: { redesign?: boolean }): string {
  const redesign = opts?.redesign ?? false;
  switch (role) {
    case "homeowner":
      return redesign ? "/app/homeowner-dashboard" : "/homeowner-dashboard";
    case "cleaner":
      return redesign ? "/app/cleaner-dashboard" : "/cleaner-dashboard";
    case "manager":
      return "/manager-dashboard";
    case "admin":
      return redesign ? "/app/admin-dashboard" : "/admin-dashboard";
    default:
      return "/";
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test -- dashboardPath`
Expected: PASS (both `it` blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/redesign/dashboardPath.ts src/lib/redesign/dashboardPath.test.ts
git commit -m "feat(redesign): route homeowner to /app/homeowner-dashboard when redesign on"
```

---

### Task 2: Notification href — homeowner branch

**Files:**
- Modify: `src/components/redesign/notifications/deriveNotifications.ts:111-130`
- Test: `src/components/redesign/notifications/deriveNotifications.test.ts`

**Interfaces:**
- Produces: for `role === 'homeowner'`, appointment rows → `/app/homeowner-dashboard?appointment=<id>`, else `/app/homeowner-dashboard`.

- [ ] **Step 1: Write the failing test.** Append to `deriveNotifications.test.ts`:

```ts
describe('homeownerNotificationHref (via deriveNotificationGroups role="homeowner")', () => {
  it('deep-links appointment notifications to the homeowner dashboard', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: 'appt-7', event_type: 'job_started' })],
      NOW,
      'homeowner',
    );
    expect(g.latest.href).toBe('/app/homeowner-dashboard?appointment=appt-7');
  });

  it('falls back to the homeowner dashboard for appointment-less events', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: null, event_type: 'something_else' })],
      NOW,
      'homeowner',
    );
    expect(g.latest.href).toBe('/app/homeowner-dashboard');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- deriveNotifications`
Expected: FAIL (homeowner currently falls through to `operatorNotificationHref` → `/admin-dashboard?...`).

- [ ] **Step 3: Implement.** In `deriveNotifications.ts`, add the homeowner href function after `cleanerNotificationHref` (after line 121) and a branch in `notificationHref`:

```ts
/**
 * Click destination for a homeowner notification. Appointment-scoped rows
 * deep-link the homeowner dashboard (its detail takeover opens on `?appointment=`,
 * built in Slice 2); everything else lands on the homeowner home.
 */
function homeownerNotificationHref(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
): string {
  if (item.appointment_id) {
    return `/app/homeowner-dashboard?appointment=${item.appointment_id}`;
  }
  return '/app/homeowner-dashboard';
}

function notificationHref(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
  role: NotificationRole,
): string {
  if (role === 'cleaner') return cleanerNotificationHref(item);
  if (role === 'homeowner') return homeownerNotificationHref(item);
  // admin and manager both use the operator console
  return operatorNotificationHref(item);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test -- deriveNotifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/notifications/deriveNotifications.ts src/components/redesign/notifications/deriveNotifications.test.ts
git commit -m "feat(redesign): route homeowner notifications to the homeowner dashboard"
```

---

### Task 3: Home presenters (pure)

**Files:**
- Create: `src/components/redesign/homeowner/home/home-presenters.ts`
- Test: `src/components/redesign/homeowner/home/home-presenters.test.ts`

**Interfaces:**
- Consumes: `Appointment` from `@/hooks/useHomeownerData`; `formatTimeTo12h` from `@/lib/formatTime`.
- Produces:
  - `pickHeroAppointment(appointments: Appointment[], todayStr: string): Appointment | null`
  - `deriveHeroState(appt: Appointment | null): 'empty' | 'upcoming' | 'in_progress' | 'complete'`
  - `homeownerStatusLabel(status: Appointment['status']): { label: string; tone: HomeownerStatusTone }` where `HomeownerStatusTone = 'default' | 'secondary' | 'positive' | 'caution' | 'critical'`
  - `cleanerDisplayName(appt: Appointment): string | null`
  - `formatCleaningWhen(dateStr: string, timeStr: string): string`

- [ ] **Step 1: Write the failing test.** Create `home-presenters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Appointment } from '@/hooks/useHomeownerData';
import {
  pickHeroAppointment,
  deriveHeroState,
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
} from './home-presenters';

const TODAY = '2026-06-25';

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    scheduled_date: '2026-06-26',
    scheduled_time: '10:30',
    status: 'confirmed',
    total_price: 120,
    property: { name: 'Home', address: '123 Maple Ave' } as Appointment['property'],
    service_type: { name: 'Deep clean', description: '' },
    checklist: null,
    cleaner_profile: { user_profile: { first_name: 'Marco', last_name: 'Diaz' } },
    payment_status: null,
    ...over,
  };
}

describe('pickHeroAppointment', () => {
  it('prefers an in-progress cleaning', () => {
    const inProg = appt({ id: 'p', status: 'in_progress', scheduled_date: '2026-06-25' });
    const result = pickHeroAppointment([appt({ id: 'u' }), inProg], TODAY);
    expect(result?.id).toBe('p');
  });

  it('otherwise returns the soonest upcoming active cleaning', () => {
    const later = appt({ id: 'later', scheduled_date: '2026-06-28' });
    const sooner = appt({ id: 'sooner', scheduled_date: '2026-06-26' });
    const past = appt({ id: 'past', scheduled_date: '2026-06-20', status: 'completed' });
    expect(pickHeroAppointment([later, past, sooner], TODAY)?.id).toBe('sooner');
  });

  it('falls back to the most recent completed cleaning', () => {
    const oldDone = appt({ id: 'old', scheduled_date: '2026-06-10', status: 'completed' });
    const newDone = appt({ id: 'new', scheduled_date: '2026-06-22', status: 'completed' });
    expect(pickHeroAppointment([oldDone, newDone], TODAY)?.id).toBe('new');
  });

  it('returns null when there is nothing to show', () => {
    expect(pickHeroAppointment([], TODAY)).toBeNull();
    expect(pickHeroAppointment([appt({ status: 'cancelled' })], TODAY)).toBeNull();
  });
});

describe('deriveHeroState', () => {
  it('maps appointment status to a hero state', () => {
    expect(deriveHeroState(null)).toBe('empty');
    expect(deriveHeroState(appt({ status: 'in_progress' }))).toBe('in_progress');
    expect(deriveHeroState(appt({ status: 'completed' }))).toBe('complete');
    expect(deriveHeroState(appt({ status: 'confirmed' }))).toBe('upcoming');
    expect(deriveHeroState(appt({ status: 'pending' }))).toBe('upcoming');
  });
});

describe('homeownerStatusLabel', () => {
  it('uses warm consumer copy + a tone per status', () => {
    expect(homeownerStatusLabel('pending')).toEqual({ label: 'Requested', tone: 'caution' });
    expect(homeownerStatusLabel('confirmed')).toEqual({ label: 'Confirmed', tone: 'secondary' });
    expect(homeownerStatusLabel('in_progress')).toEqual({ label: 'In progress', tone: 'default' });
    expect(homeownerStatusLabel('completed')).toEqual({ label: 'All done', tone: 'positive' });
    expect(homeownerStatusLabel('cancelled')).toEqual({ label: 'Cancelled', tone: 'critical' });
  });
});

describe('cleanerDisplayName', () => {
  it('returns first name + last initial', () => {
    expect(cleanerDisplayName(appt())).toBe('Marco D.');
  });
  it('returns null when no cleaner is assigned', () => {
    expect(cleanerDisplayName(appt({ cleaner_profile: null }))).toBeNull();
  });
});

describe('formatCleaningWhen', () => {
  it('formats a friendly date and 12h time', () => {
    expect(formatCleaningWhen('2026-06-25', '10:30')).toContain('Jun 25');
    expect(formatCleaningWhen('2026-06-25', '10:30')).toMatch(/10:30\s?AM/i);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- home-presenters`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `home-presenters.ts`:

```ts
import type { Appointment } from '@/hooks/useHomeownerData';
import { formatTimeTo12h } from '@/lib/formatTime';

export type HeroState = 'empty' | 'upcoming' | 'in_progress' | 'complete';
export type HomeownerStatusTone = 'default' | 'secondary' | 'positive' | 'caution' | 'critical';

/** The single cleaning the Home hero should feature. */
export function pickHeroAppointment(
  appointments: Appointment[],
  todayStr: string,
): Appointment | null {
  const inProgress = appointments.find((a) => a.status === 'in_progress');
  if (inProgress) return inProgress;

  const upcoming = appointments
    .filter(
      (a) =>
        a.scheduled_date >= todayStr &&
        (a.status === 'pending' || a.status === 'confirmed'),
    )
    .sort(
      (a, b) =>
        a.scheduled_date.localeCompare(b.scheduled_date) ||
        a.scheduled_time.localeCompare(b.scheduled_time),
    );
  if (upcoming.length > 0) return upcoming[0];

  const completed = appointments
    .filter((a) => a.status === 'completed')
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  return completed[0] ?? null;
}

export function deriveHeroState(appt: Appointment | null): HeroState {
  if (!appt) return 'empty';
  if (appt.status === 'in_progress') return 'in_progress';
  if (appt.status === 'completed') return 'complete';
  return 'upcoming';
}

export function homeownerStatusLabel(
  status: Appointment['status'],
): { label: string; tone: HomeownerStatusTone } {
  switch (status) {
    case 'pending':
      return { label: 'Requested', tone: 'caution' };
    case 'confirmed':
      return { label: 'Confirmed', tone: 'secondary' };
    case 'in_progress':
      return { label: 'In progress', tone: 'default' };
    case 'completed':
      return { label: 'All done', tone: 'positive' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'critical' };
    default:
      return { label: 'Scheduled', tone: 'secondary' };
  }
}

export function cleanerDisplayName(appt: Appointment): string | null {
  const p = appt.cleaner_profile?.user_profile;
  const first = p?.first_name?.trim();
  if (!first) return null;
  const last = p?.last_name?.trim();
  return last ? `${first} ${last.charAt(0)}.` : first;
}

export function formatCleaningWhen(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const datePart = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${datePart} · ${formatTimeTo12h(timeStr)}`;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test -- home-presenters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner/home/home-presenters.ts src/components/redesign/homeowner/home/home-presenters.test.ts
git commit -m "feat(redesign): homeowner Home presenters (hero selection + status copy)"
```

---

### Task 4: Nav items + active deriver

**Files:**
- Create: `src/components/redesign/homeowner/shell/homeowner-nav-items.ts`
- Test: `src/components/redesign/homeowner/shell/homeowner-nav-items.test.ts`

**Interfaces:**
- Produces: `HOMEOWNER_NAV: HomeownerNavItem[]` (ids `home|cleanings|messages|account`) and `deriveHomeownerActive(pathname: string): string`.

- [ ] **Step 1: Write the failing test.** Create `homeowner-nav-items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HOMEOWNER_NAV, deriveHomeownerActive } from './homeowner-nav-items';

describe('HOMEOWNER_NAV', () => {
  it('has the four primary destinations with icon + label', () => {
    expect(HOMEOWNER_NAV.map((n) => n.id)).toEqual(['home', 'cleanings', 'messages', 'account']);
    for (const n of HOMEOWNER_NAV) {
      expect(n.label.length).toBeGreaterThan(0);
      expect(n.icon).toBeTruthy();
    }
  });
});

describe('deriveHomeownerActive', () => {
  it('maps pathnames to the active nav id', () => {
    expect(deriveHomeownerActive('/app/homeowner-dashboard')).toBe('home');
    expect(deriveHomeownerActive('/app/homeowner-dashboard/cleanings')).toBe('cleanings');
    expect(deriveHomeownerActive('/app/homeowner-dashboard/messages')).toBe('messages');
    expect(deriveHomeownerActive('/app/homeowner-dashboard/account')).toBe('account');
  });
  it('defaults to home for unknown paths', () => {
    expect(deriveHomeownerActive('/app/homeowner-dashboard/whatever')).toBe('home');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test -- homeowner-nav-items`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `homeowner-nav-items.ts`:

```ts
import { Home, CalendarDays, MessageSquare, UserCircle, type LucideIcon } from 'lucide-react';

export interface HomeownerNavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const HOMEOWNER_NAV: HomeownerNavItem[] = [
  { id: 'home', label: 'Home', href: '/app/homeowner-dashboard', icon: Home },
  { id: 'cleanings', label: 'Cleanings', href: '/app/homeowner-dashboard/cleanings', icon: CalendarDays },
  { id: 'messages', label: 'Messages', href: '/app/homeowner-dashboard/messages', icon: MessageSquare },
  { id: 'account', label: 'Account', href: '/app/homeowner-dashboard/account', icon: UserCircle },
];

export function deriveHomeownerActive(pathname: string): string {
  if (pathname.includes('/cleanings')) return 'cleanings';
  if (pathname.includes('/messages')) return 'messages';
  if (pathname.includes('/account')) return 'account';
  return 'home';
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test -- homeowner-nav-items`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner/shell/homeowner-nav-items.ts src/components/redesign/homeowner/shell/homeowner-nav-items.test.ts
git commit -m "feat(redesign): homeowner nav model + active-tab deriver"
```

---

### Task 5: Shell (top bar + bottom nav) + route group + stubs

**Files:**
- Create: `src/components/redesign/homeowner/shell/HomeownerBottomNav.tsx`
- Create: `src/components/redesign/homeowner/shell/HomeownerTopBar.tsx`
- Create: `src/components/redesign/homeowner/shell/HomeownerShell.tsx`
- Create: `src/app/(redesign)/app/homeowner-dashboard/layout.tsx`
- Create: `src/app/(redesign)/app/homeowner-dashboard/page.tsx` (temporary placeholder body; real Home in Task 8)
- Create: `src/app/(redesign)/app/homeowner-dashboard/{cleanings,messages,account}/page.tsx` (stubs)

**Interfaces:**
- Consumes: `HOMEOWNER_NAV`, `deriveHomeownerActive` (Task 4); `NotificationBell` (`role`); `useAuth`; `useConversations` for the messages unread count.
- Produces: `HomeownerShell` wrapping any child in the homeowner chrome.

- [ ] **Step 1: Create `HomeownerBottomNav.tsx`** (mirror of `CleanerBottomNav`, homeowner nav + unread badge):

```tsx
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { HOMEOWNER_NAV } from './homeowner-nav-items';

export function HomeownerBottomNav({
  activeId,
  messagesUnread = 0,
}: {
  activeId?: string;
  messagesUnread?: number;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {HOMEOWNER_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'font-semibold text-brand-600' : 'text-muted-foreground',
            )}
          >
            {active && (
              <span className="absolute top-0 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-brand-600" aria-hidden />
            )}
            <span className="relative">
              <Icon className="h-6 w-6" aria-hidden />
              {item.id === 'messages' && messagesUnread > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-2 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-brand-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white"
                >
                  {messagesUnread > 99 ? '99+' : messagesUnread}
                </span>
              )}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Create `HomeownerTopBar.tsx`** (greeting + bell + profile menu). Reuse the cleaner top-bar pattern; mount `NotificationBell role="homeowner"`. Use the existing `DropdownMenu` primitive for the profile menu (sign out + a link to Account):

```tsx
'use client';

import Link from 'next/link';
import { LogOut, UserCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { NotificationBell } from '@/components/redesign/notifications/NotificationBell';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function HomeownerTopBar() {
  const { user, signOut } = useAuth() as {
    user: { profile?: { firstName?: string } } | null;
    signOut: () => void;
  };
  const first = user?.profile?.firstName || 'there';
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-lg items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Your home, handled.</p>
          <p className="truncate text-lg font-extrabold leading-tight">Hi, {first}</p>
        </div>
        <NotificationBell role="homeowner" />
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-pill outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar>
              <AvatarFallback>{first.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href="/app/homeowner-dashboard/account">
                <UserCircle className="mr-2 h-4 w-4" /> Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
```

> Note: confirm the exact `DropdownMenu` import path/exports in `src/components/ui/dropdown-menu.tsx` and the `useAuth` return shape (`user.profile.firstName`, `signOut`) against `CleanerTopBar.tsx` — match it exactly; adjust if the cleaner version differs.

- [ ] **Step 3: Create `HomeownerShell.tsx`** (mirror `CleanerShell`):

```tsx
'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { HomeownerTopBar } from './HomeownerTopBar';
import { HomeownerBottomNav } from './HomeownerBottomNav';
import { deriveHomeownerActive } from './homeowner-nav-items';

export function HomeownerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeId = deriveHomeownerActive(pathname);
  const { user } = useAuth();
  const { conversations } = useConversations({ userId: user?.id });
  const messagesUnread = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh bg-background text-foreground">
        <HomeownerTopBar />
        <main id="main-content" className="mx-auto max-w-lg px-4 pb-28 pt-4">
          {children}
        </main>
        <HomeownerBottomNav activeId={activeId} messagesUnread={messagesUnread} />
      </div>
    </TooltipProvider>
  );
}
```

> Note: confirm `useConversations({ userId })` returns `conversations` with `unread_count` (per the inventory). If the cleaner shell uses a dedicated `useUnreadMessageCount(user?.id)` helper, reuse that instead for consistency.

- [ ] **Step 4: Create the route-group layout** `src/app/(redesign)/app/homeowner-dashboard/layout.tsx` (role guard + shell, mirror cleaner layout but without the takeover hosts):

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { HomeownerShell } from '@/components/redesign/homeowner/shell/HomeownerShell';

export default function HomeownerDashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth() as { user: { role?: string } | null; loading: boolean };
  const router = useRouter();
  useEffect(() => {
    if (!loading && user && user.role !== 'homeowner') {
      router.replace('/');
    }
  }, [loading, user, router]);
  return <HomeownerShell>{children}</HomeownerShell>;
}
```

> Note: match the exact role-guard shape used in `cleaner-dashboard/layout.tsx` (it may read `user.role` differently or use a shared guard). Mirror it precisely rather than inventing.

- [ ] **Step 5: Create the Home page placeholder** `src/app/(redesign)/app/homeowner-dashboard/page.tsx`:

```tsx
export default function HomeownerHomePage() {
  return <p className="text-sm text-muted-foreground">Home coming up next.</p>;
}
```

- [ ] **Step 6: Create the three stub pages** so the nav never 404s. For each of `cleanings/page.tsx`, `messages/page.tsx`, `account/page.tsx`:

```tsx
export default function ComingSoonPage() {
  return (
    <div className="py-16 text-center text-sm text-muted-foreground">Coming soon.</div>
  );
}
```

- [ ] **Step 7: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no new errors. Fix import paths/prop shapes flagged against the real `useAuth`/`useConversations`/`dropdown-menu`/`tooltip` signatures.

- [ ] **Step 8: Visual verification (Playwright MCP).** Start `npm run dev`. Log in as the seed homeowner. Navigate to `http://localhost:3000/app/homeowner-dashboard`. Resize to 375px. Screenshot. Confirm: sticky top bar (greeting + bell + avatar), the placeholder body, and a fixed 4-tab bottom nav with Home active. Tap each tab → the three stubs render inside the shell with the correct active tab (no 404). Compare chrome to `docs/redesign/mockups/homeowner-shell.html`.

- [ ] **Step 9: Commit**

```bash
git add src/components/redesign/homeowner/shell src/app/(redesign)/app/homeowner-dashboard
git commit -m "feat(redesign): homeowner shell (top bar + bottom nav) + route group + stubs"
```

---

### Task 6: HomeownerCleaningHero

**Files:**
- Create: `src/components/redesign/homeowner/HomeownerCleaningHero.tsx`

**Interfaces:**
- Consumes: `Appointment`; the Task 3 presenters; `Badge`, `Avatar`/`AvatarFallback`, `Card` primitives.
- Produces: `<HomeownerCleaningHero appointment={Appointment | null} />` rendering the empty / upcoming / in_progress / complete states. (In_progress here is a simple labeled state; the live progress bar is added in Slice 1b.)

- [ ] **Step 1: Implement the hero.** Build the gradient hero from brand tokens (no raw hex). For `empty`, render a calm card prompting a request:

```tsx
import type { Appointment } from '@/hooks/useHomeownerData';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CalendarPlus } from 'lucide-react';
import {
  deriveHeroState,
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
} from './home/home-presenters';

const TONE_TO_VARIANT = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
} as const;

export function HomeownerCleaningHero({ appointment }: { appointment: Appointment | null }) {
  const state = deriveHeroState(appointment);

  if (state === 'empty' || !appointment) {
    return (
      <div className="rounded-card border border-border bg-card p-6 text-center shadow-soft-md">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-pill bg-muted text-muted-foreground">
          <CalendarPlus className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-base font-semibold">No cleaning scheduled</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Request a cleaning and we will take it from here.
        </p>
      </div>
    );
  }

  const { label, tone } = homeownerStatusLabel(appointment.status);
  const cleaner = cleanerDisplayName(appointment);
  const heading =
    state === 'in_progress'
      ? 'Cleaning in progress'
      : state === 'complete'
        ? 'Your recent cleaning'
        : 'Your next cleaning';

  return (
    <div className="rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-soft-lg">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/85">{heading}</p>
        <Badge variant={TONE_TO_VARIANT[tone]} className="border-white/20 bg-white/20 text-white">
          {label}
        </Badge>
      </div>
      <p className="mt-2 text-xl font-extrabold tabular-nums">
        {formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time)}
      </p>
      <p className="text-sm text-white/90">
        {appointment.property?.address ?? appointment.property?.name ?? 'Your home'}
        {appointment.service_type?.name ? ` · ${appointment.service_type.name}` : ''}
      </p>
      {cleaner && (
        <div className="mt-4 flex items-center gap-3 border-t border-white/20 pt-3">
          <Avatar className="size-9">
            <AvatarFallback className="bg-white/30 text-white">{cleaner.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold">{cleaner}</p>
            <p className="text-xs text-white/80">Your cleaner</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

> Note: the translucent white pill over the brand gradient is a deliberate on-brand treatment (white text on `brand-600` passes AA). Keep status meaning carried by the `label` text, not color alone.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (Confirm `Badge` accepts the `variant` values used and that `Avatar`/`AvatarFallback` accept `className`.)

- [ ] **Step 3: Visual verification (Playwright MCP).** Temporarily render the hero in the Home page with the real `useHomeownerAppointments` data (this lands properly in Task 8). Screenshot the upcoming and (if the seed roster has one) completed states at 375px; confirm the gradient hero matches the mockup structure (label, date, where, cleaner, pill) using design-system tokens only.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/homeowner/HomeownerCleaningHero.tsx
git commit -m "feat(redesign): homeowner lifecycle hero (empty/upcoming/in-progress/complete)"
```

---

### Task 7: PendingRequestCard + cancel

**Files:**
- Create: `src/components/redesign/homeowner/home/PendingRequestCard.tsx`

**Interfaces:**
- Consumes: `HomeownerRequest` from `@/hooks/useHomeownerRequests`; `cancelRequest(id)` + `cancelling` passed in as props; `Card`, `Badge`, `Button`, and an `AlertDialog` confirm primitive.
- Produces: `<PendingRequestCard request={HomeownerRequest} onCancel={(id) => Promise<void>} cancelling={boolean} />`.

- [ ] **Step 1: Implement.** Render the request (service + preferred times + an "Awaiting" pill) with a cancel that confirms first:

```tsx
'use client';

import { useState } from 'react';
import type { HomeownerRequest } from '@/hooks/useHomeownerRequests';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export function PendingRequestCard({
  request,
  onCancel,
  cancelling,
}: {
  request: HomeownerRequest;
  onCancel: (id: string) => Promise<void>;
  cancelling: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">
          {request.service_type?.name ?? 'Cleaning'} request
        </p>
        <Badge variant="caution">Awaiting</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {request.property?.address ?? request.property?.name ?? 'Your home'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {request.requested_slots.length} preferred {request.requested_slots.length === 1 ? 'time' : 'times'} sent
      </p>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="mt-2 text-critical-600">
            Cancel request
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
            <AlertDialogDescription>
              This withdraws your cleaning request. You can always request a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={async () => {
                await onCancel(request.id);
                setOpen(false);
              }}
            >
              Cancel request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

> Note: confirm `src/components/ui/alert-dialog.tsx` exists and exports these names (standard shadcn). If absent, add the shadcn `alert-dialog` primitive to `src/components/ui/` first (it is a reusable primitive, not a one-off). Confirm a `critical-600` token exists for the destructive text; otherwise use the Button `destructive` variant.

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Visual verification** deferred to Task 8 (rendered with real pending-request data there).

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/homeowner/home/PendingRequestCard.tsx
git commit -m "feat(redesign): homeowner pending-request card with confirm-cancel"
```

---

### Task 8: HomeownerHome composition + request entry

**Files:**
- Create: `src/components/redesign/homeowner/home/HomeownerHome.tsx`
- Modify: `src/app/(redesign)/app/homeowner-dashboard/page.tsx` (render `HomeownerHome`)

**Interfaces:**
- Consumes: `useHomeownerAppointments`, `useHomeownerRequests`; Task 3 presenters; `HomeownerCleaningHero`, `PendingRequestCard`; `RequestAppointmentButton` (legacy, opened as-is).
- Produces: the assembled Home screen: hero + "Request a cleaning" button + persistent FAB + pending requests, with skeletons + empty states.

- [ ] **Step 1: Implement `HomeownerHome.tsx`:**

```tsx
'use client';

import { useMemo } from 'react';
import { CalendarPlus } from 'lucide-react';
import RequestAppointmentButton from '@/components/RequestAppointmentButton';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { useHomeownerRequests } from '@/hooks/useHomeownerRequests';
import { pickHeroAppointment } from './home-presenters';
import { HomeownerCleaningHero } from '../HomeownerCleaningHero';
import { PendingRequestCard } from './PendingRequestCard';

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function HomeownerHome() {
  const { appointments, loading } = useHomeownerAppointments();
  const { requests, cancelRequest, cancelling } = useHomeownerRequests();
  const hero = useMemo(() => pickHeroAppointment(appointments, todayStr()), [appointments]);

  return (
    <div className="flex flex-col gap-4 pb-8">
      {loading ? (
        <div className="h-40 animate-pulse rounded-card bg-muted" aria-hidden />
      ) : (
        <HomeownerCleaningHero appointment={hero} />
      )}

      <RequestAppointmentButton
        label="Request a cleaning"
        className="flex w-full items-center justify-center gap-2 rounded-control border border-border bg-card py-3 text-sm font-bold text-brand-600 shadow-soft-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {requests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Pending requests
          </h2>
          {requests.map((r) => (
            <PendingRequestCard
              key={r.id}
              request={r}
              onCancel={cancelRequest}
              cancelling={cancelling}
            />
          ))}
        </section>
      )}

      {/* Persistent request FAB (phone-first; clears the bottom nav). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg">
        <div className="pointer-events-auto absolute bottom-[88px] right-4">
          <RequestAppointmentButton
            label="Request"
            className="flex items-center gap-2 rounded-pill bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-soft-lg transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}
```

> Note: `RequestAppointmentButton` is the default export. The FAB reuses the same button with a different `className` + a short label. Confirm `rounded-control`/`brand-700` tokens exist; if not, use `rounded-pill`/`brand-600` with `hover:opacity-90`.

- [ ] **Step 2: Wire it into the Home page.** Replace `src/app/(redesign)/app/homeowner-dashboard/page.tsx`:

```tsx
import { HomeownerHome } from '@/components/redesign/homeowner/home/HomeownerHome';

export default function HomeownerHomePage() {
  return <HomeownerHome />;
}
```

- [ ] **Step 3: Type-check + lint + unit tests**

Run: `npx tsc --noEmit && npm run lint && npm run test -- home-presenters homeowner-nav-items dashboardPath deriveNotifications`
Expected: all green.

- [ ] **Step 4: Visual verification (Playwright MCP).** With `npm run dev` + seed homeowner login, open `/app/homeowner-dashboard` at 375px. Confirm: hero (real next cleaning), the "Request a cleaning" button opens the legacy `RequestAppointmentModal`, the persistent FAB sits above the bottom nav, pending requests render with a working confirm-cancel, and the empty state shows when the seed account has no upcoming cleaning. Iterate with `ui-ux-pro-max` (implementation pass) for design-system conformance (no raw hex, tokens only, touch targets ≥44px, both light/dark). Save screenshots for the PR.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner/home/HomeownerHome.tsx "src/app/(redesign)/app/homeowner-dashboard/page.tsx"
git commit -m "feat(redesign): assemble homeowner Home (hero + request entry + pending)"
```

---

## Pre-PR

- [ ] Run full gates: `npm run test`, `npx tsc --noEmit`, `npm run lint`.
- [ ] Conformance pass (`ui-feature-workflow`): no raw hex / mockup styling leaked; existing primitives reused; status via Badge vocabulary; no em dashes in copy.
- [ ] One Codex review: `/codex:review --scope branch --base master --wait`; apply valid fixes in a follow-up commit.
- [ ] Push `feat/redesign-homeowner-app` (or a `feat/redesign-homeowner-slice-1a` branch off it) and open the PR; confirm the four CI checks go green.

## Self-review (done while writing)

- **Spec coverage:** Slice 1a items from the spec (shell, bottom nav, getDashboardPath homeowner case, notification href fix, greeting + bell, hero Confirmed/Complete/empty, pending + cancel, request button + FAB, no migration) each map to Tasks 1-8. In-progress live state + migration are correctly deferred to Slice 1b.
- **Placeholder scan:** no TBD/TODO; every code step shows real code. Three "confirm exact signature" notes point at real files to match (`CleanerTopBar`, `useAuth`, `dropdown-menu`, `alert-dialog`) rather than inventing APIs.
- **Type consistency:** `pickHeroAppointment`/`deriveHeroState`/`homeownerStatusLabel`/`cleanerDisplayName`/`formatCleaningWhen` signatures are identical across Tasks 3, 6, 8; `HOMEOWNER_NAV`/`deriveHomeownerActive` identical across Tasks 4, 5; `homeownerNotificationHref` matches the cleaner/operator sibling shape.
