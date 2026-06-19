# Operator Shell + Overview (Redesign Reference Screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first redesigned screen — the Operator (admin) shell + Overview — at `/app/admin-dashboard` inside a flag-gated `(redesign)` route group, on the real primitive kit, reusing existing headless hooks, with zero edits to legacy dashboard files. This screen is the canonical, screenshot-matched reference every later screen copies.

**Architecture:** A new `src/app/(redesign)/` route group owns a layout that scopes the `.redesign` theme + production gate; new presentational components live in `src/components/redesign/`; the page consumes the existing `useAuth` / `useAdminStats` / `usePaymentStats` / `useAdminAppointments` / `useManagerPermissions` hooks unchanged. A `NEXT_PUBLIC_REDESIGN_ENABLED` flag flips the admin post-login redirect to the new route. Legacy `src/app/*-dashboard` and legacy `src/components/*` are never edited (the only legacy touch is the login redirect — the one sanctioned wiring edit).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (redesign tokens), shadcn/Radix primitives in `src/components/ui/`, TanStack Query hooks, Vitest (unit), Playwright MCP (visual fidelity).

## Global Constraints

- **Legacy untouched:** do not edit any file under `src/app/{admin,manager,cleaner,homeowner}-dashboard/**` or any legacy component in `src/components/*` (only `src/components/redesign/**` and `src/components/ui/**` are in play). The sole legacy edit allowed is `src/app/login/page.tsx` (redirect wiring).
- **No backend changes:** no API routes, no migrations, no hook edits. Consume existing hooks as-is.
- **Flag:** client flag is `NEXT_PUBLIC_REDESIGN_ENABLED` (string `"true"`), read via `redesignUiEnabled()` — matches the decisions log. Default `false` (prod/test), `true` in `.env.development.local`.
- **Route prefix:** redesigned screens live under `/app/...` (the `(redesign)` group name strips from the URL; `/app/admin-dashboard` avoids colliding with legacy `/admin-dashboard`). Promoted at cutover.
- **Theme scoping:** every redesign screen renders inside the `(redesign)` layout's `<ThemeProvider><div className="redesign font-jakarta min-h-screen">`. Do NOT add `AuthProvider`/`QueryClientProvider` (root `LayoutWrapper` owns them; re-wrapping splits cache/auth).
- **Identity locked:** brand `#0150FC`, Plus Jakarta Sans, warm canvas, pillowy radius, soft shadows. Use tokens/primitives only — no ad-hoc hex or fonts.
- **Enforced UX rules** (from decisions log): SVG icons only (Lucide), 150–300ms transitions, AA contrast both themes, visible focus rings, ≥44px touch targets, reduced-motion respected, responsive at 375/768/1024/1440.
- **Admin+Manager are one design:** gate sections/actions by `useManagerPermissions()` flags so the same screen serves both roles (admins effectively have all permissions).
- **Fidelity gate:** UI tasks are accepted only when a Playwright MCP screenshot (desktop + mobile) matches the approved mockup in `docs/redesign/mockups/` and passes a `ui-ux-pro-max` review.

---

### Task 1: Redesign feature flag

**Files:**
- Create: `src/lib/redesign/flags.ts`
- Test: `src/lib/redesign/flags.test.ts`

**Interfaces:**
- Produces: `redesignUiEnabled(): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/redesign/flags.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { redesignUiEnabled } from "./flags";

describe("redesignUiEnabled", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns true only when the flag is exactly 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "true");
    expect(redesignUiEnabled()).toBe(true);
  });

  it("returns false when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "");
    expect(redesignUiEnabled()).toBe(false);
  });

  it("returns false for truthy-but-not-'true' values", () => {
    vi.stubEnv("NEXT_PUBLIC_REDESIGN_ENABLED", "1");
    expect(redesignUiEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/redesign/flags.test.ts`
Expected: FAIL (cannot resolve `./flags`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/redesign/flags.ts
/**
 * Client flag for the dashboard redesign. Mirrors the stripe-flags convention:
 * exact string compare against "true", NEXT_PUBLIC_ prefix so it is readable
 * on the client. Default off.
 */
export function redesignUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REDESIGN_ENABLED === "true";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/redesign/flags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the dev env value**

Add to `.env.development.local` (gitignored — do not commit): `NEXT_PUBLIC_REDESIGN_ENABLED=true`. Leave it unset/`false` everywhere else.

- [ ] **Step 6: Commit**

```bash
git add src/lib/redesign/flags.ts src/lib/redesign/flags.test.ts
git commit -m "feat(redesign): add redesignUiEnabled flag"
```

---

### Task 2: Flag-aware dashboard redirect

**Files:**
- Create: `src/lib/redesign/dashboardPath.ts`
- Test: `src/lib/redesign/dashboardPath.test.ts`
- Modify: `src/app/login/page.tsx` (replace the inline `getDashboardPath` with the extracted one + pass the flag)

**Interfaces:**
- Consumes: `redesignUiEnabled` (Task 1)
- Produces: `getDashboardPath(role: string, opts?: { redesign?: boolean }): string`

Rationale: extract the inline `getDashboardPath` to a pure, testable module. Only **admin** flips to the redesign path in this plan (manager/cleaner/homeowner redesign routes don't exist yet — flipping them would dead-end). The `/owner` platform-admin short-circuit stays in the page's `useEffect`, untouched.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/redesign/dashboardPath.test.ts
import { describe, expect, it } from "vitest";
import { getDashboardPath } from "./dashboardPath";

describe("getDashboardPath", () => {
  it("maps legacy paths when redesign is off", () => {
    expect(getDashboardPath("admin")).toBe("/admin-dashboard");
    expect(getDashboardPath("manager")).toBe("/manager-dashboard");
    expect(getDashboardPath("cleaner")).toBe("/cleaner-dashboard");
    expect(getDashboardPath("homeowner")).toBe("/homeowner-dashboard");
    expect(getDashboardPath("nonsense")).toBe("/");
  });

  it("routes ONLY admin to the redesign operator screen when on", () => {
    expect(getDashboardPath("admin", { redesign: true })).toBe("/app/admin-dashboard");
    // not-yet-built redesign screens still go to legacy to avoid dead-ends
    expect(getDashboardPath("manager", { redesign: true })).toBe("/manager-dashboard");
    expect(getDashboardPath("cleaner", { redesign: true })).toBe("/cleaner-dashboard");
    expect(getDashboardPath("homeowner", { redesign: true })).toBe("/homeowner-dashboard");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/redesign/dashboardPath.test.ts`
Expected: FAIL (cannot resolve `./dashboardPath`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/redesign/dashboardPath.ts
/** Post-login destination for a user role. When redesign is on, only admin
 *  is routed to the new operator screen (other redesign screens don't exist yet). */
export function getDashboardPath(role: string, opts?: { redesign?: boolean }): string {
  const redesign = opts?.redesign ?? false;
  switch (role) {
    case "homeowner":
      return "/homeowner-dashboard";
    case "cleaner":
      return "/cleaner-dashboard";
    case "manager":
      return "/manager-dashboard";
    case "admin":
      return redesign ? "/app/admin-dashboard" : "/admin-dashboard";
    default:
      return "/";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/redesign/dashboardPath.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into the login page**

In `src/app/login/page.tsx`: delete the inline `getDashboardPath` const; add imports and pass the flag at the call site.

```ts
import { getDashboardPath } from "@/lib/redesign/dashboardPath";
import { redesignUiEnabled } from "@/lib/redesign/flags";
```

Replace the redirect line inside the existing `useEffect` (keep the `/owner` short-circuit and the `isPlatformAdmin !== null` guard exactly as-is):

```ts
useEffect(() => {
  if (user && isPlatformAdmin !== null) {
    router.push(
      isPlatformAdmin ? "/owner" : getDashboardPath(user.role, { redesign: redesignUiEnabled() })
    );
  }
}, [user, isPlatformAdmin, router]);
```

- [ ] **Step 6: Verify typecheck + login still compiles**

Run: `npx tsc --noEmit` (no new errors) and `npm run test:unit -- src/lib/redesign/dashboardPath.test.ts` (PASS).

- [ ] **Step 7: Commit**

```bash
git add src/lib/redesign/dashboardPath.ts src/lib/redesign/dashboardPath.test.ts src/app/login/page.tsx
git commit -m "feat(redesign): flag-gated admin redirect to /app/admin-dashboard"
```

---

### Task 3: `(redesign)` route group layout + gate (with a smoke page)

**Files:**
- Create: `src/app/(redesign)/layout.tsx`
- Create: `src/app/(redesign)/app/admin-dashboard/page.tsx` (temporary smoke page; replaced in Task 6)

**Interfaces:**
- Consumes: `redesignUiEnabled` (Task 1), `ThemeProvider` from `@/components/ui/theme-provider`
- Produces: the `/app/admin-dashboard` route, themed + gated.

Gate logic (extends the `(dev)` pattern): allow in local dev, on Vercel preview, OR when the redesign flag is on (so a prod rollout is possible by flipping the flag). With the flag off in prod, the whole tree 404s — half-built screens never leak.

- [ ] **Step 1: Create the group layout**

```tsx
// src/app/(redesign)/layout.tsx
import { notFound } from "next/navigation";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { redesignUiEnabled } from "@/lib/redesign/flags";

// Redesign screens are reachable in local dev, on Vercel preview, OR in any
// environment where NEXT_PUBLIC_REDESIGN_ENABLED === "true". With the flag off
// in production the tree 404s, so in-progress screens never leak. Per-request
// (force-dynamic) so the runtime env is authoritative.
export const dynamic = "force-dynamic";

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  const allowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview" ||
    redesignUiEnabled();
  if (!allowed) notFound();
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">{children}</div>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Create a temporary smoke page**

```tsx
// src/app/(redesign)/app/admin-dashboard/page.tsx
export default function OperatorOverviewSmoke() {
  return (
    <main className="grid min-h-screen place-items-center bg-background text-foreground">
      <div className="rounded-card border border-border bg-card p-8 shadow-soft-md">
        <h1 className="text-2xl font-bold">Operator redesign route is live.</h1>
        <p className="text-muted-foreground mt-2">Replaced by the real shell + Overview in Task 6.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify the route renders (dev) via Playwright MCP**

Start dev (`npm run dev`), ensure `NEXT_PUBLIC_REDESIGN_ENABLED=true` in `.env.development.local`. With Playwright MCP: `browser_navigate` to `http://localhost:3000/app/admin-dashboard`, `browser_snapshot`. Expected: the smoke card renders in Plus Jakarta Sans on the warm canvas (confirms `.redesign` scope is active). Take `browser_take_screenshot` for the record.

- [ ] **Step 4: Verify the production gate (flag off) 404s**

Temporarily set `NEXT_PUBLIC_REDESIGN_ENABLED=false`, simulate prod: `npm run build && npx cross-env VERCEL_ENV=production npm run start` (or unset preview); navigate to `/app/admin-dashboard`. Expected: 404 (Next not-found). Restore `=true` for dev afterward. (If running prod locally is impractical, assert the gate logic by unit-reasoning + verify dev/preview render; note this in the commit.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(redesign)/layout.tsx" "src/app/(redesign)/app/admin-dashboard/page.tsx"
git commit -m "feat(redesign): (redesign) route group layout + gate + smoke page"
```

---

### Task 4: Operator shell (rail + top bar + mobile nav)

**Files:**
- Create: `src/components/redesign/shell/OperatorShell.tsx` (composes the three below + responsive content slot)
- Create: `src/components/redesign/shell/OperatorRail.tsx` (desktop full-height hover-expand brand rail)
- Create: `src/components/redesign/shell/OperatorTopBar.tsx` (search + New booking + bell + profile)
- Create: `src/components/redesign/shell/OperatorMobileNav.tsx` (bottom tabs + Menu→full-rail drawer via `Sheet`)
- Create: `src/components/redesign/shell/nav-items.ts` (shared destination list)

**Interfaces:**
- Consumes: primitives `Logo`, `Button`, `Tooltip`, `Sheet`/`SheetContent`/`SheetTrigger`, `Avatar`, `DropdownMenu`, `Input` (search), Lucide icons. `useAuth()` for profile/sign-out; `usePathname()` for active state.
- Produces: `<OperatorShell active="overview">{children}</OperatorShell>` — renders rail (desktop ≥`lg`), top bar, and bottom nav + drawer (`<lg`), with `{children}` in the content area.

**Mockup source of truth:** `docs/redesign/mockups/operator-desktop-shell.html` (rail hover-expand, top bar) and `docs/redesign/mockups/operator-mobile-shell.html` (bottom tabs + Menu drawer). Translate that exact structure into primitives. Final spacing/sizing is settled by the screenshot loop in Step 4 — the code below is the structural first cut.

- [ ] **Step 1: Define the nav destinations**

```ts
// src/components/redesign/shell/nav-items.ts
import { Home, CalendarDays, Users, UsersRound, Tag, CreditCard, BarChart3, MessageSquare, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { id: string; label: string; href: string; icon: LucideIcon; primary?: boolean };

// `primary: true` = shown in the mobile bottom bar (max 4 + Menu). All show in the rail/drawer.
export const OPERATOR_NAV: NavItem[] = [
  { id: "overview",  label: "Overview",            href: "/app/admin-dashboard",            icon: Home,         primary: true },
  { id: "bookings",  label: "Bookings",            href: "/app/admin-dashboard/bookings",   icon: CalendarDays, primary: true },
  { id: "people",    label: "Customers",           href: "/app/admin-dashboard/customers",  icon: Users,        primary: true },
  { id: "cleaners",  label: "Cleaners & team",     href: "/app/admin-dashboard/team",       icon: UsersRound },
  { id: "services",  label: "Services",            href: "/app/admin-dashboard/services",   icon: Tag },
  { id: "payments",  label: "Payments & payouts",  href: "/app/admin-dashboard/payments",   icon: CreditCard },
  { id: "analytics", label: "Analytics",           href: "/app/admin-dashboard/analytics",  icon: BarChart3 },
  { id: "messages",  label: "Messages",            href: "/app/admin-dashboard/messages",   icon: MessageSquare, primary: true },
  { id: "settings",  label: "Settings",            href: "/app/admin-dashboard/settings",   icon: Settings },
];
```

> Note: only `overview` is built in this plan; other hrefs are placeholders for now. Until those screens exist, clicking them should fall back gracefully (Task 6 Step: render a "coming soon" inline for unbuilt routes, OR link to the legacy equivalent — decide per the decisions-log "cross-boundary links" gotcha; default to legacy link).

- [ ] **Step 2: Build `OperatorRail.tsx` (desktop, hover-expand)**

Translate `operator-desktop-shell.html` rail: a `hidden lg:flex` fixed full-height column, default `w-[56px]`, `hover:w-[220px]` with `transition-[width] duration-200`; brand block at top using `<Logo variant="mark" />` collapsed and `<Logo variant="full" />` (or mark + "Nexxus" wordmark) revealed on hover; nav items rendered from `OPERATOR_NAV` as icon + label (label `opacity-0` → `group-hover:opacity-100`); `Settings` pinned bottom (`mt-auto`); active item (`pathname` match) uses `bg-brand-600 text-white rounded-control`. Each collapsed item wrapped in `Tooltip` (label as content) for discoverability. No divider between brand and nav (decisions-log lock). `'use client'` (uses `usePathname`, hover).

```tsx
// src/components/redesign/shell/OperatorRail.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OPERATOR_NAV } from "./nav-items";
import { cn } from "@/lib/utils"; // confirm cn util path during impl

export function OperatorRail() {
  const pathname = usePathname();
  return (
    <aside className="group fixed inset-y-0 left-0 z-40 hidden w-[56px] flex-col overflow-hidden border-r border-border bg-card transition-[width,box-shadow] duration-200 hover:w-[220px] hover:shadow-soft-lg lg:flex">
      <div className="flex h-[56px] flex-none items-center gap-3 px-3">
        <Logo variant="mark" className="h-8 w-8 flex-none" />
        <span className="whitespace-nowrap text-lg font-extrabold opacity-0 transition-opacity group-hover:opacity-100">Nexxus</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 pb-3">
        {OPERATOR_NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Link href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-control px-[9px] py-[9px] text-muted-foreground",
                    item.id === "settings" && "mt-auto",
                    active && "bg-brand-600 text-white"
                  )}>
                  <Icon className="h-5 w-5 flex-none" aria-hidden />
                  <span className="whitespace-nowrap text-[13px] opacity-0 transition-opacity group-hover:opacity-100">{item.label}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="lg:hidden">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Build `OperatorTopBar.tsx` and `OperatorMobileNav.tsx`, then compose `OperatorShell.tsx`**

`OperatorTopBar`: a `h-[56px]` flex row (with `lg:pl-[56px]` to clear the rail) containing a search `Input` (icon-prefixed), a primary `Button` "New booking" (Plus icon), a notification bell `Button variant="ghost" size="icon"` with an unread dot, and a profile `DropdownMenu` triggered by `Avatar` (items: Settings, Sign out → `useAuth().signOut`). On mobile (`<lg`) the search collapses to an icon.

`OperatorMobileNav`: a `lg:hidden` fixed bottom bar with the `primary` nav items (icon + label) + a 5th "Menu" `SheetTrigger`; `SheetContent side="left"` renders the full rail list grouped Primary/More with the `<Logo variant="full" />` at top (mirrors `operator-mobile-shell.html`). A "New booking" FAB (`Button` fixed bottom-right above the bar).

`OperatorShell`: composes `<OperatorRail/>` + a content column with `<OperatorTopBar/>` on top, `<main className="lg:pl-[56px]">{children}</main>`, and `<OperatorMobileNav/>`. Accepts `active?: string` to pass active id down (or rely on `usePathname`). Wrap the whole tree in `TooltipProvider` (from the tooltip primitive) if not already provided globally.

Write all three files translating the mockup structure; use only documented primitives + Lucide icons + tokens (`bg-card`, `border-border`, `text-muted-foreground`, `rounded-control/card/pill`, `shadow-soft-*`, `bg-brand-600`).

- [ ] **Step 4: Visual fidelity check (Playwright MCP) — desktop + mobile**

Temporarily render the shell around the Task 3 smoke content (or a throwaway `?shellpreview`): with `npm run dev`, Playwright MCP `browser_navigate` to `/app/admin-dashboard`, then:
- Desktop: `browser_resize` 1440×900, `browser_take_screenshot`; hover the rail (`browser_hover` on the aside) and screenshot the expanded state. Compare to `operator-desktop-shell.html`.
- Mobile: `browser_resize` 390×844, screenshot the bottom bar; tap **Menu** (`browser_click`), screenshot the drawer. Compare to `operator-mobile-shell.html`.
Iterate the component code until both match (spacing, the hover-expand, the brand mark→lockup, active state, FAB). Then run a `ui-ux-pro-max` review pass: `<py> <search.py> "dashboard sidebar topbar mobile bottom-nav focus touch-target" --domain ux -n 12` (see `reference_ui_ux_pro_max` memory for the interpreter/script path) and fix any flagged a11y/interaction issues (focus rings, ≥44px targets, labels on icon buttons).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (no new errors).

```bash
git add src/components/redesign/shell/
git commit -m "feat(redesign): operator shell (rail + top bar + mobile nav)"
```

---

### Task 5: Overview content (derivation util + KPI strip + Needs-you-now + Today/Active)

**Files:**
- Create: `src/components/redesign/overview/deriveOverview.ts` (pure)
- Test: `src/components/redesign/overview/deriveOverview.test.ts`
- Create: `src/components/redesign/overview/OperatorOverview.tsx` (composition)
- Create: `src/components/redesign/overview/KpiStrip.tsx`
- Create: `src/components/redesign/overview/NeedsYouNowQueue.tsx`
- Create: `src/components/redesign/overview/TodayActivePanel.tsx`

**Interfaces:**
- Consumes: `useAdminStats`, `usePaymentStats`, `useAdminAppointments`, `useManagerPermissions`, `useAuth`; primitives `StatTile`, `Card`, `Badge`, `StatusPill`, `Button`, `Avatar`, `EmptyState`, `Skeleton`, `Separator`.
- Produces: `deriveOverviewSections(appointments, todayISO)` and `<OperatorOverview/>`.

**Mockup source of truth:** `docs/redesign/mockups/operator-desktop-shell.html` (KPI strip + "Needs you now" centerpiece + Today/Active column) and `operator-mobile-shell.html` (stacked).

- [ ] **Step 1: Write the failing test for the derivation util**

```ts
// src/components/redesign/overview/deriveOverview.test.ts
import { describe, expect, it } from "vitest";
import { deriveOverviewSections } from "./deriveOverview";

const appt = (over: Partial<any> = {}) => ({
  id: "a", status: "pending", cleaner_id: null,
  cleaner_confirmation_status: "awaiting", scheduled_date: "2026-06-19",
  cleaner_availability_feedback: [], ...over,
});

describe("deriveOverviewSections", () => {
  const today = "2026-06-19";

  it("classifies unassigned (no cleaner, not cancelled)", () => {
    const r = deriveOverviewSections([appt({ cleaner_id: null })], today);
    expect(r.unassigned).toHaveLength(1);
  });

  it("excludes cancelled from unassigned", () => {
    const r = deriveOverviewSections([appt({ cleaner_id: null, status: "cancelled" })], today);
    expect(r.unassigned).toHaveLength(0);
  });

  it("classifies declined and counter-proposed", () => {
    const r = deriveOverviewSections([
      appt({ cleaner_id: "c1", cleaner_confirmation_status: "rejected" }),
      appt({ cleaner_id: "c1", cleaner_availability_feedback: [{ at: "x" }] }),
    ], today);
    expect(r.declined).toHaveLength(1);
    expect(r.counterProposed).toHaveLength(1);
  });

  it("buckets today's schedule and active-now", () => {
    const r = deriveOverviewSections([
      appt({ cleaner_id: "c1", status: "confirmed", scheduled_date: today }),
      appt({ cleaner_id: "c1", status: "in_progress", scheduled_date: today }),
      appt({ cleaner_id: "c1", status: "confirmed", scheduled_date: "2026-07-01" }),
    ], today);
    expect(r.today).toHaveLength(2);
    expect(r.activeNow).toHaveLength(1);
  });

  it("guards a null counter-proposal array", () => {
    const r = deriveOverviewSections([appt({ cleaner_availability_feedback: null })], today);
    expect(r.counterProposed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/components/redesign/overview/deriveOverview.test.ts`
Expected: FAIL (cannot resolve `./deriveOverview`).

- [ ] **Step 3: Implement the derivation util**

```ts
// src/components/redesign/overview/deriveOverview.ts
import type { AdminAppointment } from "@/hooks/useAdminAppointments"; // confirm exact export at impl time

export type OverviewSections = {
  unassigned: AdminAppointment[];
  declined: AdminAppointment[];
  counterProposed: AdminAppointment[];
  today: AdminAppointment[];
  activeNow: AdminAppointment[];
};

export function deriveOverviewSections(appts: AdminAppointment[], todayISO: string): OverviewSections {
  const live = (a: AdminAppointment) => a.status !== "cancelled";
  return {
    unassigned: appts.filter((a) => live(a) && a.cleaner_id == null),
    declined: appts.filter((a) => live(a) && a.cleaner_confirmation_status === "rejected"),
    counterProposed: appts.filter((a) => live(a) && (a.cleaner_availability_feedback?.length ?? 0) > 0),
    today: appts.filter((a) => live(a) && a.scheduled_date === todayISO),
    activeNow: appts.filter((a) => a.status === "in_progress"),
  };
}
```

> At impl time, confirm the `AdminAppointment` type's exact import (build reference says `useAdminAppointments` returns `{ appointments }` with these fields; if the type isn't exported, define a minimal local `Pick<>` interface of the fields used). Confirm `todayISO` timezone matches how `scheduled_date` is stored (build-reference Gap: timezone) — reuse any existing legacy "today" helper if present rather than inventing one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/components/redesign/overview/deriveOverview.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Build the presentational pieces**

`KpiStrip.tsx`: four `<StatTile>` — Today's jobs (`sections.today.length`), In progress (`sections.activeNow.length`), Awaiting approval (`stats.pendingApprovals`), Revenue this month (`paymentStats.thisMonthRevenue`, currency-formatted, tabular figures). Gate the Revenue tile behind `permissions.can_view_payments` (admins pass; managers may not — show "Unassigned" count fallback per decisions log if off). Loading → `<Skeleton>` tiles.

`NeedsYouNowQueue.tsx`: a `<Card>` titled "Needs you now" with a count `<Badge variant="caution">`; three groups (Unassigned, All cleaners declined, Counter-proposed) each rendered as labeled rows composed from `Card`-row + `StatusPill`/`Badge` + `Avatar` + a primary `Button` action (Assign / Force-assign / Review). Empty → `<EmptyState title="You're all caught up" />`. (No triage-list primitive exists — compose from these, per build-reference Gap.)

`TodayActivePanel.tsx`: a column of two `<Card>`s — "Today's schedule" (time + property rows from `sections.today`, sorted by `scheduled_time`) and "Active now" (rows from `sections.activeNow` with a pulsing indicator dot). Empty states for each.

`OperatorOverview.tsx`: calls the hooks, computes `sections = deriveOverviewSections(appointments, todayISO)`, and lays out `KpiStrip` (full width) + a responsive grid: `NeedsYouNowQueue` (≈2fr) beside `TodayActivePanel` (≈1fr) on `lg`, stacked on mobile. Handle each hook's `loading` with skeletons; never block the whole screen on one slow query.

Use only documented primitives + tokens. `'use client'` on components using hooks.

- [ ] **Step 6: Visual fidelity check (Playwright MCP)**

Render `<OperatorOverview/>` inside the shell (still via the smoke page swap or a preview). With `npm run dev` + logged-in admin (dev roster) + flag on: navigate `/app/admin-dashboard`, screenshot desktop (1440) and mobile (390). Compare KPI strip + "Needs you now" centerpiece + Today/Active column to `operator-desktop-shell.html`. Verify loading skeletons (throttle network) and empty states (org with no data). Iterate to match; run `ui-ux-pro-max` review (`--domain ux "cards data-density tabular numbers empty-state skeleton"`) and fix flagged issues.

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit`; `npm run test:unit -- src/components/redesign/overview/deriveOverview.test.ts`.

```bash
git add src/components/redesign/overview/
git commit -m "feat(redesign): operator overview (derivation util + KPIs + needs-you-now + today/active)"
```

---

### Task 6: Compose the operator overview page + final fidelity pass

**Files:**
- Modify: `src/app/(redesign)/app/admin-dashboard/page.tsx` (replace the Task 3 smoke page)
- Create (optional): `src/app/(redesign)/app/admin-dashboard/layout.tsx` (SpeedInsights pass-through, mirroring legacy)

**Interfaces:**
- Consumes: `OperatorShell` (Task 4), `OperatorOverview` (Task 5), `useAuth` (auth guard).

- [ ] **Step 1: Write the page (Suspense + auth guard + shell + overview)**

Mirror the legacy auth-guard pattern from the build reference: outer `export default` wraps an inner `*Inner` in `<Suspense>`; inner destructures `useAuth()`, runs the redirect `useEffect`, the loading/org-status gate, and the `orgStatus === "error"` retry (`<WorkspaceErrorScreen>`), then renders `<OperatorShell active="overview"><OperatorOverview/></OperatorShell>`.

```tsx
// src/app/(redesign)/app/admin-dashboard/page.tsx
"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth"; // confirm exact path at impl
import { WorkspaceErrorScreen } from "@/components/WorkspaceErrorScreen"; // legacy component, read-only reuse
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorOverview } from "@/components/redesign/overview/OperatorOverview";

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="text-center"><Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" /><p className="text-muted-foreground">Loading...</p></div>
    </div>
  );
}

function OperatorOverviewInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  useEffect(() => { if (!loading && !user) router.push("/login"); }, [user, loading, router]);
  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  return (
    <OperatorShell active="overview">
      <OperatorOverview />
    </OperatorShell>
  );
}

export default function OperatorOverviewPage() {
  return (<Suspense fallback={<Spinner />}><OperatorOverviewInner /></Suspense>);
}
```

> Confirm at impl time: the exact `useAuth` import path (`@/hooks/useAuth` per build reference) and that `WorkspaceErrorScreen` is importable read-only. Reuse legacy `WorkspaceErrorScreen` rather than rebuilding (it's role-agnostic chrome).

- [ ] **Step 2: Full end-to-end fidelity pass (Playwright MCP)**

`npm run dev`, log in as a dev admin (flag on → redirected to `/app/admin-dashboard`). Verify the complete flow:
- Login redirect lands on `/app/admin-dashboard` (Task 2 wiring).
- Desktop 1440: full screen matches `operator-desktop-shell.html` (rail + top bar + KPI + Needs-you-now + Today/Active). Hover rail expands.
- Mobile 390: matches `operator-mobile-shell.html` (bottom nav + Menu drawer + FAB).
- Real data renders (today's count, in-progress, awaiting, revenue; queue groups populated/empty as appropriate).
- Keyboard: tab order through rail/top bar/queue actions; visible focus rings.
Iterate code until the screenshots match the mockups; final `ui-ux-pro-max` pre-delivery review pass (Quick Reference §1–§3) and fix anything flagged.

- [ ] **Step 3: Gates**

Run: `npm run test` (all pass), `npx tsc --noEmit` (no new errors), `npm run lint`.

- [ ] **Step 4: Codex review (per CLAUDE.md) then commit + push**

```bash
git add "src/app/(redesign)/app/admin-dashboard/"
git commit -m "feat(redesign): operator overview reference screen at /app/admin-dashboard"
```
Then run the Codex branch review (`node "<codex-plugin>/scripts/codex-companion.mjs" review --scope branch --base master`), apply valid findings as a follow-up commit, then `git push -u origin feat/redesign-operator-shell` and open a PR to master.

---

## Self-Review

**Spec coverage:** Build architecture (Approach B) → Tasks 1–3 (flag, redirect, gated route group). Operator shell desktop+mobile → Task 4. Overview (KPI + Needs-you-now + Today/Active) → Task 5. Reuse-hooks-no-backend → enforced in every task (consume-only). Fidelity gate (screenshot vs mockup + ui-ux-pro-max) → Tasks 4/5/6. Legacy-untouched → Global Constraints + only login edited. Covered.

**Placeholder scan:** Deterministic tasks (1, 2, 3, 5-derivation) have complete code + tests. UI tasks (4, 5-presentational, 6) intentionally specify structure + exact primitives + exact hook fields + mockup reference + screenshot-acceptance rather than final pixel TSX — this is by design for fidelity work (the screenshot loop produces final spacing), not a placeholder. `nav-items.ts` non-overview hrefs are explicitly flagged as placeholders with a fallback rule.

**Type consistency:** `redesignUiEnabled()` (Task 1) consumed in Tasks 2 + 3. `getDashboardPath(role, {redesign})` (Task 2) signature matches its test + login wiring. `deriveOverviewSections(appts, todayISO)` (Task 5) return keys (`unassigned/declined/counterProposed/today/activeNow`) match the test and the components that consume them. Hook field names (`pendingApprovals`, `thisMonthRevenue`, `cleaner_id`, `cleaner_confirmation_status`, `cleaner_availability_feedback`, `status`, `scheduled_date`) match the build reference.

**Known confirm-at-impl items** (flagged inline, not blockers): exact `AdminAppointment`/`useAuth` import paths; `cn` util path; the "today" timezone helper; whether `WorkspaceErrorScreen` is cleanly importable. Each task says to confirm by reading the file at implementation time.
