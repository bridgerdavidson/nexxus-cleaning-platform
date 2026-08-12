import { BRAND_CACHE_KEY, REMEMBERED_ORG_KEY } from "./tokens";

interface CachedBrand {
  orgId: string;
  vars: Record<string, string>;
  /** Cache-busted icon URL, so the cold-load loader can show the tenant's mark
   *  before the org row arrives. Absent in pre-existing cache entries. */
  iconUrl?: string | null;
  /** Cache-busted dark-mode icon URL. Absent in pre-existing cache entries;
   *  render falls back to iconUrl when null. */
  iconDarkUrl?: string | null;
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

/**
 * The cached icon URLs (light + dark), but ONLY when the cache belongs to the
 * remembered org (same guard the pre-paint bootstrap applies to the ramp):
 * after an org switch the stale entry must not flash the OLD company's mark.
 */
export function readCachedIconUrls(): { iconUrl: string | null; iconDarkUrl: string | null } {
  const none = { iconUrl: null, iconDarkUrl: null };
  const cached = readBrandCache();
  if (!cached?.iconUrl && !cached?.iconDarkUrl) return none;
  try {
    const remembered = window.localStorage.getItem(REMEMBERED_ORG_KEY);
    if (remembered && cached.orgId !== remembered) return none;
  } catch {
    return none;
  }
  return { iconUrl: cached.iconUrl ?? null, iconDarkUrl: cached.iconDarkUrl ?? null };
}

export function writeBrandCache(
  orgId: string,
  vars: Record<string, string>,
  iconUrl?: string | null,
  iconDarkUrl?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BRAND_CACHE_KEY,
      JSON.stringify({ orgId, vars, iconUrl: iconUrl ?? null, iconDarkUrl: iconDarkUrl ?? null }),
    );
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
