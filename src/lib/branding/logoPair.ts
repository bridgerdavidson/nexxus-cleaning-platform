/**
 * Light/dark logo URL pair resolution (white-label dark mode).
 *
 * Dark slots are optional per-asset: a missing dark URL falls back to the
 * light asset, so an org that uploaded nothing extra renders identically in
 * both themes. `distinct` tells the render site whether it needs a themed
 * dual-<img> swap (dark: classes) or a single plain <img>.
 */
export interface LogoPair {
  light: string | null;
  dark: string | null;
  distinct: boolean;
}

export function resolveLogoPair(lightUrl: string | null, darkUrl: string | null): LogoPair {
  return {
    light: lightUrl ?? null,
    dark: darkUrl ?? lightUrl ?? null,
    distinct: !!darkUrl && darkUrl !== lightUrl,
  };
}
