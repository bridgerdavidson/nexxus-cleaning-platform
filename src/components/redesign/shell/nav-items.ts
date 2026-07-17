import {
  Home,
  CalendarRange,
  ClipboardList,
  BookUser,
  Users,
  Tag,
  CreditCard,
  BarChart3,
  MessageSquare,
  Settings,
  MapPinHouse,
  type LucideIcon,
} from "lucide-react";
import type { ManagerPermissionKey, ManagerPermissions } from "@/lib/permissions/managerFlags";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar (max 4 + Menu). All items show in the rail/drawer. */
  primary?: boolean;
  /** Extra path roots that should also mark this item active (incremental rollout aliasing). */
  activeFor?: string[];
  /** Manager permission flag that must be on for a non-privileged viewer to see this item. Omitted = always visible. */
  requires?: ManagerPermissionKey;
};

// Operator (admin + manager) destinations. Every screen is redesigned, so all
// hrefs point at /app/* routes. Settings keeps activeFor: ["/settings"] only as
// a nav-highlight alias while the legacy settings pages remain reachable.
//
// Icons are lucide, chosen so each tab reads at a glance in the collapsed
// rail: only Calendar gets a calendar glyph (Bookings is the work-order list,
// hence clipboard), Cleaners & team gets the people-pair, and Customers gets
// the client-book so the two never read as near-duplicates. Properties is the
// pinned house (places we service) so it can't be mistaken for Overview's Home.
export const OPERATOR_NAV: NavItem[] = [
  { id: "overview", label: "Overview", href: "/app/admin-dashboard", icon: Home, primary: true },
  { id: "bookings", label: "Bookings", href: "/app/admin-dashboard/bookings", icon: ClipboardList, primary: true, requires: "can_view_bookings" },
  { id: "calendar", label: "Calendar", href: "/app/admin-dashboard/calendar", icon: CalendarRange, requires: "can_view_bookings" },
  { id: "properties", label: "Properties", href: "/app/admin-dashboard/properties", icon: MapPinHouse, requires: "can_view_properties" },
  { id: "people", label: "Customers", href: "/app/admin-dashboard/customers", icon: BookUser, primary: true, requires: "can_view_customers" },
  { id: "cleaners", label: "Cleaners & team", href: "/app/admin-dashboard/cleaners", icon: Users, requires: "can_manage_cleaners" },
  { id: "services", label: "Services", href: "/app/admin-dashboard/services", icon: Tag, requires: "can_view_services" },
  { id: "payments", label: "Payments & payouts", href: "/app/admin-dashboard/payments", icon: CreditCard, requires: "can_view_payments" },
  { id: "analytics", label: "Analytics", href: "/app/admin-dashboard/analytics", icon: BarChart3, requires: "can_view_analytics" },
  { id: "messages", label: "Messages", href: "/app/admin-dashboard/messages", icon: MessageSquare, primary: true, requires: "can_view_messages" },
  { id: "settings", label: "Settings", href: "/app/admin-dashboard/settings", icon: Settings, activeFor: ["/settings"] },
];

/**
 * Pure permission filter for the Operator nav. Owners/admins (`privileged`)
 * bypass gating entirely and see every item. A manager sees an item only if
 * it has no `requires` flag, or the flag is true in their `permissions`.
 * `permissions` is nullable to cover the loading state of useManagerPermissions
 * (nothing gated is shown until permissions resolve).
 */
export function filterOperatorNav(
  items: NavItem[],
  opts: { privileged: boolean; permissions: ManagerPermissions | null },
): NavItem[] {
  if (opts.privileged) return items;
  return items.filter((i) => !i.requires || !!opts.permissions?.[i.requires]);
}
