"use client";

import { type ReactNode, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { CleanerShell } from "@/components/redesign/cleaner/shell/CleanerShell";
import { CleanerJobDetailHost } from "@/components/redesign/cleaner/job/CleanerJobDetailHost";
import { CleanerMessageThreadHost } from "@/components/redesign/cleaner/messages/CleanerMessageThreadHost";
import { CleanerJobThreadHost } from "@/components/redesign/cleaner/messages/CleanerJobThreadHost";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";

function Spinner() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

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

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (user.role && user.role !== "cleaner") return <Spinner />;

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
