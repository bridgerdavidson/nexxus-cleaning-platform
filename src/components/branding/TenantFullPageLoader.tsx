"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { readCachedIconUrls } from "@/lib/branding/brandCache";
import { useAuth } from "@/hooks/useAuth";
import { useOrgBrand } from "./BrandProvider";

/**
 * Full-page loader for tenant surfaces (admin, cleaner, homeowner layouts).
 *
 * The animated NexxusLoader stays on surfaces that are genuinely ours (login,
 * signup, marketing, /owner); inside a tenant's app their mark pulses instead
 * (spec decision 8). On a cold load the org row is not known yet, so the icon
 * URL cached by BrandProvider (org-guarded, same replay rule as the ramp)
 * stands in. Until an icon has fully loaded, and whenever none exists, a
 * spinner shows: never a half-painted image, and never a bare colored bar.
 */
export function TenantFullPageLoader() {
  const { iconUrl } = useOrgBrand();
  const { user, loading } = useAuth();
  // Read AFTER mount, never during the first render: the server prerender
  // cannot see localStorage, so a lazy-useState read would make the first
  // client render diverge from the server HTML and trip React 19 hydration
  // mismatch #418 (whose recovery can wipe unrelated client-set state).
  const [cachedIconUrl, setCachedIconUrl] = useState<string | null>(null);
  useEffect(() => {
    setCachedIconUrl(readCachedIconUrls().iconUrl);
  }, []);
  // The cached mark stands in only while a session plausibly exists (restore
  // in flight, or a user present). Once restore resolves to NO user (lapsed
  // session on a shared device), fall back to the spinner: the previous
  // company's logo must not greet the next visitor during the login redirect.
  const src = iconUrl ?? (loading || user ? cachedIconUrl : null);

  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showIcon = !!src && failedUrl !== src;
  const iconReady = showIcon && loadedUrl === src;

  return (
    <div role="status" aria-label="Loading" className="grid min-h-dvh place-items-center bg-background">
      <div className="grid place-items-center">
        {showIcon ? (
          /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
          <img
            src={src}
            alt=""
            ref={(el) => {
              // Browser-cached outcome: onLoad/onError fired before hydration
              // attached the handlers; classify by naturalWidth.
              if (!el || !el.complete) return;
              if (el.naturalWidth > 0) setLoadedUrl(src);
              else setFailedUrl(src);
            }}
            onLoad={() => setLoadedUrl(src)}
            onError={() => setFailedUrl(src)}
            className={cn(
              "col-start-1 row-start-1 h-12 w-12 object-contain",
              iconReady ? "animate-pulse-subtle motion-reduce:animate-none" : "opacity-0",
            )}
          />
        ) : null}
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
