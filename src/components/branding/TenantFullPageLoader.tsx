"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { readCachedIconUrls } from "@/lib/branding/brandCache";
import { resolveLogoPair } from "@/lib/branding/logoPair";
import { useAuth } from "@/hooks/useAuth";
import { useOrgBrand } from "./BrandProvider";

/**
 * Full-page loader for tenant surfaces (admin, cleaner, homeowner layouts).
 *
 * The animated NexxusLoader stays on surfaces that are genuinely ours (login,
 * signup, marketing, /owner); inside a tenant's app their mark pulses instead
 * (spec decision 8). On a cold load the org row is not known yet, so the icon
 * URLs cached by BrandProvider (org-guarded, same replay rule as the ramp)
 * stand in. Until an icon has fully loaded, and whenever none exists, a
 * spinner shows: never a half-painted image, and never a bare colored bar.
 *
 * Dark mode picks the icon via CSS themed siblings (html.dark), matching
 * OrgLogo: the theme class is on <html> before paint, so the right mark shows
 * from the first frame.
 */
export function TenantFullPageLoader() {
  const { iconUrl, iconDarkUrl } = useOrgBrand();
  const { user, loading } = useAuth();
  // Read AFTER mount, never during the first render: the server prerender
  // cannot see localStorage, so a lazy-useState read would make the first
  // client render diverge from the server HTML and trip React 19 hydration
  // mismatch #418 (whose recovery can wipe unrelated client-set state).
  const [cached, setCached] = useState<{ iconUrl: string | null; iconDarkUrl: string | null }>({
    iconUrl: null,
    iconDarkUrl: null,
  });
  useEffect(() => {
    setCached(readCachedIconUrls());
  }, []);
  // The cached mark stands in only while a session plausibly exists (restore
  // in flight, or a user present). Once restore resolves to NO user (lapsed
  // session on a shared device), fall back to the spinner: the previous
  // company's logo must not greet the next visitor during the login redirect.
  const sessionPlausible = loading || !!user;
  // Live brand beats cache, and the two are never mixed: once the org row is
  // in, its (possibly absent) dark variant is authoritative, and a stale
  // cached dark icon must not pair with a fresh light one.
  const hasLive = !!(iconUrl || iconDarkUrl);
  const pair = resolveLogoPair(
    hasLive ? iconUrl : sessionPlausible ? cached.iconUrl : null,
    hasLive ? iconDarkUrl : sessionPlausible ? cached.iconDarkUrl : null,
  );

  const [failed, setFailed] = useState<Record<string, true>>({});
  const [loaded, setLoaded] = useState<Record<string, true>>({});
  const markFailed = (url: string) => setFailed((prev) => ({ ...prev, [url]: true }));
  const markLoaded = (url: string) =>
    setLoaded((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  const usable = (url: string | null): url is string => !!url && !failed[url];

  const light = usable(pair.light) ? pair.light : null;
  const dark = usable(pair.dark) ? pair.dark : null;
  const sources: { url: string; themeCls?: string }[] =
    light && dark && light !== dark
      ? [
          { url: light, themeCls: "dark:hidden" },
          { url: dark, themeCls: "hidden dark:block" },
        ]
      : (light ?? dark)
        ? [{ url: (light ?? dark)! }]
        : [];

  const showIcon = sources.length > 0;
  // Every rendered sibling painted: the spinner may briefly overlap a loaded
  // mark while its twin finishes, which beats a blank cell if the visible
  // theme's img were the straggler.
  const iconReady = showIcon && sources.every(({ url }) => loaded[url]);

  return (
    <div role="status" aria-label="Loading" className="grid min-h-dvh place-items-center bg-background">
      <div className="grid place-items-center">
        {sources.map(({ url, themeCls }) => (
          /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
          <img
            key={url}
            src={url}
            alt=""
            ref={(el) => {
              // Browser-cached outcome: onLoad/onError fired before hydration
              // attached the handlers; classify by naturalWidth.
              if (!el || !el.complete) return;
              if (el.naturalWidth > 0) markLoaded(url);
              else markFailed(url);
            }}
            onLoad={() => markLoaded(url)}
            onError={() => markFailed(url)}
            className={cn(
              "col-start-1 row-start-1 h-12 w-12 object-contain",
              iconReady ? "animate-pulse-subtle motion-reduce:animate-none" : "opacity-0",
              themeCls,
            )}
          />
        ))}
        {!iconReady ? (
          <Loader2
            aria-hidden
            className="col-start-1 row-start-1 h-8 w-8 animate-spin text-brand-600 motion-reduce:animate-none"
          />
        ) : null}
      </div>
    </div>
  );
}
