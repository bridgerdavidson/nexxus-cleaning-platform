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
