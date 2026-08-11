"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { NavMessagesBadge } from "@/components/redesign/shell/NavMessagesBadge";
import { CLEANER_NAV } from "./cleaner-nav-items";

/** Phone-first bottom tab bar (5 top-level tabs), shown at all widths. */
export function CleanerBottomNav({
  activeId,
  messagesUnread = 0,
}: {
  activeId?: string;
  messagesUnread?: number;
}) {
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
              "group relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-ring",
              active ? "font-semibold text-brand-ink" : "text-muted-foreground"
            )}
          >
            {active && (
              <span className="absolute top-0 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-brand-600 animate-nav-pip-in motion-reduce:animate-none" aria-hidden />
            )}
            <span className="relative transition-transform duration-fast group-active:scale-90">
              <Icon className="h-6 w-6" aria-hidden />
              {item.id === "messages" && <NavMessagesBadge count={messagesUnread} />}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
