# Cleaner App Slice 1: Shell + Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the phone-first cleaner shell (top bar + bottom nav) and a working Today home screen behind the redesign flag, with cleaners routed into the new `(redesign)` cleaner route group.

**Architecture:** Mirror the operator redesign exactly. New pages under `src/app/(redesign)/app/cleaner-dashboard/**` (gated by the existing `(redesign)/layout.tsx`). A `CleanerShell` (no desktop rail; phone-style at all widths, content constrained on large screens) composes a `CleanerTopBar` and `CleanerBottomNav`. Today is built Container -> View -> `deriveToday` (pure, unit-tested), reusing the existing `useCleanerAppointments` hook. Deep job/offer actions bridge to the legacy `/cleaner-dashboard?appointment=<id>` panel until Slice 2 builds the in-redesign job detail.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, lucide-react, the owned `src/components/ui/*` primitives. Tests: Vitest (unit) + Playwright MCP (visual verification).

## Global Constraints

- **UI-only rebuild (Approach B):** reuse existing hooks/routes; **no new data layer** in this slice.
- **Flag gating:** all pages live under `src/app/(redesign)/app/cleaner-dashboard/**`; the parent `(redesign)/layout.tsx` already 404s in prod unless `NEXT_PUBLIC_REDESIGN_ENABLED === "true"`. Do not add new gating.
- **Design identity (locked):** brand `#0150FC` via `brand-600` / `bg-brand-600` / `text-brand-600`; font `font-jakarta`; warm canvas `bg-background`, white surfaces `bg-card`; rounded scale (`rounded-card`/`rounded-control`/`rounded-pill`); soft shadows (`shadow-soft-sm/md/lg`). Use `src/components/ui/*` primitives and **lucide icons only (no emoji)**.
- **Copy:** no em dash (`—`) characters in any user-facing string. Use a period, comma, parentheses, or "to" for ranges.
- **Mobile UX (ui-ux-pro-max verified):** touch targets >= 44px; sticky bars use `pb-[env(safe-area-inset-bottom)]`; every list has an **empty state** and a **loading skeleton**; active nav item is visibly highlighted; screens are deep-linkable; `min-h-dvh` not `100vh`.
- **Data:** org-scoped queries via the existing hooks; query keys from `keys` (`src/lib/queryKeys.ts`). `cleaner_profiles.id === auth user id`. Appointments use `special_requests` and `duration_minutes`.
- **Gates before any push:** `npx tsc --noEmit`, `npm run lint`, `npm run test` all clean for code you introduced; then a Codex branch review; apply valid findings as a follow-up commit; then push + PR to `master`.
- **Commit trailers:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NvSoW94o1PBWfDfjuuSK29
  ```
- **Working dir:** the `feat/redesign-cleaner-app` worktree at `.claude/worktrees/redesign-cleaner-app`.

---

### Task 1: Route cleaners into the redesign

**Files:**
- Modify: `src/lib/redesign/dashboardPath.ts`
- Test: `src/lib/redesign/dashboardPath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getDashboardPath("cleaner", { redesign: true }) === "/app/cleaner-dashboard"`. Callers already pass `{ redesign: redesignUiEnabled() }`, so this is the only change needed to land cleaners in the new tree.

- [ ] **Step 1: Update the failing test**

In `src/lib/redesign/dashboardPath.test.ts`, change the cleaner redesign expectation (currently asserts legacy) and update the comment:

```ts
  it("routes admin and cleaner to redesign screens when on", () => {
    expect(getDashboardPath("admin", { redesign: true })).toBe("/app/admin-dashboard");
    expect(getDashboardPath("cleaner", { redesign: true })).toBe("/app/cleaner-dashboard");
    // not-yet-built redesign screens still go to legacy to avoid dead-ends
    expect(getDashboardPath("manager", { redesign: true })).toBe("/manager-dashboard");
    expect(getDashboardPath("homeowner", { redesign: true })).toBe("/homeowner-dashboard");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- dashboardPath`
Expected: FAIL — cleaner returns `/cleaner-dashboard`, expected `/app/cleaner-dashboard`.

- [ ] **Step 3: Update the implementation**

In `src/lib/redesign/dashboardPath.ts`, change the cleaner case:

```ts
    case "cleaner":
      return redesign ? "/app/cleaner-dashboard" : "/cleaner-dashboard";
```

Also update the top doc comment to: `When redesign is on, admin and cleaner route to new screens (other redesign screens don't exist yet).`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- dashboardPath`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/redesign/dashboardPath.ts src/lib/redesign/dashboardPath.test.ts
git commit   # subject: "feat(redesign): route cleaners to the redesign cleaner dashboard" + trailers
```

---

### Task 2: Cleaner navigation config + bottom nav

**Files:**
- Create: `src/components/redesign/cleaner/shell/cleaner-nav-items.ts`
- Create: `src/components/redesign/cleaner/shell/CleanerBottomNav.tsx`

**Interfaces:**
- Produces: `CLEANER_NAV: CleanerNavItem[]` (5 items); `deriveCleanerActive(pathname): string | undefined`; `<CleanerBottomNav activeId?: string />`.
- Consumes: lucide icons, `cn` from `@/lib/utils`, `next/link`.

- [ ] **Step 1: Create the nav config**

`src/components/redesign/cleaner/shell/cleaner-nav-items.ts`:

```ts
import { Home, CalendarDays, DollarSign, MessageSquare, User, type LucideIcon } from "lucide-react";

export type CleanerNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path roots that also mark this item active. */
  activeFor?: string[];
};

// Phone-first 5-tab bottom nav. All hrefs point inside the redesign cleaner
// route group; each destination ships as its own slice (Schedule, Earnings,
// Messages, Profile arrive after Today).
export const CLEANER_NAV: CleanerNavItem[] = [
  { id: "today", label: "Today", href: "/app/cleaner-dashboard", icon: Home },
  { id: "schedule", label: "Schedule", href: "/app/cleaner-dashboard/schedule", icon: CalendarDays },
  { id: "earnings", label: "Earnings", href: "/app/cleaner-dashboard/earnings", icon: DollarSign },
  { id: "messages", label: "Messages", href: "/app/cleaner-dashboard/messages", icon: MessageSquare },
  { id: "profile", label: "Profile", href: "/app/cleaner-dashboard/profile", icon: User },
];

/** Longest matching href wins so /app/cleaner-dashboard/schedule resolves to
 *  "schedule", not "today" (whose href is a prefix of every other). */
export function deriveCleanerActive(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  let best: { id: string; len: number } | undefined;
  for (const item of CLEANER_NAV) {
    const roots = [item.href, ...(item.activeFor ?? [])];
    for (const root of roots) {
      if (pathname === root || pathname.startsWith(root + "/")) {
        if (!best || root.length > best.len) best = { id: item.id, len: root.length };
      }
    }
  }
  return best?.id;
}
```

- [ ] **Step 2: Add a unit test for active derivation**

Create `src/components/redesign/cleaner/shell/cleaner-nav-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveCleanerActive } from "./cleaner-nav-items";

describe("deriveCleanerActive", () => {
  it("resolves the Today root exactly", () => {
    expect(deriveCleanerActive("/app/cleaner-dashboard")).toBe("today");
  });
  it("prefers the longest match for nested routes", () => {
    expect(deriveCleanerActive("/app/cleaner-dashboard/schedule")).toBe("schedule");
    expect(deriveCleanerActive("/app/cleaner-dashboard/earnings")).toBe("earnings");
  });
  it("returns undefined off-tree", () => {
    expect(deriveCleanerActive("/login")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `npm run test:unit -- cleaner-nav-items`
Expected: FAIL first if file ordering differs; after Step 1 it PASSES. Confirm PASS.

- [ ] **Step 4: Create the bottom nav component**

`src/components/redesign/cleaner/shell/CleanerBottomNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CLEANER_NAV } from "./cleaner-nav-items";

/** Phone-first bottom tab bar (5 top-level tabs), shown at all widths. */
export function CleanerBottomNav({ activeId }: { activeId?: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {CLEANER_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "font-semibold text-brand-600" : "text-muted-foreground"
            )}
          >
            {active && (
              <span className="absolute top-0 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-brand-600" aria-hidden />
            )}
            <Icon className="h-6 w-6" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/shell/cleaner-nav-items.ts src/components/redesign/cleaner/shell/cleaner-nav-items.test.ts src/components/redesign/cleaner/shell/CleanerBottomNav.tsx
git commit   # "feat(redesign): cleaner nav config + bottom tab bar" + trailers
```

---

### Task 3: Cleaner top bar

**Files:**
- Create: `src/components/redesign/cleaner/shell/CleanerTopBar.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`user.profile { firstName, lastName, avatarUrl }`, `signOut`), `NotificationBell`, `Avatar*`, `DropdownMenu*` from `@/components/ui/*`.
- Produces: `<CleanerTopBar />` (greeting + name left; notification bell + avatar menu right).

- [ ] **Step 1: Create the component**

`src/components/redesign/cleaner/shell/CleanerTopBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { NotificationBell } from "@/components/redesign/notifications/NotificationBell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

type Profile = { firstName?: string; lastName?: string; avatarUrl?: string };

function initials(p?: Profile) {
  const f = p?.firstName?.[0] ?? "";
  const l = p?.lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "ME";
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Cleaner top bar: greeting + first name on the left; notifications + profile
 *  menu on the right. No global search (operator-only). */
export function CleanerTopBar() {
  const { user, signOut } = useAuth() as {
    user: { profile?: Profile } | null;
    signOut: () => void;
  };
  const profile = user?.profile;
  const first = profile?.firstName || "there";
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Cleaner";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-lg items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{greeting(new Date())}</p>
          <p className="truncate text-lg font-extrabold leading-tight">{first}</p>
        </div>
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Account menu"
          >
            <Avatar className="h-9 w-9">
              {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={fullName} /> : null}
              <AvatarFallback>{initials(profile)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{fullName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/app/cleaner-dashboard/profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={() => signOut()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
```

> Note: verify `DropdownMenuItem` accepts a `destructive` prop in this codebase (the operator top bar uses it). If the prop differs, match the operator usage exactly.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/cleaner/shell/CleanerTopBar.tsx
git commit   # "feat(redesign): cleaner top bar (greeting + notifications + profile menu)" + trailers
```

---

### Task 4: Cleaner shell + route-group layout + stub pages

**Files:**
- Create: `src/components/redesign/cleaner/shell/CleanerShell.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/layout.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/schedule/page.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/messages/page.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/profile/page.tsx`

**Interfaces:**
- Consumes: `CleanerTopBar`, `CleanerBottomNav`, `deriveCleanerActive`; `useAuth()` (`user`, `loading`, `orgStatus`, `reloadOrganization`, `user.role`); `getDashboardPath`; `redesignUiEnabled`; `WorkspaceErrorScreen`; `EmptyState` from `@/components/ui/empty-state`.
- Produces: `<CleanerShell>{children}</CleanerShell>`; a layout that guards auth/role and wraps every cleaner page in the shell; four "coming soon" stub pages so the bottom nav never dead-ends.

- [ ] **Step 1: Create the shell**

`src/components/redesign/cleaner/shell/CleanerShell.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CleanerTopBar } from "./CleanerTopBar";
import { CleanerBottomNav } from "./CleanerBottomNav";
import { deriveCleanerActive } from "./cleaner-nav-items";

/** Phone-first cleaner app shell: sticky top bar, a constrained content column
 *  (so it reads like a phone app on desktop), and a fixed bottom tab bar. */
export function CleanerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeId = deriveCleanerActive(pathname);
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:shadow-soft-md focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <CleanerTopBar />
        <main id="main-content" className="mx-auto max-w-lg px-4 pb-28 pt-4">
          {children}
        </main>
        <CleanerBottomNav activeId={activeId} />
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Create the guarded route-group layout**

`src/app/(redesign)/app/cleaner-dashboard/layout.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { CleanerShell } from "@/components/redesign/cleaner/shell/CleanerShell";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";
import { redesignUiEnabled } from "@/lib/redesign/flags";

function Spinner() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

export default function CleanerDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    // Soft role guard: non-cleaners get redirected to their own dashboard so a
    // deep link doesn't strand them on the cleaner shell.
    if (user.role && user.role !== "cleaner") {
      router.push(getDashboardPath(user.role, { redesign: redesignUiEnabled() }));
    }
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (user.role && user.role !== "cleaner") return <Spinner />;

  return <CleanerShell>{children}</CleanerShell>;
}
```

> Verify `useAuth()` exposes `user.role`. If role lives elsewhere (e.g. `currentOrgRole`), use that field; the guard logic is the same. If the legacy cleaner dashboard does not role-guard, keep this soft guard but do not block rendering on an unknown role (the `user.role &&` checks already allow that).

- [ ] **Step 3: Create four "coming soon" stub pages**

Each stub keeps the bottom nav cohesive until its slice lands. `src/app/(redesign)/app/cleaner-dashboard/schedule/page.tsx`:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays } from "lucide-react";

export default function CleanerSchedulePage() {
  return (
    <EmptyState
      icon={CalendarDays}
      title="Schedule is coming soon"
      description="Your full upcoming and past jobs will live here."
    />
  );
}
```

Repeat for the other three, changing only the import icon, file, component name, title, and description:
- `earnings/page.tsx` — icon `DollarSign`, title "Earnings is coming soon", description "Your payouts and what you've earned will show up here."
- `messages/page.tsx` — icon `MessageSquare`, title "Messages is coming soon", description "Chat with your operator will live here."
- `profile/page.tsx` — icon `User`, title "Profile is coming soon", description "Your details, availability, and settings will live here."

> Verify the `EmptyState` prop names against `src/components/ui/empty-state.tsx` (the operator screens use it). If it takes `action`/children instead of `icon`/`title`/`description`, match that signature exactly.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Manual smoke (dev server)**

Run `npm run dev`. With `NEXT_PUBLIC_REDESIGN_ENABLED=true` and signed in as a cleaner, visit `http://localhost:3000/app/cleaner-dashboard/schedule`. Expected: cleaner shell renders with the top bar + bottom nav, Schedule tab active, "coming soon" body. Tapping each tab switches the active indicator.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/cleaner/shell/CleanerShell.tsx "src/app/(redesign)/app/cleaner-dashboard/layout.tsx" "src/app/(redesign)/app/cleaner-dashboard/schedule/page.tsx" "src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx" "src/app/(redesign)/app/cleaner-dashboard/messages/page.tsx" "src/app/(redesign)/app/cleaner-dashboard/profile/page.tsx"
git commit   # "feat(redesign): cleaner shell + guarded layout + tab stubs" + trailers
```

---

### Task 5: Today domain logic (`deriveToday`) + types

**Files:**
- Create: `src/components/redesign/cleaner/today/today-types.ts`
- Create: `src/components/redesign/cleaner/today/deriveToday.ts`
- Test: `src/components/redesign/cleaner/today/deriveToday.test.ts`

**Interfaces:**
- Consumes: `CleanerAppointment` from `@/hooks/useCleanerData`.
- Produces:
  - `type CleanerPayoutModel = "percentage_contractor" | "hourly_external"`
  - `interface TodayData { activeJob: CleanerAppointment | null; offers: CleanerAppointment[]; todayJobs: CleanerAppointment[]; tomorrowCount: number; tomorrowFirstTime: string | null; isEmpty: boolean }`
  - `function deriveToday(appointments: CleanerAppointment[], todayStr: string, tomorrowStr: string, payoutModel: CleanerPayoutModel): TodayData` — pure; `todayStr`/`tomorrowStr` are `YYYY-MM-DD` (passed in by the container so the function stays time-pure and testable).

- [ ] **Step 1: Write the types**

`src/components/redesign/cleaner/today/today-types.ts`:

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type CleanerPayoutModel = "percentage_contractor" | "hourly_external";

export interface TodayData {
  /** First in-progress job, pinned at the top. */
  activeJob: CleanerAppointment | null;
  /** Pending offers awaiting the cleaner's response. Always empty in the
   *  employee (hourly_external) model, where jobs are assigned, not offered. */
  offers: CleanerAppointment[];
  /** Confirmed or in-progress jobs scheduled for today, sorted by time. */
  todayJobs: CleanerAppointment[];
  /** Count of confirmed/in-progress jobs scheduled for tomorrow. */
  tomorrowCount: number;
  /** Earliest scheduled_time among tomorrow's jobs, or null. */
  tomorrowFirstTime: string | null;
  /** True when there is nothing to show (drives the empty state). */
  isEmpty: boolean;
}
```

- [ ] **Step 2: Write the failing test**

`src/components/redesign/cleaner/today/deriveToday.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveToday } from "./deriveToday";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-26";
const TOMORROW = "2026-06-27";

function appt(over: Partial<CleanerAppointment>): CleanerAppointment {
  return {
    id: Math.random().toString(36).slice(2),
    scheduled_date: TODAY,
    scheduled_time: "10:00:00",
    status: "confirmed",
    total_price: 100,
    cleaner_confirmation_status: "approved",
    homeowner: null,
    property: null,
    service_type: null,
    ...over,
  } as CleanerAppointment;
}

describe("deriveToday", () => {
  it("pins the first in-progress job as active", () => {
    const r = deriveToday(
      [appt({ id: "a", status: "in_progress" }), appt({ id: "b" })],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.activeJob?.id).toBe("a");
  });

  it("surfaces awaiting offers in the contractor model, sorted by time", () => {
    const r = deriveToday(
      [
        appt({ id: "late", status: "pending", cleaner_confirmation_status: "awaiting", scheduled_time: "15:00:00" }),
        appt({ id: "early", status: "pending", cleaner_confirmation_status: "awaiting", scheduled_time: "09:00:00" }),
      ],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.offers.map((o) => o.id)).toEqual(["early", "late"]);
  });

  it("hides offers entirely in the employee model", () => {
    const r = deriveToday(
      [appt({ status: "pending", cleaner_confirmation_status: "awaiting" })],
      TODAY, TOMORROW, "hourly_external"
    );
    expect(r.offers).toHaveLength(0);
  });

  it("lists today's confirmed + in-progress jobs sorted by time", () => {
    const r = deriveToday(
      [
        appt({ id: "pm", scheduled_time: "16:30:00" }),
        appt({ id: "am", scheduled_time: "08:00:00" }),
        appt({ id: "done", status: "completed", scheduled_time: "07:00:00" }),
      ],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.todayJobs.map((j) => j.id)).toEqual(["am", "pm"]);
  });

  it("counts tomorrow's jobs and finds the earliest start", () => {
    const r = deriveToday(
      [
        appt({ scheduled_date: TOMORROW, scheduled_time: "13:00:00" }),
        appt({ scheduled_date: TOMORROW, scheduled_time: "09:00:00" }),
      ],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.tomorrowCount).toBe(2);
    expect(r.tomorrowFirstTime).toBe("09:00:00");
  });

  it("reports empty when nothing is actionable", () => {
    const r = deriveToday([], TODAY, TOMORROW, "percentage_contractor");
    expect(r.isEmpty).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- deriveToday`
Expected: FAIL with "deriveToday is not a function".

- [ ] **Step 4: Implement `deriveToday`**

`src/components/redesign/cleaner/today/deriveToday.ts`:

```ts
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { CleanerPayoutModel, TodayData } from "./today-types";

const byTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");

const isScheduledOn = (a: CleanerAppointment, date: string) =>
  a.scheduled_date === date && (a.status === "confirmed" || a.status === "in_progress");

export function deriveToday(
  appointments: CleanerAppointment[],
  todayStr: string,
  tomorrowStr: string,
  payoutModel: CleanerPayoutModel
): TodayData {
  const activeJob = appointments.find((a) => a.status === "in_progress") ?? null;

  const offers =
    payoutModel === "percentage_contractor"
      ? appointments
          .filter((a) => a.status === "pending" && a.cleaner_confirmation_status === "awaiting")
          .sort(byTime)
      : [];

  const todayJobs = appointments.filter((a) => isScheduledOn(a, todayStr)).sort(byTime);

  const tomorrow = appointments.filter((a) => isScheduledOn(a, tomorrowStr)).sort(byTime);
  const tomorrowCount = tomorrow.length;
  const tomorrowFirstTime = tomorrow[0]?.scheduled_time ?? null;

  const isEmpty = !activeJob && offers.length === 0 && todayJobs.length === 0 && tomorrowCount === 0;

  return { activeJob, offers, todayJobs, tomorrowCount, tomorrowFirstTime, isEmpty };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- deriveToday`
Expected: PASS (all 6).

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/cleaner/today/today-types.ts src/components/redesign/cleaner/today/deriveToday.ts src/components/redesign/cleaner/today/deriveToday.test.ts
git commit   # "feat(redesign): Today domain logic (deriveToday)" + trailers
```

---

### Task 6: Today presenters (formatting)

**Files:**
- Create: `src/components/redesign/cleaner/today/today-presenters.ts`
- Test: `src/components/redesign/cleaner/today/today-presenters.test.ts`

**Interfaces:**
- Consumes: `CleanerAppointment`.
- Produces:
  - `function formatTimeParts(time: string): { h: string; ap: string }` — `"14:30:00"` -> `{ h: "2:30", ap: "PM" }`.
  - `function propertyTitle(a: CleanerAppointment): string` — property name or street address, falling back to "Job".
  - `function jobSubtitle(a: CleanerAppointment): string` — `"<service> · <customer>"` with graceful omissions.
  - `function statusBadge(a: CleanerAppointment): { label: string; tone: "blue" | "amber" | "gray" | "green" }`.

- [ ] **Step 1: Write the failing test**

`src/components/redesign/cleaner/today/today-presenters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTimeParts, propertyTitle, jobSubtitle, statusBadge } from "./today-presenters";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const base = {
  id: "x", scheduled_date: "2026-06-26", scheduled_time: "14:30:00",
  status: "confirmed", total_price: 100, cleaner_confirmation_status: "approved",
  homeowner: null, property: null, service_type: null,
} as CleanerAppointment;

describe("today-presenters", () => {
  it("formats 24h time into 12h parts", () => {
    expect(formatTimeParts("14:30:00")).toEqual({ h: "2:30", ap: "PM" });
    expect(formatTimeParts("09:00:00")).toEqual({ h: "9:00", ap: "AM" });
    expect(formatTimeParts("00:15:00")).toEqual({ h: "12:15", ap: "AM" });
  });

  it("titles by property name, then address, then a fallback", () => {
    expect(propertyTitle({ ...base, property: { name: "Oak House", address: "1 A St", city: "", state: "", zip_code: "" } })).toBe("Oak House");
    expect(propertyTitle({ ...base, property: { name: "", address: "123 Oak Street", city: "", state: "", zip_code: "" } })).toBe("123 Oak Street");
    expect(propertyTitle(base)).toBe("Job");
  });

  it("builds a subtitle from service and customer", () => {
    expect(jobSubtitle({ ...base, service_type: { name: "Standard Clean", description: "", duration_minutes: 120 }, homeowner: { first_name: "Sarah", last_name: "M", email: "" } })).toBe("Standard Clean · Sarah M");
  });

  it("maps status to a badge tone", () => {
    expect(statusBadge({ ...base, status: "in_progress" }).tone).toBe("blue");
    expect(statusBadge({ ...base, status: "pending", cleaner_confirmation_status: "awaiting" }).tone).toBe("amber");
    expect(statusBadge({ ...base, status: "completed" }).tone).toBe("green");
    expect(statusBadge({ ...base, status: "confirmed" }).tone).toBe("gray");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- today-presenters`
Expected: FAIL with missing exports.

- [ ] **Step 3: Implement the presenters**

`src/components/redesign/cleaner/today/today-presenters.ts`:

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

export function statusBadge(a: CleanerAppointment): { label: string; tone: "blue" | "amber" | "gray" | "green" } {
  if (a.status === "in_progress") return { label: "In progress", tone: "blue" };
  if (a.status === "completed") return { label: "Done", tone: "green" };
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return { label: "Needs response", tone: "amber" };
  return { label: "Upcoming", tone: "gray" };
}
```

> The `·` above is a middle dot (U+00B7), not an em dash; it is allowed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- today-presenters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/today/today-presenters.ts src/components/redesign/cleaner/today/today-presenters.test.ts
git commit   # "feat(redesign): Today presenters (time/title/subtitle/badge)" + trailers
```

---

### Task 7: Today view + container + page

**Files:**
- Create: `src/components/redesign/cleaner/today/CleanerTodayView.tsx`
- Create: `src/components/redesign/cleaner/today/CleanerToday.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/page.tsx`

**Interfaces:**
- Consumes: `useCleanerAppointments()` (`{ appointments, loading, error, refetch }`), `deriveToday`, presenters, `TodayData`, `Skeleton`/`EmptyState` from `@/components/ui/*`, `useRouter`.
- Produces: `<CleanerToday />` (default route content); `<CleanerTodayView ... />` (pure presentation with `onContinueActive` / `onRespondOffer` / `onOpenJob` callbacks).

- [ ] **Step 1: Build the view**

`src/components/redesign/cleaner/today/CleanerTodayView.tsx`:

```tsx
"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { TodayData } from "./today-types";
import { formatTimeParts, propertyTitle, jobSubtitle, statusBadge } from "./today-presenters";

const TONE: Record<string, string> = {
  blue: "bg-[#E1EAFF] text-brand-600",
  amber: "bg-[#FEF3C7] text-[#92660A]",
  green: "bg-[#DCFCE7] text-[#15803D]",
  gray: "bg-muted text-muted-foreground",
};

function Badge({ a }: { a: CleanerAppointment }) {
  const b = statusBadge(a);
  return <span className={cn("rounded-pill px-2.5 py-1 text-[10px] font-bold", TONE[b.tone])}>{b.label}</span>;
}

function SectionHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{title}</h2>
      {trailing}
    </div>
  );
}

function JobRow({ a, onClick }: { a: CleanerAppointment; onClick: () => void }) {
  const t = formatTimeParts(a.scheduled_time);
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
        <div className="truncate text-sm font-bold">{propertyTitle(a)}</div>
        <div className="truncate text-xs text-muted-foreground">{jobSubtitle(a)}</div>
      </div>
      <Badge a={a} />
    </button>
  );
}

export function CleanerTodayView({
  data,
  loading,
  onContinueActive,
  onRespondOffer,
  onOpenJob,
  onSeeTomorrow,
}: {
  data: TodayData;
  loading: boolean;
  onContinueActive: () => void;
  onRespondOffer: (id: string) => void;
  onOpenJob: (id: string) => void;
  onSeeTomorrow: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-16 w-full rounded-card" />
      </div>
    );
  }

  if (data.isEmpty) {
    return (
      <div className="pt-10">
        <EmptyState icon={Sparkles} title="Nothing scheduled" description="When you have jobs or new offers, they'll show up here." />
      </div>
    );
  }

  return (
    <div className="space-y-7 pt-2">
      {data.activeJob && (
        <section>
          <div className="rounded-card bg-brand-600 p-4 text-white shadow-soft-lg">
            <div className="text-[10px] font-extrabold tracking-widest opacity-85">ACTIVE JOB</div>
            <div className="mt-0.5 text-lg font-extrabold">{propertyTitle(data.activeJob)}</div>
            <div className="text-xs opacity-90">{jobSubtitle(data.activeJob)}</div>
            <button
              onClick={onContinueActive}
              className="mt-3 w-full rounded-pill bg-white py-3 text-sm font-extrabold text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Continue job
            </button>
          </div>
        </section>
      )}

      {data.offers.length > 0 && (
        <section>
          <SectionHeader
            title="Needs your response"
            trailing={<span className="rounded-pill bg-[#E1EAFF] px-2 py-0.5 text-[11px] font-extrabold text-brand-600">{data.offers.length}</span>}
          />
          <div className="space-y-3">
            {data.offers.map((o) => {
              const t = formatTimeParts(o.scheduled_time);
              return (
                <div key={o.id} className="rounded-card border border-l-4 border-border border-l-[#F59E0B] bg-card p-4 shadow-soft-sm">
                  <div className="text-sm font-extrabold">{t.h} {t.ap}</div>
                  <div className="mt-1 text-sm font-semibold">{propertyTitle(o)}</div>
                  <div className="text-xs text-muted-foreground">{jobSubtitle(o)}</div>
                  <button
                    onClick={() => onRespondOffer(o.id)}
                    className="mt-3 min-h-[44px] w-full rounded-pill bg-brand-600 text-sm font-extrabold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Respond
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {data.todayJobs.length > 0 && (
        <section>
          <SectionHeader title="Today" trailing={<span className="ml-auto text-xs font-medium text-muted-foreground">{data.todayJobs.length} jobs</span>} />
          <div className="space-y-2.5">
            {data.todayJobs.map((j) => <JobRow key={j.id} a={j} onClick={() => onOpenJob(j.id)} />)}
          </div>
        </section>
      )}

      {data.tomorrowCount > 0 && (
        <section>
          <SectionHeader title="Tomorrow" />
          <button
            onClick={onSeeTomorrow}
            className="flex w-full items-center gap-2 rounded-card border border-dashed border-border bg-card p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex-1 text-sm text-muted-foreground">
              <b className="text-foreground">{data.tomorrowCount} {data.tomorrowCount === 1 ? "job" : "jobs"}</b>
              {data.tomorrowFirstTime ? ` · first at ${formatTimeParts(data.tomorrowFirstTime).h} ${formatTimeParts(data.tomorrowFirstTime).ap}` : ""}
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
          </button>
        </section>
      )}
    </div>
  );
}
```

> Verify `Skeleton` and `EmptyState` import paths/props against `src/components/ui/`. The brand-tint hexes (`#E1EAFF` etc.) mirror the badge tones used in the operator screens; if a semantic token exists for them, prefer it.

- [ ] **Step 2: Build the container + page**

`src/components/redesign/cleaner/today/CleanerToday.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCleanerAppointments } from "@/hooks/useCleanerData";
import { deriveToday } from "./deriveToday";
import { CleanerTodayView } from "./CleanerTodayView";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerToday() {
  const router = useRouter();
  const { appointments, loading } = useCleanerAppointments();

  const now = new Date();
  const todayStr = ymd(now);
  const tomorrowStr = ymd(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  // Slice 1 ships the contractor model only; the employee-model read is wired
  // in the placeholders slice. deriveToday already branches on this param.
  const data = deriveToday(appointments, todayStr, tomorrowStr, "percentage_contractor");

  // Deep actions bridge to the legacy panel (?appointment=) until Slice 2 ships
  // the in-redesign job detail. Never dead-ends.
  const openLegacy = (id: string) => router.push(`/cleaner-dashboard?appointment=${id}`);

  return (
    <CleanerTodayView
      data={data}
      loading={loading}
      onContinueActive={() => data.activeJob && openLegacy(data.activeJob.id)}
      onRespondOffer={openLegacy}
      onOpenJob={openLegacy}
      onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
    />
  );
}
```

`src/app/(redesign)/app/cleaner-dashboard/page.tsx`:

```tsx
import { CleanerToday } from "@/components/redesign/cleaner/today/CleanerToday";

export default function CleanerTodayPage() {
  return <CleanerToday />;
}
```

- [ ] **Step 3: Type-check, lint, unit tests**

Run: `npx tsc --noEmit && npm run lint && npm run test:unit -- cleaner`
Expected: no new type/lint errors; all cleaner unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/cleaner/today/CleanerTodayView.tsx src/components/redesign/cleaner/today/CleanerToday.tsx "src/app/(redesign)/app/cleaner-dashboard/page.tsx"
git commit   # "feat(redesign): cleaner Today screen (shell home)" + trailers
```

---

### Task 8: Visual verification + UX pass + screenshot

**Files:** none (verification only).

- [ ] **Step 1: Run the app and seed an active+offer state**

Run `npm run dev` with `NEXT_PUBLIC_REDESIGN_ENABLED=true`, sign in as a cleaner in an org with at least: one `in_progress` job, one `pending`/`awaiting` offer, one confirmed job today, and a job tomorrow (use the remote dev Supabase roster).

- [ ] **Step 2: Screenshot at 390px via Playwright MCP**

Navigate to `http://localhost:3000/app/cleaner-dashboard`, set viewport to 390x844, capture the page. Verify against the approved mockup: active job pinned (brand), offers with Respond, today timeline rows, tomorrow peek, bottom nav with Today active. Also capture the empty state (a cleaner with no jobs) and the loading skeleton.

- [ ] **Step 3: ui-ux-pro-max review pass**

Run the ui-ux-pro-max CLI for a final mobile check:
`& "C:/Users/mvbda/AppData/Local/Programs/Python/Python311/python.exe" "C:/Users/mvbda/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.5.0/src/ui-ux-pro-max/scripts/search.py" "touch target safe area active nav empty state skeleton" --domain ux`
Confirm: touch targets >= 44px, active nav highlighted, safe-area padding on the bottom bar, empty + loading states present. Fix any gaps and amend the relevant commit.

- [ ] **Step 4: Send the screenshots to the user**

Deliver the Today (populated), empty, and loading screenshots for sign-off.

- [ ] **Step 5: Full gates + Codex + push + PR**

```bash
npm run test
npx tsc --noEmit
npm run lint
```
Then run the Codex branch review (`--scope branch --base master`), apply valid findings as a "fix: address Codex review" commit, then `git push -u origin feat/redesign-cleaner-app` and open a PR to `master`.

---

## Self-Review

**Spec coverage (Slice 1 only):**
- Route group + flag gating -> Tasks 4 (pages under the gated group). OK.
- Role routing into redesign -> Task 1. OK.
- Phone-first shell (top bar, bottom nav, safe areas, no rail) -> Tasks 2-4. OK.
- 5-tab bottom nav (Today/Schedule/Earnings/Messages/Profile) -> Task 2. OK.
- Today feed (active pinned, offers, today timeline, tomorrow peek, empty/loading) -> Tasks 5-7. OK.
- Model-aware (offers hidden in employee model) -> Task 5 (`deriveToday` param + test), Task 7 (default contractor, real read deferred). OK, with the deferral noted.
- Reuse hooks, no new data layer -> Tasks 5-7 use `useCleanerAppointments`. OK.
- Deep-link/no-dead-end actions -> Task 7 legacy bridge. OK.
- Empty/loading/active-nav/touch/safe-area -> Tasks 2,4,7,8. OK.
- Earnings/Messages/Profile/Schedule full screens, the active-job flow, photo gate, employee placeholders -> **out of scope for Slice 1** (later slices, stubs only here). OK.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" placeholders. The "coming soon" stub pages are intentional product placeholders, not plan gaps. The two "verify prop names against the primitive" notes are explicit guardrails, not unfinished steps.

**Type consistency:** `CleanerAppointment` fields used (`status`, `cleaner_confirmation_status`, `scheduled_date`, `scheduled_time`, `property`, `service_type`, `homeowner`) match the hook's exported interface. `TodayData` shape is identical across Task 5 (definition), Task 7 (consumption), and the tests. `deriveToday`/`formatTimeParts`/`statusBadge`/`propertyTitle`/`jobSubtitle` signatures match between definition, tests, and the view.

## Out of scope (later slices)
- Slice 2: in-redesign job detail + active-job flow (replaces the legacy bridge), inline offer Accept/Decline.
- Slice 3: photo gate (`require_job_photos` + skip-with-reason) and lifecycle/charge wiring.
- Slice 4: Earnings. Slice 5: Messages. Slice 6: Profile + employee-model placeholders (incl. wiring the real `default_payout_model` read into Today).
