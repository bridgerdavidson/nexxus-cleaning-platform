import {
  Home,
  CalendarDays,
  Users,
  UsersRound,
  Tag,
  CreditCard,
  BarChart3,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar (max 4 + Menu). All items show in the rail/drawer. */
  primary?: boolean;
};

// Operator (admin + manager) destinations. Only Overview is redesigned so far;
// every other destination falls back to its LEGACY route (/admin-dashboard?tab=…
// or /settings) so the shell never dead-ends (404) during the incremental
// rollout. Repoint each href to its /app/* redesign route as that screen ships.
export const OPERATOR_NAV: NavItem[] = [
  { id: "overview", label: "Overview", href: "/app/admin-dashboard", icon: Home, primary: true },
  { id: "bookings", label: "Bookings", href: "/admin-dashboard?tab=bookings", icon: CalendarDays, primary: true },
  { id: "people", label: "Customers", href: "/admin-dashboard?tab=customers", icon: Users, primary: true },
  { id: "cleaners", label: "Cleaners & team", href: "/admin-dashboard?tab=cleaners", icon: UsersRound },
  { id: "services", label: "Services", href: "/admin-dashboard?tab=services", icon: Tag },
  { id: "payments", label: "Payments & payouts", href: "/admin-dashboard?tab=payments", icon: CreditCard },
  { id: "analytics", label: "Analytics", href: "/admin-dashboard?tab=analytics", icon: BarChart3 },
  { id: "messages", label: "Messages", href: "/admin-dashboard?tab=messages", icon: MessageSquare, primary: true },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings },
];

export const OPERATOR_PRIMARY_NAV = OPERATOR_NAV.filter((i) => i.primary);
export const OPERATOR_SECONDARY_NAV = OPERATOR_NAV.filter((i) => !i.primary && i.id !== "settings");
