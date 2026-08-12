"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { orgInitials } from "@/lib/branding/monogram";
import { resolveLogoPair, type LogoPair } from "@/lib/branding/logoPair";
import { useOrgBrand } from "./BrandProvider";

/**
 * The org's visual identity, in one component with a guaranteed fallback chain
 * (docs/white-label-branding.md decisions 1 and 2):
 *
 *   variant="icon":  uploaded icon -> initials monogram
 *   variant="full":  uploaded lockup -> (icon or monogram) + org name as text
 *
 * It never renders a broken-image glyph: a failed load falls through to the
 * next state. Every image is also hidden until it has fully loaded, so a slow
 * network never shows a half-painted logo (progressive PNG decode paints top
 * to bottom). URLs come from useOrgBrand(), which already appends the
 * brand_updated_at cache-buster.
 *
 * Dark mode: each asset may have a dark variant. Theme selection is CSS-level
 * (dark:hidden / hidden dark:block on sibling imgs keyed off html.dark), never
 * resolvedTheme in JS, so there is no mount flicker and no hydration
 * divergence. When only one side of a pair is usable (missing or failed
 * upload), that side renders in BOTH themes: a broken dark asset degrades to
 * the light logo, never to a blank slot.
 */
export function OrgLogo({
  variant,
  size = 32,
  boxWidth,
  imageMaxHeight,
  imageMaxWidth,
  className,
}: {
  variant: "icon" | "full";
  /** Rendered height in px; width follows the asset's aspect ratio. */
  size?: number;
  /**
   * Icon variant only: width of the letterbox the mark is centered in
   * (defaults to `size`, a square). A wider box lets a tightly-cropped
   * landscape icon (e.g. a transparent PNG cropped to its glyphs) render
   * larger instead of being squeezed into the square.
   */
  boxWidth?: number;
  /**
   * Full variant only: an UPLOADED lockup renders at its natural aspect ratio
   * inside a max-height x max-width box (defaults: `size` tall, unlimited
   * wide). The width budget is what keeps both extremes sane: a wide
   * tight-cropped lockup hits imageMaxWidth and stops growing, while a
   * squarish one uses the full imageMaxHeight instead of being scaled down to
   * a sliver by a height-only cap. The monogram+name fallback stays at `size`.
   */
  imageMaxHeight?: number;
  imageMaxWidth?: number;
  className?: string;
}) {
  const brand = useOrgBrand();
  // brand.name, never currentOrganization.name: during "View as" the latter is
  // the platform admin's OWN org, which would pair the impersonated tenant's
  // logo with the wrong name/initials.
  const name = brand.name;

  // Track failed URLs so an onError falls through to the next state and a new
  // upload (different ?v=) gets a fresh chance; track loaded URLs so an image
  // stays invisible until it can paint completely.
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, true>>({});
  const usable = (url: string | null): url is string => !!url && !failed[url];
  const markFailed = (url: string) => setFailed((prev) => ({ ...prev, [url]: true }));
  const markLoaded = (url: string) =>
    setLoadedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  // onLoad/onError never fire for an image that completed before hydration
  // attached the handlers (browser-cached asset OR cached failure), so the
  // ref covers both outcomes; without the failure branch a pre-attach 404
  // would leave an invisible img instead of falling through to the fallback.
  const completeRef = (url: string) => (el: HTMLImageElement | null) => {
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) markLoaded(url);
    else markFailed(url);
  };

  // A pair collapses to the img elements that actually render: two themed
  // siblings when a distinct dark variant is usable, one plain img otherwise.
  const themedSources = (pair: LogoPair): { url: string; themeCls?: string }[] => {
    const light = usable(pair.light) ? pair.light : null;
    const dark = usable(pair.dark) ? pair.dark : null;
    if (light && dark && light !== dark) {
      return [
        { url: light, themeCls: "dark:hidden" },
        { url: dark, themeCls: "hidden dark:block" },
      ];
    }
    const only = light ?? dark;
    return only ? [{ url: only }] : [];
  };

  const iconSources = themedSources(resolveLogoPair(brand.iconUrl, brand.iconDarkUrl));
  const fullSources = themedSources(resolveLogoPair(brand.fullUrl, brand.fullDarkUrl));

  if (variant === "full" && fullSources.length > 0) {
    return (
      // The wrapper reserves the box height BEFORE the image loads (h-auto
      // imgs are 0px tall until then), so content below the logo never jumps
      // when it finishes loading (the welcome takeover centers on it).
      <span
        className={cn("flex min-w-0 items-center", className)}
        style={{ height: imageMaxHeight ?? size }}
      >
        {fullSources.map(({ url, themeCls }) => (
          /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
          <img
            key={url}
            ref={completeRef(url)}
            src={url}
            alt={name}
            style={{
              maxHeight: imageMaxHeight ?? size,
              // min(): the width budget must never beat the container (inline
              // max-width would override the max-w-full class on narrow bars).
              maxWidth: imageMaxWidth != null ? `min(${imageMaxWidth}px, 100%)` : undefined,
            }}
            className={cn(
              "h-auto w-auto max-w-full object-contain object-left",
              !loadedUrls[url] && "opacity-0",
              themeCls,
            )}
            onLoad={() => markLoaded(url)}
            onError={() => markFailed(url)}
          />
        ))}
      </span>
    );
  }

  if (variant === "full") {
    return (
      <span className={cn("flex min-w-0 items-center gap-2", className)}>
        {iconSources.length > 0 ? (
          iconSources.map(({ url, themeCls }) => (
            /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
            <img
              key={url}
              ref={completeRef(url)}
              src={url}
              alt=""
              style={{ height: size, width: size }}
              className={cn(
                "shrink-0 object-contain object-left",
                !loadedUrls[url] && "opacity-0",
                themeCls,
              )}
              onLoad={() => markLoaded(url)}
              onError={() => markFailed(url)}
            />
          ))
        ) : (
          // Decorative: the visible name text follows, mirroring alt="" above.
          <Monogram name={name} size={size} decorative />
        )}
        <span
          className="truncate font-extrabold tracking-tight text-foreground"
          style={{ fontSize: Math.max(13, Math.round(size * 0.5)) }}
        >
          {name}
        </span>
      </span>
    );
  }

  if (iconSources.length === 1) {
    const { url } = iconSources[0];
    return (
      // Centered (not object-left): a non-square mark should sit in the middle
      // of its box, matching how the monogram square self-centers.
      /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
      <img
        ref={completeRef(url)}
        src={url}
        alt={name}
        style={{ height: size, width: boxWidth ?? size }}
        className={cn("shrink-0 object-contain", !loadedUrls[url] && "opacity-0", className)}
        onLoad={() => markLoaded(url)}
        onError={() => markFailed(url)}
      />
    );
  }

  if (iconSources.length > 1) {
    return (
      // Same box the single-img case renders; only one themed sibling is
      // visible at a time, so the span's content is exactly that img.
      <span
        className={cn("inline-flex shrink-0", className)}
        style={{ height: size, width: boxWidth ?? size }}
      >
        {iconSources.map(({ url, themeCls }) => (
          /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
          <img
            key={url}
            ref={completeRef(url)}
            src={url}
            alt={name}
            style={{ height: size, width: boxWidth ?? size }}
            className={cn("shrink-0 object-contain", !loadedUrls[url] && "opacity-0", themeCls)}
            onLoad={() => markLoaded(url)}
            onError={() => markFailed(url)}
          />
        ))}
      </span>
    );
  }

  return <Monogram name={name} size={size} className={className} />;
}

/** Initials in a brand-600 rounded square; fg-600 is the AA-picked pairing. */
function Monogram({
  name,
  size,
  className,
  decorative = false,
}: {
  name: string;
  size: number;
  className?: string;
  /** True when visible name text sits beside it, so SRs don't hear it twice. */
  decorative?: boolean;
}) {
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      style={{ height: size, width: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-md bg-brand-600 font-extrabold leading-none text-[hsl(var(--brand-fg-600))]",
        className,
      )}
    >
      {orgInitials(name)}
    </span>
  );
}
