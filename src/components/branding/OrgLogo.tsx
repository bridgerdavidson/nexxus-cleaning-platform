"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
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
  className,
}: {
  variant: "icon" | "full";
  /** Rendered height in px; width follows the asset's aspect ratio. */
  size?: number;
  className?: string;
}) {
  const { currentOrganization } = useAuth();
  const brand = useOrgBrand();
  const name = currentOrganization?.name ?? "";

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
        style={{ height: size }}
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
          <Monogram name={name} size={size} />
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
      /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
      <img
        src={brand.iconUrl}
        alt={name}
        style={{ height: size, width: size }}
        className={cn("shrink-0 object-contain object-left", className)}
        onError={() => markFailed(brand.iconUrl!)}
      />
    );
  }

  return <Monogram name={name} size={size} className={className} />;
}

/** Initials in a brand-600 rounded square; fg-600 is the AA-picked pairing. */
function Monogram({ name, size, className }: { name: string; size: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={name}
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
