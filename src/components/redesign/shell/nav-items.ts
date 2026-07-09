import {
  Home,
  CalendarDays,
  Users,
  SprayCan,
  Tag,
  CreditCard,
  BarChart3,
  MessageSquare,
  Settings,
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

// Operator (admin + manager) destinations. Only Overview is redesigned so far;
// every other destination falls back to its LEGACY route (/admin-dashboard?tab=…
// or /settings) so the shell never dead-ends (404) during the incremental
// rollout. Repoint each href to its /app/* redesign route as that screen ships.
//
// Icons are lucide. Cleaners & team uses SprayCan (a cleaning glyph) instead of
// a second people-icon, so it never reads as a near-duplicate of Customers.
export const OPERATOR_NAV: NavItem[] = [
  { id: "overview", label: "Overview", href: "/app/admin-dashboard", icon: Home, primary: true },
  { id: "bookings", label: "Bookings", href: "/app/admin-dashboard/bookings", icon: CalendarDays, primary: true, requires: "can_view_bookings" },
  { id: "people", label: "Customers", href: "/app/admin-dashboard/customers", icon: Users, primary: true, requires: "can_view_customers" },
  { id: "cleaners", label: "Cleaners & team", href: "/app/admin-dashboard/cleaners", icon: SprayCan, requires: "can_manage_cleaners" },
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
