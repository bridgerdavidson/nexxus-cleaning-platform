import { Home, CalendarDays, MessageSquare, UserCircle, type LucideIcon } from 'lucide-react';

export interface HomeownerNavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const HOMEOWNER_NAV: HomeownerNavItem[] = [
  { id: 'home', label: 'Home', href: '/app/homeowner-dashboard', icon: Home },
  { id: 'cleanings', label: 'Cleanings', href: '/app/homeowner-dashboard/cleanings', icon: CalendarDays },
  { id: 'messages', label: 'Messages', href: '/app/homeowner-dashboard/messages', icon: MessageSquare },
  { id: 'account', label: 'Account', href: '/app/homeowner-dashboard/account', icon: UserCircle },
];

export function deriveHomeownerActive(pathname: string): string {
  if (pathname.includes('/cleanings')) return 'cleanings';
  if (pathname.includes('/messages')) return 'messages';
  if (pathname.includes('/account')) return 'account';
  return 'home';
}
