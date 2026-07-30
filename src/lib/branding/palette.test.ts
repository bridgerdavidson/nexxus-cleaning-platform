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

  it("emits one CSS variable per step, both foregrounds, and both inks", () => {
    const vars = rampToCssVars(deriveBrandRamp(NEXXUS_BRAND_HEX));
    expect(Object.keys(vars)).toHaveLength(BRAND_STEPS.length + 4);
    for (const name of ["--brand-600", "--brand-fg-600", "--brand-fg-500", "--brand-ink-on-light", "--brand-ink-on-dark"]) {
      expect(vars[name], name).toBeDefined();
    }
  });

  it("keeps brand-colored text readable on neutral surfaces at any brand", () => {
    // The failure this guards: 52 `text-brand-600` usages across 42 files go
    // unreadable the moment a tenant picks a pale color.
    for (const hex of ["#0150FC", "#FFE24D", "#7CFF6B", "#F4A0C0"]) {
      const ramp = deriveBrandRamp(hex);
      expect(
        wcagContrast(channelsToRgb(ramp.inkOnLight), parse("#F7F6F3")!),
        `${hex} on warm-50`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        wcagContrast(channelsToRgb(ramp.inkOnDark), parse("#24211B")!),
        `${hex} on the dark card`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses the tenant's own color as ink when it is already legible", () => {
    const ramp = deriveBrandRamp("#0150FC");
    expect(ramp.inkOnLight).toBe(ramp.steps[600]);
  });
});
