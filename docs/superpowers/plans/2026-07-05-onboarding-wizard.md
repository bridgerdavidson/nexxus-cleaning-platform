# Onboarding Wizard (R4-C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every redesign role (Operator, Cleaner, Homeowner) an adaptive first-run: a once-per-user welcome moment plus a persistent, derived-completion setup checklist that routes into screens that already exist, scoped to the percentage-contractor payout model.

**Architecture:** A model-keyed pure step config + a pure derive function feed three role-specific status hooks. Each role's dashboard-home container consumes its hook, renders a shared presentational `SetupChecklistCard` (pinned atop the home screen) and a shared `WelcomeContent` (wrapped in a `Dialog` for operator/desktop, a `MobileTakeover` for cleaner/homeowner). Completion is derived from existing data signals plus four new nullable flag/marker columns; nothing about the underlying screens or their forms is rebuilt.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Supabase (Postgres + RLS), TanStack Query v5, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-onboarding-wizard-design.md`. Wireframes (reference-only): `docs/redesign/mockups/onboarding/`.
- Build every screen from the design system: primitives in `src/components/ui/*` and tokens in `tailwind.config.js` + `src/app/globals.css`. Brand `#0150FC`, Plus Jakarta Sans, warm canvas, `rounded-card`/`rounded-pill`, `shadow-soft-md`. No raw hex or bespoke classes copied from a mockup.
- No em dashes in any product copy (labels, buttons, descriptions, toasts). Use periods, commas, parentheses, or "to".
- Cleaner- and homeowner-facing copy says "the office" / "homeowners", never "operator".
- Model scope is `percentage_contractor` only. Step definitions live in a model-keyed config; do not hardcode steps into components. No model-picker step.
- Roles in scope: Operator (admin + owner), Cleaner, Homeowner. No Manager or Platform-owner onboarding.
- **Button Slot gotcha:** the `Button` primitive is NOT `asChild`-compatible when it has a loading child. Never write `<Button asChild><Link/></Button>`. Render a link styled as a button with `<Link className={cn(buttonVariants({ variant, size }), '...')}>`.
- **No component-render test harness** exists (Vitest `environment: 'node'`, no jsdom/testing-library). Pure logic gets colocated `*.test.ts`; API routes get colocated `*.integration.test.ts`; presentational components and wiring are verified with `npx tsc --noEmit`, `npm run lint`, and Playwright MCP visual checks. Do NOT add a render harness.
- Legacy `src/components/admin-dashboard/OwnerSetupChecklist.tsx` is left untouched (deleted at cutover). This plan builds the redesign equivalent.
- Branch: `feat/onboarding-wizard`. Commit after each task.

---

## File Structure

**New files**
- `supabase/migrations/101_onboarding_flags.sql` — 5 additive nullable columns.
- `src/lib/onboarding/onboardingConfig.ts` — `OnboardingRole`, `OrgModel`, `SetupStepDef`, `getSetupSteps`.
- `src/lib/onboarding/onboardingConfig.test.ts`
- `src/lib/onboarding/deriveChecklist.ts` — `ChecklistItem`, `ChecklistVM`, `deriveChecklist`.
- `src/lib/onboarding/deriveChecklist.test.ts`
- `src/lib/onboarding/welcomeCopy.ts` — `WelcomeVariant`, `WelcomeCopy`, `getWelcomeCopy`.
- `src/lib/onboarding/welcomeCopy.test.ts`
- `src/lib/onboarding/onboardingFlags.ts` — client write helpers.
- `src/hooks/useOnboardingFlags.ts` — reads per-user flags (welcome + user dismissal).
- `src/hooks/useOperatorOnboarding.ts`
- `src/hooks/useCleanerOnboarding.ts`
- `src/hooks/useHomeownerOnboarding.ts`
- `src/components/redesign/onboarding/SetupChecklistCard.tsx` — presentational.
- `src/components/redesign/onboarding/WelcomeContent.tsx` — presentational inner.
- `src/app/api/organizations/[orgId]/onboarding/route.ts` — PATCH org dismissal.
- `src/app/api/organizations/[orgId]/onboarding/route.integration.test.ts`

**Modified files**
- `src/types/index.ts` — add flag fields to `UserProfile` + `Organization`.
- `src/lib/queryKeys.ts` — add `keys.onboarding`.
- `src/app/api/organizations/[orgId]/cleaner-payouts/route.ts` (+ its integration test) — stamp `payout_configured_at`.
- `src/app/api/organizations/[orgId]/business-hours/route.ts` (+ its integration test) — stamp `hours_policy_configured_at`.
- `src/components/redesign/overview/OperatorOverview.tsx` + `OperatorOverviewView.tsx` — wire operator checklist + welcome.
- `src/components/redesign/cleaner/today/CleanerToday.tsx` + `CleanerTodayView.tsx` — wire cleaner checklist + welcome.
- `src/components/redesign/homeowner/home/HomeownerHome.tsx` — wire homeowner checklist + welcome.
- `src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx` — empty-state gap (Slice 3).

---

# Slice 1 — Foundation + Operator

## Task 1: Migration 101 + type updates

**Files:**
- Create: `supabase/migrations/101_onboarding_flags.sql`
- Modify: `src/types/index.ts` (UserProfile interface ~64-75, Organization interface ~78-109)

**Interfaces:**
- Produces: DB columns `user_profiles.welcome_seen_at`, `user_profiles.setup_checklist_dismissed_at`, `organizations.setup_checklist_dismissed_at`, `organizations.payout_configured_at`, `organizations.hours_policy_configured_at`; TS fields on `UserProfile` and `Organization`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/101_onboarding_flags.sql
-- Onboarding wizard (R4-C): additive nullable flags/markers. No RLS change needed
-- (existing user_profiles_update + org update policies already cover new columns).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS welcome_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at timestamptz;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS hours_policy_configured_at timestamptz;

COMMENT ON COLUMN public.user_profiles.welcome_seen_at IS 'Onboarding: when the user first dismissed/completed the welcome moment.';
COMMENT ON COLUMN public.organizations.payout_configured_at IS 'Onboarding: when the owner first saved cleaner payout settings (a default percent cannot be distinguished from an intentional one).';
COMMENT ON COLUMN public.organizations.hours_policy_configured_at IS 'Onboarding: when the owner first saved business hours / policy.';
```

- [ ] **Step 2: Verify the schema rebuilds**

Run: `npx supabase db reset`
Expected: completes with no error; all migrations including `101_onboarding_flags.sql` apply cleanly.

- [ ] **Step 3: Add TS fields**

In `src/types/index.ts`, add to the `UserProfile` interface:

```ts
  welcome_seen_at?: string | null;
  setup_checklist_dismissed_at?: string | null;
```

Add to the `Organization` interface:

```ts
  setup_checklist_dismissed_at?: string | null;
  payout_configured_at?: string | null;
  hours_policy_configured_at?: string | null;
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from these additions (pre-existing errors may remain).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/101_onboarding_flags.sql src/types/index.ts
git commit -m "feat(onboarding): migration 101 flags + type fields"
```

---

## Task 2: `onboardingConfig.ts` (pure step config)

**Files:**
- Create: `src/lib/onboarding/onboardingConfig.ts`
- Test: `src/lib/onboarding/onboardingConfig.test.ts`

**Interfaces:**
- Produces:
  - `type OnboardingRole = 'operator' | 'cleaner' | 'homeowner'`
  - `type OrgModel = 'percentage_contractor' | 'hourly_external'`
  - `interface SetupStepDef { key: string; title: string; description: string; required: boolean; ctaLabel: string; href: string; completionKey: string }`
  - `function getSetupSteps(role: OnboardingRole, model: OrgModel): SetupStepDef[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/onboarding/onboardingConfig.test.ts
import { describe, it, expect } from 'vitest';
import { getSetupSteps } from './onboardingConfig';

describe('getSetupSteps', () => {
  it('returns 5 operator steps with 4 required for percentage_contractor', () => {
    const steps = getSetupSteps('operator', 'percentage_contractor');
    expect(steps.map((s) => s.key)).toEqual(['payments', 'services', 'payout', 'cleaners', 'hours']);
    expect(steps.filter((s) => s.required).map((s) => s.key)).toEqual(['payments', 'services', 'payout', 'cleaners']);
    expect(steps.find((s) => s.key === 'payout')!.href).toBe('/app/admin-dashboard/settings?section=payout');
  });

  it('returns cleaner steps: required payouts + optional profile', () => {
    const steps = getSetupSteps('cleaner', 'percentage_contractor');
    expect(steps.map((s) => s.key)).toEqual(['payouts', 'profile']);
    expect(steps.find((s) => s.key === 'payouts')!.required).toBe(true);
    expect(steps.find((s) => s.key === 'profile')!.required).toBe(false);
  });

  it('returns homeowner steps: both required', () => {
    const steps = getSetupSteps('homeowner', 'percentage_contractor');
    expect(steps.map((s) => s.key)).toEqual(['home', 'card']);
    expect(steps.every((s) => s.required)).toBe(true);
  });

  it('has no em dashes in copy', () => {
    const roles = ['operator', 'cleaner', 'homeowner'] as const;
    for (const role of roles) {
      for (const step of getSetupSteps(role, 'percentage_contractor')) {
        expect(step.title.includes('—')).toBe(false);
        expect(step.description.includes('—')).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/onboarding/onboardingConfig.test.ts`
Expected: FAIL ("getSetupSteps is not a function" / module not found).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/onboarding/onboardingConfig.ts
export type OnboardingRole = 'operator' | 'cleaner' | 'homeowner';
export type OrgModel = 'percentage_contractor' | 'hourly_external';

export interface SetupStepDef {
  key: string;
  title: string;
  description: string;
  required: boolean;
  ctaLabel: string;
  /** Absolute redesign route the step routes to. */
  href: string;
  /** Key into the signals map the status hook computes. */
  completionKey: string;
}

const OPERATOR_PERCENTAGE: SetupStepDef[] = [
  { key: 'payments', title: 'Connect payments', description: 'So you can charge customers and pay your cleaners', required: true, ctaLabel: 'Connect', href: '/app/admin-dashboard/settings?section=payments', completionKey: 'payments_connected' },
  { key: 'services', title: 'Add your services and pricing', description: 'Define what you offer and what it costs', required: true, ctaLabel: 'Add service', href: '/app/admin-dashboard/services', completionKey: 'services_added' },
  { key: 'payout', title: 'Set cleaner pay', description: 'The percent each cleaner earns per job', required: true, ctaLabel: 'Set pay', href: '/app/admin-dashboard/settings?section=payout', completionKey: 'cleaner_pay_set' },
  { key: 'cleaners', title: 'Invite your cleaners', description: 'Build your team so you can assign jobs', required: true, ctaLabel: 'Invite', href: '/app/admin-dashboard/cleaners', completionKey: 'cleaners_invited' },
  { key: 'hours', title: 'Set business hours and cancellation policy', description: 'When you work and your terms', required: false, ctaLabel: 'Set hours', href: '/app/admin-dashboard/settings?section=business-hours', completionKey: 'hours_policy_set' },
];

const CLEANER_PERCENTAGE: SetupStepDef[] = [
  { key: 'payouts', title: 'Connect payouts', description: 'So you get paid to your bank', required: true, ctaLabel: 'Connect', href: '/app/cleaner-dashboard/earnings', completionKey: 'payouts_connected' },
  { key: 'profile', title: 'Complete your profile', description: 'Add a photo so homeowners know who is coming', required: false, ctaLabel: 'Add photo', href: '/app/cleaner-dashboard/profile', completionKey: 'profile_complete' },
];

const HOMEOWNER_PERCENTAGE: SetupStepDef[] = [
  { key: 'home', title: 'Add your home', description: 'Where you would like us to clean', required: true, ctaLabel: 'Add home', href: '/app/homeowner-dashboard/account/properties', completionKey: 'home_added' },
  { key: 'card', title: 'Add a payment method', description: 'You are only charged after a cleaning', required: true, ctaLabel: 'Add card', href: '/app/homeowner-dashboard/account/payment-methods', completionKey: 'payment_method_added' },
];

/**
 * Model-keyed setup step definitions. Only `percentage_contractor` is populated
 * today; other models (e.g. hourly_external, employee/availability) add their own
 * arrays here without touching the checklist machinery.
 */
export function getSetupSteps(role: OnboardingRole, model: OrgModel): SetupStepDef[] {
  if (model !== 'percentage_contractor') return [];
  switch (role) {
    case 'operator': return OPERATOR_PERCENTAGE;
    case 'cleaner': return CLEANER_PERCENTAGE;
    case 'homeowner': return HOMEOWNER_PERCENTAGE;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/onboarding/onboardingConfig.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/onboardingConfig.ts src/lib/onboarding/onboardingConfig.test.ts
git commit -m "feat(onboarding): model-keyed setup step config"
```

---

## Task 3: `deriveChecklist.ts` (pure derive)

**Files:**
- Create: `src/lib/onboarding/deriveChecklist.ts`
- Test: `src/lib/onboarding/deriveChecklist.test.ts`

**Interfaces:**
- Consumes: `SetupStepDef` from Task 2.
- Produces:
  - `interface ChecklistItem extends SetupStepDef { done: boolean; isNext: boolean }`
  - `interface ChecklistVM { items: ChecklistItem[]; requiredTotal: number; requiredDone: number; requiredRemaining: number; allRequiredComplete: boolean; progressPercent: number; nextKey: string | null }`
  - `function deriveChecklist(steps: SetupStepDef[], signals: Record<string, boolean>): ChecklistVM`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/onboarding/deriveChecklist.test.ts
import { describe, it, expect } from 'vitest';
import { deriveChecklist } from './deriveChecklist';
import type { SetupStepDef } from './onboardingConfig';

const steps: SetupStepDef[] = [
  { key: 'a', title: 'A', description: '', required: true, ctaLabel: 'A', href: '/a', completionKey: 'a' },
  { key: 'b', title: 'B', description: '', required: true, ctaLabel: 'B', href: '/b', completionKey: 'b' },
  { key: 'c', title: 'C', description: '', required: false, ctaLabel: 'C', href: '/c', completionKey: 'c' },
];

describe('deriveChecklist', () => {
  it('counts required only and picks the first incomplete required as next', () => {
    const vm = deriveChecklist(steps, { a: true, b: false, c: false });
    expect(vm.requiredTotal).toBe(2);
    expect(vm.requiredDone).toBe(1);
    expect(vm.requiredRemaining).toBe(1);
    expect(vm.allRequiredComplete).toBe(false);
    expect(vm.progressPercent).toBe(50);
    expect(vm.nextKey).toBe('b');
    expect(vm.items.find((i) => i.key === 'b')!.isNext).toBe(true);
  });

  it('falls back to first incomplete optional for next when required are done', () => {
    const vm = deriveChecklist(steps, { a: true, b: true, c: false });
    expect(vm.allRequiredComplete).toBe(true);
    expect(vm.progressPercent).toBe(100);
    expect(vm.nextKey).toBe('c');
  });

  it('nextKey is null when everything is done', () => {
    const vm = deriveChecklist(steps, { a: true, b: true, c: true });
    expect(vm.nextKey).toBeNull();
    expect(vm.items.every((i) => i.done)).toBe(true);
  });

  it('treats a missing signal as not done', () => {
    const vm = deriveChecklist(steps, {});
    expect(vm.requiredDone).toBe(0);
    expect(vm.progressPercent).toBe(0);
    expect(vm.nextKey).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/onboarding/deriveChecklist.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/onboarding/deriveChecklist.ts
import type { SetupStepDef } from './onboardingConfig';

export interface ChecklistItem extends SetupStepDef {
  done: boolean;
  isNext: boolean;
}

export interface ChecklistVM {
  items: ChecklistItem[];
  requiredTotal: number;
  requiredDone: number;
  requiredRemaining: number;
  allRequiredComplete: boolean;
  progressPercent: number;
  nextKey: string | null;
}

/**
 * Pure projection of steps + live signals into a checklist view model.
 * "next" is the first incomplete required step, else the first incomplete
 * optional step. Progress counts REQUIRED steps only.
 */
export function deriveChecklist(steps: SetupStepDef[], signals: Record<string, boolean>): ChecklistVM {
  const done = (s: SetupStepDef) => signals[s.completionKey] === true;

  const firstIncompleteRequired = steps.find((s) => s.required && !done(s));
  const firstIncompleteOptional = steps.find((s) => !s.required && !done(s));
  const nextKey = (firstIncompleteRequired ?? firstIncompleteOptional)?.key ?? null;

  const items: ChecklistItem[] = steps.map((s) => ({ ...s, done: done(s), isNext: s.key === nextKey }));

  const required = steps.filter((s) => s.required);
  const requiredTotal = required.length;
  const requiredDone = required.filter(done).length;
  const requiredRemaining = requiredTotal - requiredDone;
  const allRequiredComplete = requiredRemaining === 0;
  const progressPercent = requiredTotal === 0 ? 100 : Math.round((requiredDone / requiredTotal) * 100);

  return { items, requiredTotal, requiredDone, requiredRemaining, allRequiredComplete, progressPercent, nextKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/onboarding/deriveChecklist.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/deriveChecklist.ts src/lib/onboarding/deriveChecklist.test.ts
git commit -m "feat(onboarding): pure deriveChecklist view model"
```

---

## Task 4: `welcomeCopy.ts` (pure adaptive copy)

**Files:**
- Create: `src/lib/onboarding/welcomeCopy.ts`
- Test: `src/lib/onboarding/welcomeCopy.test.ts`

**Interfaces:**
- Consumes: `OnboardingRole` from Task 2.
- Produces:
  - `type WelcomeVariant = 'setup' | 'reorientation'`
  - `interface WelcomeCopy { title: string; lede: string; ctaLabel: string; skipLabel: string | null }`
  - `function getWelcomeCopy(role: OnboardingRole, variant: WelcomeVariant, firstName?: string | null): WelcomeCopy`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/onboarding/welcomeCopy.test.ts
import { describe, it, expect } from 'vitest';
import { getWelcomeCopy } from './welcomeCopy';

describe('getWelcomeCopy', () => {
  it('operator setup greets by name and offers a skip', () => {
    const c = getWelcomeCopy('operator', 'setup', 'Sarah');
    expect(c.title).toBe('Welcome to Nexxus, Sarah');
    expect(c.skipLabel).toBe("I'll do this later");
  });

  it('reorientation is the same for every role and has no skip', () => {
    const c = getWelcomeCopy('cleaner', 'reorientation', 'Marco');
    expect(c.title).toBe('Welcome to the new Nexxus');
    expect(c.skipLabel).toBeNull();
  });

  it('handles a missing name gracefully', () => {
    const c = getWelcomeCopy('homeowner', 'setup', null);
    expect(c.title).toBe('Welcome');
  });

  it('has no em dashes', () => {
    const variants = ['setup', 'reorientation'] as const;
    const roles = ['operator', 'cleaner', 'homeowner'] as const;
    for (const role of roles) for (const v of variants) {
      const c = getWelcomeCopy(role, v, 'X');
      expect((c.title + c.lede + c.ctaLabel + (c.skipLabel ?? '')).includes('—')).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/onboarding/welcomeCopy.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/onboarding/welcomeCopy.ts
import type { OnboardingRole } from './onboardingConfig';

export type WelcomeVariant = 'setup' | 'reorientation';

export interface WelcomeCopy {
  title: string;
  lede: string;
  ctaLabel: string;
  skipLabel: string | null;
}

function greet(base: string, firstName?: string | null): string {
  return firstName ? `${base}, ${firstName}` : base;
}

export function getWelcomeCopy(role: OnboardingRole, variant: WelcomeVariant, firstName?: string | null): WelcomeCopy {
  if (variant === 'reorientation') {
    return {
      title: 'Welcome to the new Nexxus',
      lede: 'Same tools, a fresh and faster look. Nothing you set up has changed.',
      ctaLabel: 'Take a look',
      skipLabel: null,
    };
  }
  switch (role) {
    case 'operator':
      return {
        title: greet('Welcome to Nexxus', firstName),
        lede: "Let's get your cleaning business ready to take bookings. A few quick steps and you are live.",
        ctaLabel: "Let's get started",
        skipLabel: "I'll do this later",
      };
    case 'cleaner':
      return {
        title: greet('Welcome', firstName),
        lede: 'You are on the team. Connect your payouts and you are ready for jobs.',
        ctaLabel: 'Get started',
        skipLabel: 'Later',
      };
    case 'homeowner':
      return {
        title: greet('Welcome', firstName),
        lede: "Let's get your home set up so you can book your first cleaning.",
        ctaLabel: 'Get started',
        skipLabel: 'Later',
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/onboarding/welcomeCopy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/welcomeCopy.ts src/lib/onboarding/welcomeCopy.test.ts
git commit -m "feat(onboarding): adaptive welcome copy"
```

---

## Task 5: Flag write helpers + `useOnboardingFlags` + query keys

**Files:**
- Create: `src/lib/onboarding/onboardingFlags.ts`
- Create: `src/hooks/useOnboardingFlags.ts`
- Modify: `src/lib/queryKeys.ts`

**Interfaces:**
- Produces:
  - `keys.onboarding.flags(userId)`, `keys.onboarding.operator(orgId)`, `keys.onboarding.homeowner(userId)` (cleaner reuses Stripe-connect + properties keys).
  - `async function markWelcomeSeen(userId: string): Promise<void>`
  - `async function dismissUserChecklist(userId: string): Promise<void>`
  - `async function dismissOrgChecklist(orgId: string, accessToken: string): Promise<void>`
  - `function useOnboardingFlags(): { welcomeSeen: boolean; userChecklistDismissed: boolean; loading: boolean; refetch: () => void }`

- [ ] **Step 1: Add query keys**

In `src/lib/queryKeys.ts`, add an `onboarding` factory following the file's existing pattern (typed nested factory). Example shape to add alongside the others:

```ts
  onboarding: {
    all: ['onboarding'] as const,
    flags: (userId: string) => ['onboarding', 'flags', userId] as const,
    operator: (orgId: string) => ['onboarding', 'operator', orgId] as const,
    homeowner: (userId: string) => ['onboarding', 'homeowner', userId] as const,
  },
```

- [ ] **Step 2: Write the client write helpers**

```ts
// src/lib/onboarding/onboardingFlags.ts
import { supabase } from '@/lib/supabase';

/** Per-user flags are RLS-safe to update directly (user_profiles_update policy allows self). */
export async function markWelcomeSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ welcome_seen_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function dismissUserChecklist(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ setup_checklist_dismissed_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

/** Org-level dismissal goes through an authed route: the org UPDATE policy is
 * creator-only, so a non-creator admin cannot update the row client-side. */
export async function dismissOrgChecklist(orgId: string, accessToken: string): Promise<void> {
  const res = await fetch(`/api/organizations/${orgId}/onboarding`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ dismiss_setup_checklist: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Failed to dismiss checklist');
  }
}
```

- [ ] **Step 3: Write `useOnboardingFlags`**

```ts
// src/hooks/useOnboardingFlags.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';

/** Reads the current user's onboarding flags from user_profiles. */
export function useOnboardingFlags() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: keys.onboarding.flags(userId ?? 'none'),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('welcome_seen_at, setup_checklist_dismissed_at')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        welcomeSeen: !!data?.welcome_seen_at,
        userChecklistDismissed: !!data?.setup_checklist_dismissed_at,
      };
    },
  });

  return {
    welcomeSeen: query.data?.welcomeSeen ?? false,
    userChecklistDismissed: query.data?.userChecklistDismissed ?? false,
    loading: query.isLoading,
    refetch: () => { void query.refetch(); },
  };
}
```

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no new errors. (`useAuth()` exposes `user.id`; confirm the property in `src/hooks/useAuth.ts` / AuthContext — it is the auth user id.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/onboardingFlags.ts src/hooks/useOnboardingFlags.ts src/lib/queryKeys.ts
git commit -m "feat(onboarding): flag write helpers + useOnboardingFlags + query keys"
```

---

## Task 6: `PATCH /api/organizations/[orgId]/onboarding` (org dismissal)

**Files:**
- Create: `src/app/api/organizations/[orgId]/onboarding/route.ts`
- Test: `src/app/api/organizations/[orgId]/onboarding/route.integration.test.ts`

**Interfaces:**
- Consumes: `requireOrgAuth` and the admin client, exactly as `src/app/api/organizations/[orgId]/business-hours/route.ts` does (open that file and mirror its imports, auth guard, param handling, and response shape).
- Produces: `PATCH` accepting `{ dismiss_setup_checklist: true }`, gated `['owner','admin']`, setting `organizations.setup_checklist_dismissed_at = now()`. Returns `{ success: true }`.

- [ ] **Step 1: Write the failing integration test**

Mirror an existing org-route integration test (e.g. `src/app/api/organizations/[orgId]/business-hours/route.integration.test.ts`) for helper usage (`withTestOrg`, auth token creation, `callRoute`/direct `PATCH` import). The test asserts:

```ts
// src/app/api/organizations/[orgId]/onboarding/route.integration.test.ts
// (mirror the setup/imports of the business-hours integration test)
import { describe, it, expect } from 'vitest';
import { PATCH } from './route';
// ...withTestOrg + owner token helpers as in sibling tests...

describe('PATCH /api/organizations/[orgId]/onboarding', () => {
  it('stamps setup_checklist_dismissed_at for an owner', async () => {
    // arrange: withTestOrg -> { orgId, ownerToken, supabaseAdmin }
    // act: call PATCH with { dismiss_setup_checklist: true } and Authorization: Bearer ownerToken
    // assert: res.status 200, body.success true
    // assert: organizations row now has setup_checklist_dismissed_at not null
  });

  it('rejects a non-member with 401/403', async () => {
    // act with a stranger token -> expect 401 or 403
  });
});
```

Fill the arrange/act/assert bodies by copying the exact helper calls from the business-hours integration test.

- [ ] **Step 2: Run test to verify it fails**

Run (needs local Supabase): `npx supabase start` then `npm run test:integration -- src/app/api/organizations/[orgId]/onboarding`
Expected: FAIL (route module does not exist).

- [ ] **Step 3: Write the route**

Open `src/app/api/organizations/[orgId]/business-hours/route.ts` and mirror its structure. Body:

```ts
// src/app/api/organizations/[orgId]/onboarding/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgAuth } from '@/lib/requireOrgAuth'; // use the SAME import the business-hours route uses
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const auth = await requireOrgAuth(req, orgId, ['owner', 'admin']); // match the sibling route's call signature exactly
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  if (body?.dismiss_setup_checklist !== true) {
    return NextResponse.json({ error: 'dismiss_setup_checklist must be true' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ setup_checklist_dismissed_at: new Date().toISOString() })
    .eq('id', orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
```

Adjust the `requireOrgAuth` import path and call shape to match the business-hours route verbatim (it may return a differently named result; copy its exact pattern).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- src/app/api/organizations/[orgId]/onboarding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/organizations/[orgId]/onboarding/route.ts" "src/app/api/organizations/[orgId]/onboarding/route.integration.test.ts"
git commit -m "feat(onboarding): org checklist dismissal route"
```

---

## Task 7: Stamp `payout_configured_at` on payout save

**Files:**
- Modify: `src/app/api/organizations/[orgId]/cleaner-payouts/route.ts`
- Modify: `src/app/api/organizations/[orgId]/cleaner-payouts/route.integration.test.ts`

**Interfaces:**
- Consumes: existing PATCH route body `{ default_cleaner_payout_percent: number }`.
- Produces: on successful update, `organizations.payout_configured_at` is set (only if currently null, to preserve the first-configured moment; a plain set is also acceptable since the signal is null-vs-not).

- [ ] **Step 1: Add a failing assertion to the existing integration test**

In `cleaner-payouts/route.integration.test.ts`, add:

```ts
it('stamps payout_configured_at on save', async () => {
  // arrange org (payout_configured_at null), call PATCH with a valid percent
  // assert: organizations.payout_configured_at is now NOT null
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/app/api/organizations/[orgId]/cleaner-payouts`
Expected: FAIL (payout_configured_at still null).

- [ ] **Step 3: Implement**

In `cleaner-payouts/route.ts`, find the `.update({ ... })` object that writes `default_cleaner_payout_percent` and add the marker to the same update:

```ts
  .update({
    default_cleaner_payout_percent: value,        // existing field(s)
    payout_configured_at: new Date().toISOString(), // NEW: onboarding completion marker
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:integration -- src/app/api/organizations/[orgId]/cleaner-payouts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/organizations/[orgId]/cleaner-payouts/route.ts" "src/app/api/organizations/[orgId]/cleaner-payouts/route.integration.test.ts"
git commit -m "feat(onboarding): stamp payout_configured_at on payout save"
```

---

## Task 8: Stamp `hours_policy_configured_at` on business-hours save

**Files:**
- Modify: `src/app/api/organizations/[orgId]/business-hours/route.ts`
- Modify: `src/app/api/organizations/[orgId]/business-hours/route.integration.test.ts`

**Interfaces:**
- Produces: on successful business-hours PATCH, `organizations.hours_policy_configured_at` is set.

- [ ] **Step 1: Add a failing assertion**

```ts
it('stamps hours_policy_configured_at on save', async () => {
  // arrange org (hours_policy_configured_at null), PATCH with valid timezone + business_hours
  // assert: organizations.hours_policy_configured_at is now NOT null
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/app/api/organizations/[orgId]/business-hours`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `business-hours/route.ts`, add to the `.update({ ... })` that writes `timezone` / `business_hours`:

```ts
    hours_policy_configured_at: new Date().toISOString(), // NEW: onboarding completion marker
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:integration -- src/app/api/organizations/[orgId]/business-hours`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/organizations/[orgId]/business-hours/route.ts" "src/app/api/organizations/[orgId]/business-hours/route.integration.test.ts"
git commit -m "feat(onboarding): stamp hours_policy_configured_at on hours save"
```

---

## Task 9: Presentational `SetupChecklistCard` + `WelcomeContent`

**Files:**
- Create: `src/components/redesign/onboarding/SetupChecklistCard.tsx`
- Create: `src/components/redesign/onboarding/WelcomeContent.tsx`

**Interfaces:**
- Consumes: `ChecklistVM`/`ChecklistItem` (Task 3), `WelcomeCopy` (Task 4), primitives `Card`, `Progress`, `Button`, `buttonVariants`, `cn`.
- Produces:
  - `function SetupChecklistCard({ title, subtitle, vm, onDismiss }: { title: string; subtitle: string; vm: ChecklistVM; onDismiss: () => void }): JSX.Element`
  - `function WelcomeContent({ copy, previewSteps, onPrimary, onSkip }: { copy: WelcomeCopy; previewSteps?: { title: string }[]; onPrimary: () => void; onSkip: () => void }): JSX.Element`

These are presentational only (no data). Build strictly from `src/components/ui/*` + tokens. Use lucide icons. No render harness exists, so verify via tsc/lint + Playwright visual (Task 11 mounts them live).

- [ ] **Step 1: Write `SetupChecklistCard`**

```tsx
// src/components/redesign/onboarding/SetupChecklistCard.tsx
'use client';

import Link from 'next/link';
import { Check, ChevronRight, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChecklistVM } from '@/lib/onboarding/deriveChecklist';

export function SetupChecklistCard({
  title,
  subtitle,
  vm,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  vm: ChecklistVM;
  onDismiss: () => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-primary">Get started</p>
          <h3 className="mt-1.5 text-lg font-extrabold tracking-tight text-foreground">{title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm font-extrabold tabular-nums text-foreground">
            {vm.requiredDone}
            <span className="text-muted-foreground/60">/{vm.requiredTotal}</span>
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss setup checklist"
            className="grid h-8 w-8 place-items-center rounded-pill border border-border bg-card text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Progress value={vm.progressPercent} className="my-4" aria-label="Setup progress" />

      <ul className="divide-y divide-muted">
        {vm.items.map((item) => (
          <li key={item.key} className="flex items-center gap-3.5 py-3.5">
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-pill',
                item.done && 'bg-positive text-white',
                !item.done && item.isNext && 'border-[1.5px] border-brand-100 bg-brand-50 text-primary',
                !item.done && !item.isNext && 'border-[1.5px] border-border bg-card text-muted-foreground/60',
              )}
            >
              {item.done ? <Check className="h-[18px] w-[18px]" strokeWidth={3} /> : <ChevronRight className="h-[18px] w-[18px]" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className={cn('text-[15px] font-bold', item.done && 'text-muted-foreground line-through decoration-border')}>
                {item.title}
                {!item.required && (
                  <span className="ml-2 rounded-pill bg-muted px-2 py-0.5 align-middle text-[11px] font-semibold text-muted-foreground">
                    Optional
                  </span>
                )}
              </p>
              {!item.done && <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>}
            </div>

            {item.done ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-bold text-positive-700">
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />
                Done
              </span>
            ) : item.isNext ? (
              <Link href={item.href} className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'shrink-0')}>
                {item.ctaLabel}
              </Link>
            ) : (
              <Link href={item.href} aria-label={item.ctaLabel} className="shrink-0 text-muted-foreground/60 hover:text-foreground">
                <ChevronRight className="h-5 w-5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 2: Write `WelcomeContent`**

```tsx
// src/components/redesign/onboarding/WelcomeContent.tsx
'use client';

import { Logo } from '@/components/ui/logo';
import { Button } from '@/components/ui/button';
import type { WelcomeCopy } from '@/lib/onboarding/welcomeCopy';

export function WelcomeContent({
  copy,
  previewSteps,
  onPrimary,
  onSkip,
}: {
  copy: WelcomeCopy;
  previewSteps?: { title: string }[];
  onPrimary: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-2 py-2 text-center">
      <Logo variant="full" className="h-8 w-auto" />
      <h1 className="mt-10 text-3xl font-extrabold tracking-tight text-foreground">{copy.title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{copy.lede}</p>

      {previewSteps && previewSteps.length > 0 && (
        <ul className="mt-7 w-full space-y-1.5 text-left">
          {previewSteps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-control bg-muted/60 px-4 py-2.5 text-sm font-semibold text-foreground">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-brand-50 text-xs font-extrabold text-primary">
                {i + 1}
              </span>
              {s.title}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex w-full flex-col items-center gap-3">
        <Button size="lg" className="w-full" onClick={onPrimary}>
          {copy.ctaLabel}
        </Button>
        {copy.skipLabel && (
          <Button variant="ghost" onClick={onSkip}>
            {copy.skipLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
```

Confirm `Logo` is exported from `@/components/ui/logo` with a `variant="full"` prop (it is used by `SystemStatePage.tsx`).

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/onboarding/SetupChecklistCard.tsx src/components/redesign/onboarding/WelcomeContent.tsx
git commit -m "feat(onboarding): SetupChecklistCard + WelcomeContent presentational"
```

---

## Task 10: `useOperatorOnboarding` hook

**Files:**
- Create: `src/hooks/useOperatorOnboarding.ts`

**Interfaces:**
- Consumes: `useAuth` (`currentOrganizationId`, `accessToken`, `user`), `useOnboardingFlags` (Task 5), `getSetupSteps` (Task 2), `deriveChecklist` (Task 3), `dismissOrgChecklist` + `markWelcomeSeen` (Task 5), `keys.onboarding.operator` (Task 5). Reads org signals via a direct `useOrgQuery` mirroring `OwnerSetupChecklist.tsx:32-59` plus `useInvites` for outstanding cleaner invites.
- Produces:
  - `interface OnboardingState { model: OrgModel; vm: ChecklistVM; showChecklist: boolean; showWelcome: boolean; welcomeVariant: WelcomeVariant; firstName: string | null; loading: boolean; onDismiss: () => void; onWelcomeDone: () => void }`
  - `function useOperatorOnboarding(): OnboardingState`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useOperatorOnboarding.ts
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useInvites } from '@/hooks/useInvites';
import { useOnboardingFlags } from '@/hooks/useOnboardingFlags';
import { keys } from '@/lib/queryKeys';
import { getSetupSteps, type OrgModel } from '@/lib/onboarding/onboardingConfig';
import { deriveChecklist, type ChecklistVM } from '@/lib/onboarding/deriveChecklist';
import type { WelcomeVariant } from '@/lib/onboarding/welcomeCopy';
import { markWelcomeSeen, dismissOrgChecklist } from '@/lib/onboarding/onboardingFlags';

export interface OnboardingState {
  model: OrgModel;
  vm: ChecklistVM;
  showChecklist: boolean;
  showWelcome: boolean;
  welcomeVariant: WelcomeVariant;
  firstName: string | null;
  loading: boolean;
  onDismiss: () => void;
  onWelcomeDone: () => void;
}

export function useOperatorOnboarding(): OnboardingState {
  const { user, currentOrganizationId, accessToken } = useAuth();
  const orgId = currentOrganizationId ?? null;
  const qc = useQueryClient();
  const flags = useOnboardingFlags();
  const { invites } = useInvites(orgId, accessToken);

  const orgQuery = useQuery({
    queryKey: keys.onboarding.operator(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: async () => {
      const [orgRes, svcRes, cleanerRes] = await Promise.all([
        supabase
          .from('organizations')
          .select('stripe_connect_charges_enabled, default_payout_model, payout_configured_at, hours_policy_configured_at, setup_checklist_dismissed_at')
          .eq('id', orgId as string)
          .maybeSingle(),
        supabase.from('service_types').select('id', { count: 'exact', head: true }).eq('organization_id', orgId as string),
        supabase.from('organization_members').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId as string).eq('role', 'cleaner'),
      ]);
      const org = (orgRes.data ?? {}) as {
        stripe_connect_charges_enabled?: boolean;
        default_payout_model?: OrgModel;
        payout_configured_at?: string | null;
        hours_policy_configured_at?: string | null;
        setup_checklist_dismissed_at?: string | null;
      };
      return {
        chargesEnabled: !!org.stripe_connect_charges_enabled,
        model: (org.default_payout_model ?? 'percentage_contractor') as OrgModel,
        payoutConfigured: !!org.payout_configured_at,
        hoursConfigured: !!org.hours_policy_configured_at,
        orgDismissed: !!org.setup_checklist_dismissed_at,
        serviceCount: svcRes.count ?? 0,
        cleanerCount: cleanerRes.count ?? 0,
      };
    },
  });

  const data = orgQuery.data;
  const model: OrgModel = data?.model ?? 'percentage_contractor';

  const outstandingCleanerInvites = (invites ?? []).filter(
    (i) => i.role === 'cleaner' && (i.status === 'pending' || i.status === 'creating'),
  ).length;

  const signals: Record<string, boolean> = {
    payments_connected: !!data?.chargesEnabled,
    services_added: (data?.serviceCount ?? 0) > 0,
    cleaner_pay_set: !!data?.payoutConfigured,
    cleaners_invited: (data?.cleanerCount ?? 0) > 0 || outstandingCleanerInvites > 0,
    hours_policy_set: !!data?.hoursConfigured,
  };

  const vm = deriveChecklist(getSetupSteps('operator', model), signals);

  const loading = orgQuery.isLoading || flags.loading;
  const showChecklist = !loading && !data?.orgDismissed && !vm.allRequiredComplete;
  const showWelcome = !loading && !flags.welcomeSeen;
  const welcomeVariant: WelcomeVariant = vm.allRequiredComplete ? 'reorientation' : 'setup';

  const invalidate = () => {
    if (orgId) void qc.invalidateQueries({ queryKey: keys.onboarding.operator(orgId) });
    if (user?.id) void qc.invalidateQueries({ queryKey: keys.onboarding.flags(user.id) });
  };

  return {
    model,
    vm,
    showChecklist,
    showWelcome,
    welcomeVariant,
    firstName: user?.profile?.firstName ?? null,
    loading,
    onDismiss: async () => {
      if (!orgId || !accessToken) return;
      await dismissOrgChecklist(orgId, accessToken);
      invalidate();
    },
    onWelcomeDone: async () => {
      if (!user?.id) return;
      await markWelcomeSeen(user.id);
      invalidate();
    },
  };
}
```

Note: confirm `useAuth()` exposes `currentOrganizationId`, `accessToken`, and `user.profile.firstName` (it does; used across redesign hooks). Confirm the `Invite` type's `role`/`status` fields (per recon: `role`, `status` with values including `'pending' | 'creating'`).

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useOperatorOnboarding.ts
git commit -m "feat(onboarding): useOperatorOnboarding hook"
```

---

## Task 11: Wire operator checklist + welcome into Overview

**Files:**
- Modify: `src/components/redesign/overview/OperatorOverview.tsx`
- Modify: `src/components/redesign/overview/OperatorOverviewView.tsx`

**Interfaces:**
- Consumes: `useOperatorOnboarding` (Task 10), `SetupChecklistCard` + `WelcomeContent` (Task 9), `getWelcomeCopy` (Task 4), `Dialog`/`DialogContent` (`src/components/ui/dialog.tsx`).
- The View gains an optional `checklist?: React.ReactNode` slot rendered at the very top of its `max-w-[1700px] space-y-5` container; the container owns data and passes a rendered `<SetupChecklistCard/>` (or null) plus renders the welcome `Dialog` itself.

- [ ] **Step 1: Add the checklist slot to the View**

In `OperatorOverviewView.tsx`, add `checklist?: React.ReactNode` to its props type, and render it as the first child inside the outer `<div className="max-w-[1700px] space-y-5">` (before `<KpiStrip .../>`):

```tsx
      <div className="max-w-[1700px] space-y-5">
        {checklist}
        <header> ... </header>
        {/* KpiStrip, grid, etc. unchanged */}
```

- [ ] **Step 2: Wire the container**

In `OperatorOverview.tsx`, call the hook and render the checklist + welcome dialog. Compute copy via `getWelcomeCopy`. Pass a preview of required step titles to the welcome.

```tsx
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useOperatorOnboarding } from '@/hooks/useOperatorOnboarding';
import { SetupChecklistCard } from '@/components/redesign/onboarding/SetupChecklistCard';
import { WelcomeContent } from '@/components/redesign/onboarding/WelcomeContent';
import { getWelcomeCopy } from '@/lib/onboarding/welcomeCopy';

// inside the component:
const onboarding = useOperatorOnboarding();
const welcomeCopy = getWelcomeCopy('operator', onboarding.welcomeVariant, onboarding.firstName);

const checklist = onboarding.showChecklist ? (
  <SetupChecklistCard
    title="Finish setting up your business"
    subtitle={`${onboarding.vm.requiredRemaining} ${onboarding.vm.requiredRemaining === 1 ? 'step' : 'steps'} left before you can take bookings`}
    vm={onboarding.vm}
    onDismiss={onboarding.onDismiss}
  />
) : null;

// pass checklist to the View:
// <OperatorOverviewView ... checklist={checklist} />

// render the welcome dialog alongside the View:
{onboarding.showWelcome && (
  <Dialog open onOpenChange={(open) => { if (!open) onboarding.onWelcomeDone(); }}>
    <DialogContent className="max-w-lg p-8">
      <WelcomeContent
        copy={welcomeCopy}
        previewSteps={onboarding.vm.items.filter((i) => i.required).map((i) => ({ title: i.title }))}
        onPrimary={onboarding.onWelcomeDone}
        onSkip={onboarding.onWelcomeDone}
      />
    </DialogContent>
  </Dialog>
)}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Live visual verification (Playwright MCP)**

With `npm run dev` running and an admin test login (`.env.development.local` E2E creds), navigate to `/app/admin-dashboard`. Verify: the welcome dialog shows once (setup variant with the 4 required step titles); after dismissing, the pinned checklist card renders atop the overview with the correct progress (`1/4` when payments already connected in the seed, else `0/4`); each step routes to its destination; the dismiss X hides the card. Screenshot for the record. (If the dev login form is unresponsive, seed the session via the documented localStorage approach.)

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/overview/OperatorOverview.tsx src/components/redesign/overview/OperatorOverviewView.tsx
git commit -m "feat(onboarding): operator checklist + welcome on Overview"
```

---

# Slice 2 — Cleaner + Homeowner

## Task 12: Cleaner onboarding (hook + wire into Today)

**Files:**
- Create: `src/hooks/useCleanerOnboarding.ts`
- Modify: `src/components/redesign/cleaner/today/CleanerToday.tsx`
- Modify: `src/components/redesign/cleaner/today/CleanerTodayView.tsx`

**Interfaces:**
- Consumes: `useAuth` (`user.profile.avatarUrl`, `user.id`), `useStripeConnect` (`connectStatus.onboarding_complete`), `useOnboardingFlags`, config/derive/copy, `markWelcomeSeen` + `dismissUserChecklist`, `MobileTakeover` (`src/components/redesign/shared/MobileTakeover.tsx`).
- Produces: `useCleanerOnboarding(): OnboardingState` (same shape as Task 10, but `onDismiss` calls `dismissUserChecklist(user.id)` and dismissal is read from `useOnboardingFlags().userChecklistDismissed`).

- [ ] **Step 1: Write `useCleanerOnboarding`**

Mirror `useOperatorOnboarding` with these differences:
- Signals: `payouts_connected` = `useStripeConnect().connectStatus?.onboarding_complete === true`; `profile_complete` = `!!user?.profile?.avatarUrl`.
- Steps: `getSetupSteps('cleaner', 'percentage_contractor')`.
- `showChecklist = !loading && !flags.userChecklistDismissed && !vm.allRequiredComplete`.
- `onDismiss = async () => { if (user?.id) { await dismissUserChecklist(user.id); invalidate(); } }`.
- No org query needed; `loading = flags.loading || stripeConnectLoading`.

```ts
// src/hooks/useCleanerOnboarding.ts
'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { useOnboardingFlags } from '@/hooks/useOnboardingFlags';
import { keys } from '@/lib/queryKeys';
import { getSetupSteps } from '@/lib/onboarding/onboardingConfig';
import { deriveChecklist } from '@/lib/onboarding/deriveChecklist';
import type { WelcomeVariant } from '@/lib/onboarding/welcomeCopy';
import { markWelcomeSeen, dismissUserChecklist } from '@/lib/onboarding/onboardingFlags';
import type { OnboardingState } from '@/hooks/useOperatorOnboarding';

export function useCleanerOnboarding(): OnboardingState {
  const { user } = useAuth();
  const qc = useQueryClient();
  const flags = useOnboardingFlags();
  const { connectStatus, statusLoading } = useStripeConnect();

  const signals: Record<string, boolean> = {
    payouts_connected: connectStatus?.onboarding_complete === true,
    profile_complete: !!user?.profile?.avatarUrl,
  };
  const vm = deriveChecklist(getSetupSteps('cleaner', 'percentage_contractor'), signals);

  const loading = flags.loading || statusLoading;
  const invalidate = () => { if (user?.id) void qc.invalidateQueries({ queryKey: keys.onboarding.flags(user.id) }); };

  return {
    model: 'percentage_contractor',
    vm,
    showChecklist: !loading && !flags.userChecklistDismissed && !vm.allRequiredComplete,
    showWelcome: !loading && !flags.welcomeSeen,
    welcomeVariant: (vm.allRequiredComplete ? 'reorientation' : 'setup') as WelcomeVariant,
    firstName: user?.profile?.firstName ?? null,
    loading,
    onDismiss: async () => { if (user?.id) { await dismissUserChecklist(user.id); invalidate(); } },
    onWelcomeDone: async () => { if (user?.id) { await markWelcomeSeen(user.id); invalidate(); } },
  };
}
```

Confirm `useStripeConnect()` returns `{ connectStatus, statusLoading }` (per recon: `src/hooks/useStripeConnect.ts:34-157`).

- [ ] **Step 2: Add a checklist slot to `CleanerTodayView`**

Add `checklist?: React.ReactNode` to the View props and render it before the `needsAttention` section (recon: `CleanerTodayView.tsx` ~line 84-101, after the `activeJob` banner).

- [ ] **Step 3: Wire the `CleanerToday` container**

Call `useCleanerOnboarding()`, build `<SetupChecklistCard title="Get set up" subtitle="Connect payouts so you can get paid" .../>` when `showChecklist`, pass it to the View, and render the welcome inside a `MobileTakeover` when `showWelcome`:

```tsx
{onboarding.showWelcome && (
  <MobileTakeover ariaLabel="Welcome" onClosed={onboarding.onWelcomeDone}>
    {(close) => (
      <div className="flex min-h-full items-center justify-center bg-background px-6 py-16">
        <WelcomeContent
          copy={getWelcomeCopy('cleaner', onboarding.welcomeVariant, onboarding.firstName)}
          onPrimary={close}
          onSkip={close}
        />
      </div>
    )}
  </MobileTakeover>
)}
```

`MobileTakeover`'s `onClosed` fires after the close animation, so `onWelcomeDone` runs once on close (both primary and skip call `close`).

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Live visual verification**

Login as a cleaner test user, navigate to `/app/cleaner-dashboard`. Verify: welcome takeover shows once (mobile viewport 402px); after close, the checklist card renders atop Today with `Connect payouts` (Required, primary) + `Complete your profile` (Optional, chevron); dismiss hides it. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCleanerOnboarding.ts src/components/redesign/cleaner/today/CleanerToday.tsx src/components/redesign/cleaner/today/CleanerTodayView.tsx
git commit -m "feat(onboarding): cleaner checklist + welcome on Today"
```

---

## Task 13: Homeowner onboarding (hook + wire into Home)

**Files:**
- Create: `src/hooks/useHomeownerOnboarding.ts`
- Modify: `src/components/redesign/homeowner/home/HomeownerHome.tsx`

**Interfaces:**
- Consumes: `useAuth` (`user.id`, `user.profile.firstName`), `useHomeownerProperties` (`{ properties }`), `useSavedPaymentMethods` (`{ cards, loading }`), `useOnboardingFlags`, `stripeNewChargeFlowUiEnabled` (`src/lib/stripe/flags.ts`), config/derive/copy, flag writers, `MobileTakeover`.
- Produces: `useHomeownerOnboarding(): OnboardingState`. The `card` step is filtered OUT of the step list when `!stripeNewChargeFlowUiEnabled()` (the add-card UI is behind that flag).

- [ ] **Step 1: Write `useHomeownerOnboarding`**

```ts
// src/hooks/useHomeownerOnboarding.ts
'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useHomeownerProperties } from '@/hooks/useHomeownerData';
import { useSavedPaymentMethods } from '@/components/redesign/homeowner/account/payment-methods/useSavedPaymentMethods';
import { useOnboardingFlags } from '@/hooks/useOnboardingFlags';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import { keys } from '@/lib/queryKeys';
import { getSetupSteps } from '@/lib/onboarding/onboardingConfig';
import { deriveChecklist } from '@/lib/onboarding/deriveChecklist';
import type { WelcomeVariant } from '@/lib/onboarding/welcomeCopy';
import { markWelcomeSeen, dismissUserChecklist } from '@/lib/onboarding/onboardingFlags';
import type { OnboardingState } from '@/hooks/useOperatorOnboarding';

export function useHomeownerOnboarding(): OnboardingState {
  const { user } = useAuth();
  const qc = useQueryClient();
  const flags = useOnboardingFlags();
  const { properties, loading: propsLoading } = useHomeownerProperties();
  const cardsEnabled = stripeNewChargeFlowUiEnabled();
  const { cards, loading: cardsLoading } = useSavedPaymentMethods();

  const allSteps = getSetupSteps('homeowner', 'percentage_contractor');
  const steps = cardsEnabled ? allSteps : allSteps.filter((s) => s.key !== 'card');

  const signals: Record<string, boolean> = {
    home_added: (properties?.length ?? 0) > 0,
    payment_method_added: (cards?.length ?? 0) > 0,
  };
  const vm = deriveChecklist(steps, signals);

  const loading = flags.loading || propsLoading || (cardsEnabled && cardsLoading);
  const invalidate = () => { if (user?.id) void qc.invalidateQueries({ queryKey: keys.onboarding.flags(user.id) }); };

  return {
    model: 'percentage_contractor',
    vm,
    showChecklist: !loading && !flags.userChecklistDismissed && !vm.allRequiredComplete,
    showWelcome: !loading && !flags.welcomeSeen,
    welcomeVariant: (vm.allRequiredComplete ? 'reorientation' : 'setup') as WelcomeVariant,
    firstName: user?.profile?.firstName ?? null,
    loading,
    onDismiss: async () => { if (user?.id) { await dismissUserChecklist(user.id); invalidate(); } },
    onWelcomeDone: async () => { if (user?.id) { await markWelcomeSeen(user.id); invalidate(); } },
  };
}
```

Confirm `useHomeownerProperties` returns `{ properties, loading }` and `useSavedPaymentMethods` returns `{ cards, loading }` (per recon).

- [ ] **Step 2: Wire `HomeownerHome`**

In `HomeownerHome.tsx`, call `useHomeownerOnboarding()`, insert the `<SetupChecklistCard title="Get ready for your first cleaning" subtitle="A couple of quick things and you can book" .../>` as a section before the "Pending requests" section (recon: ~line 48-59), and render the welcome `MobileTakeover` when `showWelcome` (same pattern as cleaner, with `getWelcomeCopy('homeowner', ...)`).

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Live visual verification**

Login as a homeowner test user (mobile 402px), navigate to `/app/homeowner-dashboard`. Verify: welcome takeover once; checklist with `Add your home` (Required) + `Add a payment method` (Required, only if the charge-flow flag is on); dismiss hides it; routing works. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHomeownerOnboarding.ts src/components/redesign/homeowner/home/HomeownerHome.tsx
git commit -m "feat(onboarding): homeowner checklist + welcome on Home"
```

---

# Slice 3 — Empty-state gaps

Recon found the redesign empty-state coverage is already near-complete; only two first-run gaps remain.

## Task 14: Cleaner Earnings empty state

**Files:**
- Modify: `src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx`

**Interfaces:**
- Consumes: `EmptyState` (`@/components/ui/empty-state`).

- [ ] **Step 1: Add the empty state**

In `CleanerEarningsView.tsx`, when the cleaner has an active Connect account but no cleared earnings yet (`data.clearing.length === 0`), render an on-system `EmptyState` in the data section instead of an empty list:

```tsx
import { EmptyState } from '@/components/ui/empty-state';
import { Wallet } from 'lucide-react';

// in the no-data branch:
<EmptyState
  icon={<Wallet />}
  title="No earnings yet"
  description="Once you complete a job, your pay shows up here."
/>
```

Match the exact data field for "no cleared earnings" to the view's actual props (recon: `CleanerEarningsView.tsx:36-94`, clearing list around line 150). Keep the existing employee-mode card behavior unchanged.

- [ ] **Step 2: Type-check + lint + visual**

Run: `npx tsc --noEmit` then `npm run lint`. Then Playwright: a cleaner with a connected account and no earnings shows the EmptyState. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx
git commit -m "feat(onboarding): cleaner earnings empty state"
```

---

## Task 15: Homeowner Home empty state

**Files:**
- Modify: `src/components/redesign/homeowner/home/HomeownerHome.tsx`

**Interfaces:**
- Consumes: `EmptyState`.

- [ ] **Step 1: Add the empty state**

In `HomeownerHome.tsx`, when there is no next cleaning, no recurring series, and no pending requests (`hero === null && seriesGroups.length === 0 && requests.length === 0`), render an on-system `EmptyState` for the "Your next cleaning" area (recon: HomeownerHome.tsx:22-90). This renders BELOW the onboarding checklist (which handles first-run setup), so the copy is the post-setup "nothing booked" state:

```tsx
import { EmptyState } from '@/components/ui/empty-state';
import { Sparkles } from 'lucide-react';

<EmptyState
  icon={<Sparkles />}
  title="No cleanings booked yet"
  description="Request a cleaning and you'll see it here with live updates."
/>
```

Do not duplicate a CTA if the Request FAB is already present; keep the FAB as the primary action.

- [ ] **Step 2: Type-check + lint + visual**

Run: `npx tsc --noEmit` then `npm run lint`. Playwright: a homeowner with no bookings shows the EmptyState under the checklist. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/homeowner/home/HomeownerHome.tsx
git commit -m "feat(onboarding): homeowner home empty state"
```

---

## Final verification (all slices)

- [ ] `npm run test` (unit + integration) passes.
- [ ] `npx tsc --noEmit` shows no errors you introduced.
- [ ] `npm run lint` clean for touched files.
- [ ] `npx supabase db reset` rebuilds with migration 101; integration tests still pass.
- [ ] Playwright visual pass captured for operator, cleaner, homeowner (welcome once + checklist + dismiss + a completed/auto-hide state).

---

## Notes for the implementer

- **Auto-open dialogs (deliberately out of scope):** the Services "Add service", Cleaners "Invite", homeowner add-property, and add-card dialogs are button-triggered with no query param today. Checklist CTAs route to the destination PAGE (whose empty state already prompts the exact action). Do NOT add auto-open query params in this project; it is a separate enhancement.
- **Realtime:** the checklist re-derives on query invalidation and normal dashboard refetch. Do not add realtime subscriptions for onboarding columns.
- **`payout_configured_at` / `hours_policy_configured_at`** are set server-side in existing routes (Tasks 7, 8). The client settings helpers (`settings-api.ts`) need no change.
- **Welcome mount:** the welcome overlay is rendered by each role's dashboard-home container (Overview / Today / Home), so it appears on first landing (the redesign login redirect lands users on their dashboard root) and not on deep routes.
