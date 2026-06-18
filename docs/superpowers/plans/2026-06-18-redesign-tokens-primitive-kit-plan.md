# Redesign Phase 0 + Phase 1: Tokens + Primitive Kit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the redesign's brand foundation — design tokens (color, type, shape, motion) plus a complete, accessible primitive component kit and a dev-only `/ui-kit` preview gallery — entirely additive, with zero change to the live legacy UI.

**Architecture:** Tokens ship as CSS variables (`:root` + `.dark`) in `globals.css`, surfaced through an **additive** Tailwind theme extension that never redefines a legacy key's existing meaning. The kit is shadcn/ui (Radix + Tailwind) copied into `src/components/ui/`, restyled with our tokens; because shadcn components already consume semantic classes (`bg-primary`, `border-input`, `bg-card`, `text-muted-foreground`, `ring-ring`), once Tailwind maps those names to our CSS variables, most components adopt our colors and both themes with near-zero per-component edits. The only per-component deltas are radius (pillowy), soft shadows, and 44px touch sizing. The kit and its theme/font are scoped to the `(dev)/ui-kit` route so the legacy global `html{font-family:var(--font-inter)}` / `body bg-white` stay live.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3.4.17 (JS config, `module.exports`), shadcn/ui, Radix UI, class-variance-authority, tailwind-merge + clsx (`cn()`), lucide-react (already installed), next-themes, tailwindcss-animate, react-day-picker, sonner. Path alias `@/*` → `./src/*`.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from `docs/superpowers/specs/2026-06-17-redesign-tokens-primitive-kit-design.md`.

- **Additive only.** Do not change any existing `tailwind.config.js` key's current meaning, any legacy `globals.css` rule, the yellow `primary` ramp, the `secondary`/`success` ramps, the default `rounded-*`/`shadow-*` scales, or the global `--font-inter`. New tokens use **new key names** or **add fields** to existing color objects without altering existing shades.
- **No global theme swap.** Legacy `src/components/**`, the data layer (`src/hooks`, `src/lib`, `src/contexts`, `src/app/api/**`, Supabase, Stripe) are untouched.
- **Both themes, every component.** Light + dark, verified independently. Contrast meets WCAG AA (4.5:1 body text, 3:1 large text / UI). Status is never color-only — every pill/badge carries an icon or text.
- **Touch + a11y.** Min 44x44px touch targets with 8px+ spacing; visible `focus-visible` rings never removed; full keyboard nav; icon-only buttons get `aria-label`; `prefers-reduced-motion` honored; dynamic text scaling without layout break.
- **Icons: lucide-react only**, stroke set consistent, sizes 16/20/24. No emoji as icons.
- **Tabular numerals** (`font-feature-settings: "tnum" 1`) on money, tables, timers, stats.
- **No em dashes (`—`) in any user-facing UI copy** (labels, buttons, gallery captions that mimic product copy). Use a period, comma, parentheses, or "to" for ranges. (This rule is about product copy, not this plan doc.)
- **Brand source of truth:** brand-600 `#0150FC`, sky-400 `#68B6FA`. Font: **Plus Jakarta Sans** (deliberately not Inter).

---

## File Structure

| Path | New/Mod | Responsibility |
|---|---|---|
| `src/lib/utils.ts` | Create | `cn()` class-merge helper. |
| `components.json` | Create | shadcn CLI config pointed at our paths; prevents CLI from re-initing our token/config files. |
| `src/app/layout.tsx` | Modify | Register Plus Jakarta Sans as a 2nd `next/font`, expose `--font-sans`; add `suppressHydrationWarning`. Inter stays the legacy default. |
| `src/app/globals.css` | Modify (append) | `:root` + `.dark` token blocks, `.redesign` scope class, `.tnum` utility, `prefers-reduced-motion` block. Existing rules untouched. |
| `tailwind.config.js` | Modify | `darkMode:['class']`; additive `brand`/`sky`/`warm`/status ramps + shadcn semantic keys + pillowy radius keys + soft shadow keys + jakarta font key + motion tokens; add `tailwindcss-animate` plugin. |
| `src/components/ui/theme-provider.tsx` | Create | `next-themes` provider (client). |
| `src/components/ui/theme-toggle.tsx` | Create | Light/dark toggle button (kit primitive). |
| `src/components/ui/*.tsx` | Create | Every primitive (Button, Input, Card, Dialog, …). |
| `src/components/ui/logo.tsx` | Create | `<Logo>` reading `public/brand/*`, variant + theme aware. |
| `src/app/(dev)/layout.tsx` | Create | Dev-only route-group layout: server-side guard + redesign font/theme scope wrapper. |
| `src/app/(dev)/ui-kit/page.tsx` | Create | The gallery: every component in every state, grouped, with theme toggle. |
| `src/app/(dev)/ui-kit/sections/*.tsx` | Create | One section component per category (forms, display, overlays, nav, brand) to keep the page file focused. |

## Conventions for the component tasks (Part B onward)

1. **Scaffold from upstream, then own it:** `npx shadcn@latest add <name>` writes the base file into `src/components/ui/`. We own and version it after that. (First `add` includes a config-diff guard — Task 10.)
2. **The token payoff:** after Tasks 5-6, shadcn's semantic classes already resolve to our colors in both themes. Per-component edits are limited to: **radius** (`rounded-md`/`rounded-lg` → `rounded-control`/`rounded-field`/`rounded-card`/`rounded-pill`), **shadow** (`shadow-sm`/`shadow-md` → `shadow-soft-md`/`shadow-soft-lg` on cards/popovers/overlays), and **size** (raise control heights to `h-11`/`h-12` for 44px touch).
3. **Each component task ends with:** a gallery section rendering all states, a Playwright MCP screenshot verification (light + dark) against the spec feel, then a commit.
4. **Verification, not unit TDD:** primitives are visual; the spec calls for "lightweight optional checks, no heavy test burden." The verification gate is the `/ui-kit` screenshot, not Vitest. The one exception with a real unit test is `cn()` (Task 2).

---

# PART A — Foundation & token wiring

### Task 1: Install core dependencies

**Files:** `package.json` (via npm).

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
npm install class-variance-authority tailwind-merge clsx next-themes
npm install -D tailwindcss-animate
```
(`lucide-react` is already present. Radix packages, `react-day-picker`, and `sonner` arrive per-component via `npx shadcn add` in later tasks.)

- [ ] **Step 2: Verify install**

Run: `npm ls class-variance-authority tailwind-merge clsx next-themes tailwindcss-animate`
Expected: all five resolve with versions, no `UNMET DEPENDENCY`.

- [ ] **Step 3: Commit**
```bash
git add package.json package-lock.json
git commit -m "chore(redesign): add token/kit core dependencies"
```

---

### Task 2: `cn()` class-merge helper

**Files:**
- Create: `src/lib/utils.ts`
- Test: `src/lib/utils.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` — merges class lists with `clsx` then dedupes Tailwind conflicts with `twMerge`. Every component imports this.

- [ ] **Step 1: Write the failing test**
```ts
// src/lib/utils.test.ts
import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('joins truthy classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })
  it('lets later tailwind classes win on conflict', () => {
    expect(cn('px-2 px-4')).toBe('px-4')
  })
  it('merges conditional objects', () => {
    expect(cn('p-2', { 'text-red-500': true, 'hidden': false })).toBe('p-2 text-red-500')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/utils.test.ts`
Expected: FAIL — `Cannot find module './utils'` / `cn is not a function`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/utils.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(redesign): add cn() class-merge helper"
```

---

### Task 3: shadcn config (`components.json`)

**Files:**
- Create: `components.json`

This is hand-authored (we do **not** run `npx shadcn init`, which would rewrite `globals.css` + `tailwind.config.js` with its defaults). It points the CLI at our existing files so `shadcn add` only writes component files + deps.

**Interfaces:**
- Produces: a config consumed by every `npx shadcn add` call (Tasks 10+).

- [ ] **Step 1: Create the config**
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 2: Verify the CLI reads it (dry, no writes yet)**

Run: `npx shadcn@latest add --help`
Expected: help text prints (confirms the CLI is reachable). Do not add a component yet — tokens must land first.

- [ ] **Step 3: Commit**
```bash
git add components.json
git commit -m "chore(redesign): add shadcn components.json (additive, no init)"
```

---

### Task 4: Register Plus Jakarta Sans (no legacy font change)

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: a `--font-sans` CSS variable available document-wide. Legacy keeps using `--font-inter`; only the `.redesign` scope (Task 5) consumes `--font-sans`.

- [ ] **Step 1: Add the font import + instance**

In `src/app/layout.tsx`, change the import line:
```ts
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
```
and add, right after the `inter` definition:
```ts
// Redesign font. Self-hosted, exposed as --font-sans. Consumed only inside the
// .redesign scope (the /ui-kit gallery and, later, the redesign route tree),
// so legacy UI keeps Inter via --font-inter.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});
```

- [ ] **Step 2: Expose the variable + allow theme class mutation**

Change the `<html>` tag:
```tsx
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
```
(`suppressHydrationWarning` prevents a hydration warning when `next-themes` writes the `class`/`style` on `<html>`. The `body className="min-h-screen bg-white"` line is unchanged — legacy stays white.)

- [ ] **Step 3: Verify build wiring**

Run: `npm run dev` (if not already running), then `npx tsc --noEmit`
Expected: no new type errors from `layout.tsx`. Dev server compiles.

- [ ] **Step 4: Commit**
```bash
git add src/app/layout.tsx
git commit -m "feat(redesign): register Plus Jakarta Sans as --font-sans (legacy Inter untouched)"
```

---

### Task 5: Token CSS variables (`globals.css`)

**Files:**
- Modify: `src/app/globals.css` (append only — do not touch lines 1-14 or the legacy `@layer components` / scrollbar blocks).

**Interfaces:**
- Produces: light (`:root`) + dark (`.dark`) semantic variables (shadcn HSL-channel convention), a `--shadow-rgb` for theme-aware shadows, the `.redesign` scope class (applies Jakarta + warm canvas), a `.tnum` tabular-numerals utility, and a `prefers-reduced-motion` guard. Consumed by Task 6's Tailwind mapping and by every kit component.

- [ ] **Step 1: Append the token blocks to the end of `globals.css`**
```css
/* ============================================================
   REDESIGN TOKENS (additive). Light = :root, dark = .dark.
   shadcn HSL-channel convention: consumed as hsl(var(--x)).
   Source of truth hex is in the trailing comment on each line.
   ============================================================ */
:root {
  /* shadow base (warm near-black, light theme) */
  --shadow-rgb: 20 18 15;

  --background: 45 20% 96%;        /* #F7F6F3 warm-50 */
  --foreground: 34 12% 12%;        /* #211E1A warm-900 */
  --card: 0 0% 100%;               /* #FFFFFF */
  --card-foreground: 34 12% 12%;   /* #211E1A */
  --popover: 0 0% 100%;            /* #FFFFFF */
  --popover-foreground: 34 12% 12%;/* #211E1A */
  --primary: 221 99% 50%;          /* #0150FC brand-600 */
  --primary-foreground: 0 0% 100%; /* #FFFFFF */
  --secondary: 43 18% 92%;         /* #EFEDE8 warm-100 */
  --secondary-foreground: 34 12% 12%;/* #211E1A */
  --muted: 43 18% 92%;             /* #EFEDE8 */
  --muted-foreground: 37 9% 38%;   /* #6B6459 warm-600 */
  --accent: 221 100% 97%;          /* #EFF4FF brand-50 */
  --accent-foreground: 221 99% 40%;/* #0140CC brand-700 */
  --border: 38 18% 88%;            /* #E6E2DB warm-200 */
  --input: 38 18% 88%;             /* #E6E2DB */
  --ring: 221 99% 50%;             /* #0150FC brand-600 */
  --destructive: 358 75% 59%;      /* #E5484D danger */
  --destructive-foreground: 0 0% 100%;/* #FFFFFF */
}

.dark {
  --shadow-rgb: 0 0 0;             /* pure black base reads stronger on dark */

  --background: 36 11% 9%;         /* #1A1815 */
  --foreground: 40 23% 95%;        /* #F5F3EF */
  --card: 40 14% 12%;              /* #24211B */
  --card-foreground: 40 23% 95%;   /* #F5F3EF */
  --popover: 40 14% 12%;           /* #24211B */
  --popover-foreground: 40 23% 95%;/* #F5F3EF */
  --primary: 225 100% 59%;         /* #2E62FF brand-500 (lifted) */
  --primary-foreground: 0 0% 100%; /* #FFFFFF */
  --secondary: 33 11% 15%;         /* #2C2823 */
  --secondary-foreground: 40 23% 95%;/* #F5F3EF */
  --muted: 33 11% 15%;             /* #2C2823 */
  --muted-foreground: 38 13% 68%;  /* #B8B0A2 */
  --accent: 33 11% 15%;            /* #2C2823 */
  --accent-foreground: 223 100% 93%;/* #DCE6FF brand-100 */
  --border: 37 13% 19%;            /* #38332B */
  --input: 37 13% 19%;             /* #38332B */
  --ring: 225 100% 68%;            /* #5C84FF brand-400 */
  --destructive: 358 86% 64%;      /* #F2555A */
  --destructive-foreground: 36 11% 9%;/* #1A1815 */
}

/* Redesign scope: opt-in wrapper. Applies the redesign font + warm canvas
   without touching the global html/body legacy rules. */
.redesign {
  font-family: var(--font-sans), system-ui, sans-serif;
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
}

/* Tabular numerals for money/tables/timers/stats. */
.tnum {
  font-feature-settings: "tnum" 1;
  font-variant-numeric: tabular-nums;
}

/* Respect reduced motion inside the kit. */
@media (prefers-reduced-motion: reduce) {
  .redesign *,
  .redesign *::before,
  .redesign *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Verify nothing legacy moved**

Run: `git diff src/app/globals.css`
Expected: only additions at end of file; lines 1-14 (Tailwind directives + legacy `html`/`body`) and the legacy `@layer components` block show no changes.

- [ ] **Step 3: Commit**
```bash
git add src/app/globals.css
git commit -m "feat(redesign): add light/dark token vars + .redesign scope + tnum + reduced-motion"
```

---

### Task 6: Additive Tailwind theme extension

**Files:**
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces: utilities the kit relies on — `bg-brand-600`/`text-sky-400`/`bg-warm-100` (hex ramps); `bg-primary`/`text-primary-foreground`/`bg-card`/`border-input`/`ring-ring`/`bg-muted`/`text-muted-foreground`/`bg-accent`/`bg-popover`/`bg-destructive` (semantic, via `hsl(var())`); status ramps `bg-positive`/`bg-caution`/`bg-critical`/`bg-info` (+ `-50`/`-700`); radius `rounded-chip|control|field|card|pill`; shadow `shadow-soft-sm|md|lg`; `font-jakarta`; `duration-fast|base|slow`; `ease-out-soft`.

**Coexistence note:** the legacy `primary` (yellow 50-900) and `secondary` (slate 50-900) ramps are **preserved** by re-declaring all their existing shades and only *adding* `DEFAULT` + `foreground` fields. `bg-primary-600` stays yellow; the new `bg-primary` (bare) resolves to brand blue. Legacy never used the bare form (no `DEFAULT` existed), so this is purely additive.

- [ ] **Step 1: Guard — confirm legacy has no media-query `dark:` reliance**

Run: `grep -rn "dark:" src/components src/app --include=*.tsx | head -40`
Expected: review output. The app is light-only; switching `darkMode` to `'class'` only changes how `dark:` *would* resolve. If any legacy `dark:` utilities exist and are intended to be active, note them — but legacy renders on a white body and does not toggle `.dark`, so they remain inert either way. Proceed.

- [ ] **Step 2: Add `darkMode` and the plugin**

At the top level of the config object (sibling of `content`), add:
```js
  darkMode: ['class'],
```
In the `plugins` array, add `require('tailwindcss-animate')`:
```js
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
```

- [ ] **Step 3: Extend `theme.extend.colors`** — replace the existing `primary` and `secondary` objects with the merged versions below, and add the new color keys. **Keep** `success` exactly as-is.
```js
        primary: {
          // legacy yellow ramp (PRESERVED, do not change)
          50: '#FFFBF0', 100: '#FEF5D9', 200: '#FDEAB3', 300: '#FBDD88',
          400: '#F9D05C', 500: '#F7C41E', 600: '#D9A718', 700: '#B88914',
          800: '#936D10', 900: '#6B4F0C',
          // redesign semantic (NEW, additive)
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          // legacy slate ramp (PRESERVED, do not change)
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
          800: '#1e293b', 900: '#0f172a',
          // redesign semantic (NEW, additive)
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // success ramp stays unchanged (legacy green)

        // ---- redesign ramps (NEW) ----
        brand: {
          50: '#EFF4FF', 100: '#DCE6FF', 200: '#C0D2FF', 300: '#93AEFF',
          400: '#5C84FF', 500: '#2E62FF', 600: '#0150FC', 700: '#0140CC',
          800: '#0A2F95', 900: '#102A6E', 950: '#0A1A47',
        },
        sky: { 300: '#9CD0FD', 400: '#68B6FA', 500: '#3F9DF5' },
        warm: {
          50: '#F7F6F3', 100: '#EFEDE8', 200: '#E6E2DB', 300: '#D7D2C8',
          400: '#B2AB9D', 500: '#8B8475', 600: '#6B6459', 700: '#4E483F',
          800: '#322E28', 900: '#211E1A', 950: '#14120F',
        },
        // status ramps (icon/label always accompanies color)
        positive: { 50: '#E7F7EE', DEFAULT: '#1FAE63', 700: '#12814A' }, // success
        caution:  { 50: '#FEF3E2', DEFAULT: '#F59E0B', 700: '#B4740B' }, // warning
        critical: { 50: '#FDECEC', DEFAULT: '#E5484D', 700: '#B42A2F' }, // danger
        info:     { 50: '#EAF4FE', DEFAULT: '#3F9DF5', 700: '#1E6FB8' }, // info/sky

        // ---- shadcn semantic keys (NEW) ----
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
```

- [ ] **Step 4: Extend `theme.extend` with radius, shadow, font, motion** — add these sibling keys inside `extend` (do not modify the existing `animation`/`keyframes`):
```js
      borderRadius: {
        chip: '10px',     // sm
        control: '14px',  // md
        field: '18px',    // lg (inputs/selects)
        card: '22px',     // xl (cards)
        pill: '9999px',   // buttons / badges
      },
      boxShadow: {
        'soft-sm': '0 1px 2px rgb(var(--shadow-rgb) / 0.06)',
        'soft-md': '0 8px 24px rgb(var(--shadow-rgb) / 0.08), 0 2px 6px rgb(var(--shadow-rgb) / 0.05)',
        'soft-lg': '0 14px 34px rgb(var(--shadow-rgb) / 0.12), 0 4px 10px rgb(var(--shadow-rgb) / 0.06)',
      },
      fontFamily: {
        // legacy `sans` (Inter) stays; add the redesign family under a new key
        jakarta: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '300ms' },
      transitionTimingFunction: { 'out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)' },
```

- [ ] **Step 5: Verify Tailwind compiles and legacy utilities still resolve**

Restart dev (`npm run dev`). In the running app, confirm an existing legacy page still renders yellow (e.g. a `bg-primary-600` button). Then:
Run: `npx tsc --noEmit`
Expected: no new errors. Dev server compiles with no "unknown utility" warnings.

- [ ] **Step 6: Commit**
```bash
git add tailwind.config.js
git commit -m "feat(redesign): additive Tailwind extension (brand/warm/semantic, pillowy radius, soft shadow, jakarta, motion)"
```

---

### Task 7: Theme provider + toggle

**Files:**
- Create: `src/components/ui/theme-provider.tsx`
- Create: `src/components/ui/theme-toggle.tsx`

**Interfaces:**
- Produces: `<ThemeProvider>` (wraps the kit; `attribute="class"`, toggles `.dark` on `<html>`); `<ThemeToggle>` (button switching light/dark, used in the gallery header). Consumed by Task 8's `(dev)` layout.

- [ ] **Step 1: ThemeProvider**
```tsx
// src/components/ui/theme-provider.tsx
'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

- [ ] **Step 2: ThemeToggle**
```tsx
// src/components/ui/theme-toggle.tsx
'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'
  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex h-11 w-11 items-center justify-center rounded-pill border border-border bg-card text-foreground shadow-soft-sm transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {mounted && isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors in the two new files.

- [ ] **Step 4: Commit**
```bash
git add src/components/ui/theme-provider.tsx src/components/ui/theme-toggle.tsx
git commit -m "feat(redesign): next-themes provider + theme toggle primitive"
```

---

### Task 8: Dev-only `/ui-kit` route shell + gallery scaffold

**Files:**
- Create: `src/app/(dev)/layout.tsx`
- Create: `src/app/(dev)/ui-kit/page.tsx`
- Create: `src/app/(dev)/ui-kit/sections/section.tsx` (shared section/spec layout helpers)

**Interfaces:**
- Consumes: `ThemeProvider` (Task 7), `ThemeToggle` (Task 7).
- Produces: `Section` + `Specimen` layout helpers used by every later gallery section; a guarded `/ui-kit` page rendering the warm canvas in both themes. Later tasks import their sections into `page.tsx`.

- [ ] **Step 1: Route-group layout with server guard + redesign scope**
```tsx
// src/app/(dev)/layout.tsx
import { notFound } from 'next/navigation'
import { ThemeProvider } from '@/components/ui/theme-provider'

// Dev-only. Never ships to prod users unless explicitly enabled on a preview.
const enabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_UI_KIT_ENABLED === 'true'

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!enabled) notFound()
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">{children}</div>
    </ThemeProvider>
  )
}
```

- [ ] **Step 2: Section helpers**
```tsx
// src/app/(dev)/ui-kit/sections/section.tsx
import * as React from 'react'

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-6 grid gap-8">{children}</div>
    </section>
  )
}

export function Specimen({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <div className={`flex flex-wrap items-center gap-4 rounded-card border border-border bg-card p-6 shadow-soft-sm ${className}`}>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Gallery page shell**
```tsx
// src/app/(dev)/ui-kit/page.tsx
'use client'

import { ThemeToggle } from '@/components/ui/theme-toggle'

export default function UiKitPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground">Nexxus UI Kit</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Redesign primitives. Plus Jakarta Sans, warm canvas, brand blue, pillowy shapes. Toggle the theme to verify both.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="grid gap-16">
        {/* Sections appended here as components land (Tasks 9-29). */}
        <p className="text-sm text-muted-foreground">Sections render here as primitives are built.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify the empty gallery in both themes (first screenshot gate)**

Ensure `npm run dev` is running. Using the **Playwright MCP**:
1. `browser_navigate` → `http://localhost:3000/ui-kit`
2. `browser_take_screenshot` (light) — expect warm off-white canvas (`#F7F6F3`), Jakarta heading, a pill theme toggle, no console errors.
3. `browser_click` the theme toggle, `browser_take_screenshot` (dark) — expect warm near-black canvas (`#1A1815`), light text.
4. `browser_console_messages` — expect no errors (hydration warning must be gone given `suppressHydrationWarning`).

Expected: both screenshots show the warm canvas + correct font; theme toggles cleanly.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(dev)"
git commit -m "feat(redesign): dev-only /ui-kit gallery shell with theme toggle + section helpers"
```

---

### Task 9: `<Logo>` component + brand section

**Files:**
- Create: `src/components/ui/logo.tsx`
- Create: `src/app/(dev)/ui-kit/sections/brand-section.tsx`
- Modify: `src/app/(dev)/ui-kit/page.tsx` (mount the section)

**Pre-check:** confirm the brand asset filenames before coding.
Run: `ls public/brand`
Expected (from this session's import): `icon-color.svg`, `icon-mono-white.svg`, `icon-mono-gray.svg`, `icon-dark.svg`, `icon-light.svg`, `logo-black.svg`, `logo-white.svg`, plus PNG variants. Use the actual names returned; adjust the map in Step 1 to match.

**Interfaces:**
- Produces: `<Logo variant?: 'mark' | 'full'; tone?: 'color' | 'mono' | 'auto'; className?: string />`. `tone="auto"` swaps light/dark asset based on theme. Default `variant="full"`, `tone="auto"`.

- [ ] **Step 1: Logo component**
```tsx
// src/components/ui/logo.tsx
'use client'

import * as React from 'react'
import Image from 'next/image'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

type LogoProps = {
  variant?: 'mark' | 'full'
  tone?: 'color' | 'mono' | 'auto'
  className?: string
  priority?: boolean
}

// Map (variant, resolved appearance) -> asset path. Adjust paths to match `ls public/brand`.
const ASSET: Record<string, string> = {
  'mark-color': '/brand/icon-color.svg',
  'mark-mono-light': '/brand/icon-dark.svg',   // dark mark for light bg
  'mark-mono-dark': '/brand/icon-light.svg',   // light mark for dark bg
  'full-color-light': '/brand/logo-black.svg',
  'full-color-dark': '/brand/logo-white.svg',
}

export function Logo({ variant = 'full', tone = 'auto', className, priority }: LogoProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const appearance = mounted && resolvedTheme === 'dark' ? 'dark' : 'light'

  let src: string
  if (variant === 'mark') {
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
      className={cn('h-10 w-auto select-none', className)}
    />
  )
}
```

- [ ] **Step 2: Brand gallery section**
```tsx
// src/app/(dev)/ui-kit/sections/brand-section.tsx
import { Logo } from '@/components/ui/logo'
import { Section, Specimen } from './section'

export function BrandSection() {
  return (
    <Section id="brand" title="Brand">
      <Specimen label="Full lockup (theme-aware)"><Logo variant="full" /></Specimen>
      <Specimen label="Mark, color"><Logo variant="mark" tone="color" /></Specimen>
      <Specimen label="Mark, mono (theme-aware)"><Logo variant="mark" tone="mono" /></Specimen>
    </Section>
  )
}
```

- [ ] **Step 3: Mount it in the page**

In `src/app/(dev)/ui-kit/page.tsx`, import and render the section inside the `grid gap-16` wrapper, replacing the placeholder `<p>`:
```tsx
import { BrandSection } from './sections/brand-section'
// ...
      <div className="grid gap-16">
        <BrandSection />
      </div>
```

- [ ] **Step 4: Screenshot gate (Playwright MCP)**

Navigate to `/ui-kit`, screenshot light + dark. Expect: color mark renders; full lockup swaps black↔white with theme; mono mark legible on each canvas. No layout shift, no console errors.

- [ ] **Step 5: Commit**
```bash
git add src/components/ui/logo.tsx "src/app/(dev)/ui-kit"
git commit -m "feat(redesign): theme-aware Logo primitive + brand gallery section"
```

---

# PART B — Form primitives

> For each component: scaffold via `npx shadcn@latest add <name>`, apply the documented deltas, add the gallery section, screenshot-verify light+dark, commit. Standard control height for 44px touch is `h-11` (44px) default, `h-12` (48px) for primary CTAs, `h-9` only for explicitly compact contexts.

### Task 10: Button + IconButton (+ first-add config guard)

**Files:**
- Create: `src/components/ui/button.tsx` (scaffolded, then restyled)
- Create: `src/components/ui/icon-button.tsx`
- Create: `src/app/(dev)/ui-kit/sections/buttons-section.tsx`
- Modify: `src/app/(dev)/ui-kit/page.tsx`

**Interfaces:**
- Produces: `Button` with `variant: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'`, `size: 'default' | 'sm' | 'lg' | 'icon'`, `asChild`, and a `loading?: boolean` prop (disables + shows a `Loader2` spinner). `buttonVariants(...)` cva export. `IconButton` = icon-only button with required `aria-label`.

- [ ] **Step 1: Scaffold Button**

Run: `npx shadcn@latest add button`
Expected: writes `src/components/ui/button.tsx`, installs `@radix-ui/react-slot`.

- [ ] **Step 2: First-add config guard**

Run: `git diff tailwind.config.js src/app/globals.css components.json`
Expected: **no changes** (our tokens already satisfied the CLI). If the CLI injected anything (duplicate `:root` vars, a `@layer base` block, config edits), revert those hunks with `git checkout -- <file>` — our Task 5/6 versions are authoritative. Re-run the diff to confirm clean.

- [ ] **Step 3: Restyle Button to tokens** — replace the generated `buttonVariants` and add `loading`. Final file:
```tsx
// src/components/ui/button.tsx
'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold transition-all duration-base ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[.97] [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-soft-sm hover:brightness-110',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        outline: 'border border-input bg-card text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground shadow-soft-sm hover:brightness-110',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-6',
        sm: 'h-9 px-4 text-sm',
        lg: 'h-12 px-8 text-base',
        icon: 'h-11 w-11 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-5 animate-spin" /> : null}
        {children}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

- [ ] **Step 4: IconButton**
```tsx
// src/components/ui/icon-button.tsx
'use client'

import * as React from 'react'
import { Button, type ButtonProps } from './button'

export interface IconButtonProps extends Omit<ButtonProps, 'size'> {
  'aria-label': string
  size?: 'default' | 'sm' | 'lg'
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', ...props }, ref) => (
    <Button ref={ref} size="icon" variant={variant} {...props} />
  ),
)
IconButton.displayName = 'IconButton'

export { IconButton }
```

- [ ] **Step 5: Gallery section**
```tsx
// src/app/(dev)/ui-kit/sections/buttons-section.tsx
'use client'

import { Plus, Trash2, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Section, Specimen } from './section'

export function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons">
      <Specimen label="Variants">
        <Button>New booking</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive"><Trash2 />Delete</Button>
        <Button variant="link">Link</Button>
      </Specimen>
      <Specimen label="Sizes">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg"><Plus />Large</Button>
      </Specimen>
      <Specimen label="States">
        <Button disabled>Disabled</Button>
        <Button loading>Saving</Button>
      </Specimen>
      <Specimen label="Icon buttons">
        <IconButton aria-label="Add"><Plus /></IconButton>
        <IconButton aria-label="Notifications" variant="outline"><Bell /></IconButton>
        <IconButton aria-label="Delete" variant="destructive"><Trash2 /></IconButton>
      </Specimen>
    </Section>
  )
}
```

- [ ] **Step 6: Mount in page** — import `ButtonsSection` and add it after `<BrandSection />` in `page.tsx`.

- [ ] **Step 7: Screenshot gate (Playwright MCP)** — light + dark. Verify: pill shape, brand-blue primary, visible focus ring on keyboard `Tab`, press-scale on click, spinner on `loading`, 44px height. Iterate classes until it matches the spec's pillowy/premium feel.

- [ ] **Step 8: Commit**
```bash
git add src/components/ui/button.tsx src/components/ui/icon-button.tsx "src/app/(dev)/ui-kit"
git commit -m "feat(redesign): Button + IconButton primitives + gallery"
```

---

### Task 11: Input + Textarea + Label

**Files:** Create `src/components/ui/input.tsx`, `textarea.tsx`, `label.tsx`, `sections/inputs-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: `Input` (native input, all types), `Textarea`, `Label` (Radix label). All accept `className`, forward refs, expose an error state via an `aria-invalid` style hook.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add input textarea label`

- [ ] **Step 2: Restyle Input** (Textarea mirrors it with `min-h-24`):
```tsx
// src/components/ui/input.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-field border border-input bg-card px-4 text-base text-foreground transition-colors duration-base placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
export { Input }
```
Textarea: same classes minus fixed height, plus `min-h-24 py-3 resize-y`.

- [ ] **Step 3: Restyle Label**
```tsx
// src/components/ui/label.tsx
'use client'
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-sm font-semibold text-foreground peer-disabled:opacity-50', className)}
    {...props}
  />
))
Label.displayName = 'Label'
export { Label }
```

- [ ] **Step 4: Gallery section** — render: default input, with placeholder, focused (note focus ring), disabled, `aria-invalid` error input, an `email`/`tel`/`number` (note `className="tnum"` on number), and a Textarea. Each paired with a `<Label htmlFor>`.

- [ ] **Step 5: Mount, screenshot gate (light+dark), iterate.** Verify 44px height, field radius, focus ring, error border, 16px text (no iOS zoom).

- [ ] **Step 6: Commit** — `feat(redesign): Input + Textarea + Label primitives + gallery`

---

### Task 12: FormField wrapper

**Files:** Create `src/components/ui/form-field.tsx`, extend `inputs-section.tsx`.

**Interfaces:**
- Consumes: `Label` (Task 11).
- Produces: `FormField({ label, htmlFor, helper?, error?, required?, children })` — renders a visible `Label` above the control, persistent `helper` text below, and an `error` rendered with `role="alert"` (replacing helper when present). Wires `aria-describedby`.

- [ ] **Step 1: Component**
```tsx
// src/components/ui/form-field.tsx
import * as React from 'react'
import { Label } from './label'
import { cn } from '@/lib/utils'

export interface FormFieldProps {
  label: string
  htmlFor: string
  helper?: string
  error?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function FormField({ label, htmlFor, helper, error, required, className, children }: FormFieldProps) {
  const describedBy = error ? `${htmlFor}-error` : helper ? `${htmlFor}-helper` : undefined
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-destructive" aria-hidden>*</span> : null}
      </Label>
      <div aria-describedby={describedBy}>{children}</div>
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm font-medium text-destructive">{error}</p>
      ) : helper ? (
        <p id={`${htmlFor}-helper`} className="text-sm text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Gallery** — show a FormField with helper, one with error, one required. Pass an `Input id` matching `htmlFor`; set `aria-invalid` on the errored input.

- [ ] **Step 3: Screenshot gate (light+dark), commit** — `feat(redesign): FormField wrapper + gallery`

---

### Task 13: Select

**Files:** Create `src/components/ui/select.tsx` (scaffold), `sections/select-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: shadcn `Select` family (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`).

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add select` (installs `@radix-ui/react-select`).
- [ ] **Step 2: Restyle deltas** in `select.tsx`:
  - `SelectTrigger`: `h-11 rounded-field px-4 text-base` + standard focus-ring classes; keep `border-input bg-card`.
  - `SelectContent`: `rounded-card border-border bg-popover shadow-soft-lg`.
  - `SelectItem`: `rounded-control py-2.5 text-base focus:bg-accent focus:text-accent-foreground`; min touch height via `py-2.5`.
- [ ] **Step 3: Gallery** — a labeled Select (via FormField) with 4-5 options + groups; show open state in the screenshot.
- [ ] **Step 4: Screenshot gate (light+dark), keyboard-open with Enter/Space, arrow-key nav. Commit** — `feat(redesign): Select primitive + gallery`

---

### Task 14: Checkbox + RadioGroup + Switch

**Files:** Create `src/components/ui/checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `sections/toggles-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: `Checkbox`, `RadioGroup` + `RadioGroupItem`, `Switch`.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add checkbox radio-group switch`
- [ ] **Step 2: Restyle deltas:**
  - `Checkbox`: `size-6 rounded-chip border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary text-primary-foreground` + focus ring. Wrap with a `Label` in usage for a 44px hit row.
  - `RadioGroupItem`: `size-6 border-input text-primary` + focus ring; indicator dot `bg-primary`.
  - `Switch`: track `h-7 w-12 rounded-pill data-[state=checked]:bg-primary data-[state=unchecked]:bg-input`; thumb `size-6` + focus ring.
- [ ] **Step 3: Gallery** — each control in a label row (`flex items-center gap-3 min-h-11`): default, checked/selected/on, disabled, disabled-checked. RadioGroup with 3 options.
- [ ] **Step 4: Screenshot gate (light+dark), space-to-toggle, arrow-nav radios. Commit** — `feat(redesign): Checkbox + RadioGroup + Switch primitives + gallery`

---

### Task 15: Calendar + DatePicker

**Files:** Create `src/components/ui/calendar.tsx` (scaffold), `src/components/ui/date-picker.tsx`, `sections/datepicker-section.tsx`; modify `page.tsx`. Requires `popover` (added here if not yet present).

**Interfaces:**
- Consumes: `Button` (Task 10), `Popover` (shadcn).
- Produces: `Calendar` (react-day-picker, restyled) and `DatePicker({ value, onChange, placeholder? })` — a Popover-anchored single-date picker.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add calendar popover` (installs `react-day-picker`, `@radix-ui/react-popover`).
- [ ] **Step 2: Restyle Calendar deltas:** day cells `rounded-pill size-10`; selected `bg-primary text-primary-foreground`; today `border border-ring`; nav buttons use our `Button` `ghost`/`icon`. Caption `font-semibold`.
- [ ] **Step 3: DatePicker**
```tsx
// src/components/ui/date-picker.tsx
'use client'
import * as React from 'react'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { Button } from './button'
import { Calendar } from './calendar'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '@/lib/utils'

export function DatePicker({
  value, onChange, placeholder = 'Pick a date',
}: { value?: Date; onChange?: (d?: Date) => void; placeholder?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('h-11 w-60 justify-start font-normal', !value && 'text-muted-foreground')}>
          <CalendarIcon />
          {value ? format(value, 'PPP') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-card p-0 shadow-soft-lg" align="start">
        <Calendar mode="single" selected={value} onSelect={onChange} initialFocus />
      </PopoverContent>
    </Popover>
  )
}
```
- [ ] **Step 4: Gallery** — a `DatePicker` (uncontrolled demo via local state) and a static open `Calendar`.
- [ ] **Step 5: Screenshot gate (light+dark), keyboard nav into calendar. Commit** — `feat(redesign): Calendar + DatePicker primitives + gallery`

---

# PART C — Display primitives

### Task 16: Card (+ Header / Body / Footer)

**Files:** Create `src/components/ui/card.tsx` (scaffold), `sections/cards-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add card`
- [ ] **Step 2: Restyle deltas:** `Card` root → `rounded-card border border-border bg-card text-card-foreground shadow-soft-md`; `CardHeader` `p-6`; `CardContent` `p-6 pt-0`; `CardFooter` `p-6 pt-0`; `CardTitle` `text-xl font-bold`; `CardDescription` `text-muted-foreground`.
- [ ] **Step 3: Gallery** — a "Today's jobs" card (title + description + two rows + a footer `Button`), and an interactive tappable card (`active:scale-[.99] hover:shadow-soft-lg transition-all`).
- [ ] **Step 4: Screenshot gate (light+dark). Commit** — `feat(redesign): Card primitive + gallery`

---

### Task 17: Badge / StatusPill

**Files:** Create `src/components/ui/badge.tsx` (scaffold), `src/components/ui/status-pill.tsx`, `sections/badges-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: `Badge` (`variant: 'default' | 'secondary' | 'outline' | 'positive' | 'caution' | 'critical' | 'info'`); `StatusPill({ status, label?, icon? })` — always pairs color with an icon + text (never color-only).

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add badge`
- [ ] **Step 2: Restyle `badgeVariants`:**
```tsx
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border text-foreground',
        positive: 'bg-positive-50 text-positive-700',
        caution: 'bg-caution-50 text-caution-700',
        critical: 'bg-critical-50 text-critical-700',
        info: 'bg-info-50 text-info-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)
```
- [ ] **Step 3: StatusPill** — maps domain statuses to `{variant, icon, label}`. Example mapping (icons from lucide): `scheduled→info/CalendarClock`, `in_progress→default/Loader2`, `completed→positive/CheckCircle2`, `cancelled→critical/XCircle`, `pending→caution/Clock`. Renders `<Badge variant={...}><Icon/>{label}</Badge>`. Always renders the label text.
- [ ] **Step 4: Gallery** — all Badge variants; all StatusPill statuses. Note in a caption that color is never the only signal.
- [ ] **Step 5: Screenshot gate (light+dark) + a quick contrast check on each tint/text pair (AA). Commit** — `feat(redesign): Badge + StatusPill primitives + gallery`

---

### Task 18: Avatar

**Files:** Create `src/components/ui/avatar.tsx` (scaffold), extend a display section; modify `page.tsx`.

**Interfaces:**
- Produces: `Avatar`, `AvatarImage`, `AvatarFallback`.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add avatar`
- [ ] **Step 2: Restyle:** root `size-11 rounded-pill`; `AvatarFallback` `bg-muted text-muted-foreground font-semibold`. Add a `size` convention via className (`size-9` / `size-11` / `size-14`).
- [ ] **Step 3: Gallery** — image avatar, initials fallback, three sizes, a small overlap stack.
- [ ] **Step 4: Screenshot gate (light+dark). Commit** — `feat(redesign): Avatar primitive + gallery`

---

### Task 19: Stat / KPI tile

**Files:** Create `src/components/ui/stat-tile.tsx`, `sections/stats-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Consumes: `Card` (Task 16).
- Produces: `StatTile({ label, value, unit?, icon?, trend?, intent? })` — value uses `tnum`; `trend` shows up/down with `positive`/`critical` color + an arrow icon (color + icon, not color alone).

- [ ] **Step 1: Component**
```tsx
// src/components/ui/stat-tile.tsx
import * as React from 'react'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { Card } from './card'
import { cn } from '@/lib/utils'

export interface StatTileProps {
  label: string
  value: string
  unit?: string
  icon?: React.ReactNode
  trend?: { direction: 'up' | 'down'; label: string }
}

export function StatTile({ label, value, unit, icon, trend }: StatTileProps) {
  const up = trend?.direction === 'up'
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground [&_svg]:size-5">{icon}</span> : null}
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-foreground tnum">
        {value}{unit ? <span className="ml-1 text-xl font-bold text-muted-foreground">{unit}</span> : null}
      </p>
      {trend ? (
        <p className={cn('mt-2 inline-flex items-center gap-1 text-sm font-semibold', up ? 'text-positive-700' : 'text-critical-700')}>
          {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
          {trend.label}
        </p>
      ) : null}
    </Card>
  )
}
```
- [ ] **Step 2: Gallery** — a 3-up grid: `$8,920.00 / Revenue this month / up 12%`, `14 / Jobs today`, `3 / In progress` with lucide icons.
- [ ] **Step 3: Screenshot gate (light+dark); confirm numerals are tabular (no column drift). Commit** — `feat(redesign): StatTile primitive + gallery`

---

### Task 20: Table / DataList

**Files:** Create `src/components/ui/table.tsx` (scaffold), `sections/table-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: shadcn `Table` family (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`). Numeric cells use `tnum`; sortable headers expose `aria-sort`.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add table`
- [ ] **Step 2: Restyle deltas:** wrap in `rounded-card border border-border overflow-hidden`; `TableHead` `text-xs uppercase tracking-[0.04em] text-muted-foreground`; rows `border-border hover:bg-muted/50`; right-align + `tnum` for amount cells.
- [ ] **Step 3: Gallery** — a 4-row jobs table (Property, Date, Status via `StatusPill`, Amount right-aligned `tnum`), one `TableHead` with a sort button + `aria-sort="ascending"` and a `ChevronUp` icon; plus a skeleton-loading variant (after Task 21) and an empty state placeholder row.
- [ ] **Step 4: Screenshot gate (light+dark). Commit** — `feat(redesign): Table primitive + gallery`

---

### Task 21: Tooltip + Separator + Skeleton + EmptyState

**Files:** Create `src/components/ui/tooltip.tsx`, `separator.tsx` (scaffold), `skeleton.tsx` (scaffold), `src/components/ui/empty-state.tsx`, `sections/feedback-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: `Tooltip` family, `Separator`, `Skeleton`, `EmptyState({ icon, title, description?, action? })`.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add tooltip separator skeleton`
- [ ] **Step 2: Restyle deltas:** Tooltip content `rounded-control bg-foreground text-background px-3 py-1.5 text-xs shadow-soft-md`; Skeleton `bg-muted rounded-control animate-pulse`; Separator `bg-border`.
- [ ] **Step 3: EmptyState**
```tsx
// src/components/ui/empty-state.tsx
import * as React from 'react'

export function EmptyState({
  icon, title, description, action,
}: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      {icon ? <div className="mb-4 text-muted-foreground [&_svg]:size-10">{icon}</div> : null}
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
```
- [ ] **Step 4: Gallery** — a Tooltip on a Button (note: hover + focus both trigger it; wrap in `TooltipProvider`), a Separator between two blocks, three Skeleton shapes, and an EmptyState ("No bookings yet" + a `Button` action).
- [ ] **Step 5: Screenshot gate (light+dark). Commit** — `feat(redesign): Tooltip + Separator + Skeleton + EmptyState primitives + gallery`

---

# PART D — Overlays

### Task 22: Dialog / Modal

**Files:** Create `src/components/ui/dialog.tsx` (scaffold), `sections/dialog-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Consumes: `Button` (Task 10).
- Produces: shadcn `Dialog` family (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`).

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add dialog` (installs `@radix-ui/react-dialog`).
- [ ] **Step 2: Restyle deltas:** overlay `bg-foreground/40 backdrop-blur-sm`; `DialogContent` `rounded-card bg-popover text-popover-foreground shadow-soft-lg p-6` (keep the generated Radix open/close `data-[state]` animation classes from tailwindcss-animate); close button = our `IconButton` style with `aria-label="Close"`.
- [ ] **Step 3: Gallery** — a trigger Button opening a dialog with title, description, a FormField, and a footer (`Cancel` ghost + `Save` primary). Mount inside the gallery (client).
- [ ] **Step 4: Screenshot gate** — open state, light + dark; verify Escape closes, focus traps inside, focus returns to trigger on close (keyboard test via Playwright `browser_press_key`). Commit — `feat(redesign): Dialog primitive + gallery`

---

### Task 23: Sheet / Drawer

**Files:** Create `src/components/ui/sheet.tsx` (scaffold), extend `dialog-section.tsx` or new `sheet-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: shadcn `Sheet` family with `side: 'top' | 'right' | 'bottom' | 'left'`.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add sheet`
- [ ] **Step 2: Restyle deltas:** content `bg-popover text-popover-foreground shadow-soft-lg`; bottom sheet gets `rounded-t-card`, side sheets `rounded-l-card`/`rounded-r-card`; keep slide animations.
- [ ] **Step 3: Gallery** — a right Sheet (filters mock) and a bottom Sheet (mobile actions mock) with triggers.
- [ ] **Step 4: Screenshot gate (light+dark), Escape + focus-trap check. Commit** — `feat(redesign): Sheet/Drawer primitive + gallery`

---

### Task 24: DropdownMenu

**Files:** Create `src/components/ui/dropdown-menu.tsx` (scaffold), `sections/menus-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: shadcn `DropdownMenu` family (trigger, content, item, checkbox-item, radio-item, label, separator, sub-menu).

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add dropdown-menu`
- [ ] **Step 2: Restyle deltas:** content `rounded-card bg-popover shadow-soft-lg p-1.5`; items `rounded-control py-2.5 text-base focus:bg-accent focus:text-accent-foreground`; destructive item `text-destructive focus:bg-critical-50`.
- [ ] **Step 3: Gallery** — an `IconButton` (MoreVertical) trigger with items (View, Edit, a separator, Delete as destructive), shown open.
- [ ] **Step 4: Screenshot gate (light+dark), arrow-key nav, Escape. Commit** — `feat(redesign): DropdownMenu primitive + gallery`

---

### Task 25: Popover

**Files:** `src/components/ui/popover.tsx` already added in Task 15. Add `sections/popover-section.tsx`; modify `page.tsx`. (If Task 15 was skipped/reordered, run `npx shadcn@latest add popover` first.)

**Interfaces:**
- Produces: `Popover`, `PopoverTrigger`, `PopoverContent`.

- [ ] **Step 1: Confirm/restyle deltas:** `PopoverContent` `rounded-card bg-popover shadow-soft-lg p-4`.
- [ ] **Step 2: Gallery** — a Button trigger opening a small form popover (a FormField + a Save Button).
- [ ] **Step 3: Screenshot gate (light+dark). Commit** — `feat(redesign): Popover gallery section`

---

### Task 26: Toast (sonner)

**Files:** Create `src/components/ui/sonner.tsx` (scaffold), mount `<Toaster>` in `(dev)/layout.tsx`, `sections/toast-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: `<Toaster>` (themed via next-themes) and the `toast()` API from `sonner`. Decision: use **sonner** (resolves the spec's open item; lighter and better DX than the legacy shadcn toast).

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add sonner` (installs `sonner`).
- [ ] **Step 2: Restyle deltas:** pass `theme` from `useTheme()`; `toastOptions.classNames` → `toast: 'rounded-card bg-popover text-popover-foreground border border-border shadow-soft-lg'`, success/error use `positive`/`critical` accents with an icon.
- [ ] **Step 3: Mount** `<Toaster richColors position="top-right" />` inside `(dev)/layout.tsx` (inside `.redesign`).
- [ ] **Step 4: Gallery** — Buttons firing `toast.success('Booking saved')`, `toast.error('Card declined')`, `toast('Heads up', { description: '...' })`. Copy must avoid em dashes.
- [ ] **Step 5: Screenshot gate (light+dark) — trigger a toast, screenshot it. Commit** — `feat(redesign): Toast (sonner) primitive + gallery`

---

### Task 27: ConfirmDialog

**Files:** Create `src/components/ui/confirm-dialog.tsx`, `sections/confirm-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Consumes: `Dialog` (Task 22), `Button` (Task 10).
- Produces: `ConfirmDialog({ open, onOpenChange, title, description?, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm })` — a controlled confirm modal; destructive variant uses the `destructive` Button.

- [ ] **Step 1: Component**
```tsx
// src/components/ui/confirm-dialog.tsx
'use client'
import * as React from 'react'
import { Button } from './button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive, loading, onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>{cancelLabel}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```
- [ ] **Step 2: Gallery** — a "Delete booking" trigger wired to local `open` state, destructive confirm, with a loading demo.
- [ ] **Step 3: Screenshot gate (light+dark). Commit** — `feat(redesign): ConfirmDialog primitive + gallery`

---

# PART E — Navigation

### Task 28: Tabs + SegmentedControl

**Files:** Create `src/components/ui/tabs.tsx` (scaffold), `src/components/ui/segmented-control.tsx`, `sections/tabs-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: shadcn `Tabs` family; `SegmentedControl({ options, value, onChange })` — a pill-track single-select toggle.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add tabs`
- [ ] **Step 2: Restyle Tabs deltas:** `TabsList` `rounded-pill bg-muted p-1`; `TabsTrigger` `rounded-pill h-9 px-4 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-soft-sm` + focus ring.
- [ ] **Step 3: SegmentedControl** (built on Radix `ToggleGroup` or a simple button row):
```tsx
// src/components/ui/segmented-control.tsx
'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

export function SegmentedControl<T extends string>({
  options, value, onChange, className,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-1 rounded-pill bg-muted p-1', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-9 rounded-pill px-4 text-sm font-semibold transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-card text-foreground shadow-soft-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
```
- [ ] **Step 4: Gallery** — a 3-tab Tabs with content panels; a SegmentedControl (Day/Week/Month) wired to local state.
- [ ] **Step 5: Screenshot gate (light+dark), arrow-key tab nav. Commit** — `feat(redesign): Tabs + SegmentedControl primitives + gallery`

---

### Task 29: Breadcrumb + Pagination

**Files:** Create `src/components/ui/breadcrumb.tsx` + `pagination.tsx` (scaffold), `sections/nav-section.tsx`; modify `page.tsx`.

**Interfaces:**
- Produces: shadcn `Breadcrumb` family and `Pagination` family.

- [ ] **Step 1: Scaffold** — `npx shadcn@latest add breadcrumb pagination`
- [ ] **Step 2: Restyle deltas:** Breadcrumb links `text-muted-foreground hover:text-foreground`, current `text-foreground font-semibold`, separator a lucide `ChevronRight`. Pagination items reuse `Button` `ghost`/`outline`, active page `bg-primary text-primary-foreground rounded-pill`, all ≥44px.
- [ ] **Step 3: Gallery** — a 3-level breadcrumb; a pagination row (Prev, 1 2 3 …, Next) with page 2 active.
- [ ] **Step 4: Screenshot gate (light+dark). Commit** — `feat(redesign): Breadcrumb + Pagination primitives + gallery`

---

# PART F — Final verification & handoff

### Task 30: Full gallery verification pass (both themes + a11y)

**Files:** none (verification + small fixes only).

- [ ] **Step 1: Full-page screenshots** — with `npm run dev` running, Playwright MCP `browser_navigate` → `/ui-kit`; `browser_take_screenshot` full-page in light, toggle, full-page in dark. Compare against the spec's feel (pillowy, warm, premium, brand blue). Note any component that reads off.
- [ ] **Step 2: Keyboard + focus sweep** — `Tab` through the whole page; confirm every interactive element shows a visible `focus-visible` ring and nothing is reachable-but-invisible. Open each overlay (Dialog, Sheet, Dropdown, Popover) via keyboard; confirm focus trap + Escape + focus restore.
- [ ] **Step 3: Contrast audit** — `browser_evaluate` a script that walks rendered text nodes inside `.redesign` and computes contrast ratio of color vs background; flag any < 4.5:1 (body) / < 3:1 (large/UI), in **both** themes. Fix offenders by retuning the relevant token (warm ramp or the lifted dark primary) per the spec's risk note.
- [ ] **Step 4: Reduced-motion check** — emulate `prefers-reduced-motion: reduce` (`browser_evaluate`/emulation), re-open an overlay; confirm animations are suppressed (no slide/zoom), state still changes.
- [ ] **Step 5: Touch-target check** — script-measure all buttons/inputs/menu items inside `.redesign`; assert min 44x44px. Fix any that fall short.
- [ ] **Step 6: Apply fixes, re-screenshot, commit**
```bash
git add -A
git commit -m "fix(redesign): a11y + contrast + touch-target sweep on /ui-kit"
```

### Task 31: Branch finalize

- [ ] **Step 1:** Run the local gates: `npx vitest run src/lib/utils.test.ts`, `npx tsc --noEmit` (no *new* errors), `npm run lint` (no *new* errors in redesign files).
- [ ] **Step 2:** Use the **superpowers:finishing-a-development-branch** skill to decide merge/PR/cleanup. Per project workflow (CLAUDE.md): this is a `feat/*` branch off `master`; before push, run the Codex pre-push review (`/codex:review --scope branch --base master --wait`), commit valid findings, then push and open a PR to `master`.
- [ ] **Step 3:** Confirm `NEXT_PUBLIC_UI_KIT_ENABLED` is **unset** in prod env so `/ui-kit` 404s for prod users (route guard, Task 8).

---

## Self-review (run after writing; fixed inline)

**1. Spec coverage** — checked each spec section against a task:
- Delivery mechanism (CSS vars, additive Tailwind, shadcn HSL convention, next-themes) → Tasks 5, 6, 7. ✓
- Color (brand/sky/warm/semantic ramps + shadcn mapping, both themes) → Tasks 5, 6 (HSL computed exactly). ✓
- Typography (Jakarta via next/font, weights, tabular nums, scale) → Tasks 4, 5; scale applied in gallery headings + components. ✓
- Shape/elevation/spacing/motion (pillowy radius, soft shadow, durations, easing, reduced-motion) → Tasks 5, 6. ✓
- Foundation & conventions (cva, cn, forwardRef, Slot, lucide, all states, 44px, ARIA) → Task 2 + Part B/C/D/E + Task 30. ✓
- Inventory: Forms (Button ✓10, IconButton ✓10, Input/Textarea ✓11, Select ✓13, Checkbox/Radio/Switch ✓14, Label ✓11, FormField ✓12, Date/Calendar ✓15); Display (Card ✓16, Badge/StatusPill ✓17, Avatar ✓18, Stat/KPI ✓19, Table/DataList ✓20, Tooltip/Separator/Skeleton/EmptyState ✓21); Overlays (Dialog ✓22, Sheet ✓23, DropdownMenu ✓24, Popover ✓25, Toast ✓26, ConfirmDialog ✓27); Navigation (Tabs/SegmentedControl ✓28, Breadcrumb/Pagination ✓29); Brand Logo ✓9. ✓
- Component standards (visible labels, role=alert errors, persistent helper, semantic input types, loading disables submit, destructive separated + ConfirmDialog, table tnum + aria-sort + empty/loading) → Tasks 11, 12, 16, 20, 27. ✓
- Preview harness (dev-only /ui-kit, guarded, grouped, light/dark toggle, warm canvas) → Task 8 + every section. ✓
- Repo layout & coexistence → File Structure table + Global Constraints + Task 6 coexistence note. ✓
- Accessibility & touch → Global Constraints + Task 30. ✓
- Verification (Playwright screenshots, light+dark, iterate; light unit checks) → per-task screenshot gates + Task 2 + Task 30. ✓

**2. Placeholder scan** — no "TBD/handle edge cases/similar to Task N"; component tasks state exact deltas/variant code, not vague directions. Where a base file comes from `shadcn add`, the plan documents the exact restyle deltas (the design-bearing part) rather than re-transcribing upstream source — a deliberate, stated convention, not a placeholder.

**3. Type consistency** — `cn` signature stable; `Button`/`ButtonProps`/`buttonVariants` reused by IconButton, DatePicker, ConfirmDialog; `Card` reused by StatTile; `Dialog` family reused by ConfirmDialog; `Popover` shared by DatePicker (Task 15) and Popover section (Task 25) with a guard note if reordered; `FormField` prop names (`label/htmlFor/helper/error/required`) consistent across usages. ✓

## Open items carried from the spec (non-blocking)
- Warm-gray ramp / blue-on-warm harmony may be retuned during Task 30's contrast pass (cheap; token-only).
- Toast library: **resolved → sonner** (Task 26).
