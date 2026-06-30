"use client";

import { type ReactNode, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { HomeownerShell } from "@/components/redesign/homeowner/shell/HomeownerShell";
import { HomeownerCleaningDetailHost } from "@/components/redesign/homeowner/cleanings/HomeownerCleaningDetailHost";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";
import { redesignUiEnabled } from "@/lib/redesign/flags";

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
      router.push(getDashboardPath(user.role, { redesign: redesignUiEnabled() }));
    }
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading")
    return <Spinner />;
  if (orgStatus === "error")
    return (
      <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />
    );
  if (user.role && user.role !== "homeowner") return <Spinner />;

  return (
    <>
      <HomeownerShell>{children}</HomeownerShell>
      <Suspense fallback={null}>
        <HomeownerCleaningDetailHost />
      </Suspense>
    </>
  );
}
