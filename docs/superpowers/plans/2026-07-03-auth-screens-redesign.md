# Auth Screens Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the four auth screens (login, forgot-password, reset-password, accept-invite) + the shared `AuthShell` on the redesign design system (Shape B: split-screen on desktop, plain card on mobile), preserving all auth behavior, and fold in one behavior change: a password-policy hardening (Supabase floor 6->8 + a privacy-safe breached-password check on the create-password screens).

**Architecture:** Restyle in place (same routes, no route group). A rebuilt `AuthShell` renders a blue brand panel (desktop only) + the form card, wrapping content in `.redesign font-jakarta` so the brand tokens + Plus Jakarta Sans apply outside the `(redesign)` group. Pages keep their existing handlers verbatim and swap only presentation to `ui/*` primitives + shared auth primitives. A new `checkPasswordNotBreached` helper (HIBP k-anonymity, fail-open) gates the two create-password submits.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Supabase Auth, `ui/*` design-system primitives, Web Crypto (SHA-1 for HIBP).

## Global Constraints

- **Design system only.** brand `#0150FC` via `brand-*` / semantic tokens (`bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, `text-critical-700`), Plus Jakarta Sans via the `.redesign font-jakarta` wrapper, `rounded-card`/`rounded-field`/`rounded-pill`, `shadow-soft-*`. NO legacy: `.btn-primary`, `.input-field`, `primary-<number>` (yellow ramp), `text-gray-*`, `bg-gray-*`, `rounded-xl`/`rounded-2xl`, `#F7C41E`, Inter.
- **No em dashes** in user-facing copy.
- **Preserve behavior.** Every existing handler / effect / route call is kept verbatim: `signIn` + redirect, forgot-password fetch (anti-enumeration), reset `updateUser` + role lookup, accept-invite token exchange + preview/accept + `pagehide` beacon + `mark-expired`. Presentation-only except the added breached-password check.
- **Light mode only.** Do not add a `ThemeProvider` on auth; `:root` light tokens apply.
- **Tagline:** shared screens use panel title "Cleaning, handled." + subtitle "Booked, tracked, and paid in one place." Accept-invite passes "Welcome to the team." / "Set up your account and you're in."
- **critical border tint:** the `critical` color ramp is `{50, DEFAULT, 700}` only. Use `border-critical/30` (opacity on DEFAULT), never `border-critical-200` (undefined).

---

## File structure

- **Modify** `src/components/ui/logo.tsx` , add an `onDark` variant (all-white lockup via CSS filter for `full`, `icon-mono-white.svg` for `mark`).
- **Rewrite** `src/components/auth/AuthShell.tsx` , the split-screen shell (brand panel desktop / plain card mobile), `panelTitle`/`panelSubtitle` props.
- **Create** `src/components/auth/authPrimitives.tsx` , `AuthHeading`, `AuthError`, `TextField`, `PasswordField` (shared, design-system).
- **Create** `src/lib/auth/breachedPassword.ts` + `src/lib/auth/breachedPassword.test.ts` , HIBP k-anonymity check, fail-open.
- **Modify** `supabase/config.toml` , `minimum_password_length` 6 -> 8.
- **Modify** `src/app/login/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/app/accept-invite/page.tsx` , swap presentation to the new shell + primitives; add the breached check to reset + accept-invite submit.

**Interfaces produced (used across tasks):**
```ts
// logo.tsx
<Logo variant="full" onDark className="h-8 w-auto" />   // all-white lockup on the blue panel
// AuthShell.tsx
function AuthShell(props: { children: React.ReactNode; panelTitle?: string; panelSubtitle?: string }): JSX.Element
// authPrimitives.tsx
function AuthHeading(props: { title: string; subtitle?: string }): JSX.Element
function AuthError(props: { message?: string | null }): JSX.Element
function TextField(props: { id: string; label: string } & React.ComponentProps<typeof Input>): JSX.Element
function PasswordField(props: { id: string; label: string; helper?: string } & React.ComponentProps<typeof Input>): JSX.Element
// breachedPassword.ts
function checkPasswordNotBreached(password: string): Promise<{ breached: boolean }>
```

---

### Task 1: `Logo` on-dark variant

**Files:** Modify `src/components/ui/logo.tsx`

**Produces:** `<Logo onDark />` , all-white lockup for the blue panel.

- [ ] **Step 1: Add the `onDark` prop + white rendering.** Replace the component so `onDark` renders white:

```tsx
type LogoProps = {
  variant?: 'mark' | 'full'
  tone?: 'color' | 'mono' | 'auto'
  onDark?: boolean
  className?: string
  priority?: boolean
}

// ...ASSET map unchanged...

export function Logo({ variant = 'full', tone = 'auto', onDark = false, className, priority }: LogoProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const appearance = mounted && resolvedTheme === 'dark' ? 'dark' : 'light'

  let src: string
  let filterWhite = false
  if (onDark) {
    // logo-white.svg keeps a blue mark (invisible on blue); derive white from the
    // black lockup with a filter. The mark asset is already solid white.
    src = variant === 'mark' ? '/brand/icon-mono-white.svg' : ASSET['full-color-light']
    filterWhite = variant === 'full'
  } else if (variant === 'mark') {
    src = tone === 'color' ? ASSET['mark-color'] : ASSET[`mark-mono-${appearance}`]
  } else {
    src = ASSET[`full-color-${appearance}`]
  }

  const dims = variant === 'mark' ? { width: 40, height: 40 } : { width: 168, height: 40 }
  return (
    <Image
      src={src}
      alt="Nexxus"
      {...dims}
      priority={priority}
      style={{ width: 'auto', height: 'auto' }}
      className={cn('h-10 w-auto select-none', filterWhite && '[filter:brightness(0)_invert(1)]', className)}
    />
  )
}
```

- [ ] **Step 2: Type-check.** Run: `npx tsc --noEmit` , expect no new errors from this file.
- [ ] **Step 3: Commit.** `git add src/components/ui/logo.tsx && git commit -m "feat(ui): Logo on-dark (all-white) variant"`

---

### Task 2: Rebuild `AuthShell` (split-screen)

**Files:** Rewrite `src/components/auth/AuthShell.tsx`

**Consumes:** `Logo` (`onDark`). **Produces:** `AuthShell({ children, panelTitle?, panelSubtitle? })`.

- [ ] **Step 1: Replace the file.**

```tsx
import React from 'react';
import { Logo } from '@/components/ui/logo';

interface AuthShellProps {
  children: React.ReactNode;
  panelTitle?: string;
  panelSubtitle?: string;
}

/**
 * Shared auth chrome (login / forgot / reset / accept-invite). Split-screen on
 * desktop (blue brand panel + form card); on mobile the panel is hidden and the
 * black lockup sits above the card. Wrapped in `.redesign font-jakarta` so the
 * brand tokens + Plus Jakarta Sans apply outside the (redesign) route group.
 * Light mode only (no ThemeProvider here).
 */
export function AuthShell({
  children,
  panelTitle = 'Cleaning, handled.',
  panelSubtitle = 'Booked, tracked, and paid in one place.',
}: AuthShellProps) {
  return (
    <div className="redesign font-jakarta min-h-screen bg-background text-foreground md:grid md:grid-cols-[minmax(0,44%)_minmax(0,56%)]">
      <aside className="relative hidden overflow-hidden bg-brand-600 p-10 text-white md:flex md:flex-col md:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border border-white/15" aria-hidden />
        <div className="pointer-events-none absolute -left-16 bottom-24 size-44 rounded-full border border-white/15" aria-hidden />
        <Logo variant="full" onDark className="h-8 w-auto" priority />
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">{panelTitle}</h2>
          <p className="mt-2 text-lg font-medium text-white/90">{panelSubtitle}</p>
        </div>
        <p className="text-sm text-white/80">Cleaning Solutions</p>
      </aside>

      <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
        <div className="mb-7 md:hidden">
          <Logo variant="full" className="h-7 w-auto" priority />
        </div>
        <div className="w-full max-w-sm rounded-card border border-border bg-card p-6 shadow-soft-lg sm:max-w-md sm:p-7">
          {children}
        </div>
      </main>
    </div>
  );
}

export default AuthShell;
```

- [ ] **Step 2: Type-check.** Run: `npx tsc --noEmit`. (Consumers still pass a `badge` prop; those pages are updated in Tasks 6-9, so a transient TS error on `badge` is expected until then , do NOT re-add `badge`.)
- [ ] **Step 3: Commit.** `git add src/components/auth/AuthShell.tsx && git commit -m "feat(auth): rebuild AuthShell as split-screen brand shell"`

---

### Task 3: Shared auth form primitives

**Files:** Create `src/components/auth/authPrimitives.tsx`

**Consumes:** `Input`, `Label` (`ui/*`). **Produces:** `AuthHeading`, `AuthError`, `TextField`, `PasswordField`.

- [ ] **Step 1: Create the file.**

```tsx
'use client';

import * as React from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function AuthError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-control border border-critical/30 bg-critical-50 px-4 py-3 text-sm font-medium text-critical-700">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function TextField({
  id, label, ...props
}: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}

export function PasswordField({
  id, label, helper, ...props
}: { id: string; label: string; helper?: string } & React.ComponentProps<typeof Input>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={show ? 'text' : 'password'} className="pr-11 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden" {...props} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-field text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint.** `npx tsc --noEmit && npx eslint src/components/auth/authPrimitives.tsx`
- [ ] **Step 3: Commit.** `git add src/components/auth/authPrimitives.tsx && git commit -m "feat(auth): shared design-system auth form primitives"`

---

### Task 4: Breached-password check (TDD)

**Files:** Create `src/lib/auth/breachedPassword.ts` + `src/lib/auth/breachedPassword.test.ts`

**Produces:** `checkPasswordNotBreached(password): Promise<{ breached: boolean }>`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPasswordNotBreached } from './breachedPassword';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 -> prefix 5BAA6, suffix 1E4C9B93F3F0682250B6CF8331B7EE68FD8
afterEach(() => vi.restoreAllMocks());

describe('checkPasswordNotBreached', () => {
  it('returns breached:true when the suffix is in the HIBP range response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('00000000000000000000000000000000000:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:99999'),
    }));
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: true });
  });

  it('returns breached:false when the suffix is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('00000000000000000000000000000000000:3\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1'),
    }));
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: false });
  });

  it('fails open (breached:false) when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: false });
  });

  it('fails open on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') }));
    expect(await checkPasswordNotBreached('password')).toEqual({ breached: false });
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `npm run test:unit -- breachedPassword` , FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
/**
 * Check a password against the Have I Been Pwned breached-password corpus using
 * k-anonymity: only the first 5 hex chars of the SHA-1 are sent, never the
 * password. FAIL OPEN , if HIBP is unreachable or errors, treat the password as
 * not-breached (this is an enhancement on top of validatePassword, not a gate).
 */
export async function checkPasswordNotBreached(password: string): Promise<{ breached: boolean }> {
  try {
    const enc = new TextEncoder().encode(password);
    const digest = await globalThis.crypto.subtle.digest('SHA-1', enc);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return { breached: false };
    const body = await res.text();
    const breached = body.split('\n').some((line) => line.split(':')[0]?.trim().toUpperCase() === suffix);
    return { breached };
  } catch {
    return { breached: false };
  }
}
```

- [ ] **Step 4: Run tests, verify pass.** `npm run test:unit -- breachedPassword` , 4 pass.
- [ ] **Step 5: Commit.** `git add src/lib/auth/breachedPassword.ts src/lib/auth/breachedPassword.test.ts && git commit -m "feat(auth): HIBP k-anonymity breached-password check (fail-open) + tests"`

---

### Task 5: Raise the Supabase password floor

**Files:** Modify `supabase/config.toml`

- [ ] **Step 1:** Change `minimum_password_length = 6` to `minimum_password_length = 8` (matches the app-level `validatePassword` minimum). Leave `password_requirements = ""` (the app enforces complexity; setting a Supabase value here can reject the CLI on older versions).
- [ ] **Step 2: Verify local supabase still starts (optional if Docker up).** `npx supabase stop && npx supabase start` OR just confirm the toml parses. (Remote dev/prod projects enforce their floor via the Supabase dashboard Auth settings , note this as an ops follow-up in the PR; the app-level policy is the real gate.)
- [ ] **Step 3: Commit.** `git add supabase/config.toml && git commit -m "chore(auth): raise Supabase minimum_password_length 6 -> 8"`

---

### Task 6: Login page

**Files:** Modify `src/app/login/page.tsx`

**Consumes:** `AuthShell`, `AuthHeading`, `AuthError`, `TextField`, `PasswordField`, `Button`. **Preserve verbatim:** the `LoginContent` state, the redirect `useEffect` (user + isPlatformAdmin gating), and `handleSubmit` (`signIn` + error).

- [ ] **Step 1: Swap presentation.** Keep the imports for logic (`useAuth`, `useRouter`, `getDashboardPath`, `redesignUiEnabled`, `Suspense`, state, `handleSubmit`, the redirect effect) exactly as they are. Replace the returned JSX of `LoginContent` with:

```tsx
  return (
    <AuthShell>
      <AuthHeading title="Welcome back" subtitle="Sign in to your account to continue." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={error} />
        <TextField
          id="email" label="Email address" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
        />
        <PasswordField
          id="password" label="Password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password"
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isLoading || isCleaningUp}>
          {isCleaningUp ? 'Please wait...' : isLoading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
```

Update imports at the top: remove `AlertCircle, Eye, EyeOff, Loader` from lucide (now inside primitives/Button), keep `Link`; add `import { AuthShell } from "@/components/auth/AuthShell"; import { AuthHeading, AuthError, TextField, PasswordField } from "@/components/auth/authPrimitives"; import { Button } from "@/components/ui/button";`. Remove `showPassword` state (now inside `PasswordField`). Replace the `Suspense` fallback's legacy markup with a minimal centered spinner using tokens: `<div className="redesign font-jakarta grid min-h-screen place-items-center bg-background"><Loader2 className="size-8 animate-spin text-brand-600" /></div>` (import `Loader2`).

- [ ] **Step 2: Type-check + lint.** `npx tsc --noEmit && npx eslint src/app/login/page.tsx`
- [ ] **Step 3: Commit.** `git add src/app/login/page.tsx && git commit -m "feat(auth): redesign login page"`

---

### Task 7: Forgot-password page

**Files:** Modify `src/app/forgot-password/page.tsx`

**Preserve verbatim:** the `handleSubmit` (anti-enumeration fetch + always-submitted), the `status` state, `useToast`.

- [ ] **Step 1: Swap presentation.** Keep all logic. Replace the "submitted" branch JSX with:

```tsx
  if (status === "submitted") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <Mail className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              If an account exists for <span className="font-semibold text-foreground">{email.trim()}</span>, we sent a password reset link. Check your inbox (and spam), it expires in 1 hour.
            </p>
          </div>
          <Link href="/login" className="mt-1 text-sm font-semibold text-brand-600 hover:text-brand-700">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }
```

Replace the idle/submitting JSX with:

```tsx
  return (
    <AuthShell>
      <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send you a link to set a new one." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={clientError} />
        <TextField
          id="email" label="Email address" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
          disabled={status === "submitting"}
        />
        <Button type="submit" size="lg" className="w-full" loading={status === "submitting"}>
          {status === "submitting" ? "Sending..." : "Send reset link"}
        </Button>
        <div className="text-center">
          <Link href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Back to sign in</Link>
        </div>
      </form>
    </AuthShell>
  );
```

Update imports: add `AuthShell`, `AuthHeading`, `AuthError`, `TextField`, `Button`; keep `Mail`, `Loader2`, `Link`; remove `Loader`, `AlertCircle`. Replace the `Suspense` fallback with the same token spinner as Task 6.

- [ ] **Step 2: Type-check + lint.** `npx tsc --noEmit && npx eslint src/app/forgot-password/page.tsx`
- [ ] **Step 3: Commit.** `git add src/app/forgot-password/page.tsx && git commit -m "feat(auth): redesign forgot-password page"`

---

### Task 8: Reset-password page (+ breached check)

**Files:** Modify `src/app/reset-password/page.tsx`

**Preserve verbatim:** the recovery-session detection `useEffect`, the role lookup + redirect. **Add:** breached check in `handleSubmit`.

- [ ] **Step 1: Add the breached check to `handleSubmit`.** After the existing `validatePassword` + `password !== confirmPassword` checks pass and before `setIsSubmitting(true)`, insert:

```tsx
    const { breached } = await checkPasswordNotBreached(password);
    if (breached) {
      setFormError("This password showed up in a data breach. Please choose a different one.");
      return;
    }
```

Add `import { checkPasswordNotBreached } from "@/lib/auth/breachedPassword";`.

- [ ] **Step 2: Swap presentation.** Keep the loading/expired/invalid/success/form state logic. Replace the expired/invalid JSX:

```tsx
  if (pageState === "expired" || pageState === "invalid") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-critical-50 text-critical-700">
            <AlertCircle className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">{pageState === "expired" ? "Link expired" : "Invalid link"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{pageError}</p>
          </div>
          <Button asChild size="lg" className="w-full"><Link href="/forgot-password">Request a new link</Link></Button>
          <Link href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }
```

Replace the loading + success branches with the token spinner inside `<AuthShell>` (`<div className="flex flex-col items-center gap-3 py-6 text-center"><Loader2 className="size-8 animate-spin text-brand-600" /><p className="text-sm font-medium text-muted-foreground">Verifying your reset link...</p></div>` for loading; "Password updated. Redirecting..." for success). Replace the form JSX:

```tsx
  return (
    <AuthShell>
      <AuthHeading title="Set a new password" subtitle="Choose a new password for your account." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={formError} />
        <PasswordField
          id="password" label="New password" autoComplete="new-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
          helper={PASSWORD_HELPER_TEXT} disabled={isSubmitting}
        />
        <PasswordField
          id="confirmPassword" label="Confirm password" autoComplete="new-password" required
          value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password"
          disabled={isSubmitting}
        />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Updating password..." : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
```

Update imports: add `AuthShell`, `AuthHeading`, `AuthError`, `PasswordField`, `Button`, `checkPasswordNotBreached`; keep `AlertCircle`, `Loader2`, `Link`, `PASSWORD_HELPER_TEXT`; remove `Loader`, `validatePassword` stays. Replace the `Suspense` fallback with the token spinner.

- [ ] **Step 3: Type-check + lint.** `npx tsc --noEmit && npx eslint src/app/reset-password/page.tsx`
- [ ] **Step 4: Commit.** `git add src/app/reset-password/page.tsx && git commit -m "feat(auth): redesign reset-password page + breached-password check"`

---

### Task 9: Accept-invite page (+ breached check)

**Files:** Modify `src/app/accept-invite/page.tsx`

**Preserve verbatim:** the entire token-exchange `useEffect`, `processSession`, the `pagehide` beacon effect, `handleSubmit` (validation + `/api/accept-invite` + sign-in + redirect). **Add:** breached check + swap presentation. Panel copy = "Welcome to the team." / "Set up your account and you're in."

- [ ] **Step 1: Add the breached check to `handleSubmit`.** After `validatePassword` + `password !== confirmPassword` pass and before `setIsLoading(true)`:

```tsx
    const { breached } = await checkPasswordNotBreached(password);
    if (breached) {
      setFormError("This password showed up in a data breach. Please choose a different one.");
      return;
    }
```

Add `import { checkPasswordNotBreached } from "@/lib/auth/breachedPassword";`.

- [ ] **Step 2: Swap presentation.** Each `AuthShell` here passes the invite panel copy: `<AuthShell panelTitle="Welcome to the team." panelSubtitle="Set up your account and you're in.">`. Replace the loading branch with the token spinner ("Verifying your invite..."). Replace invalid/expired:

```tsx
    return (
      <AuthShell panelTitle="Welcome to the team." panelSubtitle="Set up your account and you're in.">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-critical-50 text-critical-700">
            <AlertCircle className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">{pageState === "expired" ? "Invite expired" : "Invalid invite"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{pageError}</p>
          </div>
        </div>
      </AuthShell>
    );
```

Replace the valid-form JSX (keep `invitePreview`, `userEmail`, all field state + handlers):

```tsx
  return (
    <AuthShell panelTitle="Welcome to the team." panelSubtitle="Set up your account and you're in.">
      <AuthHeading title={`Welcome to ${invitePreview?.organizationName ?? "the team"}`} subtitle="Complete your profile to access your dashboard." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={formError} />
        <TextField id="email" label="Email address" type="email" value={userEmail} disabled />
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <div><Badge variant="default">{formatRole(invitePreview?.role ?? "")}</Badge></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField id="firstName" label="First name" required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
          <TextField id="lastName" label="Last name" required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
        </div>
        <TextField id="phone" label="Phone (optional)" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000" />
        <PasswordField id="password" label="Create a password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" helper={PASSWORD_HELPER_TEXT} />
        <PasswordField id="confirmPassword" label="Confirm password" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" />
        <Button type="submit" size="lg" className="w-full" loading={isLoading}>
          {isLoading ? "Setting up your account..." : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
```

Update imports: add `AuthShell`, `AuthHeading`, `AuthError`, `TextField`, `PasswordField`, `Button`, `Badge` (`@/components/ui/badge`), `Label` (`@/components/ui/label`), `checkPasswordNotBreached`; keep `AlertCircle`, `Loader2`, `formatRole`, `validatePassword`, `PASSWORD_HELPER_TEXT`; remove `Loader`. Replace the `Suspense` fallback with the token spinner.

- [ ] **Step 3: Type-check + lint.** `npx tsc --noEmit && npx eslint src/app/accept-invite/page.tsx`
- [ ] **Step 4: Commit.** `git add src/app/accept-invite/page.tsx && git commit -m "feat(auth): redesign accept-invite page + breached-password check"`

---

### Task 10: Gates, conformance, review, visual verification, PR

- [ ] **Step 1: Full gates.** `npx tsc --noEmit` (no NEW errors beyond the pre-existing legacy set), `npm run lint`, `npm run test:unit` (breachedPassword green).
- [ ] **Step 2: Conformance grep** on the touched auth files , no raw hex, no `primary-[0-9]`, no `#F7C41E`, no `btn-primary`/`input-field`, no `text-gray-`, no em dash:
```bash
grep -rnE "#[0-9a-fA-F]{6}|primary-[0-9]|F7C41E|btn-primary|input-field|text-gray-|bg-gray-|—" \
  src/components/auth/ src/app/login/page.tsx src/app/forgot-password/page.tsx src/app/reset-password/page.tsx src/app/accept-invite/page.tsx
```
Expected: no matches.
- [ ] **Step 3: `ui-ux-pro-max` at implementation** over the auth shell + primitives (contrast on brand panel, 44px targets on the password toggle + buttons, focus rings, autofill/keyboard types).
- [ ] **Step 4: Independent adversarial review** over the branch (background Agent, opus): behavior preserved (no handler/effect changed except the added breached check), the breached check fails open + runs after sync validation, design-system conformance, "office"/no-em-dash/light-only, the Logo on-dark filter, and the mobile/desktop collapse.
- [ ] **Step 5: Visual verification on dev** at BOTH widths for all four screens + states (login; forgot idle + submitted; reset form + expired; accept-invite form + invalid). See the viewing notes below for how to reach the token-gated screens. Screenshots to the user (mobile).
- [ ] **Step 6: Push + open PR** to master (user-gated merge). PR notes: presentation rebuild + the one behavior change (password floor + breached check), the deferred auth backlog (`docs/auth-improvements-backlog.md`), the remote-Supabase floor dashboard follow-up, and the dead `/api/auth/signup` cleanup note. Honor the codex pre-push review per the user's standing preference.

---

## Viewing notes (for the "how do I see these" question)

Because auth is **restyled in place** (same routes, no route group), there is no redirect/route-group problem:
- **/login** and **/forgot-password**: open directly in a logged-out / incognito tab (login redirects to a dashboard if you're already signed in).
- **/reset-password (form)**: while signed in, navigate to `/reset-password` , `getSession()` resolves and the page shows the form state. The expired/invalid states need a `#error=...` hash (or the real emailed link).
- **/accept-invite (form)**: needs a real pending invite token; the cold page lands on the invalid state. To see the real form, send a test invite to an address you control, or rely on screenshots.

I'll drive all of these via Playwright and send screenshots regardless.

---

## Self-review

- **Spec coverage:** B split-screen shell (T2) + plain-card mobile (T2) + real logo/on-dark (T1) + all 4 screens (T6-T9) + password floor (T5) + breached check (T4, T8, T9) + restyle-in-place + light-only + tagline. Covered.
- **Placeholder scan:** none; all steps carry complete code or exact edits.
- **Type consistency:** `AuthShell({children, panelTitle?, panelSubtitle?})`, `checkPasswordNotBreached -> {breached}`, primitive prop names (`id`, `label`, `helper`) consistent across T3/T6-T9. `Logo onDark` consistent T1/T2.
- **Ambiguity:** breached check fails open (explicit); config floor local + remote-is-ops (explicit); light-only via no ThemeProvider (explicit).
