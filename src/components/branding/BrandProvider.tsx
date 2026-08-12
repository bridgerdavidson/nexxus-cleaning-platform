"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { deriveBrandRamp, rampToCssVars } from "@/lib/branding/palette";
import {
  BRAND_STEPS,
  brandVarName,
  BRAND_FG_500_VAR,
  BRAND_FG_600_VAR,
  BRAND_INK_ON_LIGHT_VAR,
  BRAND_INK_ON_DARK_VAR,
  BRAND_BOOTSTRAP_SHEET_GLOBAL,
  NEXXUS_BRAND_HEX,
} from "@/lib/branding/tokens";
import { writeBrandCache, clearBrandCache } from "@/lib/branding/brandCache";
import { isBrandedAppPath } from "@/lib/branding/paths";

export interface OrgBrand {
  color: string;
  iconUrl: string | null;
  fullUrl: string | null;
  /** Dark-mode variants; null falls back to the light asset at render time. */
  iconDarkUrl: string | null;
  fullDarkUrl: string | null;
  /** The EFFECTIVE org's display name: the impersonated org's while "View as"
   * is active, the member org's otherwise. Consumers must use this, not
   * currentOrganization.name, or impersonation shows a mixed identity. */
  name: string;
  /** True when the org has set no color, i.e. we are showing the platform brand. */
  isDefault: boolean;
}

const DEFAULT_BRAND: OrgBrand = {
  color: NEXXUS_BRAND_HEX,
  iconUrl: null,
  fullUrl: null,
  iconDarkUrl: null,
  fullDarkUrl: null,
  name: "",
  isDefault: true,
};

const BrandContext = createContext<OrgBrand>(DEFAULT_BRAND);

export function useOrgBrand(): OrgBrand {
  return useContext(BrandContext);
}

/** Every inline property this provider may have set. Removal restores globals.css. */
const ALL_BRAND_VARS: string[] = [
  ...BRAND_STEPS.map(brandVarName),
  BRAND_FG_600_VAR,
  BRAND_FG_500_VAR,
  BRAND_INK_ON_LIGHT_VAR,
  BRAND_INK_ON_DARK_VAR,
];

interface BrandRow {
  name?: string | null;
  brand_color?: string | null;
  logo_icon_url?: string | null;
  logo_full_url?: string | null;
  logo_icon_dark_url?: string | null;
  logo_full_dark_url?: string | null;
  brand_updated_at?: string | null;
}

function toBrand(row: BrandRow | null | undefined): OrgBrand {
  const v = row?.brand_updated_at ? `?v=${Date.parse(row.brand_updated_at)}` : "";
  return {
    color: row?.brand_color || NEXXUS_BRAND_HEX,
    iconUrl: row?.logo_icon_url ? row.logo_icon_url + v : null,
    fullUrl: row?.logo_full_url ? row.logo_full_url + v : null,
    iconDarkUrl: row?.logo_icon_dark_url ? row.logo_icon_dark_url + v : null,
    fullDarkUrl: row?.logo_full_dark_url ? row.logo_full_dark_url + v : null,
    name: row?.name ?? "",
    isDefault: !row?.brand_color,
  };
}

/**
 * Applies the current org's derived ramp as CSS variables on <html>.
 *
 * Render sites never read brand_color: they consume brand-* / primary tokens,
 * which this provider repoints. Invariants (each one is a fixed review finding):
 *
 * - Branding is applied ONLY on tenant app paths (isBrandedAppPath): the
 *   marketing site, /login, /signup, and /owner always render the platform
 *   palette, even for a signed-in member of a branded org. The pre-paint
 *   bootstrap applies the same path gate.
 * - While the session or org context is still loading, it writes NOTHING, so
 *   the pre-paint bootstrap's replayed ramp survives until the real org
 *   arrives (no default-blue flash for returning users).
 * - An org with no brand_color gets the variables REMOVED, not a derived
 *   default: the derived default drifts perceptibly from the hand-written
 *   globals.css values at several steps, and globals must stay authoritative.
 * - The /owner back-office is a platform surface: always Nexxus, even for a
 *   staffer who also holds a tenant org membership.
 * - While impersonating, the IMPERSONATED org's branding is fetched and shown
 *   (that is the point of "View as"), and the cache is never written, so the
 *   admin's next cold load cannot replay a tenant pairing that is not theirs.
 */
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { currentOrganization, currentOrganizationId, orgStatus, user, loading, impersonatingOrgId } =
    useAuth();
  const pathname = usePathname();
  const isPlatformSurface = pathname?.startsWith("/owner") ?? false;
  const isBrandedSurface = isBrandedAppPath(pathname);
  // Where the NEXT account signs in; the only place a signed-out visit may
  // clear the cached ramp (see the effect below).
  const isAuthSurface = pathname === "/login" || (pathname?.startsWith("/signup") ?? false);

  // Impersonation: currentOrganization is still the admin's OWN org, so the
  // tenant's branding has to be fetched separately (allowed by the platform
  // admin SELECT policy). null = fetch in flight.
  const [impersonatedRow, setImpersonatedRow] = useState<BrandRow | null>(null);
  useEffect(() => {
    if (!impersonatingOrgId) {
      setImpersonatedRow(null);
      return;
    }
    let alive = true;
    supabase
      .from("organizations")
      .select("name, brand_color, logo_icon_url, logo_full_url, logo_icon_dark_url, logo_full_dark_url, brand_updated_at")
      .eq("id", impersonatingOrgId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setImpersonatedRow((data as BrandRow | null) ?? {});
      });
    return () => {
      alive = false;
    };
  }, [impersonatingOrgId]);

  const brand = useMemo<OrgBrand>(() => {
    if (isPlatformSurface) return DEFAULT_BRAND;
    if (impersonatingOrgId) return impersonatedRow ? toBrand(impersonatedRow) : DEFAULT_BRAND;
    return toBrand(currentOrganization);
  }, [isPlatformSurface, impersonatingOrgId, impersonatedRow, currentOrganization]);

  useEffect(() => {
    const style = document.documentElement.style;

    const apply = (color: string) => {
      const vars = rampToCssVars(deriveBrandRamp(color));
      for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
      return vars;
    };
    const restoreDefaults = () => {
      for (const name of ALL_BRAND_VARS) style.removeProperty(name);
      // The pre-paint bootstrap delivers the replayed ramp as an ADOPTED
      // stylesheet (any DOM mutation before hydration trips React 19's
      // mismatch recovery); restoring defaults must un-adopt it too, or the
      // replayed ramp keeps winning over globals.css.
      try {
        const w = window as unknown as Record<string, CSSStyleSheet | undefined>;
        const sheet = w[BRAND_BOOTSTRAP_SHEET_GLOBAL];
        if (sheet && document.adoptedStyleSheets) {
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
          delete w[BRAND_BOOTSTRAP_SHEET_GLOBAL];
        }
      } catch {
        /* constructed stylesheets unsupported: nothing was injected */
      }
    };

    if (isPlatformSurface || !isBrandedSurface) {
      // Platform, marketing, and auth surfaces always render Nexxus (spec
      // decision 10), even for a signed-in member of a branded org.
      restoreDefaults();
      // Only the AUTH surfaces clear the cache: that is where a different
      // account signs in next, and a stale ramp must not replay for it.
      // Everywhere else a signed-out visit keeps the cache: token-scoped
      // pre-auth pages (/billing/add-card, accept-invite) are opened by the
      // tenant's own people while signed out, and wiping there would
      // re-introduce the cold-load flash the bootstrap exists to prevent.
      if (!loading && !user && isAuthSurface) clearBrandCache();
      return;
    }

    if (impersonatingOrgId) {
      if (impersonatedRow === null) return; // fetch in flight: leave the current paint alone
      if (impersonatedRow.brand_color) apply(impersonatedRow.brand_color);
      else restoreDefaults();
      return; // never cache an impersonated pairing
    }

    // Session restore or org load in flight: the bootstrap's replayed ramp is
    // the best information available; writing anything here re-creates the
    // flash the bootstrap exists to prevent.
    if (loading) return;
    if (user && (orgStatus === "idle" || orgStatus === "loading")) return;

    if (currentOrganizationId && (currentOrganization?.brand_color || brand.iconUrl || brand.iconDarkUrl)) {
      // The cache also carries the icon URL (org with an icon but the default
      // palette included), so the cold-load loader can show the tenant mark.
      let vars: Record<string, string> = {};
      if (currentOrganization?.brand_color) {
        vars = apply(currentOrganization.brand_color);
      } else {
        restoreDefaults();
      }
      writeBrandCache(currentOrganizationId, vars, brand.iconUrl, brand.iconDarkUrl);
    } else {
      // Signed out, no org, or an org with no brand: globals.css wins exactly.
      restoreDefaults();
      clearBrandCache();
    }
  }, [
    isPlatformSurface,
    isBrandedSurface,
    isAuthSurface,
    impersonatingOrgId,
    impersonatedRow,
    loading,
    user,
    orgStatus,
    currentOrganization?.brand_color,
    currentOrganizationId,
    brand.iconUrl,
    brand.iconDarkUrl,
  ]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
