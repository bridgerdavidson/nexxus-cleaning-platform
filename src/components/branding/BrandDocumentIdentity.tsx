"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useOrgBrand } from "./BrandProvider";

/**
 * Render-null: keeps the browser chrome (tab title, favicon, theme-color) in
 * sync with the current org. Mounted inside BrandProvider. Restores the Nexxus
 * defaults whenever there is no org (pre-auth, /owner, signed out) and on
 * unmount, so signing out never strands a tenant's favicon.
 *
 * Runs per navigation too: the App Router rewrites <title> from route metadata
 * on transitions, so the tenant title must be re-applied after each one.
 */
export function BrandDocumentIdentity() {
  const { currentOrganization, orgStatus } = useAuth();
  const brand = useOrgBrand();
  const pathname = usePathname();

  // Captured once, before the first override, so restore is always faithful.
  const defaultsRef = useRef<{ title: string; icons: { el: HTMLLinkElement; href: string }[]; themeColor: string | null } | null>(null);

  useEffect(() => {
    if (defaultsRef.current === null) {
      defaultsRef.current = {
        title: document.title,
        icons: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')).map(
          (el) => ({ el, href: el.href }),
        ),
        themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null,
      };
    }
    const defaults = defaultsRef.current;

    const isPlatformSurface = pathname?.startsWith("/owner") ?? false;
    const active = orgStatus === "loaded" && !!currentOrganization && !isPlatformSurface;

    const restore = () => {
      document.title = defaults.title;
      for (const { el, href } of defaults.icons) el.href = href;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta && defaults.themeColor) meta.content = defaults.themeColor;
    };

    if (!active) {
      restore();
      return;
    }

    document.title = currentOrganization.name;
    if (brand.iconUrl) {
      for (const { el } of defaults.icons) el.href = brand.iconUrl;
    } else {
      // No uploaded icon: the static Nexxus favicon stays (spec decision 9).
      for (const { el, href } of defaults.icons) el.href = href;
    }
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta && !brand.isDefault) meta.content = brand.color;
    else if (meta && defaults.themeColor) meta.content = defaults.themeColor;

    return restore;
  }, [currentOrganization, orgStatus, brand.iconUrl, brand.color, brand.isDefault, pathname]);

  return null;
}
