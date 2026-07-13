"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { OperatorRail } from "./OperatorRail";
import { OperatorTopBar } from "./OperatorTopBar";
import { OperatorMobileNav } from "./OperatorMobileNav";
import { CommandPalette } from "@/components/redesign/command/CommandPalette";
import { OperatorBookingHost } from "@/components/redesign/bookings/new-booking/OperatorBookingHost";
import { useOpenOperatorBooking } from "@/components/redesign/bookings/new-booking/useOpenOperatorBooking";
import { OperatorBookingDetailHost } from "@/components/redesign/bookings/OperatorBookingDetailHost";
import { useOpenBookingDetail } from "@/components/redesign/bookings/useOpenBookingDetail";
import { OperatorPropertyDetailHost } from "@/components/redesign/properties/OperatorPropertyDetailHost";
import { OPERATOR_NAV } from "./nav-items";
import { useOperatorNav } from "./useOperatorNav";

function deriveActive(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  // Longest matching href wins so /app/admin-dashboard/bookings resolves to
  // "bookings", not "overview" (whose href is a prefix of every other).
  let best: { id: string; len: number } | undefined;
  for (const item of OPERATOR_NAV) {
    const roots = [item.href, ...(item.activeFor ?? [])];
    for (const root of roots) {
      if (pathname === root || pathname.startsWith(root + "/")) {
        if (!best || root.length > best.len) best = { id: item.id, len: root.length };
      }
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
  children,
}: {
  active?: string;
  /** @deprecated The shell now opens the redesigned booking sheet itself; this prop is ignored. */
  onNewBooking?: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeId = active ?? deriveActive(pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  // The shell owns the new-booking action: it opens the redesigned booking sheet (below)
  // instead of routing to the legacy admin dashboard.
  const openBooking = useOpenOperatorBooking();
  const { nav, primary, secondary } = useOperatorNav();

  // The "New booking" trigger (top-bar button, mobile FAB, command-palette action) is a
  // global affordance every Operator surface shares, so it is gated once here rather than
  // in each consumer. A manager without can_edit_bookings gets `undefined`, which each
  // consumer already treats as "hide the trigger" (see OperatorTopBar/OperatorMobileNav).
  const { currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canCreateBooking = privileged || !!permissions?.can_edit_bookings;
  const onNewBooking = canCreateBooking ? openBooking : undefined;
  // The booking-detail sheet is a global surface too: notifications, message
  // chips, and the overview queue all open it in place via ?booking=<id>.
  // Mirror the bookings route's gate (useRequireManagerFlag can_view_bookings)
  // so a restricted manager can never open it anywhere.
  const canViewBookings = privileged || !!permissions?.can_view_bookings;
  const openBookingDetail = useOpenBookingDetail();
  // The property-detail sheet is a global surface too (deep-linked via
  // ?property=<id>). Gated like the properties workspace itself
  // (can_view_properties); nav/route are added by a later task.
  const canViewProperties = privileged || !!permissions?.can_view_properties;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:shadow-soft-md focus:ring-2 focus:ring-ring">Skip to content</a>
        <OperatorRail activeId={activeId} nav={nav} />
        <div className="lg:pl-16">
          <OperatorTopBar
            onNewBooking={onNewBooking}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenBooking={canViewBookings ? openBookingDetail : undefined}
          />
          <main id="main-content" className="px-4 pb-28 pt-5 lg:px-6 lg:pb-10">{children}</main>
        </div>
        <OperatorMobileNav activeId={activeId} onNewBooking={onNewBooking} primary={primary} secondary={secondary} />
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} onNewBooking={onNewBooking} />
        {canCreateBooking ? (
          <Suspense fallback={null}>
            <OperatorBookingHost />
          </Suspense>
        ) : null}
        {canViewBookings ? (
          <Suspense fallback={null}>
            <OperatorBookingDetailHost />
          </Suspense>
        ) : null}
        {canViewProperties ? (
          <Suspense fallback={null}>
            <OperatorPropertyDetailHost />
          </Suspense>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
