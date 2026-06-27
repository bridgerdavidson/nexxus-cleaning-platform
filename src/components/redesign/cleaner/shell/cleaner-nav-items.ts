import { Home, CalendarDays, DollarSign, MessageSquare, User, type LucideIcon } from "lucide-react";

export type CleanerNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path roots that also mark this item active. */
  activeFor?: string[];
};

// Phone-first 5-tab bottom nav. All hrefs point inside the redesign cleaner
// route group; each destination ships as its own slice (Schedule, Earnings,
// Messages, Profile arrive after Today).
export const CLEANER_NAV: CleanerNavItem[] = [
  { id: "today", label: "Today", href: "/app/cleaner-dashboard", icon: Home },
  { id: "schedule", label: "Schedule", href: "/app/cleaner-dashboard/schedule", icon: CalendarDays },
  { id: "earnings", label: "Earnings", href: "/app/cleaner-dashboard/earnings", icon: DollarSign },
  { id: "messages", label: "Messages", href: "/app/cleaner-dashboard/messages", icon: MessageSquare },
  { id: "profile", label: "Profile", href: "/app/cleaner-dashboard/profile", icon: User },
];

/** Longest matching href wins so /app/cleaner-dashboard/schedule resolves to
 *  "schedule", not "today" (whose href is a prefix of every other). */
export function deriveCleanerActive(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  let best: { id: string; len: number } | undefined;
  for (const item of CLEANER_NAV) {
    const roots = [item.href, ...(item.activeFor ?? [])];
    for (const root of roots) {
      if (pathname === root || pathname.startsWith(root + "/")) {
        if (!best || root.length > best.len) best = { id: item.id, len: root.length };
      }
    }
  }
  return best?.id;
}
