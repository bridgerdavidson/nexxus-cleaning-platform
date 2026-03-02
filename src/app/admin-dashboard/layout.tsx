import { SpeedInsights } from "@vercel/speed-insights/next";

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <SpeedInsights />
    </>
  );
}
