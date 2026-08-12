"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { orgInitials } from "@/lib/branding/monogram";
import { useOrgBrand } from "./BrandProvider";

/**
 * The org's identity as a CIRCULAR avatar, for surfaces that stack it among
 * round people-avatars (the "Cleaning office" conversation rows and compose
 * options). Square contexts (top bars, the rail) keep OrgLogo.
 *
 * Uploaded icon -> inset in a bordered circle (brand icons are usually
 * transparent PNGs, so they need a backing to read as an avatar); otherwise
 * the initials monogram, round. Same fallback + load-gating rules as OrgLogo:
 * a failed load falls through per URL (a re-upload gets a fresh chance), and
 * an image stays invisible until it can paint completely.
 */
export function OrgAvatar({ size = 44, className }: { size?: number; className?: string }) {
  const brand = useOrgBrand();
  const name = brand.name;

  const [failed, setFailed] = useState<Record<string, true>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, true>>({});
  const url = brand.iconUrl && !failed[brand.iconUrl] ? brand.iconUrl : null;
  const markFailed = (u: string) => setFailed((prev) => ({ ...prev, [u]: true }));
  const markLoaded = (u: string) =>
    setLoadedUrls((prev) => (prev[u] ? prev : { ...prev, [u]: true }));
  // Covers images that completed (or 404ed) before hydration attached handlers.
  const completeRef = (u: string) => (el: HTMLImageElement | null) => {
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) markLoaded(u);
    else markFailed(u);
  };

  if (url) {
    return (
      <span
        role="img"
        aria-label={name}
        style={{ height: size, width: size }}
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden rounded-full border border-border/60 bg-card",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */}
        <img
          ref={completeRef(url)}
          src={url}
          alt=""
          style={{ height: Math.round(size * 0.64), width: Math.round(size * 0.64) }}
          className={cn("object-contain", !loadedUrls[url] && "opacity-0")}
          onLoad={() => markLoaded(url)}
          onError={() => markFailed(url)}
        />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      style={{ height: size, width: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-full bg-brand-600 font-extrabold leading-none text-[hsl(var(--brand-fg-600))]",
        className,
      )}
    >
      {orgInitials(name)}
    </span>
  );
}
