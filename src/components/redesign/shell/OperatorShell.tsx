"use client";

import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OperatorRail } from "./OperatorRail";
import { OperatorTopBar } from "./OperatorTopBar";
import { OperatorMobileNav } from "./OperatorMobileNav";
import { OPERATOR_NAV } from "./nav-items";

function deriveActive(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  // Longest matching href wins so /app/admin-dashboard/bookings resolves to
  // "bookings", not "overview" (whose href is a prefix of every other).
  let best: { id: string; len: number } | undefined;
  for (const item of OPERATOR_NAV) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.len) best = { id: item.id, len: item.href.length };
    }
  }
  return best?.id;
}

/**
 * Operator (admin + manager) app shell: full-height brand rail (desktop),
 * top bar, and bottom nav + drawer (mobile). Renders {children} in the content
 * area. Pass `active` to force the active nav id (e.g. in previews); otherwise
 * it is derived from the current pathname.
 */
export function OperatorShell({
  active,
  onNewBooking,
  children,
}: {
  active?: string;
  onNewBooking?: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeId = active ?? deriveActive(pathname);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:shadow-soft-md focus:ring-2 focus:ring-ring">Skip to content</a>
        <OperatorRail activeId={activeId} />
        <div className="lg:pl-16">
          <OperatorTopBar onNewBooking={onNewBooking} />
          <main id="main-content" className="px-4 pb-28 pt-5 lg:px-6 lg:pb-10">{children}</main>
        </div>
        <OperatorMobileNav activeId={activeId} onNewBooking={onNewBooking} />
      </div>
    </TooltipProvider>
  );
}
