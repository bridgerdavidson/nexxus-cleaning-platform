"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { isBrandedAppPath } from "@/lib/branding/paths";
import { APP_BG_COLOR_DARK } from "@/constants/theme";
import { useOrgBrand } from "./BrandProvider";

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

  // Theme comes from the html class, NOT useTheme(): this component mounts
  // outside the (redesign) ThemeProvider tree, and the class is what next-themes
  // actually writes. A MutationObserver keeps it live across toggles.
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

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

    // Same allowlist as BrandProvider's CSS variables and the pre-paint
    // bootstrap: marketing, /login, /signup, /owner keep the Nexxus chrome,
    // and /billing/add-card gets its own link-scoped treatment.
    const active = isBrandedAppPath(pathname) && orgStatus === "loaded" && !!brand.name;

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
    // Dark mode wins over the brand hue: the status bar must match the dark
    // canvas, not float a saturated band above a near-black app.
    if (meta && isDark) meta.content = APP_BG_COLOR_DARK;
    else if (meta && !brand.isDefault) meta.content = brand.color;
    else if (meta && defaults.themeColor) meta.content = defaults.themeColor;

    return restoreChrome;
  }, [orgStatus, brand.name, brand.iconUrl, brand.color, brand.isDefault, pathname, isDark]);

  return null;
}
