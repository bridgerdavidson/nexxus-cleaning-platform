"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
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
              {item.id === "messages" && messagesUnread > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-2 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-brand-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white"
                >
                  {messagesUnread > 99 ? "99+" : messagesUnread}
                </span>
              )}
            </span>
            {item.label}
            {item.id === "messages" && messagesUnread > 0 && (
              <span className="sr-only">{messagesUnread} unread</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
