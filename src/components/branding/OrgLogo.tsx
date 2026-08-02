"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { orgInitials } from "@/lib/branding/monogram";
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

  if (variant === "full" && usable(brand.fullUrl)) {
    return (
      // The wrapper reserves the box height BEFORE the image loads (h-auto
      // imgs are 0px tall until then), so content below the logo never jumps
      // when it finishes loading (the welcome takeover centers on it).
      <span
        className={cn("flex min-w-0 items-center", className)}
        style={{ height: imageMaxHeight ?? size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */}
        <img
          ref={completeRef(brand.fullUrl)}
          src={brand.fullUrl}
          alt={name}
          style={{
            maxHeight: imageMaxHeight ?? size,
            // min(): the width budget must never beat the container (inline
            // max-width would override the max-w-full class on narrow bars).
            maxWidth: imageMaxWidth != null ? `min(${imageMaxWidth}px, 100%)` : undefined,
          }}
          className={cn(
            "h-auto w-auto max-w-full object-contain object-left",
            !loadedUrls[brand.fullUrl] && "opacity-0",
          )}
          onLoad={() => markLoaded(brand.fullUrl!)}
          onError={() => markFailed(brand.fullUrl!)}
        />
      </span>
    );
  }

  if (variant === "full") {
    return (
      <span className={cn("flex min-w-0 items-center gap-2", className)}>
        {usable(brand.iconUrl) ? (
          /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
          <img
            ref={completeRef(brand.iconUrl)}
            src={brand.iconUrl}
            alt=""
            style={{ height: size, width: size }}
            className={cn(
              "shrink-0 object-contain object-left",
              !loadedUrls[brand.iconUrl] && "opacity-0",
            )}
            onLoad={() => markLoaded(brand.iconUrl!)}
            onError={() => markFailed(brand.iconUrl!)}
          />
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

  if (usable(brand.iconUrl)) {
    return (
      // Centered (not object-left): a non-square mark should sit in the middle
      // of its box, matching how the monogram square self-centers.
      /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
      <img
        ref={completeRef(brand.iconUrl)}
        src={brand.iconUrl}
        alt={name}
        style={{ height: size, width: boxWidth ?? size }}
        className={cn("shrink-0 object-contain", !loadedUrls[brand.iconUrl] && "opacity-0", className)}
        onLoad={() => markLoaded(brand.iconUrl!)}
        onError={() => markFailed(brand.iconUrl!)}
      />
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
