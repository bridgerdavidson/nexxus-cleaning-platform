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
  // The app domain root goes straight to login (invite-only product). The
  // marketing subdomain is excluded: config redirects run BEFORE middleware,
  // so without the `missing` guard this would swallow the middleware rewrite
  // that serves /landing on MARKETING_HOST. Temporary (307) on purpose, not a
  // cached permanent redirect, so this stays easy to revisit.
  async redirects() {
    const marketingHost = process.env.MARKETING_HOST;

    // Legacy-route retirement (cutover runbook Phase 3). When the redesign is
    // the active experience — the SAME three-arm gate as
    // src/app/(redesign)/layout.tsx, evaluated at build time — every legacy
    // dashboard/settings URL redirects into its /app/* replacement so no
    // legacy screen stays reachable. Deliberately temporary (307), never 308:
    // rolling back the flag must not fight browser-cached permanent
    // redirects. Graduate to permanent when the legacy pages are deleted
    // (runbook Phase 4). Next appends the original query string to the
    // destination (?tab=... rides along); the redesign routes ignore it.
    const redesignActive =
      process.env.NODE_ENV !== "production" ||
      process.env.VERCEL_ENV === "preview" ||
      process.env.NEXT_PUBLIC_REDESIGN_ENABLED === "true";

    // Legacy ?tab= ids (ADMIN_MANAGER_DASHBOARD_TAB_IDS) → redesign routes.
    // team + invites fold into Cleaners & team in the redesign.
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

    const legacyRedirects = redesignActive
      ? [
          // Tab deep-links first (first match wins), then the plain roots.
          ...Object.entries(adminTabTargets).map(([tab, path]) => ({
            source: "/admin-dashboard",
            has: [{ type: "query" as const, key: "tab", value: tab }],
            destination: `/app/admin-dashboard${path}`,
            permanent: false,
          })),
          { source: "/admin-dashboard", destination: "/app/admin-dashboard", permanent: false },
          { source: "/manager-dashboard", destination: "/app/admin-dashboard", permanent: false },
          { source: "/cleaner-dashboard", destination: "/app/cleaner-dashboard", permanent: false },
          { source: "/homeowner-dashboard", destination: "/app/homeowner-dashboard", permanent: false },
          { source: "/settings", destination: "/app/admin-dashboard/settings", permanent: false },
          { source: "/settings/:path*", destination: "/app/admin-dashboard/settings", permanent: false },
        ]
      : [];

    return [
      {
        source: "/",
        destination: "/login",
        permanent: false,
        ...(marketingHost ? { missing: [{ type: "host" as const, value: marketingHost }] } : {}),
      },
      ...legacyRedirects,
    ];
  },
};

export default nextConfig;
