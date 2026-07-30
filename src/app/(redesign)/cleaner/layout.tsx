"use client";

import { type ReactNode, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { CleanerShell } from "@/components/redesign/cleaner/shell/CleanerShell";
import { CleanerJobDetailHost } from "@/components/redesign/cleaner/job/CleanerJobDetailHost";
import { CleanerMessageThreadHost } from "@/components/redesign/cleaner/messages/CleanerMessageThreadHost";
import { CleanerJobThreadHost } from "@/components/redesign/cleaner/messages/CleanerJobThreadHost";
import { FullPageLoader } from "@/components/ui/nexxus-loader";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";

export default function CleanerDashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    // Soft role guard: non-cleaners get redirected to their own dashboard so a
    // deep link does not strand them on the cleaner shell.
    if (user.role && user.role !== "cleaner") {
      router.push(getDashboardPath(user.role));
    }
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <FullPageLoader />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (user.role && user.role !== "cleaner") return <FullPageLoader />;

  return (
    <>
      <CleanerShell>{children}</CleanerShell>
      <Suspense fallback={null}>
        <CleanerJobDetailHost />
      </Suspense>
      <Suspense fallback={null}>
        <CleanerMessageThreadHost />
      </Suspense>
      <Suspense fallback={null}>
        <CleanerJobThreadHost />
      </Suspense>
    </>
  );
}
