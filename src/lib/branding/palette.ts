import { converter, parse, clampChroma, wcagContrast, type Oklch } from "culori";
import {
  BRAND_STEPS,
  NEXXUS_BRAND_HEX,
  brandVarName,
  BRAND_FG_500_VAR,
  BRAND_FG_600_VAR,
  BRAND_INK_ON_LIGHT_VAR,
  BRAND_INK_ON_DARK_VAR,
  LIGHT_SURFACE_HEX,
  DARK_SURFACE_HEX,
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
  // 500 backs the dark theme's --primary, so white must clear AA on it for ANY
  // hue. 0.545 is the lightest target whose worst-case hue (green, ~145deg)
  // keeps white text at >= 4.6:1; between ~0.56 and ~0.61 there are hues where
  // neither white nor near-black clears 4.5. Today's real brand-500 is L 0.564.
  500: { l: 0.545, c: 0.98 },
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
  /** Brand-colored text on a light neutral surface. One of steps 600/700/800. */
  inkOnLight: string;
  /** Brand-colored text on a dark neutral surface. One of steps 500/400/300. */
  inkOnDark: string;
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
    inkOnLight: pickInk(steps, [600, 700, 800], LIGHT_SURFACE_HEX),
    inkOnDark: pickInk(steps, [500, 400, 300], DARK_SURFACE_HEX),
  };
}

/**
 * The first candidate step that clears AA against `surfaceHex`, else the last.
 *
 * Candidates run from the tenant's own color outward, so we use their actual
 * brand whenever it is legible and only step away when it is not. Steps 700+
 * (light) and 300+ (dark) have fixed lightness targets regardless of input, so
 * a readable option always exists.
 */
function pickInk(
  steps: Record<BrandStep, string>,
  candidates: BrandStep[],
  surfaceHex: string,
): string {
  const surface = parse(surfaceHex)!;
  for (const step of candidates) {
    if (wcagContrast(parse(`hsl(${steps[step]})`)!, surface) >= 4.5) return steps[step];
  }
  return steps[candidates[candidates.length - 1]];
}

/** The ramp as the exact CSS custom properties the provider and bootstrap set. */
export function rampToCssVars(ramp: BrandRamp): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const step of BRAND_STEPS) vars[brandVarName(step)] = ramp.steps[step];
  vars[BRAND_FG_600_VAR] = ramp.foreground600;
  vars[BRAND_FG_500_VAR] = ramp.foreground500;
  vars[BRAND_INK_ON_LIGHT_VAR] = ramp.inkOnLight;
  vars[BRAND_INK_ON_DARK_VAR] = ramp.inkOnDark;
  return vars;
}
