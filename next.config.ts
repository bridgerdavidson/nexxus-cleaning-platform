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
    return [
      {
        source: "/",
        destination: "/login",
        permanent: false,
        ...(marketingHost ? { missing: [{ type: "host" as const, value: marketingHost }] } : {}),
      },
    ];
  },
};

export default nextConfig;
