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

// Operator (admin + manager) destinations. Only `overview` is built so far;
// the other hrefs are placeholders until their screens exist (see OperatorShell
// for the not-yet-built fallback behavior).
export const OPERATOR_NAV: NavItem[] = [
  { id: "overview", label: "Overview", href: "/app/admin-dashboard", icon: Home, primary: true },
  { id: "bookings", label: "Bookings", href: "/app/admin-dashboard/bookings", icon: CalendarDays, primary: true },
  { id: "people", label: "Customers", href: "/app/admin-dashboard/customers", icon: Users, primary: true },
  { id: "cleaners", label: "Cleaners & team", href: "/app/admin-dashboard/team", icon: UsersRound },
  { id: "services", label: "Services", href: "/app/admin-dashboard/services", icon: Tag },
  { id: "payments", label: "Payments & payouts", href: "/app/admin-dashboard/payments", icon: CreditCard },
  { id: "analytics", label: "Analytics", href: "/app/admin-dashboard/analytics", icon: BarChart3 },
  { id: "messages", label: "Messages", href: "/app/admin-dashboard/messages", icon: MessageSquare, primary: true },
  { id: "settings", label: "Settings", href: "/app/admin-dashboard/settings", icon: Settings },
];

export const OPERATOR_PRIMARY_NAV = OPERATOR_NAV.filter((i) => i.primary);
export const OPERATOR_SECONDARY_NAV = OPERATOR_NAV.filter((i) => !i.primary && i.id !== "settings");
