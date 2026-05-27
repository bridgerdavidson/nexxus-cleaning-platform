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
  "invites",
  "payments",
  "analytics",
  "settings",
] as const;

export const HOMEOWNER_DASHBOARD_TAB_IDS = [
  "home",
  "messages",
  "services",
  "properties",
  "payments",
  "payment-methods",
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
 * Maps an admin/manager tab id to its left-nav group. Used to derive the active
 * sidebar group from the URL-persisted tab so the two cannot disagree (which
 * would otherwise cause a flicker, since `setActiveTab` updates the URL
 * asynchronously while local React state updates synchronously).
 */
export const ADMIN_MANAGER_TAB_TO_GROUP: Readonly<Record<string, string>> = {
  home: "operations",
  bookings: "operations",
  messages: "operations",
  services: "operations",
  customers: "accounts",
  properties: "accounts",
  team: "team",
  cleaners: "team",
  invites: "team",
  payments: "business",
  analytics: "business",
};

export const ADMIN_MANAGER_DEFAULT_GROUP = "operations";

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
