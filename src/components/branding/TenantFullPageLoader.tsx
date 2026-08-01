"use client";
import { useState } from "react";
import { useOrgBrand } from "./BrandProvider";

/**
 * Full-page loader for tenant surfaces (admin, cleaner, homeowner layouts).
 *
 * The animated NexxusLoader stays on surfaces that are genuinely ours (login,
 * signup, marketing, /owner); inside a tenant's app their mark pulses instead
 * (spec decision 8). With no uploaded icon the fallback is a brand-colored
 * indicator with NO mark, deliberately not the monogram: during a cold load
 * the org name is not known yet, while the brand-600 token already carries the
 * tenant's color via the pre-paint bootstrap.
 */
export function TenantFullPageLoader() {
  const { iconUrl } = useOrgBrand();
  const [failed, setFailed] = useState(false);
  const showIcon = !!iconUrl && !failed;
  return (
    <div role="status" aria-label="Loading" className="grid min-h-dvh place-items-center bg-background">
      {showIcon ? (
        /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
        <img
          src={iconUrl}
          alt=""
          onError={() => setFailed(true)}
          className="h-12 w-12 animate-pulse-subtle object-contain motion-reduce:animate-none"
        />
      ) : (
        <span
          aria-hidden
          className="h-2.5 w-16 animate-pulse-subtle rounded-pill bg-brand-600 motion-reduce:animate-none"
        />
      )}
    </div>
  );
}
