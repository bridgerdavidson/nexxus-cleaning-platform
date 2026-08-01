"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useOrgBrand } from "./BrandProvider";

/**
 * Tenant app route groups. ONLY these get the org's browser chrome: marketing,
 * /login, /signup stay Nexxus (spec decision 10), /owner is a platform surface,
 * and /billing/add-card gets its own treatment in PR 5.
 */
const TENANT_PREFIXES = ["/admin", "/cleaner", "/homeowner"];

/**
 * Render-null: keeps the browser chrome (tab title, favicon, theme-color) in
 * sync with the current org on tenant surfaces. Mounted inside BrandProvider.
 *
 * Title handling: the App Router owns <title> via route metadata, so this
 * never captures or restores it. It only OVERWRITES it while a tenant surface
 * is active (re-applied per navigation, since Next rewrites the title on
 * transitions); leaving for a non-tenant route lets that route's metadata win.
 * Favicon and theme-color have stable app-wide defaults, so those are captured
 * once and faithfully restored on deactivation and unmount.
 */
export function BrandDocumentIdentity() {
  const { orgStatus } = useAuth();
  const brand = useOrgBrand();
  const pathname = usePathname();

  const defaultsRef = useRef<{ icons: { el: HTMLLinkElement; href: string }[]; themeColor: string | null } | null>(null);

  useEffect(() => {
    if (defaultsRef.current === null) {
      defaultsRef.current = {
        icons: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')).map(
          (el) => ({ el, href: el.href }),
        ),
        themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null,
      };
    }
    const defaults = defaultsRef.current;

    const onTenantSurface = TENANT_PREFIXES.some(
      (p) => pathname === p || pathname?.startsWith(p + "/"),
    );
    const active = onTenantSurface && orgStatus === "loaded" && !!brand.name;

    const restoreChrome = () => {
      for (const { el, href } of defaults.icons) el.href = href;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta && defaults.themeColor) meta.content = defaults.themeColor;
    };

    if (!active) {
      restoreChrome();
      return;
    }

    // brand.name is the EFFECTIVE org (the impersonated one during "View as").
    document.title = brand.name;
    if (brand.iconUrl) {
      for (const { el } of defaults.icons) el.href = brand.iconUrl;
    } else {
      // No uploaded icon: the static Nexxus favicon stays (spec decision 9).
      for (const { el, href } of defaults.icons) el.href = href;
    }
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta && !brand.isDefault) meta.content = brand.color;
    else if (meta && defaults.themeColor) meta.content = defaults.themeColor;

    return restoreChrome;
  }, [orgStatus, brand.name, brand.iconUrl, brand.color, brand.isDefault, pathname]);

  return null;
}
