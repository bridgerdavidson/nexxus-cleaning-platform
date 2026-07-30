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
  const { currentOrganization, currentOrganizationId } = useAuth();

  const brand = useMemo<OrgBrand>(() => {
    // Cache-bust the logo URLs on every branding save so an updated upload is
    // never masked by a stale CDN/browser cache of the previous asset.
    const v = currentOrganization?.brand_updated_at
      ? `?v=${Date.parse(currentOrganization.brand_updated_at)}`
      : "";
    return {
      color: currentOrganization?.brand_color || NEXXUS_BRAND_HEX,
      iconUrl: currentOrganization?.logo_icon_url ? currentOrganization.logo_icon_url + v : null,
      fullUrl: currentOrganization?.logo_full_url ? currentOrganization.logo_full_url + v : null,
      isDefault: !currentOrganization?.brand_color,
    };
  }, [currentOrganization]);

  useEffect(() => {
    const vars = rampToCssVars(deriveBrandRamp(brand.color));
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
    if (currentOrganizationId) writeBrandCache(currentOrganizationId, vars);
  }, [brand.color, currentOrganizationId]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
