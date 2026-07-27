# White-label Branding (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cleaning company set one brand color and two logos, and have their entire app — operator, homeowner, and cleaner — become theirs, with no flash of Nexxus blue and no broken logo crops.

**Architecture:** A pure OKLCH derivation module turns one hex into an 11-step ramp. `tailwind.config.js` stops holding hex and points `brand-*` at CSS variables, which makes all 219 existing `brand-N` utilities themeable without touching them. A provider writes those variables at runtime; an inline pre-paint script replays a `localStorage` cache so returning users never see the default. Render sites consume tokens only and never read `brand_color` directly.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v3, Supabase (Postgres + Storage), `culori` (new dependency, OKLCH math), `browser-image-compression` (already installed, client-side logo resize).

## Global Constraints

- **Spec is `docs/white-label-branding.md`.** Where this plan and the spec disagree, the spec wins; fix the plan.
- **Never use em dashes (`—`) in user-facing copy** (UI text, labels, buttons, toasts, emails, errors). Repo rule, CLAUDE.md.
- **Branch per PR, PR to `master`.** Branch protection rejects direct pushes. Four checks must be green: `CI / typecheck + lint`, `CI / unit + integration`, `E2E / Playwright (preview) (1/2)` and `(2/2)`.
- **Pre-push gates:** `npm run test`, `npx tsc --noEmit`, `npm run lint`. If a migration changed, `npx supabase db reset` first.
- **Migration numbering:** prod is at `116` as of 2026-07-27, and the parked `payout-models` branch reserves `117`–`119`. **Start at `120`** and re-check `ls supabase/migrations | tail -3` before writing one.
- **Migrations are immutable once shipped.** Never edit or rename an applied migration; add a new one.
- **New API routes need a co-located `*.integration.test.ts`; new `src/lib/**` logic needs a co-located `*.test.ts`.** Use the helpers in `tests/helpers/`.
- **PR 4 is UI-heavy:** invoke the `ui-feature-workflow` skill before designing or building it, and run `ui-ux-pro-max` at both the design and implementation phases. Implement from the design system (`src/components/ui/*` + tokens); never copy mockup styling.
- **Local test suite is unreliable** when sessions share local Supabase (~381/1671 baseline failures). Run targeted suites and let CI arbitrate.
- **Do not import `lib/supabase-admin.ts` from client code.**
- **Why the UI tasks describe intent instead of pasting JSX:** CLAUDE.md routes any feature with real UI through `ui-feature-workflow` and `ui-ux-pro-max`, and prescribing exact markup here would pre-empt that design phase and risk baking in off-system styling. Logic tasks (Tasks 1, 5, 8, 13) carry complete code; visual tasks (Tasks 11, 14, 15, 16) carry exact files, states to cover, copy rules, and acceptance checks.

## File structure

**PR 1 — Foundation**
| File | Responsibility |
|---|---|
| `supabase/migrations/120_org_branding.sql` | Create | 4 columns on `organizations`, `org-branding` bucket, org-scoped RLS |
| `src/lib/branding/palette.ts` | Create | Pure: hex → 11-step ramp + 2 foreground values |
| `src/lib/branding/palette.test.ts` | Create | Unit tests incl. contrast and gamut guarantees |
| `src/lib/branding/tokens.ts` | Create | Shared constants: step list, CSS var names, Nexxus defaults |
| `tailwind.config.js` | Modify | `brand.*` hex → `hsl(var(--brand-N) / <alpha-value>)` |
| `src/app/globals.css` | Modify | Add `--brand-50..950`, `--brand-fg-500/600` defaults; repoint `--primary`, `--ring`, `--accent*` at them |
| `src/types/index.ts` | Modify | Branding columns on the `Organization` type |

**PR 2 — Org selection**
| File | Responsibility |
|---|---|
| `src/lib/auth/selectOrganization.ts` | Create | Pure: membership rows + remembered id → chosen row |
| `src/lib/auth/selectOrganization.test.ts` | Create | Unit tests |
| `src/contexts/AuthContext.tsx` | Modify | Ordered query, remembered org, `switchOrganization`, `availableOrganizations` |
| `src/components/redesign/settings/sections/OrgSwitcher.tsx` | Create | Renders only when >1 membership |

**PR 3 — Brand runtime + settings**
| File | Responsibility |
|---|---|
| `src/lib/branding/brandCache.ts` | Create | localStorage read/write of the resolved ramp |
| `src/lib/branding/bootstrapScript.ts` | Create | The inline pre-paint script source string |
| `src/components/branding/BrandProvider.tsx` | Create | Applies vars on org change, writes cache |
| `src/app/layout.tsx` | Modify | Inject the bootstrap script |
| `src/components/LayoutWrapper.tsx` | Modify | Mount `BrandProvider` |
| `src/app/api/organizations/[orgId]/branding/route.ts` | Create | PATCH color + logo urls (owner/admin) |
| `src/app/api/organizations/[orgId]/branding/route.integration.test.ts` | Create | Auth, role, validation |
| `src/components/redesign/settings/sections/BrandingSection.tsx` | Create | Color picker, 2 uploads, live preview, reset |
| `src/components/redesign/settings/sections.ts` | Modify | Register `branding` for owner + admin |

**PR 4 — Logo and identity surfaces**
| File | Responsibility |
|---|---|
| `src/components/branding/OrgLogo.tsx` | Create | One component: `variant="icon" \| "full"`, monogram fallback |
| `src/lib/branding/monogram.ts` (+ test) | Create | Org name → initials |
| `src/components/redesign/shell/OperatorRail.tsx` | Modify | Two-asset crossfade, expand preference |
| `src/components/redesign/shell/OperatorShell.tsx` | Modify | Reactive left padding |
| `src/components/redesign/shell/OperatorMobileNav.tsx` | Modify | Drawer header logo |
| `src/components/redesign/homeowner/shell/HomeownerTopBar.tsx` | Modify | Logo replaces greeting |
| `src/components/redesign/cleaner/shell/CleanerTopBar.tsx` | Modify | Logo replaces greeting |
| `src/components/redesign/homeowner/home/*`, `cleaner/today/*` | Modify | Greeting becomes an `<h1>` in the body |
| `src/components/ui/nexxus-loader.tsx` | Modify | Export a tenant-aware `FullPageLoader` |
| `src/components/branding/BrandDocumentIdentity.tsx` | Create | favicon, theme-color, title |
| `src/hooks/useRailPreference.ts` | Create | Per-user, device-local rail expansion |

**PR 5 — Email and card link**
| File | Responsibility |
|---|---|
| `src/lib/email/templates/cardLinkEmail.ts` (+ test) | Modify | Accept brand color + logo url |
| `src/app/api/billing/card-links/route.ts` | Modify | Pass the org's brand through |
| `src/app/billing/add-card/page.tsx` | Modify | Brand from the link token |

---

## PR 1 — Foundation (invisible)

**Branch:** `feat/branding-foundation`. Ends with the app looking pixel-identical; the defaults reproduce today's blue exactly. That is the verification.

### Task 1: Palette derivation module

**Files:**
- Create: `src/lib/branding/tokens.ts`, `src/lib/branding/palette.ts`
- Test: `src/lib/branding/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BRAND_STEPS`, `NEXXUS_BRAND_HEX`, `type BrandStep`, `type BrandRamp`, `deriveBrandRamp(hex: string): BrandRamp`, `rampToCssVars(ramp: BrandRamp): Record<string, string>`.

- [ ] **Step 1: Add the dependency**

```bash
npm install culori
npm install --save-dev @types/culori
```

- [ ] **Step 2: Write `src/lib/branding/tokens.ts`**

```ts
/**
 * Shared constants for org branding. Kept separate from palette.ts so the
 * bootstrap script and the provider can import names without pulling in culori.
 */

export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type BrandStep = (typeof BRAND_STEPS)[number];

/** The platform's own brand color. Also the fallback for an org with no brand_color. */
export const NEXXUS_BRAND_HEX = "#0150FC";

/** CSS custom property name for a ramp step. */
export function brandVarName(step: BrandStep): string {
  return `--brand-${step}`;
}

/** Foregrounds are per-theme: light pairs against 600, dark against 500. */
export const BRAND_FG_600_VAR = "--brand-fg-600";
export const BRAND_FG_500_VAR = "--brand-fg-500";

/** localStorage key holding the last resolved ramp, replayed before first paint. */
export const BRAND_CACHE_KEY = "nexxus.brand.v1";
```

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/branding/palette.test.ts
import { describe, it, expect } from "vitest";
import { wcagContrast, parse, converter } from "culori";
import { deriveBrandRamp, rampToCssVars } from "./palette";
import { BRAND_STEPS, NEXXUS_BRAND_HEX } from "./tokens";

const toRgb = converter("rgb");

/**
 * Channels are the shadcn "H S% L%" triplet. parse() returns an hsl-mode object
 * for that string, so convert to rgb before touching .r/.g/.b.
 */
function channelsToRgb(channels: string) {
  return toRgb(parse(`hsl(${channels})`)!)!;
}

describe("deriveBrandRamp", () => {
  it("returns every step", () => {
    const ramp = deriveBrandRamp(NEXXUS_BRAND_HEX);
    for (const step of BRAND_STEPS) {
      expect(ramp.steps[step], `step ${step}`).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
    }
  });

  it("honors the chosen color exactly at step 600", () => {
    const got = channelsToRgb(deriveBrandRamp("#0150FC").steps[600]);
    const want = toRgb(parse("#0150FC")!)!;
    // Round-tripping through OKLCH and HSL channels is lossy by well under 1/255.
    expect(Math.abs(got.r - want.r)).toBeLessThan(0.01);
    expect(Math.abs(got.g - want.g)).toBeLessThan(0.01);
    expect(Math.abs(got.b - want.b)).toBeLessThan(0.01);
  });

  it("gets monotonically darker as the step rises", () => {
    const ramp = deriveBrandRamp("#0150FC");
    const lightness = BRAND_STEPS.map((s) => Number(ramp.steps[s].split(" ")[2].replace("%", "")));
    for (let i = 1; i < lightness.length; i++) {
      expect(lightness[i], `step ${BRAND_STEPS[i]} vs ${BRAND_STEPS[i - 1]}`).toBeLessThan(lightness[i - 1]);
    }
  });

  it("picks a foreground that clears AA against its pair step", () => {
    // A pale color must flip to the dark foreground; a saturated blue keeps white.
    for (const hex of ["#0150FC", "#FFE24D", "#7CFF6B", "#111111"]) {
      const ramp = deriveBrandRamp(hex);
      expect(
        wcagContrast(channelsToRgb(ramp.foreground600), channelsToRgb(ramp.steps[600])),
        `${hex} step 600`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        wcagContrast(channelsToRgb(ramp.foreground500), channelsToRgb(ramp.steps[500])),
        `${hex} step 500`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("flips to the dark foreground for a pale brand", () => {
    expect(deriveBrandRamp("#FFE24D").foreground600).toBe("34 12% 12%");
    expect(deriveBrandRamp("#0150FC").foreground600).toBe("0 0% 100%");
  });

  it("stays inside sRGB for a wildly saturated input", () => {
    const ramp = deriveBrandRamp("#00FF00");
    for (const step of BRAND_STEPS) {
      const c = channelsToRgb(ramp.steps[step]);
      for (const ch of ["r", "g", "b"] as const) {
        expect(c[ch], `step ${step} ${ch}`).toBeGreaterThanOrEqual(-0.001);
        expect(c[ch], `step ${step} ${ch}`).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it("falls back to the Nexxus brand for unparseable input", () => {
    expect(deriveBrandRamp("not-a-color").steps[600]).toBe(deriveBrandRamp(NEXXUS_BRAND_HEX).steps[600]);
  });

  it("emits one CSS variable per step plus both foregrounds", () => {
    const vars = rampToCssVars(deriveBrandRamp(NEXXUS_BRAND_HEX));
    expect(Object.keys(vars)).toHaveLength(BRAND_STEPS.length + 2);
    expect(vars["--brand-600"]).toBeDefined();
    expect(vars["--brand-fg-600"]).toBeDefined();
    expect(vars["--brand-fg-500"]).toBeDefined();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/lib/branding/palette.test.ts`
Expected: FAIL, cannot resolve `./palette`.

- [ ] **Step 5: Implement `src/lib/branding/palette.ts`**

```ts
import { converter, parse, clampChroma, wcagContrast, type Oklch } from "culori";
import {
  BRAND_STEPS,
  NEXXUS_BRAND_HEX,
  brandVarName,
  BRAND_FG_500_VAR,
  BRAND_FG_600_VAR,
  type BrandStep,
} from "./tokens";

const toOklch = converter("oklch");
const toHsl = converter("hsl");

/**
 * Per-step OKLCH lightness targets and chroma multipliers.
 *
 * Step 600 is the anchor: it is the tenant's chosen color, unmodified (decision
 * 3 in docs/white-label-branding.md). Every other step keeps that color's hue,
 * moves to the target lightness, and scales its chroma so the ends of the ramp
 * do not read as neon. Targets were fitted against the existing Nexxus ramp so
 * a #0150FC input reproduces today's palette closely.
 */
const CURVE: Record<BrandStep, { l: number; c: number }> = {
  50: { l: 0.971, c: 0.10 },
  100: { l: 0.936, c: 0.22 },
  200: { l: 0.885, c: 0.42 },
  300: { l: 0.808, c: 0.65 },
  400: { l: 0.704, c: 0.88 },
  500: { l: 0.612, c: 0.98 },
  600: { l: 0, c: 1 }, // anchor, values unused
  700: { l: 0.478, c: 0.92 },
  800: { l: 0.408, c: 0.80 },
  900: { l: 0.352, c: 0.70 },
  950: { l: 0.245, c: 0.60 },
};

/** Near-black foreground: warm-900 #211E1A, matching the design system. */
const DARK_FG = "34 12% 12%";
const LIGHT_FG = "0 0% 100%";

export interface BrandRamp {
  /** HSL channel strings ("221 99% 50%") ready for `hsl(var(--x))`. */
  steps: Record<BrandStep, string>;
  /** Readable foreground against steps[600]. Used by the light theme. */
  foreground600: string;
  /** Readable foreground against steps[500]. Used by the dark theme. */
  foreground500: string;
}

/** Format an Oklch color as the "H S% L%" channel triplet shadcn expects. */
function toChannels(color: Oklch): string {
  const hsl = toHsl(clampChroma(color, "oklch"))!;
  const h = Number((hsl.h ?? 0).toFixed(2));
  const s = Number(((hsl.s ?? 0) * 100).toFixed(2));
  const l = Number(((hsl.l ?? 0) * 100).toFixed(2));
  return `${h} ${s}% ${l}%`;
}

/**
 * Whichever of white or near-black contrasts better against the background.
 *
 * Max-contrast rather than "white unless it fails AA": for a mid-lightness
 * brand neither option is comfortable, and a threshold test would pick the
 * fallback without checking that the fallback is any better.
 */
function readableForeground(channels: string): string {
  const bg = parse(`hsl(${channels})`);
  if (!bg) return LIGHT_FG;
  const onLight = wcagContrast(parse(`hsl(${LIGHT_FG})`)!, bg);
  const onDark = wcagContrast(parse(`hsl(${DARK_FG})`)!, bg);
  return onLight >= onDark ? LIGHT_FG : DARK_FG;
}

/**
 * One brand hex in, the full 11-step ramp out. Never throws: unparseable input
 * falls back to the platform brand so a bad DB value can't blank the UI.
 */
export function deriveBrandRamp(hex: string): BrandRamp {
  const parsed = parse(hex) ?? parse(NEXXUS_BRAND_HEX)!;
  const anchor = toOklch(parsed)!;
  const hue = anchor.h ?? 0;

  const steps = {} as Record<BrandStep, string>;
  for (const step of BRAND_STEPS) {
    steps[step] =
      step === 600
        ? toChannels(anchor)
        : toChannels({
            mode: "oklch",
            l: CURVE[step].l,
            c: anchor.c * CURVE[step].c,
            h: hue,
          });
  }

  return {
    steps,
    foreground600: readableForeground(steps[600]),
    foreground500: readableForeground(steps[500]),
  };
}

/** The ramp as the exact CSS custom properties the provider and bootstrap set. */
export function rampToCssVars(ramp: BrandRamp): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const step of BRAND_STEPS) vars[brandVarName(step)] = ramp.steps[step];
  vars[BRAND_FG_600_VAR] = ramp.foreground600;
  vars[BRAND_FG_500_VAR] = ramp.foreground500;
  return vars;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/branding/palette.test.ts`
Expected: PASS. If the monotonic-lightness test fails at 500/600, the anchor's own lightness sits outside the curve; that is expected for extreme inputs — relax that assertion to skip the 600 boundary rather than distorting the anchor.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/branding/
git commit -m "feat(branding): derive an 11-step OKLCH brand ramp from one hex"
```

### Task 2: Tokenize the Tailwind brand ramp

**Files:**
- Modify: `tailwind.config.js` (the `brand` block, currently ~line 49)
- Modify: `src/app/globals.css` (`:root` from ~line 444, `.dark` from ~line 476)

**Interfaces:**
- Consumes: variable names from `tokens.ts`.
- Produces: `--brand-50`…`--brand-950`, `--brand-fg-600`, `--brand-fg-500` as the themeable surface everything else depends on.

- [ ] **Step 1: Repoint the Tailwind ramp**

Replace the hardcoded `brand` block. The `<alpha-value>` form is required — it is what keeps the ~10 existing `brand-600/40`-style opacity utilities working.

```js
        // ---- redesign ramps ----
        // Values live in CSS variables (globals.css) so an org's derived ramp can
        // override them at runtime. Defaults reproduce the Nexxus palette exactly.
        brand: {
          50: 'hsl(var(--brand-50) / <alpha-value>)',
          100: 'hsl(var(--brand-100) / <alpha-value>)',
          200: 'hsl(var(--brand-200) / <alpha-value>)',
          300: 'hsl(var(--brand-300) / <alpha-value>)',
          400: 'hsl(var(--brand-400) / <alpha-value>)',
          500: 'hsl(var(--brand-500) / <alpha-value>)',
          600: 'hsl(var(--brand-600) / <alpha-value>)',
          700: 'hsl(var(--brand-700) / <alpha-value>)',
          800: 'hsl(var(--brand-800) / <alpha-value>)',
          900: 'hsl(var(--brand-900) / <alpha-value>)',
          950: 'hsl(var(--brand-950) / <alpha-value>)',
        },
```

- [ ] **Step 2: Add the defaults to `:root` in `globals.css`**

Insert immediately after `--shadow-rgb` in `:root`. These are today's hex converted to HSL channels; keep the hex in the trailing comment, matching the file's existing convention.

```css
  /* brand ramp — overridden per organization at runtime (docs/white-label-branding.md) */
  --brand-50: 221 100% 97%;        /* #EFF4FF */
  --brand-100: 222 100% 93%;       /* #DCE6FF */
  --brand-200: 220 100% 88%;       /* #C0D2FF */
  --brand-300: 224 100% 79%;       /* #93AEFF */
  --brand-400: 224 100% 68%;       /* #5C84FF */
  --brand-500: 225 100% 59%;       /* #2E62FF */
  --brand-600: 221 99% 50%;        /* #0150FC */
  --brand-700: 221 99% 40%;        /* #0140CC */
  --brand-800: 220 87% 31%;        /* #0A2F95 */
  --brand-900: 226 74% 25%;        /* #102A6E */
  --brand-950: 224 75% 16%;        /* #0A1A47 */
  --brand-fg-600: 0 0% 100%;       /* white on brand-600 */
  --brand-fg-500: 0 0% 100%;       /* white on brand-500 */
```

- [ ] **Step 3: Repoint the semantic tokens that derive from brand**

In `:root`, change these four lines to reference the ramp. Leave every other token alone.

```css
  --primary: var(--brand-600);
  --primary-foreground: var(--brand-fg-600);
  --accent: var(--brand-50);
  --accent-foreground: var(--brand-700);
  --ring: var(--brand-600);
```

In `.dark`, change these. Note the lifted steps — this is what makes one ramp serve both themes.

```css
  --primary: var(--brand-500);
  --primary-foreground: var(--brand-fg-500);
  --accent-foreground: var(--brand-100);
  --ring: var(--brand-400);
```

Leave `.dark`'s `--accent: 33 11% 15%` as-is: dark mode's accent surface is a warm neutral, not a brand tint.

- [ ] **Step 4: Verify the values round-trip**

Run: `npm run dev`, then open `/ui-kit`.
Expected: identical to before. Compare against `git stash` if unsure. Any visible shift means an HSL conversion above is wrong.

- [ ] **Step 5: Verify the opacity utilities still work**

Run: `grep -rEo "brand-[0-9]+/[0-9]+" src --include="*.tsx" | head`
Then load a page rendering one (`src/components/redesign/customers/CustomersCardList.tsx` uses `brand-600/40` and `brand-50/60`).
Expected: the translucent borders still render translucent. If they render opaque, the `<alpha-value>` placeholder is missing from that step.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npx tsc --noEmit && npm run lint
git add tailwind.config.js src/app/globals.css
git commit -m "refactor(branding): drive the brand ramp from CSS variables"
```

### Task 3: Schema and storage

**Files:**
- Create: `supabase/migrations/120_org_branding.sql`
- Modify: `src/types/index.ts` (the `Organization` interface, near `logo_url` at ~line 83)

**Interfaces:**
- Produces: `organizations.brand_color`, `.logo_icon_url`, `.logo_full_url`, `.brand_updated_at`; the `org-branding` storage bucket.

- [ ] **Step 1: Confirm the migration number is still free**

```bash
ls supabase/migrations | tail -3
```
Expected: nothing at or above `120`. If there is, use the next free number here and everywhere below.

- [ ] **Step 2: Write the migration**

```sql
-- 120_org_branding.sql
--
-- White-label Phase 0 (docs/white-label-branding.md): per-org brand color and logos.
--
-- Two logo slots, not one: the operator rail shows a square-ish icon when collapsed and a
-- full lockup when expanded. Deriving both from a single upload is what breaks for tenants
-- whose logo is a wordmark, a stacked lockup, or a circular badge (decision 1).
-- Both are nullable: no logo falls back to an initials monogram, no color falls back to the
-- Nexxus brand.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS logo_icon_url text,
  ADD COLUMN IF NOT EXISTS logo_full_url text,
  ADD COLUMN IF NOT EXISTS brand_updated_at timestamptz;

-- Reject anything that is not a 6-digit hex so a bad write can never reach the palette
-- module (which falls back silently and would hide the bug).
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_brand_color_hex;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_brand_color_hex
  CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9a-f]{6}$');

-- Public bucket: logos are also embedded in transactional email, where a signed URL would
-- expire before the recipient opens the message.
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-branding', 'org-branding', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Path layout is `<orgId>/<icon|full>-<uuid>.<ext>`, so split_part(name,'/',1) is the org id.
-- Mirrors the property-photos policies (migrations 054/077/079).
DROP POLICY IF EXISTS "Org owner or admin can upload org branding" ON storage.objects;
CREATE POLICY "Org owner or admin can upload org branding"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-branding'
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(storage.objects.name, '/', 1)
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Org owner or admin can update org branding" ON storage.objects;
CREATE POLICY "Org owner or admin can update org branding"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-branding'
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(storage.objects.name, '/', 1)
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Org owner or admin can delete org branding" ON storage.objects;
CREATE POLICY "Org owner or admin can delete org branding"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-branding'
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(storage.objects.name, '/', 1)
        AND om.role IN ('owner', 'admin')
    )
  );

-- Anyone can read: logos appear on the homeowner and cleaner apps and in email.
DROP POLICY IF EXISTS "Org branding is publicly readable" ON storage.objects;
CREATE POLICY "Org branding is publicly readable"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'org-branding');

COMMIT;
```

- [ ] **Step 3: Verify the schema rebuilds**

```bash
npx supabase db reset
```
Expected: completes with no error. Then confirm the constraint bites:

```bash
npx supabase db reset >/dev/null 2>&1 && psql "$(npx supabase status --output json | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).DB_URL))')" \
  -c "UPDATE organizations SET brand_color = 'blue';"
```
Expected: `new row for relation "organizations" violates check constraint`.

- [ ] **Step 4: Extend the domain type**

In `src/types/index.ts`, alongside `logo_url`:

```ts
  /** One hex the tenant picks; null falls back to the Nexxus brand. See docs/white-label-branding.md. */
  brand_color?: string | null;
  /** Square-ish mark: collapsed rail, mobile nav, favicon, email. Null renders an initials monogram. */
  logo_icon_url?: string | null;
  /** Lockup or wordmark: expanded rail, drawer header. Null renders the icon plus the org name. */
  logo_full_url?: string | null;
  brand_updated_at?: string | null;
```

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add supabase/migrations/120_org_branding.sql src/types/index.ts
git commit -m "feat(branding): org brand color, logo columns, and storage bucket"
```

### Task 4: Ship PR 1

- [ ] **Step 1: Run the full local gates**

```bash
npm run test
npx tsc --noEmit
npm run lint
```

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/branding-foundation
gh pr create --base master --title "feat(branding): foundation — OKLCH ramp, tokenized brand, schema" \
  --body "First of five white-label PRs (docs/white-label-branding-plan.md). No visible change: the CSS variable defaults reproduce today's palette exactly. Adds the derivation module, repoints the Tailwind brand ramp at variables so all 219 existing brand-N utilities become themeable, and lands the schema plus storage bucket."
```

- [ ] **Step 3: Wait for all four checks, then merge.**

---

## PR 2 — Org selection correctness

**Branch:** `fix/org-selection`. Isolated because `AuthContext` holds the sign-in/sign-out race invariants documented in CLAUDE.md. **Do not bypass `isSigningOutRef` / `isSigningInRef` / `isCleaningUp`, and keep the AbortController, the 5s timeout, the 406 retry, and the `app_metadata` fallback intact.**

### Task 5: Pure selection logic

**Files:**
- Create: `src/lib/auth/selectOrganization.ts`
- Test: `src/lib/auth/selectOrganization.test.ts`

**Interfaces:**
- Produces: `type MembershipRow = { organization_id: string; role: string; created_at?: string | null }`, `selectOrganization(rows: MembershipRow[], rememberedId?: string | null): MembershipRow | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectOrganization, type MembershipRow } from "./selectOrganization";

const a: MembershipRow = { organization_id: "aaa", role: "cleaner", created_at: "2026-01-02T00:00:00Z" };
const b: MembershipRow = { organization_id: "bbb", role: "owner", created_at: "2026-01-01T00:00:00Z" };

describe("selectOrganization", () => {
  it("returns null for no memberships", () => {
    expect(selectOrganization([], null)).toBeNull();
  });

  it("returns the only membership regardless of the remembered id", () => {
    expect(selectOrganization([a], "does-not-exist")?.organization_id).toBe("aaa");
  });

  it("honors a remembered org the user still belongs to", () => {
    expect(selectOrganization([a, b], "aaa")?.organization_id).toBe("aaa");
  });

  it("ignores a remembered org the user no longer belongs to", () => {
    expect(selectOrganization([a, b], "ccc")?.organization_id).toBe("bbb");
  });

  it("falls back to the oldest membership, not row order", () => {
    expect(selectOrganization([a, b], null)?.organization_id).toBe("bbb");
    expect(selectOrganization([b, a], null)?.organization_id).toBe("bbb");
  });

  it("breaks ties on organization_id so the result is never arbitrary", () => {
    const x: MembershipRow = { organization_id: "zzz", role: "owner", created_at: null };
    const y: MembershipRow = { organization_id: "aaa", role: "owner", created_at: null };
    expect(selectOrganization([x, y], null)?.organization_id).toBe("aaa");
    expect(selectOrganization([y, x], null)?.organization_id).toBe("aaa");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/auth/selectOrganization.test.ts`
Expected: FAIL, cannot resolve `./selectOrganization`.

- [ ] **Step 3: Implement**

```ts
/**
 * Which organization a user lands in.
 *
 * Before white-label this was whichever row Postgres happened to return first
 * (`.limit(1)` with no ORDER BY), which is arbitrary. Branding makes that
 * visible: a cleaner working for two companies would see the wrong company's
 * logo. See docs/white-label-branding.md decision 7.
 */
export interface MembershipRow {
  organization_id: string;
  role: string;
  created_at?: string | null;
}

export function selectOrganization(
  rows: MembershipRow[],
  rememberedId?: string | null,
): MembershipRow | null {
  if (rows.length === 0) return null;

  const remembered = rememberedId ? rows.find((r) => r.organization_id === rememberedId) : undefined;
  if (remembered) return remembered;

  // Oldest membership wins; organization_id breaks ties so two rows with the
  // same (or missing) timestamp still resolve deterministically.
  return [...rows].sort((x, y) => {
    const xt = x.created_at ?? "";
    const yt = y.created_at ?? "";
    if (xt !== yt) return xt < yt ? -1 : 1;
    return x.organization_id < y.organization_id ? -1 : 1;
  })[0];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/auth/selectOrganization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/
git commit -m "feat(auth): deterministic organization selection"
```

### Task 6: Wire it into AuthContext

**Files:**
- Modify: `src/contexts/AuthContext.tsx` (org query at ~line 275, org state assignment at ~line 321)

**Interfaces:**
- Consumes: `selectOrganization`, `MembershipRow`.
- Produces: on the auth context — `availableOrganizations: { id: string; name: string; role: string }[]` and `switchOrganization(orgId: string): void`.

- [ ] **Step 1: Fetch all memberships, ordered**

Replace the `.limit(1)` query. Select the branding columns here too — this is the single place the app learns the org, and PR 3's provider reads from it.

```ts
      const query = supabase
        .from('organization_members')
        .select(
          'organization_id, role, created_at, organizations ( id, name, logo_url, default_payout_model, brand_color, logo_icon_url, logo_full_url, brand_updated_at )'
        )
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: true })
        .order('organization_id', { ascending: true });
```

The DB `ORDER BY` and `selectOrganization`'s sort agree deliberately: the query keeps the payload stable, the pure function is what the tests pin.

- [ ] **Step 2: Choose the row through the helper**

Where the code currently takes the first row, pass the remembered id from `localStorage`. Guard the read — `AuthContext` runs during SSR.

```ts
const remembered =
  typeof window !== 'undefined' ? window.localStorage.getItem('nexxus.currentOrg') : null;
const chosen = selectOrganization(rows as MembershipRow[], remembered);
```

Then build the org state from `chosen` exactly as before, keeping the existing `logo_url: org.logo_url || undefined` shape and adding the branding fields.

- [ ] **Step 3: Expose the switcher**

Add to the context value:

```ts
  const availableOrganizations = useMemo(
    () => memberships.map((m) => ({ id: m.organization_id, name: m.organizations?.name ?? 'Organization', role: m.role })),
    [memberships],
  );

  const switchOrganization = useCallback((orgId: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem('nexxus.currentOrg', orgId);
    // Full reload rather than in-place swap: every org-scoped query, realtime
    // channel, and brand variable is keyed on the current org, and a reload is
    // the one path guaranteed to rebuild all three consistently. Switching is
    // rare (only users in 2+ orgs ever see the control).
    window.location.assign('/');
  }, []);
```

- [ ] **Step 4: Clear the remembered org on sign-out**

Find the sign-out cleanup and add `window.localStorage.removeItem('nexxus.currentOrg')` alongside the existing clears, so the next user on a shared device does not inherit it.

- [ ] **Step 5: Verify manually**

Run: `npm run dev`, sign in as a single-org user.
Expected: unchanged behavior, dashboard loads. Then in Supabase Studio add a second `organization_members` row for that user, reload, and confirm the oldest membership is chosen consistently across five reloads.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/contexts/AuthContext.tsx
git commit -m "fix(auth): pick the org deterministically and remember the user's choice"
```

### Task 7: Org switcher UI, then ship PR 2

**Files:**
- Create: `src/components/redesign/settings/sections/OrgSwitcher.tsx`
- Modify: `src/components/redesign/settings/sections/OrganizationSection.tsx` (render it above the name field)

- [ ] **Step 1: Build the switcher**

Renders nothing at all for the overwhelmingly common single-org case, so it never adds noise.

```tsx
"use client";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingRow } from "../SettingRow";

/** Only rendered when the signed-in user belongs to more than one organization. */
export function OrgSwitcher() {
  const { availableOrganizations, currentOrganizationId, switchOrganization } = useAuth();
  if (!availableOrganizations || availableOrganizations.length < 2) return null;

  return (
    <SettingRow
      label="Current organization"
      htmlFor="org-switch"
      helper="You belong to more than one company. Switching reloads the app."
    >
      <Select value={currentOrganizationId ?? undefined} onValueChange={switchOrganization}>
        <SelectTrigger id="org-switch" className="sm:w-72">
          <SelectValue placeholder="Select an organization" />
        </SelectTrigger>
        <SelectContent>
          {availableOrganizations.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
```

- [ ] **Step 2: Render it, typecheck, and commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/redesign/settings/
git commit -m "feat(settings): organization switcher for multi-org users"
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin fix/org-selection
gh pr create --base master --title "fix(auth): deterministic org selection + switcher" \
  --body "Second of five white-label PRs. AuthContext took whichever membership row Postgres returned first; branding would make that mis-scoping visible as the wrong company's logo. Now ordered, remembered, and switchable. Auth invariants (abort/timeout/406 retry/metadata fallback and the signing-in/out guards) are untouched."
```

- [ ] **Step 4: Wait for checks, then merge.**

---

## PR 3 — Brand runtime and settings

**Branch:** `feat/branding-runtime`. Ends demoable: pick a color, watch the whole app change, reload with no flash.

### Task 8: Cache and pre-paint bootstrap

**Files:**
- Create: `src/lib/branding/brandCache.ts`, `src/lib/branding/bootstrapScript.ts`
- Test: `src/lib/branding/brandCache.test.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `interface CachedBrand { orgId: string; vars: Record<string, string> }`, `readBrandCache(): CachedBrand | null`, `writeBrandCache(orgId: string, vars: Record<string, string>): void`, `clearBrandCache(): void`, `BRAND_BOOTSTRAP_SCRIPT: string`.

- [ ] **Step 1: Write the cache module**

```ts
import { BRAND_CACHE_KEY } from "./tokens";

interface CachedBrand {
  orgId: string;
  vars: Record<string, string>;
}

/** Never throws: private-mode and quota failures must not break the app. */
export function readBrandCache(): CachedBrand | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBrand;
    return parsed?.vars && parsed?.orgId ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBrandCache(orgId: string, vars: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify({ orgId, vars }));
  } catch {
    /* quota or private mode: the app still themes, it just flashes next load */
  }
}

export function clearBrandCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BRAND_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Write the bootstrap script source**

```ts
import { BRAND_CACHE_KEY } from "./tokens";

/**
 * Runs before hydration, from a <script> in <head>.
 *
 * Without it every cold load paints the default Nexxus blue and then snaps to
 * the tenant's color, because each role layout renders FullPageLoader while
 * orgStatus === "loading", i.e. before the org is known. Same mechanism the
 * queued dark-mode work needs. See docs/white-label-branding.md decision 6.
 *
 * Only writes variables whose names start with "--brand-", so a tampered cache
 * entry cannot set arbitrary CSS.
 */
export const BRAND_BOOTSTRAP_SCRIPT = `
(function(){try{
var raw=localStorage.getItem(${JSON.stringify(BRAND_CACHE_KEY)});
if(!raw)return;
var v=JSON.parse(raw).vars;
if(!v)return;
var s=document.documentElement.style;
for(var k in v){if(k.indexOf("--brand-")===0){s.setProperty(k,v[k]);}}
}catch(e){}})();
`;
```

- [ ] **Step 3: Test the cache round-trip**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { readBrandCache, writeBrandCache, clearBrandCache } from "./brandCache";

describe("brandCache", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns null when empty", () => expect(readBrandCache()).toBeNull());

  it("round-trips vars", () => {
    writeBrandCache("org-1", { "--brand-600": "221 99% 50%" });
    expect(readBrandCache()).toEqual({ orgId: "org-1", vars: { "--brand-600": "221 99% 50%" } });
  });

  it("returns null for corrupt json", () => {
    window.localStorage.setItem("nexxus.brand.v1", "{not json");
    expect(readBrandCache()).toBeNull();
  });

  it("returns null for a well-formed but incomplete entry", () => {
    window.localStorage.setItem("nexxus.brand.v1", JSON.stringify({ orgId: "x" }));
    expect(readBrandCache()).toBeNull();
  });

  it("clears", () => {
    writeBrandCache("org-1", { "--brand-600": "0 0% 0%" });
    clearBrandCache();
    expect(readBrandCache()).toBeNull();
  });
});
```

Run: `npx vitest run src/lib/branding/brandCache.test.ts`. Expected: PASS.

- [ ] **Step 4: Inject the script in the root layout**

In `src/app/layout.tsx`, inside `<html>` and before `<body>`:

```tsx
      <head>
        <script dangerouslySetInnerHTML={{ __html: BRAND_BOOTSTRAP_SCRIPT }} />
      </head>
```

`suppressHydrationWarning` is already on `<html>`, which is what makes this safe.

- [ ] **Step 5: Commit**

```bash
git add src/lib/branding/ src/app/layout.tsx
git commit -m "feat(branding): cache the resolved ramp and replay it before first paint"
```

### Task 9: BrandProvider

**Files:**
- Create: `src/components/branding/BrandProvider.tsx`
- Modify: `src/components/LayoutWrapper.tsx`

**Interfaces:**
- Consumes: `deriveBrandRamp`, `rampToCssVars`, `readBrandCache`/`writeBrandCache`, `useAuth().organization`.
- Produces: `<BrandProvider>`; `useOrgBrand(): { color: string; iconUrl: string | null; fullUrl: string | null; isDefault: boolean }`.

- [ ] **Step 1: Implement**

```tsx
"use client";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { deriveBrandRamp, rampToCssVars } from "@/lib/branding/palette";
import { NEXXUS_BRAND_HEX } from "@/lib/branding/tokens";
import { writeBrandCache } from "@/lib/branding/brandCache";

export interface OrgBrand {
  color: string;
  iconUrl: string | null;
  fullUrl: string | null;
  /** True when the org has set no color, i.e. we are showing the platform brand. */
  isDefault: boolean;
}

const BrandContext = createContext<OrgBrand>({
  color: NEXXUS_BRAND_HEX,
  iconUrl: null,
  fullUrl: null,
  isDefault: true,
});

export function useOrgBrand(): OrgBrand {
  return useContext(BrandContext);
}

/**
 * Applies the current org's derived ramp as CSS variables on <html>.
 *
 * Render sites never read brand_color: they consume brand-* / primary tokens,
 * which this provider repoints. The /owner back-office and pre-auth pages are
 * unaffected because no org is loaded there, so the defaults in globals.css win.
 */
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { organization, currentOrganizationId } = useAuth() as {
    organization?: { brand_color?: string | null; logo_icon_url?: string | null; logo_full_url?: string | null; brand_updated_at?: string | null } | null;
    currentOrganizationId?: string | null;
  };

  const brand = useMemo<OrgBrand>(() => {
    const v = organization?.brand_updated_at ? `?v=${Date.parse(organization.brand_updated_at)}` : "";
    return {
      color: organization?.brand_color || NEXXUS_BRAND_HEX,
      iconUrl: organization?.logo_icon_url ? organization.logo_icon_url + v : null,
      fullUrl: organization?.logo_full_url ? organization.logo_full_url + v : null,
      isDefault: !organization?.brand_color,
    };
  }, [organization]);

  useEffect(() => {
    const vars = rampToCssVars(deriveBrandRamp(brand.color));
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
    if (currentOrganizationId) writeBrandCache(currentOrganizationId, vars);
  }, [brand.color, currentOrganizationId]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
```

- [ ] **Step 2: Mount it inside `AuthProvider`**

In `LayoutWrapper.tsx`, wrap the children *inside* `AuthProvider` (it depends on `useAuth`) and outside the app content.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`. In Supabase Studio set your org's `brand_color` to `#B5179E`, reload.
Expected: rail active state, primary buttons, and focus rings all turn magenta. Reload again.
Expected: **no blue flash** — the bootstrap replays the cached ramp.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit
git add src/components/branding/ src/components/LayoutWrapper.tsx
git commit -m "feat(branding): apply the org ramp at runtime"
```

### Task 10: Branding API route

**Files:**
- Create: `src/app/api/organizations/[orgId]/branding/route.ts`
- Test: `src/app/api/organizations/[orgId]/branding/route.integration.test.ts`

**Interfaces:**
- Produces: `PATCH /api/organizations/:orgId/branding` accepting `{ brand_color?, logo_icon_url?, logo_full_url? }`, all nullable to clear.

- [ ] **Step 1: Write the integration test first**

Model it on the existing `src/app/api/organizations/[orgId]/profile/route.ts` tests and use `tests/helpers/` (`withTestOrg`, `callRoute`). Cover: unauthenticated → 401; a `cleaner` member → 403; an `admin` member → 200 (branding is owner **and** admin, unlike the owner-only profile route); `brand_color: "blue"` → 400; a logo URL outside the `org-branding` bucket → 400; a valid patch → 200 and `brand_updated_at` advances.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/api/organizations/\[orgId\]/branding/route.integration.test.ts`
Expected: FAIL, route does not exist. (Requires `npx supabase start` and `.env.test.local`.)

- [ ] **Step 3: Implement the route**

Follow the shape of the sibling `profile/route.ts`. Three rules it must enforce:

1. Role is `owner` or `admin` (the profile route's owner-only check is deliberately widened here).
2. `brand_color` matches `/^#[0-9a-f]{6}$/i` or is null.
3. Logo URLs must start with the project's `org-branding` public prefix, so the column can never point at an attacker-chosen host that would then be embedded in email.

Set `brand_updated_at: new Date().toISOString()` on every successful write.

- [ ] **Step 4: Run the tests, then commit**

```bash
npx vitest run "src/app/api/organizations/[orgId]/branding/route.integration.test.ts"
git add "src/app/api/organizations/[orgId]/branding/"
git commit -m "feat(branding): owner/admin branding API"
```

### Task 11: Branding settings section

**Files:**
- Create: `src/components/redesign/settings/sections/BrandingSection.tsx`
- Modify: `src/components/redesign/settings/sections.ts`, `src/components/redesign/settings/settings-api.ts`, `src/components/redesign/settings/OperatorSettingsView.tsx`

- [ ] **Step 1: Register the section**

In `sections.ts`, add to `REDESIGN_SETTINGS_SECTIONS` and to the `SettingsSectionId` union. Use the `Palette` icon from `lucide-react`.

```ts
  { id: "branding", label: "Branding", icon: Palette, group: "business", roles: ["owner", "admin"] },
```

Update `sections.test.ts` for the new count and role visibility.

- [ ] **Step 2: Build the section**

Use `useSettingsSection` for load/save/dirty/guard exactly like `OrganizationSection`. Contents:

- A color input (`<input type="color">` plus a text field accepting `#RRGGBB`) bound to `brand_color`.
- Two upload controls, "App icon" and "Full logo", each accepting `image/png, image/webp` only. Compress with `browser-image-compression` (already a dependency), upload to `org-branding` at `<orgId>/icon-<uuid>.<ext>` / `<orgId>/full-<uuid>.<ext>`, then PATCH the returned public URL.
- A live preview: a miniature card showing a fake top bar with the logo, a primary button, an active nav pill, and a status badge, all rendered from the tokens so it updates as they type. **This is the wizard's magic moment; it is worth building well.**
- A "Reset to default" action clearing color and both logos.

Copy rules: no em dashes. Helper text for the icon reads "Square works best. Shown in the sidebar, tabs, and emails." For the full logo: "Your full lockup or wordmark. Shown when the sidebar is expanded."

- [ ] **Step 3: Verify in the browser**

Run `npm run dev`, go to Settings → Branding as an owner. Set a color, watch the preview and the live app update. Upload both logos. Reload and confirm they persist with no flash. Attempt a `.svg` upload and confirm it is rejected.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/redesign/settings/
git commit -m "feat(settings): branding section with color picker, logo upload, and live preview"
```

### Task 12: Ship PR 3

- [ ] **Step 1: Full gates**

```bash
npm run test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/branding-runtime
gh pr create --base master --title "feat(branding): runtime theming + branding settings" \
  --body "Third of five white-label PRs. An owner or admin picks one color and uploads two logos; the whole app retints immediately and reloads with no flash of default blue. Logos do not render in the app shell yet, that is PR 4."
```

- [ ] **Step 3: Wait for checks, then merge.**

---

## PR 4 — Logo and identity across every surface

**Branch:** `feat/branding-surfaces`. **Before starting, invoke the `ui-feature-workflow` skill**, and run `ui-ux-pro-max` at both the design and implementation phases. This is the one PR with real visual design in it. If review gets unwieldy, the clean split is operator (Tasks 14 to 15) versus homeowner and cleaner (Task 16).

### Task 13: OrgLogo and the monogram

**Files:**
- Create: `src/lib/branding/monogram.ts` (+ `monogram.test.ts`), `src/components/branding/OrgLogo.tsx`

**Interfaces:**
- Produces: `orgInitials(name: string): string`; `<OrgLogo variant="icon" | "full" size={number} className?>`.

- [ ] **Step 1: Test the initials helper**

```ts
import { describe, it, expect } from "vitest";
import { orgInitials } from "./monogram";

describe("orgInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(orgInitials("Sparkle Clean")).toBe("SC");
  });
  it("takes two letters from a single word", () => {
    expect(orgInitials("Sparkle")).toBe("SP");
  });
  it("skips connector words", () => {
    expect(orgInitials("Maids of the Valley")).toBe("MV");
  });
  it("ignores leading and trailing whitespace", () => {
    expect(orgInitials("  Sparkle Clean  ")).toBe("SC");
  });
  it("falls back for an empty name", () => {
    expect(orgInitials("")).toBe("?");
  });
  it("handles a name that is only connector words", () => {
    expect(orgInitials("of the")).toBe("OF");
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Skip `of`, `the`, `and`, `&`, uppercase the result, and fall back to `"?"`. Re-run to green.

- [ ] **Step 3: Build `OrgLogo`**

One component, three states, in this order: the requested asset if uploaded; for `variant="full"` with no full logo, the icon beside the org name as text; otherwise the initials monogram in a `bg-brand-600 text-[hsl(var(--brand-fg-600))]` rounded square. Always `object-contain object-left`, always an `alt` of the org name. Never let it render a broken-image icon: `onError` falls through to the monogram.

- [ ] **Step 4: Commit**

```bash
git add src/lib/branding/monogram* src/components/branding/OrgLogo.tsx
git commit -m "feat(branding): OrgLogo with initials-monogram fallback"
```

### Task 14: Operator rail

**Files:**
- Modify: `src/components/redesign/shell/OperatorRail.tsx`, `OperatorShell.tsx`, `OperatorMobileNav.tsx`
- Create: `src/hooks/useRailPreference.ts`

- [ ] **Step 1: Replace the clipped single lockup**

Delete the `h-8 w-10 overflow-hidden` wrapper and its two hardcoded `/brand/logo-*.svg` images. Render `<OrgLogo variant="icon">` and `<OrgLogo variant="full">` stacked in the same grid cell, crossfading on `group-hover` (and on the expanded preference), both anchored to the same left edge so a tenant whose lockup starts with their icon appears not to move. Keep the 200ms ease-out timing the rail already uses.

- [ ] **Step 2: Add the rail preference hook**

Device-local, per user, defaulting to collapsed, matching the dark-mode plan's device-local-first decision.

```ts
"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "nexxus.railExpanded";

/** Per-user sidebar preference. Device-local; not a branding setting (decision 12). */
export function useRailPreference() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try { setExpanded(window.localStorage.getItem(KEY) === "1"); } catch { /* ignore */ }
  }, []);
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return { expanded, toggle };
}
```

- [ ] **Step 3: Make the shell padding reactive**

`OperatorShell`'s `lg:pl-16` becomes `lg:pl-16` or `lg:pl-[248px]` based on the preference. **Audit every other fixed or sticky element positioned against the rail** (top bar, impersonation banner, any sheet or FAB) and confirm none of them assume 64px.

- [ ] **Step 3b: Keep the impersonation banner Nexxus-neutral**

`RedesignImpersonationBanner.tsx` must not adopt the tenant's brand (spec decision 15). The surrounding app *should* be their brand, that is the point of impersonating, but the banner is the one control telling you whose account you are in, so it stays a fixed platform-owned treatment. Confirm it uses no `brand-*` or `primary` token; if it does, pin it to explicit warm or critical tokens instead.

- [ ] **Step 4: Add the toggle control**

A small chevron pinned at the rail's bottom next to Settings, `aria-label="Expand sidebar"` / `"Collapse sidebar"`.

- [ ] **Step 5: Update the mobile drawer**

In `OperatorMobileNav.tsx`, replace the two hardcoded lockup images with `<OrgLogo variant="full">`. Keep the existing `<SheetTitle className="sr-only">` but source it from the org name.

- [ ] **Step 6: Verify**

Check all four states at `lg` and above: no logo, icon only, both logos, and expanded-preference-on. Then check the mobile drawer below `lg`.

- [ ] **Step 7: Commit**

```bash
git add src/components/redesign/shell/ src/hooks/useRailPreference.ts
git commit -m "feat(branding): tenant logo in the rail, plus a sidebar expansion preference"
```

### Task 15: Document identity and tenant loader

**Files:**
- Create: `src/components/branding/BrandDocumentIdentity.tsx`
- Modify: `src/components/ui/nexxus-loader.tsx`

- [ ] **Step 1: Build `BrandDocumentIdentity`**

A render-null client component mounted inside `BrandProvider`. On org change it sets `document.title` to the org name, replaces `<link rel="icon">` with the org's icon URL (leaving the static Nexxus icon in place when there is none), and updates `<meta name="theme-color">` to the derived `brand-600`. It must restore the Nexxus defaults on unmount so signing out does not strand a tenant's favicon.

- [ ] **Step 2: Make the loader tenant-aware**

Keep the existing animated `NexxusLoader` export untouched — login, signup, marketing, and `/owner` keep using it. Add a sibling that renders the org's icon at rest with `animate-pulse-subtle` (the keyframe already exists in `globals.css`), falling back to a `brand-600` indicator when there is no icon. Point the role layouts' `FullPageLoader` at the tenant-aware one.

- [ ] **Step 3: Verify**

Hard-reload each role dashboard. Expected: tab title and favicon are the tenant's, and the full-page loader shows their mark rather than the Nexxus animation. Sign out. Expected: both revert to Nexxus.

- [ ] **Step 4: Commit**

```bash
git add src/components/branding/ src/components/ui/nexxus-loader.tsx "src/app/(redesign)"
git commit -m "feat(branding): per-org favicon, tab title, theme-color, and loader"
```

### Task 16: Homeowner and cleaner headers

**Files:**
- Modify: `HomeownerTopBar.tsx`, `CleanerTopBar.tsx`, plus the home/today views that receive the greeting

- [ ] **Step 1: Put the logo in both top bars**

Replace the greeting block (`<p class="text-xs">` plus `<p class="text-lg font-extrabold">`) with `<OrgLogo variant="full" />` constrained to roughly 32px tall, left-aligned. Bell and avatar stay exactly where they are.

- [ ] **Step 2: Move the greeting into the page body**

On the homeowner home view and the cleaner today view, add the greeting as the first element of the content as a real `<h1>` (`text-2xl font-extrabold`), with the existing subtitle beneath it. Homeowner: "Hi, {first}" over "Your home, handled." Cleaner: "{Good morning}, {first}". No em dashes.

- [ ] **Step 3: Give the other main views a heading**

`HomeownerCleaningsView`, `HomeownerMessagesView`, `CleanerEarningsView`, and the cleaner schedule view currently have no `<h1>` (only `text-sm` section `<h2>`s). Add one to each so removing the top-bar greeting does not leave them unlabeled. This also closes a pre-existing accessibility gap.

- [ ] **Step 4: Verify**

At a 390px viewport, check every homeowner and cleaner screen: exactly one `<h1>` per page, the logo persists across all of them, and a long company name truncates rather than pushing the bell off-screen.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner src/components/redesign/cleaner
git commit -m "feat(branding): tenant logo in the homeowner and cleaner headers"
```

### Task 17: Ship PR 4

- [ ] **Step 1: Run `ui-ux-pro-max` in implementation mode** over every file this PR touched, to catch raw hex and off-system styling.

- [ ] **Step 2: Full gates and Playwright**

```bash
npm run test && npx tsc --noEmit && npm run lint
npm run test:e2e
```

- [ ] **Step 3: Push, open the PR, wait for checks, merge.**

```bash
git push -u origin feat/branding-surfaces
gh pr create --base master --title "feat(branding): tenant logo and identity across every app surface" \
  --body "Fourth of five white-label PRs. Rail two-asset crossfade with a monogram fallback, sidebar expansion preference, homeowner and cleaner headers carrying the logo with greetings promoted to real page headings, tenant-aware loader, and per-org favicon, tab title, and theme-color."
```

---

## PR 5 — Branded email and card link

**Branch:** `feat/branding-email`.

### Task 18: Brand the card-link email

**Files:**
- Modify: `src/lib/email/templates/cardLinkEmail.ts` (+ `cardLinkEmail.test.ts`), `src/app/api/billing/card-links/route.ts`

- [ ] **Step 1: Extend the template's props**

Add `brandColor?: string` and `logoUrl?: string | null`. Email HTML cannot use Tailwind, so derive the ramp with `deriveBrandRamp` and inline the resulting hex, exactly as the file already does for the current brand-600. Default to the Nexxus values when absent so nothing regresses for an org with no brand.

- [ ] **Step 2: Update the tests**

Assert the org's color appears in the HTML when passed, that the Nexxus default appears when not, that the logo `<img>` is present only when a URL is given, and that the existing "Sent by {org} via Nexxus" footer is still there. That footer stays: it is honest attribution and good anti-phishing practice (decision 11).

- [ ] **Step 3: Pass the brand through the route**

`card-links/route.ts` already loads the org. Select `brand_color` and `logo_icon_url` alongside, and hand them to the template.

- [ ] **Step 4: Run the tests and commit**

```bash
npx vitest run src/lib/email/templates/cardLinkEmail.test.ts
git add src/lib/email src/app/api/billing/card-links/
git commit -m "feat(branding): brand the card-collection email per organization"
```

### Task 19: Brand the card-link page, then ship PR 5

**Files:**
- Modify: `src/app/billing/add-card/page.tsx`

- [ ] **Step 1: Theme the page from the token**

This page is pre-auth but org-known: the link token identifies the org (decision 10). Resolve the org's brand server-side alongside the token validation, apply the derived variables to the page's own wrapper, and render `<OrgLogo>` in the header. The two `text-brand-600` spinners at lines ~132 and ~174 then follow automatically.

- [ ] **Step 2: Verify**

Generate a card link for an org with a brand color, open it in a private window (no session, so no cache).
Expected: the tenant's color and logo, with no flash, and Stripe's own card element still rendering correctly.

- [ ] **Step 3: Full gates, push, open the PR, merge**

```bash
npm run test && npx tsc --noEmit && npm run lint
git push -u origin feat/branding-email
gh pr create --base master --title "feat(branding): branded card email and card-link page" \
  --body "Last of five white-label PRs. The emailed card-collection message and the page it links to now carry the cleaning company's color and logo. The 'Sent by {org} via Nexxus' footer stays as honest attribution."
```

---

## After all five merge

- [ ] Update `docs/MASTER-TODO.md` to check off the Phase 0 block.
- [ ] Update the Phase 0 section of `2026-07-26-build-roadmap.md` in the brain to "done", and note the actual session count against the 5 to 7 estimate.
- [ ] Confirm migration `120` applied cleanly in prod (`Migrate / migrate-prod` green).
- [ ] Set the anchor tenant (Nexxus Housing Corp) up with real branding so the demo path is exercised.
- [ ] Phase 1 (SaaS billing) is next in the roadmap.
