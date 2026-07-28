"use client";

import { type ReactNode, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { HomeownerShell } from "@/components/redesign/homeowner/shell/HomeownerShell";
import { HomeownerCleaningDetailHost } from "@/components/redesign/homeowner/cleanings/HomeownerCleaningDetailHost";
import { HomeownerMessageThreadHost } from "@/components/redesign/homeowner/messages/HomeownerMessageThreadHost";
import { BookingFlowHost } from "@/components/redesign/homeowner/booking/BookingFlowHost";
import { FullPageLoader } from "@/components/ui/nexxus-loader";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";

export default function HomeownerDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    // Soft role guard: non-homeowners get redirected to their own dashboard so a
    // deep link does not strand them on the homeowner shell.
    if (user.role && user.role !== "homeowner") {
      router.push(getDashboardPath(user.role));
    }
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading")
    return <FullPageLoader />;
  if (orgStatus === "error")
    return (
      <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />
    );
  if (user.role && user.role !== "homeowner") return <FullPageLoader />;

  return (
    <>
      <HomeownerShell>{children}</HomeownerShell>
      <Suspense fallback={null}>
        <HomeownerCleaningDetailHost />
      </Suspense>
      <Suspense fallback={null}>
        <HomeownerMessageThreadHost />
      </Suspense>
      <Suspense fallback={null}>
        <BookingFlowHost />
      </Suspense>
    </>
  );
}
