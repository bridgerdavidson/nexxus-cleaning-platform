"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  OPERATOR_NAV,
  OPERATOR_PRIMARY_NAV,
  OPERATOR_SECONDARY_NAV,
} from "./nav-items";

const SETTINGS = OPERATOR_NAV.find((i) => i.id === "settings")!;

/** Mobile (<lg) bottom tab bar (4 primary + Menu drawer) + New-booking FAB. */
export function OperatorMobileNav({
  activeId,
  onNewBooking,
}: {
  activeId?: string;
  onNewBooking?: () => void;
}) {
  return (
    <>
      {/* New-booking FAB, above the bar */}
      <Button
        onClick={onNewBooking}
        aria-label="New booking"
        className="fixed bottom-[76px] right-4 z-40 h-14 w-14 rounded-full p-0 shadow-soft-lg lg:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </Button>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[60px] items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {OPERATOR_PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium",
                active ? "font-semibold text-brand-600" : "text-muted-foreground"
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-7 rounded-full bg-brand-600" aria-hidden />
              )}
              <Icon className="h-6 w-6" aria-hidden />
              {item.label}
            </Link>
          );
        })}

        <Sheet>
          <SheetTrigger
            className="flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" aria-hidden />
            Menu
          </SheetTrigger>
          <SheetContent side="left" className="w-[80%] max-w-[320px] p-0">
            <SheetHeader className="flex h-16 flex-row items-center px-4">
              <SheetTitle className="sr-only">Nexxus</SheetTitle>
              {/* light theme: dark wordmark */}
              <Image
                src="/brand/logo-black.svg"
                alt="Nexxus"
                width={567}
                height={126}
                priority
                className="h-7 w-auto dark:hidden"
              />
              {/* dark theme: white wordmark */}
              <Image
                src="/brand/logo-white.svg"
                alt="Nexxus"
                width={565}
                height={126}
                className="hidden h-7 w-auto dark:block"
              />
            </SheetHeader>

            <div className="flex flex-col gap-1 px-3 pb-4">
              <DrawerGroupLabel>Primary</DrawerGroupLabel>
              {OPERATOR_PRIMARY_NAV.map((item) => (
                <DrawerLink key={item.id} item={item} activeId={activeId} />
              ))}
              <DrawerGroupLabel>More</DrawerGroupLabel>
              {OPERATOR_SECONDARY_NAV.map((item) => (
                <DrawerLink key={item.id} item={item} activeId={activeId} />
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

function DrawerLink({ item, activeId }: { item: (typeof OPERATOR_NAV)[number]; activeId?: string }) {
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
      </Link>
    </SheetClose>
  );
}
