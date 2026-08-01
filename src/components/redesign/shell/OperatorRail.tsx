"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { OrgLogo } from "@/components/branding/OrgLogo";
import { useOrgBrand } from "@/components/branding/BrandProvider";
import type { NavItem } from "./nav-items";
import { NavMessagesBadge } from "./NavMessagesBadge";

/**
 * Desktop-only full-height brand rail. Collapsed to 64px showing the org icon
 * + nav icons; expands to 248px on hover (or the persistent preference, set in
 * Settings -> Appearance, not here: the rail carries actionable nav only) to
 * reveal the full lockup + labels. One clean surface. Settings pinned bottom.
 * `nav` is the viewer's permission-filtered item list (see useOperatorNav).
 * `badges` maps item ids to waiting-item counts (e.g. payments -> pending pay
 * requests); rendered as the icon-corner count pill the cleaner shell uses.
 */
export function OperatorRail({
  activeId,
  nav,
  badges,
  messagesUnread = 0,
  expanded = false,
  brand,
}: {
  activeId?: string;
  nav: NavItem[];
  badges?: Record<string, number>;
  messagesUnread?: number;
  /** Persistent expansion preference (device-local, see useRailPreference). */
  expanded?: boolean;
  /** Replaces the tenant OrgLogo crossfade in the brand cell. The /owner
   * back-office passes the Nexxus lockup: platform surfaces never re-brand. */
  brand?: React.ReactNode;
}) {
  const { name: orgName } = useOrgBrand();
  return (
    <aside
      className={cn(
        "group fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden",
        "border-r border-border bg-card transition-[width,box-shadow] duration-200 ease-out lg:flex",
        expanded
          ? "w-[248px] shadow-soft-lg"
          : "w-16 hover:w-[248px] hover:shadow-soft-lg"
      )}
    >
      {/*
        brand — two tenant assets stacked, crossfading on hover/expand. The
        collapsed layer is centered on the 64px icon column so the mark sits on
        the same centerline as the nav icons below it, and wide marks get a
        40px letterbox so a tightly-cropped icon is not squeezed into a square.
        The expanded lockup anchors at the column's left edge. Falls back to
        the initials monogram (+ name when expanded) when nothing is uploaded.
        Both visual layers are aria-hidden (the crossfade would read the org
        twice); the sr-only span carries the one accessible name.
      */}
      <div className="relative h-16 flex-none">
        {brand ? (
          <div className="flex h-full items-center pl-3">{brand}</div>
        ) : (
          <>
            <span className="sr-only">{orgName}</span>
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 flex w-16 items-center justify-center transition-opacity duration-200 ease-out",
                expanded ? "opacity-0" : "opacity-100 group-hover:opacity-0"
              )}
            >
              <OrgLogo variant="icon" size={32} boxWidth={40} />
            </div>
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 left-3 flex w-[210px] items-center transition-opacity duration-200 ease-out",
                expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
            >
              <OrgLogo variant="full" size={32} />
            </div>
          </>
        )}
      </div>

      {/* nav */}
      <nav className="flex flex-1 flex-col gap-1 px-3 pb-3">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          const badge = badges?.[item.id] ?? 0;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "flex items-center gap-[13px] rounded-control px-2 py-[9px] text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.id === "settings" && "mt-auto",
                active && "bg-brand-600 text-white hover:bg-brand-600 hover:text-white"
              )}
            >
              <span className="relative flex-none">
                <Icon className="h-6 w-6 flex-none" aria-hidden />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-2 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-brand-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {item.id === "messages" && <NavMessagesBadge count={messagesUnread} />}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[13px] font-medium transition-opacity duration-150",
                  expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                {item.label}
              </span>
              {badge > 0 && <span className="sr-only">{badge} waiting</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
