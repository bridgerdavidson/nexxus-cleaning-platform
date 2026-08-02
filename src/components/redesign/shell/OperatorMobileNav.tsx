"use client";

import Link from "next/link";
import { Menu, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrgLogo } from "@/components/branding/OrgLogo";
import { useOrgBrand } from "@/components/branding/BrandProvider";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { OPERATOR_NAV, type NavItem } from "./nav-items";
import { NavMessagesBadge } from "./NavMessagesBadge";

const SETTINGS = OPERATOR_NAV.find((i) => i.id === "settings")!;

/**
 * Mobile (<lg) bottom tab bar (4 primary + Menu drawer) + New-booking FAB.
 * `primary`/`secondary` are the viewer's permission-filtered item lists (see
 * useOperatorNav); settings is never gated so it stays a module-level const.
 * `badges` maps item ids to waiting-item counts; a badged drawer item also
 * puts a dot on the Menu trigger so it stays discoverable while closed.
 */
export function OperatorMobileNav({
  activeId,
  onNewBooking,
  primary,
  secondary,
  badges,
  messagesUnread = 0,
}: {
  activeId?: string;
  onNewBooking?: () => void;
  primary: NavItem[];
  secondary: NavItem[];
  badges?: Record<string, number>;
  messagesUnread?: number;
}) {
  const drawerHasBadge = secondary.some((i) => (badges?.[i.id] ?? 0) > 0);
  // Effective org (impersonation-aware), never currentOrganization.name.
  const orgName = useOrgBrand().name || "Menu";
  return (
    <>
      {/* New-booking FAB (labeled, the one persistent global action), above the
          bar. Hidden on Settings, where a booking action is out of context, and
          hidden (not just disabled) for a manager without can_edit_bookings: see
          OperatorShell, which only passes onNewBooking when the viewer is allowed. */}
      {activeId !== "settings" && onNewBooking && (
        <Button
          onClick={onNewBooking}
          aria-label="New booking"
          className="fixed bottom-[76px] right-4 z-40 h-12 gap-2 rounded-pill px-4 shadow-soft-lg lg:hidden"
        >
          <CalendarPlus className="h-5 w-5" aria-hidden />
          <span className="text-sm font-semibold">New booking</span>
        </Button>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[60px] items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {primary.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          const badge = badges?.[item.id] ?? 0;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-fast",
                active ? "font-semibold text-brand-ink" : "text-muted-foreground"
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-7 rounded-full bg-brand-600 animate-nav-pip-in motion-reduce:animate-none" aria-hidden />
              )}
              <span className="relative">
                <Icon className="h-6 w-6 transition-transform duration-fast group-active:scale-90" aria-hidden />
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
              {item.label}
              {badge > 0 && <span className="sr-only">{badge} waiting</span>}
            </Link>
          );
        })}

        <Sheet>
          <SheetTrigger
            className="group flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open menu"
          >
            <span className="relative transition-transform duration-fast group-active:scale-90">
              <Menu className="h-6 w-6" aria-hidden />
              {drawerHasBadge && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-brand-600"
                />
              )}
            </span>
            Menu
            {drawerHasBadge && <span className="sr-only">Items waiting in the menu</span>}
          </SheetTrigger>
          <SheetContent side="left" className="w-[80%] max-w-[320px] p-0">
            <SheetHeader className="flex h-16 flex-row items-center px-4">
              <SheetTitle className="sr-only">{orgName}</SheetTitle>
              {/* Same uploaded-lockup box as the top bars: height AND width
                  budget, so wide and squarish marks both render sanely. */}
              <OrgLogo variant="full" size={28} imageMaxHeight={32} imageMaxWidth={190} />
            </SheetHeader>

            <div className="flex flex-col gap-1 px-3 pb-4">
              <DrawerGroupLabel>Primary</DrawerGroupLabel>
              {primary.map((item) => (
                <DrawerLink key={item.id} item={item} activeId={activeId} badge={badges?.[item.id]} />
              ))}
              <DrawerGroupLabel>More</DrawerGroupLabel>
              {secondary.map((item) => (
                <DrawerLink key={item.id} item={item} activeId={activeId} badge={badges?.[item.id]} />
              ))}
              <div className="mt-2 border-t border-border pt-2">
                <DrawerLink item={SETTINGS} activeId={activeId} />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}

function DrawerGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function DrawerLink({
  item,
  activeId,
  badge = 0,
}: {
  item: (typeof OPERATOR_NAV)[number];
  activeId?: string;
  badge?: number;
}) {
  const Icon = item.icon;
  const active = item.id === activeId;
  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-control px-2 py-2.5 text-[13px] font-medium",
          active ? "bg-brand-600 text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className="h-[18px] w-[18px] flex-none" aria-hidden />
        {item.label}
        {badge > 0 && (
          <span
            className={cn(
              "ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums",
              active ? "bg-white/20 text-white" : "bg-brand-600 text-white"
            )}
          >
            {badge > 99 ? "99+" : badge}
            <span className="sr-only"> waiting</span>
          </span>
        )}
      </Link>
    </SheetClose>
  );
}
