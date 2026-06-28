"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** In-page back header for the Profile drill-in screens (the shell top bar +
 *  bottom nav stay; this is the hierarchical back affordance + screen title). */
export function CleanerSubHeader({
  backHref,
  backLabel,
  title,
}: {
  backHref: string;
  backLabel: string;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <Link
        href={backHref}
        className="-ml-2 inline-flex items-center gap-0.5 rounded-control px-2 py-1.5 text-sm font-semibold text-brand-600 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {backLabel}
      </Link>
      <h1 className="px-0.5 text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
    </div>
  );
}
