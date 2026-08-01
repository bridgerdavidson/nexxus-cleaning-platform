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
 * next state. URLs come from useOrgBrand(), which already appends the
 * brand_updated_at cache-buster.
 */
export function OrgLogo({
  variant,
  size = 32,
  boxWidth,
  imageHeight,
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
   * Full variant only: rendered height for an UPLOADED lockup when it should
   * differ from the monogram+name fallback. Uploaded lockups are usually
   * cropped tight to their glyphs, so at equal pixel height they read much
   * larger than the padded fallback; top bars cap them smaller.
   */
  imageHeight?: number;
  className?: string;
}) {
  const brand = useOrgBrand();
  // brand.name, never currentOrganization.name: during "View as" the latter is
  // the platform admin's OWN org, which would pair the impersonated tenant's
  // logo with the wrong name/initials.
  const name = brand.name;

  // Track failed URLs so an onError falls through to the next state and a new
  // upload (different ?v=) gets a fresh chance.
  const [failed, setFailed] = useState<Record<string, true>>({});
  const usable = (url: string | null): url is string => !!url && !failed[url];
  const markFailed = (url: string) => setFailed((prev) => ({ ...prev, [url]: true }));

  if (variant === "full" && usable(brand.fullUrl)) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
      <img
        src={brand.fullUrl}
        alt={name}
        style={{ height: imageHeight ?? size }}
        className={cn("w-auto max-w-full object-contain object-left", className)}
        onError={() => markFailed(brand.fullUrl!)}
      />
    );
  }

  if (variant === "full") {
    return (
      <span className={cn("flex min-w-0 items-center gap-2", className)}>
        {usable(brand.iconUrl) ? (
          /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
          <img
            src={brand.iconUrl}
            alt=""
            style={{ height: size, width: size }}
            className="shrink-0 object-contain object-left"
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
        src={brand.iconUrl}
        alt={name}
        style={{ height: size, width: boxWidth ?? size }}
        className={cn("shrink-0 object-contain", className)}
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
