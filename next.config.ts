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
  // The marketing landing page is gone (invite-only product). Send the domain
  // root straight to the login page. Temporary (307) on purpose, not a cached
  // permanent redirect, so this stays easy to revisit.
  async redirects() {
    return [
      {
        source: "/",
        destination: "/login",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
