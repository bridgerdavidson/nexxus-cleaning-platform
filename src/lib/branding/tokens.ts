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

/**
 * Brand-colored TEXT on a neutral surface, per theme.
 *
 * Distinct from the foregrounds above, which colour text sitting ON a brand
 * fill. Step 600 is the tenant's exact color, so `text-brand-600` on a card is
 * unreadable for any pale brand. See docs/white-label-branding.md decision 3.
 */
export const BRAND_INK_ON_LIGHT_VAR = "--brand-ink-on-light";
export const BRAND_INK_ON_DARK_VAR = "--brand-ink-on-dark";

/** Neutral surfaces the ink must stay readable against: warm-50 and the dark card. */
export const LIGHT_SURFACE_HEX = "#F7F6F3";
export const DARK_SURFACE_HEX = "#24211B";

/** localStorage key holding the last resolved ramp, replayed before first paint. */
export const BRAND_CACHE_KEY = "nexxus.brand.v1";
