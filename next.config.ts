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
    // Legacy + prefix-era route retirement (cutover runbook Phase 4, step 4e).
    // The redesign is the app and owns the top-level URLs now: the role roots
    // are /admin, /cleaner, /homeowner, /owner (4e removed the /app prefix AND
    // the -dashboard suffix). Two bookmark classes still redirect so old links
    // keep working:
    //   (1) prefix-era  /app/<role>-dashboard/*  → /<root>/*
    //   (2) legacy-era  /<role>-dashboard, /settings, ?tab= deep links → new roots
    // All 308 (permanent) as of step 4f, now that 4e has soaked in prod. Every
    // target below resolves to a live redesign route (verified in 4f), so
    // permanent caching is safe. Permanent is correct only in THIS direction
    // (pointing OUT of /app, at the final roots) — a cached 308 pointing INTO
    // /app is why the old into-/app 307→308 graduation was cancelled. Next
    // appends the original query string to the destination.

    // Legacy ?tab= ids → redesign sub-routes, per dashboard source. Mapping each
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
        permanent: true,
      })),
      { source, destination: base, permanent: true },
    ];

    // Prefix-era bookmarks (the /app/* era, between the flip and 4e): strip the
    // /app prefix and the -dashboard suffix. `:path*` matches zero segments too,
    // so each rule also covers its bare root (e.g. /app/admin-dashboard → /admin).
    const prefixEraRedirects = [
      { source: "/app/admin-dashboard/:path*", destination: "/admin/:path*", permanent: true },
      { source: "/app/cleaner-dashboard/:path*", destination: "/cleaner/:path*", permanent: true },
      { source: "/app/homeowner-dashboard/:path*", destination: "/homeowner/:path*", permanent: true },
      { source: "/app/owner/:path*", destination: "/owner/:path*", permanent: true },
    ];

    // Legacy-era bookmarks (pre-redesign URLs). Targets lose the -dashboard
    // suffix. /owner is intentionally NOT here: the redesign back-office serves
    // that URL natively now that legacy src/app/owner is gone.
    const legacyRedirects = [
      // Manager shares the operator shell (and the same tab ids) as admin.
      ...tabRules("/admin-dashboard", "/admin", adminTabTargets),
      ...tabRules("/manager-dashboard", "/admin", adminTabTargets),
      ...tabRules("/cleaner-dashboard", "/cleaner", cleanerTabTargets),
      ...tabRules("/homeowner-dashboard", "/homeowner", homeownerTabTargets),
      { source: "/settings", destination: "/admin/settings", permanent: true },
      { source: "/settings/:path*", destination: "/admin/settings", permanent: true },
    ];

    return [...prefixEraRedirects, ...legacyRedirects];
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
