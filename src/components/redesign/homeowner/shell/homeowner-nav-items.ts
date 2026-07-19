import { Home, CalendarDays, MessageSquare, UserCircle, type LucideIcon } from 'lucide-react';

export interface HomeownerNavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const HOMEOWNER_NAV: HomeownerNavItem[] = [
  { id: 'home', label: 'Home', href: '/homeowner', icon: Home },
  { id: 'cleanings', label: 'Cleanings', href: '/homeowner/cleanings', icon: CalendarDays },
  { id: 'messages', label: 'Messages', href: '/homeowner/messages', icon: MessageSquare },
  { id: 'account', label: 'Account', href: '/homeowner/account', icon: UserCircle },
];

export function deriveHomeownerActive(pathname: string): string {
  if (pathname.includes('/cleanings')) return 'cleanings';
  if (pathname.includes('/messages')) return 'messages';
  if (pathname.includes('/account')) return 'account';
  return 'home';
}
