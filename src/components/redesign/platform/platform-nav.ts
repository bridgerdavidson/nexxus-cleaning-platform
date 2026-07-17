import { Building2, ScrollText, BellRing } from 'lucide-react';
import type { NavItem } from '@/components/redesign/shell/nav-items';

/**
 * Platform-owner rail destinations. Ordered; the shell derives the active id by
 * longest-href-prefix, so "/app/owner/audit" resolves to Audit (not Tenants,
 * whose "/app/owner" href is a prefix of it). No `requires` gate: the whole
 * surface is gated at the route/layout level on `isPlatformAdmin`.
 */
export const PLATFORM_NAV: NavItem[] = [
  { id: 'tenants', label: 'Tenants', href: '/app/owner', icon: Building2 },
  { id: 'alerts', label: 'Alerts', href: '/app/owner/alerts', icon: BellRing },
  { id: 'audit', label: 'Audit log', href: '/app/owner/audit', icon: ScrollText },
];
