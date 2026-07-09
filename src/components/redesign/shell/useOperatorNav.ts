'use client';

import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { OPERATOR_NAV, filterOperatorNav, type NavItem } from './nav-items';

/**
 * Permission-filtered Operator nav for the current viewer. Owners/admins get
 * every item unfiltered; managers are gated per-item via `useManagerPermissions`.
 * `overview` and `settings` have no `requires` so they always pass through.
 */
export function useOperatorNav(): { nav: NavItem[]; primary: NavItem[]; secondary: NavItem[] } {
  const { currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  return useMemo(() => {
    const nav = filterOperatorNav(OPERATOR_NAV, { privileged, permissions });
    return {
      nav,
      primary: nav.filter((i) => i.primary),
      secondary: nav.filter((i) => !i.primary && i.id !== 'settings'),
    };
  }, [privileged, permissions]);
}
