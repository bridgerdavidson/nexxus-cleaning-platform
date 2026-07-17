import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.1.49", "192.168.68.56"],
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  // The domain root serves the marketing landing page. See rewrites() below:
  // it's a REWRITE, not a redirect, so the URL stays the bare root while the
  // /landing route renders. Sign-in stays reachable from the landing nav /
  // footer "Log in" links and directly at /login.
  async redirects() {
    // Legacy-route retirement (cutover runbook Phase 3/4). The redesign is the
    // app now and the legacy pages are deleted (4b/4c), so these run
    // unconditionally — the NEXT_PUBLIC_REDESIGN_ENABLED gate was retired in 4d.
    // Every legacy dashboard/settings/owner URL redirects into its /app/*
    // replacement so old bookmarks keep working. Deliberately temporary (307),
    // never 308: runbook Phase 4 step 4e removes the /app prefix and reverses
    // redirect direction, and a browser-cached 308 into /app would loop forever
    // after the reversal. These rules are rewritten wholesale in 4e. Next
    // appends the original query string to the destination (?tab=... rides
    // along); the redesign routes ignore it.

    // Legacy ?tab= ids → redesign routes, per dashboard source. Mapping each
    // source's tabs (not just admin's) means a deep link like
    // /homeowner-dashboard?tab=payment-methods lands on the right redesign
    // screen instead of the dashboard root. Ids mirror the *_DASHBOARD_TAB_IDS
    // in src/hooks/usePersistedDashboardTab.ts.
    // Admin/manager: team + invites fold into Cleaners & team in the redesign.
    const adminTabTargets: Record<string, string> = {
      home: "",
      bookings: "/bookings",
      messages: "/messages",
      customers: "/customers",
      services: "/services",
      properties: "/properties",
      team: "/cleaners",
      cleaners: "/cleaners",
      invites: "/cleaners",
      payments: "/payments",
      analytics: "/analytics",
    };
    // Homeowner: legacy tabs map into the redesign's Account sub-routes.
    const homeownerTabTargets: Record<string, string> = {
      home: "",
      messages: "/messages",
      services: "/account/services",
      properties: "/account/properties",
      payments: "/account/receipts",
      "payment-methods": "/account/payment-methods",
    };
    // Cleaner: jobs → schedule, services → profile/services.
    const cleanerTabTargets: Record<string, string> = {
      home: "",
      jobs: "/schedule",
      messages: "/messages",
      earnings: "/earnings",
      services: "/profile/services",
    };

    // For one legacy source, emit its ?tab= deep-link rules (first match wins)
    // followed by the plain-root redirect. Next appends the original query
    // string to the destination (?tab=... rides along); the redesign ignores it.
    const tabRules = (
      source: string,
      base: string,
      targets: Record<string, string>,
    ) => [
      ...Object.entries(targets).map(([tab, path]) => ({
        source,
        has: [{ type: "query" as const, key: "tab", value: tab }],
        destination: `${base}${path}`,
        permanent: false,
      })),
      { source, destination: base, permanent: false },
    ];

    const legacyRedirects = [
      // Manager shares the operator shell (and the same tab ids) as admin.
      ...tabRules("/admin-dashboard", "/app/admin-dashboard", adminTabTargets),
      ...tabRules("/manager-dashboard", "/app/admin-dashboard", adminTabTargets),
      ...tabRules("/cleaner-dashboard", "/app/cleaner-dashboard", cleanerTabTargets),
      ...tabRules("/homeowner-dashboard", "/app/homeowner-dashboard", homeownerTabTargets),
      { source: "/settings", destination: "/app/admin-dashboard/settings", permanent: false },
      { source: "/settings/:path*", destination: "/app/admin-dashboard/settings", permanent: false },
      // Legacy platform back-office; sub-paths collapse to the redesign
      // back-office root. Phase 4 step 4e reverses this direction.
      { source: "/owner", destination: "/app/owner", permanent: false },
      { source: "/owner/:path*", destination: "/app/owner", permanent: false },
    ];

    return legacyRedirects;
  },
  // Serve the marketing landing page at the domain root without changing the
  // URL. `/landing` still resolves to the same page; this makes "/" an alias
  // for it. beforeFiles so it wins ahead of any future filesystem root route.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/landing" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
