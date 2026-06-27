"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CLEANER_NAV } from "./cleaner-nav-items";

/** Phone-first bottom tab bar (5 top-level tabs), shown at all widths. */
export function CleanerBottomNav({ activeId }: { activeId?: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {CLEANER_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "font-semibold text-brand-600" : "text-muted-foreground"
            )}
          >
            {active && (
              <span className="absolute top-0 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-brand-600" aria-hidden />
            )}
            <Icon className="h-6 w-6" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
