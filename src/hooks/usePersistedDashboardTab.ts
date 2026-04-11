"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const TAB_QUERY_KEY = "tab";

/** Tab ids for admin and manager dashboards (URL ?tab=) */
export const ADMIN_MANAGER_DASHBOARD_TAB_IDS = [
  "home",
  "bookings",
  "messages",
  "customers",
  "services",
  "properties",
  "team",
  "cleaners",
  "payments",
  "analytics",
  "settings",
] as const;

export const HOMEOWNER_DASHBOARD_TAB_IDS = [
  "home",
  "bookings",
  "messages",
  "services",
  "properties",
  "payments",
  "settings",
] as const;

export const CLEANER_DASHBOARD_TAB_IDS = [
  "home",
  "jobs",
  "messages",
  "earnings",
  "services",
  "settings",
] as const;

/**
 * Keeps the active dashboard tab in the URL (`?tab=...`) so refresh restores the same view.
 * Omits the query param when the tab equals `defaultTab`.
 */
export function usePersistedDashboardTab(
  defaultTab: string,
  validTabIds: readonly string[]
): readonly [string, (tab: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const validSet = useMemo(() => new Set(validTabIds), [validTabIds]);

  const raw = searchParams.get(TAB_QUERY_KEY);
  const activeTab =
    raw && validSet.has(raw) ? raw : defaultTab;

  const setActiveTab = useCallback(
    (tab: string) => {
      const next = validSet.has(tab) ? tab : defaultTab;
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultTab) {
        params.delete(TAB_QUERY_KEY);
      } else {
        params.set(TAB_QUERY_KEY, next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [defaultTab, pathname, router, searchParams, validSet]
  );

  return [activeTab, setActiveTab] as const;
}
