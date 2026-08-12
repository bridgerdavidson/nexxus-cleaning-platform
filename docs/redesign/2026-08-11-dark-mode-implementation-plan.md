# Dark Mode Implementation Plan (single PR: `feat/dark-mode`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-user dark mode (3-way Light/Dark/System) with per-theme org logo assets, in one PR.

**Architecture:** The theme infra (next-themes, `darkMode:['class']`, full `.dark` token set, provider wrapping the live app) already exists; work is (a) token-retrofit of a small live surface, (b) a dark-logo pipeline threaded through the existing white-label branding stack (migration → PATCH route → BrandProvider/cache → OrgLogo/loader → BrandingSection), and (c) a segmented theme control in each role's settings. Logo theme resolution is CSS-level (`dark:hidden` / `hidden dark:block` dual imgs) so it is hydration-safe and pre-paint-correct.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v3, next-themes v0.4.6, Supabase (Postgres + Storage), Vitest 3, Playwright.

**Spec:** `docs/redesign/2026-07-16-dark-mode-plan.md` (design finalized 2026-08-11).

## Global Constraints

- No em dashes in ANY user-facing copy (labels, helpers, toasts). Use periods/commas/"to".
- Migrations: create ONLY via `npx supabase migration new <name>` (timestamped); idempotent (`IF NOT EXISTS`); never renumber/move after push.
- Auth screens and marketing stay light by design. Do not touch `src/app/(marketing)/**` or `AuthShell`.
- The `/billing/add-card` public page stays light (no ThemeProvider in scope) - document, don't fix.
- Do not touch dead legacy screens; the live legacy list is ONLY the files named in Task 8.
- `src/components/redesign/cleaner/today/CleanerTodayView.tsx:167` white pill is a deliberate theme-invariant fill (white-label decision). Do NOT "fix" it.
- Lightbox chrome (`JobPhotoLightbox`, `MessageAttachmentsLightbox`) is theme-stable on purpose (`globals.css:598-615`). Do not invert.
- Integration tests need `npx supabase start` running + `.env.test.local`. If Docker is unavailable locally, still write the tests; CI arbitrates (note it in the commit).
- Conventional commits (`feat(scope):` etc.). Commit after each task.
- Path alias `@/*` → `./src/*`.
- Full local `npm run test` is unreliable (shared local Supabase); run targeted suites.

## File Structure (new files)

- `supabase/migrations/<ts>_org_branding_dark_logos.sql` - two nullable columns.
- `src/lib/branding/logoPair.ts` + `logoPair.test.ts` - pure light/dark URL pair resolution.
- `src/components/ui/theme-segmented.tsx` - 3-way Light/Dark/System control (design-system primitive).
- `src/components/redesign/shared/ThemePreferenceRow.tsx` - card row wrapping ThemeSegmented for homeowner/cleaner homes.

Everything else modifies existing files listed per task.

---

### Task 1: Migration + Organization type

**Files:**
- Create: `supabase/migrations/<timestamp>_org_branding_dark_logos.sql` (via CLI)
- Modify: `src/types/index.ts` (Organization interface)

**Interfaces:**
- Produces: columns `organizations.logo_icon_dark_url text | null`, `organizations.logo_full_dark_url text | null`; same fields on the `Organization` TS type. All later tasks rely on these exact names.

- [ ] **Step 1: Create the migration**

```bash
npx supabase migration new org_branding_dark_logos
```

Write into the generated file:

```sql
-- Dark-mode logo variants for white-label org branding.
-- Optional per-asset: dark slots fall back to the light asset at render time.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_icon_dark_url text,
  ADD COLUMN IF NOT EXISTS logo_full_dark_url text;
```

- [ ] **Step 2: Rebuild local schema and verify**

Run: `npx supabase db reset` (requires Docker + `npx supabase start` done once).
Expected: reset completes; `psql` or studio shows both columns. If Docker is unavailable, note it and rely on CI's migrate job semantics later; do not hand-edit anything under `supabase/migrations/` older than this file.

- [ ] **Step 3: Add fields to the Organization type**

In `src/types/index.ts`, find the `Organization` interface (search `logo_icon_url`) and add below the existing pair:

```ts
  logo_icon_dark_url?: string | null;
  logo_full_dark_url?: string | null;
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit` (no NEW errors; pre-existing ones stay).

```bash
git add supabase/migrations src/types/index.ts
git commit -m "feat(branding): add dark-mode logo columns to organizations"
```

---

### Task 2: Branding PATCH route accepts dark logo fields (TDD)

**Files:**
- Modify: `src/app/api/organizations/[orgId]/branding/route.ts` (body type L34-39, pinning loop field list, `touchesBrandAssets` L116-119)
- Test: `src/app/api/organizations/[orgId]/branding/route.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: PATCH body accepts `logo_icon_dark_url?: string | null` and `logo_full_dark_url?: string | null` with identical pinning/clearing semantics to the light fields; both stamp `brand_updated_at`.

Key existing facts: `bucketPrefix` = `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-branding/${orgId}/` (route L72). `filenameRe = /^(?:icon|full)-[A-Za-z0-9-]+\.(?:png|webp)$/` (L77) **already matches** `icon-dark-<uuid>.png` because `-` is in the charset - no regex change. The route does not enforce slot-to-field pairing for the light fields; keep that behavior for dark fields (consistency).

- [ ] **Step 1: Write failing integration tests**

Add to the existing describe block in `route.integration.test.ts`, following its existing patterns (it defines `BUCKET_PREFIX` at L9 and uses `withTestOrg`/`callRoute` helpers):

```ts
it('accepts and pins dark logo URLs and stamps brand_updated_at', async () => {
  await withTestOrg(async ({ orgId, ownerToken, supabase }) => {
    const icon = `${BUCKET_PREFIX}${orgId}/icon-dark-abc123.png`;
    const full = `${BUCKET_PREFIX}${orgId}/full-dark-def456.webp`;
    const res = await callRoute(PATCH, `/api/organizations/${orgId}/branding`, {
      method: 'PATCH', token: ownerToken,
      body: { logo_icon_dark_url: icon, logo_full_dark_url: full },
    }, { orgId });
    expect(res.status).toBe(200);
    const { data } = await supabase.from('organizations')
      .select('logo_icon_dark_url, logo_full_dark_url, brand_updated_at').eq('id', orgId).single();
    expect(data!.logo_icon_dark_url).toBe(icon);
    expect(data!.logo_full_dark_url).toBe(full);
    expect(data!.brand_updated_at).not.toBeNull();
  });
});

it('rejects a dark logo URL outside the org-branding bucket', async () => {
  await withTestOrg(async ({ orgId, ownerToken }) => {
    const res = await callRoute(PATCH, `/api/organizations/${orgId}/branding`, {
      method: 'PATCH', token: ownerToken,
      body: { logo_icon_dark_url: 'https://evil.example/icon-dark-x.png' },
    }, { orgId });
    expect(res.status).toBe(400);
  });
});

it('clears dark logo URLs with null', async () => {
  await withTestOrg(async ({ orgId, ownerToken, supabase }) => {
    // seed a value first via direct update, then clear through the route
    await supabase.from('organizations')
      .update({ logo_icon_dark_url: `${BUCKET_PREFIX}${orgId}/icon-dark-seed.png` }).eq('id', orgId);
    const res = await callRoute(PATCH, `/api/organizations/${orgId}/branding`, {
      method: 'PATCH', token: ownerToken, body: { logo_icon_dark_url: null },
    }, { orgId });
    expect(res.status).toBe(200);
    const { data } = await supabase.from('organizations').select('logo_icon_dark_url').eq('id', orgId).single();
    expect(data!.logo_icon_dark_url).toBeNull();
  });
});
```

Adjust helper call shapes to match the file's existing tests EXACTLY (copy a neighboring test's invocation form; the file is the source of truth for `callRoute`/`withTestOrg` signatures).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:integration -- branding`
Expected: new tests FAIL (route ignores the fields → columns stay null / status differs).

- [ ] **Step 3: Implement**

In `route.ts`:
1. Body type (L34-39): add `logo_icon_dark_url?: string | null; logo_full_dark_url?: string | null;`
2. The logo-pinning loop iterates the logo field names (L86-106 region): extend the field list from `['logo_icon_url', 'logo_full_url']` to include `'logo_icon_dark_url', 'logo_full_dark_url'` (match however the file enumerates them; keep one shared `filenameRe`).
3. `touchesBrandAssets` (L116): add both new field names to the array.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:integration -- branding`
Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/organizations/[orgId]/branding/
git commit -m "feat(branding): accept dark logo URLs in branding PATCH"
```

---

### Task 3: brandCache carries iconDarkUrl (TDD)

**Files:**
- Modify: `src/lib/branding/brandCache.ts`
- Test: `src/lib/branding/brandCache.test.ts`

**Interfaces:**
- Produces:
  - `CachedBrand` gains `iconDarkUrl?: string | null`.
  - `writeBrandCache(orgId: string, vars: Record<string, string>, iconUrl?: string | null, iconDarkUrl?: string | null): void`
  - `readCachedIconUrls(): { iconUrl: string | null; iconDarkUrl: string | null }` - replaces `readCachedIconUrl()` (only caller is `TenantFullPageLoader`, updated in Task 5). Returns `{ iconUrl: null, iconDarkUrl: null }` when cache missing/org-mismatched.
- Backward compat: entries written before this change (no `iconDarkUrl` key) must still read as valid (duck-check at L18 is `parsed?.vars && parsed?.orgId` - unchanged).

- [ ] **Step 1: Write failing tests** (extend `brandCache.test.ts`, following its existing localStorage-mocking pattern)

```ts
it('round-trips iconDarkUrl', () => {
  writeBrandCache('org-1', { '--brand-500': '1 2% 3%' }, 'https://x/icon.png', 'https://x/icon-dark.png');
  expect(readBrandCache()).toMatchObject({ orgId: 'org-1', iconUrl: 'https://x/icon.png', iconDarkUrl: 'https://x/icon-dark.png' });
});

it('readCachedIconUrls returns both, null dark when absent (old cache entry)', () => {
  window.localStorage.setItem('nexxus.brand.v1', JSON.stringify({ orgId: 'org-1', vars: { a: 'b' }, iconUrl: 'https://x/i.png' }));
  window.localStorage.setItem('nexxus.currentOrg', 'org-1');
  expect(readCachedIconUrls()).toEqual({ iconUrl: 'https://x/i.png', iconDarkUrl: null });
});

it('readCachedIconUrls nulls both on org mismatch', () => {
  writeBrandCache('org-1', { a: 'b' }, 'https://x/i.png', 'https://x/d.png');
  window.localStorage.setItem('nexxus.currentOrg', 'org-2');
  expect(readCachedIconUrls()).toEqual({ iconUrl: null, iconDarkUrl: null });
});
```

- [ ] **Step 2: Run to verify failure** - `npm run test:unit -- brandCache` → FAIL (missing export / missing field).

- [ ] **Step 3: Implement** - add the field to `CachedBrand`; add the 4th param to `writeBrandCache` writing `iconDarkUrl: iconDarkUrl ?? null`; implement `readCachedIconUrls()` with the same remembered-org guard as the old `readCachedIconUrl` (L29-38), and delete `readCachedIconUrl` (update its one import site in the same commit - `TenantFullPageLoader.tsx` gets fully reworked in Task 5, but keep it compiling now with `readCachedIconUrls().iconUrl`).

- [ ] **Step 4: Run to verify pass** - `npm run test:unit -- brandCache` → PASS. Also `npm run test:unit -- bootstrapScript` (bootstrap only replays vars; must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/branding/brandCache.ts src/lib/branding/brandCache.test.ts src/components/branding/TenantFullPageLoader.tsx
git commit -m "feat(branding): cache dark icon URL for cold-load loader"
```

---

### Task 4: BrandProvider + OrgBrand expose dark URLs

**Files:**
- Modify: `src/components/branding/BrandProvider.tsx`
- Modify: `src/contexts/AuthContext.tsx` (org select lists at ~L299 and ~L980: add `logo_icon_dark_url, logo_full_dark_url`)

**Interfaces:**
- Consumes: Task 1 columns, Task 3 `writeBrandCache` 4-arg signature.
- Produces: `OrgBrand` (L20-30) gains `iconDarkUrl: string | null; fullDarkUrl: string | null;` - cache-busted exactly like the light pair. `DEFAULT_BRAND` gains both as `null`. All `useOrgBrand()` consumers may rely on these fields existing.

- [ ] **Step 1: Extend the interface, DEFAULT_BRAND, and `toBrand()`** (L63-72):

```ts
iconDarkUrl: row?.logo_icon_dark_url ? row.logo_icon_dark_url + v : null,
fullDarkUrl: row?.logo_full_dark_url ? row.logo_full_dark_url + v : null,
```

- [ ] **Step 2: Widen the two data sources**
  - Impersonation fetch (L116-123): add both columns to the `.select(...)` string.
  - `AuthContext.tsx` org selects (~L299 and ~L980 `refreshOrganization`): add both columns.

- [ ] **Step 3: Write-through the cache** - at L197, `writeBrandCache(currentOrganizationId, vars, brand.iconUrl)` becomes `writeBrandCache(currentOrganizationId, vars, brand.iconUrl, brand.iconDarkUrl)`.

- [ ] **Step 4: Verify** - `npx tsc --noEmit` (no new errors); `npm run test:unit -- branding` stays green.

- [ ] **Step 5: Commit**

```bash
git add src/components/branding/BrandProvider.tsx src/contexts/AuthContext.tsx
git commit -m "feat(branding): expose dark logo URLs through useOrgBrand"
```

---

### Task 5: logoPair helper + OrgLogo dual-img + loader (TDD on helper)

**Files:**
- Create: `src/lib/branding/logoPair.ts`, `src/lib/branding/logoPair.test.ts`
- Modify: `src/components/branding/OrgLogo.tsx`, `src/components/branding/TenantFullPageLoader.tsx`

**Interfaces:**
- Consumes: Task 4 `OrgBrand.iconDarkUrl/fullDarkUrl`, Task 3 `readCachedIconUrls`.
- Produces:

```ts
// src/lib/branding/logoPair.ts
export interface LogoPair { light: string | null; dark: string | null; distinct: boolean }
/** dark falls back to light per-asset; distinct=true only when a separate dark render is needed */
export function resolveLogoPair(lightUrl: string | null, darkUrl: string | null): LogoPair
```

Semantics: `light = lightUrl ?? null`; `dark = darkUrl ?? lightUrl ?? null`; `distinct = !!darkUrl && !!lightUrl && darkUrl !== lightUrl` (also `distinct = true` when `darkUrl` exists and `lightUrl` is null - then light rendering falls back to monogram but dark shows the dark asset; decide: `distinct = !!darkUrl && darkUrl !== lightUrl`).

- [ ] **Step 1: Write failing tests**

```ts
import { resolveLogoPair } from './logoPair';

it('falls back dark to light', () => {
  expect(resolveLogoPair('L', null)).toEqual({ light: 'L', dark: 'L', distinct: false });
});
it('distinct when both differ', () => {
  expect(resolveLogoPair('L', 'D')).toEqual({ light: 'L', dark: 'D', distinct: true });
});
it('dark-only still renders dark', () => {
  expect(resolveLogoPair(null, 'D')).toEqual({ light: null, dark: 'D', distinct: true });
});
it('both null', () => {
  expect(resolveLogoPair(null, null)).toEqual({ light: null, dark: null, distinct: false });
});
it('identical URLs are not distinct', () => {
  expect(resolveLogoPair('L', 'L')).toEqual({ light: 'L', dark: 'L', distinct: false });
});
```

- [ ] **Step 2: Verify fail** - `npm run test:unit -- logoPair` → FAIL (module missing).

- [ ] **Step 3: Implement helper** (pure, ~8 lines). Verify pass.

- [ ] **Step 4: OrgLogo dual-img rendering**

In `OrgLogo.tsx` (see current fallback chain L75/L106/L137/L154): compute `const iconPair = resolveLogoPair(brand.iconUrl, brand.iconDarkUrl)` and `const fullPair = resolveLogoPair(brand.fullUrl, brand.fullDarkUrl)`. Wherever an `<img>` is rendered today from a single URL, render instead via a local `ThemedImg` helper inside the file:

- `distinct === false`: render the single `<img>` exactly as today (src = `pair.dark ?? pair.light` - same URL).
- `distinct === true`: render two `<img>` siblings with identical props/styling; the light one gets `dark:hidden` appended to its className, the dark one gets `hidden dark:block` (mirror the pattern at `src/components/redesign/platform/PlatformShell.tsx:56-68`). Both go through the existing `loadedUrls`/`failed`/`completeRef` machinery (it is keyed by URL, so two URLs coexist).
- Fallback-chain gates change from `usable(brand.fullUrl)` to "either side of the pair is usable": `usable(fullPair.light) || usable(fullPair.dark)`. If only one side is usable (e.g. dark 404s), render the usable side without theme classes ONLY if the other side failed (`failed[url]`), so a broken dark upload degrades to light rather than to nothing. Keep the monogram fallback exactly as-is when neither side is usable.
- The `variant="full"`-without-lockup branch (L106, icon + name text) uses `iconPair` the same way.

- [ ] **Step 5: TenantFullPageLoader**

Replace the `readCachedIconUrl` usage (L26-29) with `readCachedIconUrls()`, keep the post-mount `useEffect` pattern (hydration safety comment L22-25). Source selection (L34) becomes a pair: live `useOrgBrand()` values when present, else cached pair. Render dual imgs with `dark:hidden`/`hidden dark:block` when `distinct`, single img otherwise - same `iconReady` logic; treat the pair as ready when the img for the ACTIVE theme has loaded (simplest correct: track per-URL load state like today; `showIcon` when either loaded - the visible one is what matters visually, and both point at small icons).

- [ ] **Step 6: Verify + commit**

`npm run test:unit -- logoPair && npx tsc --noEmit`. Manual: dev server, set an org dark icon via SQL or settings (after Task 6), toggle `localStorage.theme`.

```bash
git add src/lib/branding/logoPair.* src/components/branding/OrgLogo.tsx src/components/branding/TenantFullPageLoader.tsx
git commit -m "feat(branding): theme-resolved org logos with per-asset dark fallback"
```

---

### Task 6: BrandingSection 2x2 slots + dual-theme preview + nudge

**Files:**
- Modify: `src/components/redesign/settings/sections/BrandingSection.tsx`
- Modify: `src/components/redesign/settings/settings-api.ts` (widen `updateOrgBranding` body type)

**Interfaces:**
- Consumes: Task 2 API fields; existing `LogoField`, `BrandPreview`, `useSettingsSection`, `trimLogoWhitespace` pipeline.
- Produces: org owners can upload/clear dark icon + dark lockup; a dark preview card always visible next to the light one; nudge copy when dark slots empty but light assets exist.

**UI conformance:** run the ui-ux-pro-max design-system check on this section when done (no raw hex, tokens only, no em dashes in copy).

- [ ] **Step 1: Form model + load/save**

`BrandingForm` (L19-25) gains `iconDarkUrl: string; fullDarkUrl: string;`. `load` select (L40-56) adds `logo_icon_dark_url, logo_full_dark_url`; map into the form. `save` (L58-76) adds `logo_icon_dark_url: v.iconDarkUrl || null, logo_full_dark_url: v.fullDarkUrl || null`. Extend `savedUrlsRef` baseline and the reset handler (L164) to blank both. Widen the `updateOrgBranding` param type in `settings-api.ts:17-18` to include both fields.

- [ ] **Step 2: Upload slots**

`LogoSlot` type (L30) becomes `"icon" | "full" | "icon-dark" | "full-dark"` - the existing `handleFile` path template `` `${orgId}/${slot}-${uuidv4()}.${ext}` `` (L299) then produces `icon-dark-<uuid>.png` which the route already pins (Task 2). Add two `<LogoField>`s under a "Dark mode logos" group heading below the existing pair, labels: "Dark mode icon" / "Dark mode logo", with helper copy: `"Optional. Shown instead of your main logo when someone uses dark mode."`

- [ ] **Step 3: Dual preview**

Refactor `BrandPreview` (L368-419) to accept `mode: 'light' | 'dark'` and the two extra URLs. For `mode='dark'`: wrap the card in `<div className="dark">` and extend the inline vars re-map for dark aliasing:

```ts
"--primary": ramp["--brand-500"],
"--primary-foreground": ramp["--brand-fg-500"],
"--ring": ramp["--brand-400"],
"--brand-ink": ramp["--brand-ink-on-dark"],
```

(the `.dark` class on the wrapper re-declares the semantic tokens locally, so `bg-background`/`bg-card`/`text-foreground` inside resolve dark automatically; the inline re-map covers only the brand-derived aliases, same reason as the existing light re-map at L374-382). Preview images: light card shows `iconUrl`/`fullUrl`; dark card shows `resolveLogoPair(...)` results so the fallback is honest. Render the two cards side by side (`grid gap-4 sm:grid-cols-2`).

- [ ] **Step 4: The nudge**

Under the dark preview, when `(v.iconUrl || v.fullUrl) && !v.iconDarkUrl && !v.fullDarkUrl`, render muted helper text: `"This is how your logo looks in dark mode. If it is hard to see, upload a dark version below."` (No em dashes.)

- [ ] **Step 5: Verify + commit**

Manual: dev server → Settings → Branding: upload dark icon, see dark preview change, save, reload, confirm persisted; clear it, save, confirm cleared. `npx tsc --noEmit`.

```bash
git add src/components/redesign/settings/sections/BrandingSection.tsx src/components/redesign/settings/settings-api.ts
git commit -m "feat(branding): dark logo uploads with dual-theme preview and nudge"
```

---

### Task 7: Status ramps + redesign-tree strays get dark forks

**Files:**
- Modify: `src/components/ui/badge.tsx` (L14-17)
- Modify: `src/components/redesign/analytics/charts/Leaderboard.tsx` (L5 MEDAL array)
- Modify: `src/components/redesign/homeowner/account/HomeownerAccountHubView.tsx` (L93), `src/components/redesign/cleaner/profile/CleanerProfileView.tsx` (L174), `src/components/redesign/settings/OperatorSettingsView.tsx` (L54), `src/components/redesign/cleaner/profile/ProfileRow.tsx` (L26)

**Interfaces:** none produced; visual-only. Precedent to mirror: `stat-tile.tsx:30` (`text-positive-700 dark:text-positive`, `text-critical-700 dark:text-destructive`).

- [ ] **Step 1: Badge variants** (badge.tsx L14-17):

```
positive: 'bg-positive-50 text-positive-700 dark:bg-positive/15 dark:text-positive',
caution:  'bg-caution-50 text-caution-700 dark:bg-caution/15 dark:text-caution',
critical: 'bg-critical-50 text-critical-700 dark:bg-critical/15 dark:text-destructive',
info:     'bg-info-50 text-info-700 dark:bg-info/15 dark:text-info',
```

- [ ] **Step 2: Chip/banner forks**
- `HomeownerAccountHubView.tsx:93` and `CleanerProfileView.tsx:174` (`bg-critical-50 text-critical border-critical/30`): append `dark:bg-critical/15 dark:text-destructive dark:border-destructive/30`.
- `OperatorSettingsView.tsx:54` (`bg-brand-50 text-brand-700`): append `dark:bg-brand-500/15 dark:text-brand-ink`.
- `ProfileRow.tsx:26` icon chip (`bg-brand-50 text-brand-ink`): append `dark:bg-brand-500/15`.

- [ ] **Step 3: Leaderboard medals** (L5): replace the hardcoded slate silver entry with token-based or dark-forked classes, e.g. `bg-muted text-foreground` for silver (verify gold/bronze entries in the array at the same time; make all three read correctly on `bg-card` in dark - use `dark:` forks if they are literal palette classes).

- [ ] **Step 4: Visual verify + commit** - dev server, `localStorage.theme = 'dark'`, check badges on bookings list, account hubs, settings index, analytics leaderboard.

```bash
git add src/components/ui/badge.tsx src/components/redesign/
git commit -m "feat(dark-mode): dark variants for status ramps and brand chips"
```

---

### Task 8: Legacy reused-live component retrofit

**Files (verified live 2026-08-11, with hardcoded-color line counts):**
- Modify: `src/components/HomeownerCardPicker.tsx` (14), `src/components/settings/StripeFramedCard.tsx` (8), `src/components/TenantStripeConnect.tsx` (6), `src/components/WorkspaceErrorScreen.tsx` (3), `src/components/CleanerStripeConnect.tsx` (3), `src/components/AddPaymentMethodPanel.tsx` (1), `src/components/platform/ImpersonationBanner.tsx` (1)

**Interfaces:** none; class-string substitution only. `MessagesPage`/`MessageBubble`/`NotificationBell` from the old plan NO LONGER EXIST - do not go looking for them.

- [ ] **Step 1: Apply the substitution map** in each file (every occurrence; grep pattern `bg-white|text-gray-|bg-gray-|border-gray-|text-black|bg-black`):

| From | To |
|---|---|
| `bg-white` | `bg-card` (page canvas: `bg-background`) |
| `text-gray-900` / `text-black` | `text-foreground` |
| `text-gray-400/500/600` | `text-muted-foreground` |
| `border-gray-200/300` | `border-border` |
| `bg-gray-50/100` | `bg-muted` |
| focus rings `ring-gray-*`/`ring-primary-*` | `ring-ring` |

Judgment calls: text on colored fills stays as-is; `ImpersonationBanner`'s single hit - check context, it may be intentional contrast on a colored banner (if so, leave + move on).

- [ ] **Step 2: Verify each in dark** - dev server with `localStorage.theme='dark'`: homeowner booking flow payment step (CardPicker + AddPaymentMethodPanel), cleaner earnings (StripeConnect + PayoutTimingNotice), operator settings payments (TenantStripeConnect + StripeFramedCard), and force an org-error state for WorkspaceErrorScreen (or temporarily render it on a dev route).

- [ ] **Step 3: Commit**

```bash
git add src/components/
git commit -m "feat(dark-mode): retrofit reused-live legacy components to semantic tokens"
```

---

### Task 9: Document canvas + mobile chrome color

**Files:**
- Modify: `src/app/globals.css` (L5-14 region), `src/constants/theme.ts`, `src/components/branding/BrandDocumentIdentity.tsx`

**Interfaces:**
- Produces: `src/constants/theme.ts` exports `APP_BG_COLOR = '#ffffff'` (unchanged) and `APP_BG_COLOR_DARK = '#1A1815'` (new; the `.dark` `--background` canvas).

- [ ] **Step 1: Dark canvas rules** - append to the `@layer base` block after the body rule (globals.css L11-13):

```css
  html.dark {
    @apply bg-background;
  }
  html.dark body {
    @apply bg-background text-foreground;
  }
```

(Scoped to `.dark` so marketing/auth, which never get the class applied by the provider, keep the existing light fallback. `viewport.themeColor` in `src/app/layout.tsx:43-49` stays static white as the SSR default.)

- [ ] **Step 2: `APP_BG_COLOR_DARK`** - add to `src/constants/theme.ts`:

```ts
export const APP_BG_COLOR_DARK = '#1A1815';
```

- [ ] **Step 3: Theme-reactive `theme-color` meta in BrandDocumentIdentity**

Read `src/components/branding/BrandDocumentIdentity.tsx` first (it snapshots/restores `meta[name="theme-color"]` at L24/32/45/63). Add an html-class observer (it may render OUTSIDE the ThemeProvider tree, so do NOT use `useTheme`):

```tsx
const [isDark, setIsDark] = React.useState(false);
React.useEffect(() => {
  const el = document.documentElement;
  const update = () => setIsDark(el.classList.contains('dark'));
  update();
  const obs = new MutationObserver(update);
  obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}, []);
```

Where it currently writes the theme-color meta for branded paths, write `isDark ? APP_BG_COLOR_DARK : <existing light value>` and re-run that effect when `isDark` changes. Keep the snapshot/restore semantics intact for non-branded paths.

- [ ] **Step 4: Verify + commit** - iOS Safari sim or devtools responsive: status-bar/overscroll area is dark in dark mode on /admin, /cleaner, /homeowner; unchanged on /login and marketing.

```bash
git add src/app/globals.css src/constants/theme.ts src/components/branding/BrandDocumentIdentity.tsx
git commit -m "feat(dark-mode): dark document canvas and theme-reactive browser chrome color"
```

---

### Task 10: Stripe Connect appearance dark gaps

**Files:**
- Modify: `src/hooks/useTenantConnect.ts` (L257), `src/hooks/useCleanerConnect.ts` (L89), `src/components/AddPaymentMethodPanel.tsx` (L89)

**Interfaces:** Consumes `getRedesignConnectAppearance(isDark: boolean, accentHex?: string)` from `src/lib/stripe/appearance.ts:6`. `/billing/add-card` (L220 hardcoded `false`) is EXCLUDED by design - public page, stays light.

- [ ] **Step 1:** In each of the three files, replace the hardcoded `false` with a resolved-theme check. Components/hooks all run under the (redesign) ThemeProvider, so:

```ts
const { resolvedTheme } = useTheme();          // import { useTheme } from 'next-themes'
...
getRedesignConnectAppearance(resolvedTheme === 'dark')
```

For the two hooks, preserve the `appearanceOverride ?? ...` structure. Note: Connect/Elements instances take appearance at init; a mid-session toggle re-renders on next mount, which is acceptable (matches the four already-dark-aware call sites).

- [ ] **Step 2: Verify + commit** - dev server in dark: cleaner earnings embedded component and operator payments onboarding render dark; `npx tsc --noEmit`.

```bash
git add src/hooks/useTenantConnect.ts src/hooks/useCleanerConnect.ts src/components/AddPaymentMethodPanel.tsx
git commit -m "feat(dark-mode): theme-aware Stripe Connect appearance in remaining call sites"
```

---

### Task 11: ThemeSegmented control + three placements + e2e

**Files:**
- Create: `src/components/ui/theme-segmented.tsx`
- Create: `src/components/redesign/shared/ThemePreferenceRow.tsx`
- Modify: `src/components/redesign/settings/sections/AppearanceSection.tsx` (insert after L30), `src/components/redesign/homeowner/account/HomeownerAccountHubView.tsx` (after L53, inside the Account `space-y-2` div), `src/components/redesign/cleaner/profile/CleanerProfileView.tsx` (Account section L134-137; add a `space-y-2` wrapper)
- Test: `tests/e2e/settings.spec.ts` (extend)

**Interfaces:**
- Produces: `export function ThemeSegmented({ className }: { className?: string })` - 3-way radiogroup wired to next-themes; `export function ThemePreferenceRow()` - card row for homeowner/cleaner homes.
- Reflect `theme` (NOT `resolvedTheme`) as the selected value; mounted guard against hydration mismatch.

**UI conformance:** run the ui-ux-pro-max design-system check on all three placements (tokens only, no em dashes).

- [ ] **Step 1: Build `ThemeSegmented`**

```tsx
// src/components/ui/theme-segmented.tsx
'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export function ThemeSegmented({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const selected = mounted ? (theme ?? 'light') : 'light'

  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex items-center gap-1 rounded-pill border border-border bg-muted p-1', className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={selected === value}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected === value ? 'bg-card text-foreground shadow-soft-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}
```

(Verify `cn` import path against a neighbor like `stat-tile.tsx`; `rounded-pill`/`shadow-soft-sm`/`duration-base` all exist - `theme-toggle.tsx` uses them.)

- [ ] **Step 2: Operator placement** - in `AppearanceSection.tsx`, after the existing sidebar `</SettingRow>` (L30):

```tsx
<SettingRow
  label="Theme"
  helper="Choose light or dark, or follow your device setting. Saved on this device."
>
  <ThemeSegmented />
</SettingRow>
```

- [ ] **Step 3: Shared row for homeowner/cleaner** - `ThemePreferenceRow.tsx`: a card row visually consistent with `ProfileRow` (read `ROW_CLASS` at `ProfileRow.tsx:6-7` and mirror its card classes) but with the segmented control stacked below the label block (no chevron):

```tsx
'use client'

import { Moon } from 'lucide-react'
import { ThemeSegmented } from '@/components/ui/theme-segmented'

export function ThemePreferenceRow() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-ink dark:bg-brand-500/15">
          <Moon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Appearance</p>
          <p className="text-xs text-muted-foreground">Choose light or dark, or follow your device.</p>
        </div>
      </div>
      <ThemeSegmented />
    </div>
  )
}
```

Mount: homeowner Account section (`HomeownerAccountHubView.tsx` after the Profile `ProfileRow`, L53); cleaner Account section (`CleanerProfileView.tsx` L134-137: wrap `ChangePasswordDialog` + the new row in `<div className="space-y-2">`).

- [ ] **Step 4: e2e** - extend `tests/e2e/settings.spec.ts` (copy its existing auth/navigation pattern): navigate to operator settings `?section=appearance`, click the "Dark" radio, expect `html` to have class `dark`; reload, expect class persists; click "Light", expect class removed.

- [ ] **Step 5: Verify + commit** - manual pass on all three roles (toggle each way, reload, System follows OS via devtools emulation). `npx tsc --noEmit`; `npm run test:unit -- sections` (ordering test must stay green - no new section id was added).

```bash
git add src/components/ui/theme-segmented.tsx src/components/redesign/ tests/e2e/settings.spec.ts
git commit -m "feat(dark-mode): 3-way theme control in operator, homeowner, and cleaner settings"
```

---

### Task 12: Full verification + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Hydration #418 check on a prod build** - `npm run build && npm run start`; open the app with `localStorage.theme='dark'` and an org with cached branding; check the browser console for React error #418/hydration warnings on cold load of /admin, /cleaner, /homeowner. (next-themes sets the html class pre-hydration; `suppressHydrationWarning` is already on `<html>` - verify, don't trust.)

- [ ] **Step 2: Dual-theme QA sweep** (Playwright MCP against dev server): for each role (admin, cleaner, homeowner): dashboard home, bookings/today, messages, payments/earnings, settings home + branding + appearance - screenshot in light and dark. Verify: no white flashes, no unreadable text, lightboxes still theme-stable, Stripe surfaces dark, org logo swaps when a dark variant exists and falls back when not.

- [ ] **Step 3: Gates**

```bash
npm run test:unit
npm run test:integration -- branding
npx tsc --noEmit        # no NEW errors
npm run lint            # scope to changed files if stale-worktree noise
```

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/dark-mode
gh pr create --base master --title "feat: dark mode with per-theme org branding" --body "..."
```

PR body: summary of the three phases, the grain decision (per-user + dark logo variants), QA screenshots, note that `/billing/add-card` and auth/marketing stay light by design, and the Phase 3 (cross-device `user_profiles.theme`) fast-follow. End with the standard Claude Code attribution line.

- [ ] **Step 5: Update memory + MASTER-TODO** - check off the dark-mode item in `docs/MASTER-TODO.md` (in the PR); update the `dark-mode-plan` memory to reflect "shipped pending merge" state after the PR is open.
