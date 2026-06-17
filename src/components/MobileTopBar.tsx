"use client";

import React, { useState } from "react";
import NotificationBell, { type NotificationOpenIntent } from "./NotificationBell";
import { notificationTab, type NotificationRole } from "../lib/notifications/navigation";

interface MobileTopBarProps {
  role: "homeowner" | "cleaner" | "manager" | "admin";
  onTabChange: (tabId: string) => void;
  /** Open an appointment's detail panel (notification deep-link). */
  onOpenAppointment?: (appointmentId: string, intent?: NotificationOpenIntent) => void;
  /**
   * Show the notification bell. Hidden during platform-admin "View as" (the
   * bell renders the admin's own feed, not the tenant's), matching TopBar.
   */
  showNotifications?: boolean;
  /** The nav tabs (same array passed to MobileNavigation). Drives the title. */
  tabs: { id: string; label: string }[];
  /** The active tab id (same value passed to MobileNavigation). */
  activeTab: string;
}

/**
 * Mobile-only top bar (md:hidden). A flush, solid-white system bar separated
 * from the gray-100 content surface by a single soft hairline (no blur, no
 * rounded corners, no side borders, no halo shadow) so it reads as one matched
 * pair with the bottom nav. Left: the Nexxus app mark, plus the wordmark on the
 * home tab or the active section's title on every other tab. Right: the
 * notification bell, which opens a full-width bottom sheet on tap.
 */
export default function MobileTopBar({
  role,
  onTabChange,
  onOpenAppointment,
  showNotifications = true,
  tabs,
  activeTab,
}: MobileTopBarProps) {
  const isHome = tabs.length > 0 && activeTab === tabs[0].id;
  const activeLabel = tabs.find((t) => t.id === activeTab)?.label ?? "";
  // While the notification sheet is open, hide the whole bar (display:none).
  // iOS samples a fixed bar's background for the status-bar safe-area tint and
  // only unmount/display:none excludes it, so this keeps the safe area matching
  // the sheet's grey backdrop instead of staying white. The bell's sheet lives
  // in a portal, so it stays visible while the bar is hidden.
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <header
      className={`md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 pt-[env(safe-area-inset-top)] ${
        sheetOpen ? "hidden" : ""
      }`}
    >
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2 min-w-0">
          {/* Nexxus app mark (gray + gold X). Inline so the brand slot is
              self-contained; swap for a tenant logo when white-label ships. */}
          <svg viewBox="0 0 64 64" className="w-8 h-8 shrink-0" aria-hidden="true">
            <path d="M8 8 L24 8 L40 32 L24 56 L8 56 L24 32 Z" fill="#C2C2C2" />
            <path d="M56 8 L40 8 L24 32 L40 56 L56 56 L40 32 Z" fill="#D8A718" />
          </svg>
          {isHome ? (
            <span className="text-lg font-bold tracking-tight text-gray-900">
              Nexxus
            </span>
          ) : (
            <h1 className="text-base font-semibold text-gray-900 truncate">
              {activeLabel}
            </h1>
          )}
        </div>
        {showNotifications && (
          <NotificationBell
            variant="sheet"
            onOpenChange={setSheetOpen}
            onOpenNotification={(n, intent) => {
              onTabChange(notificationTab(n.event_type, role as NotificationRole));
              if (n.appointment_id) onOpenAppointment?.(n.appointment_id, intent);
            }}
          />
        )}
      </div>
    </header>
  );
}
