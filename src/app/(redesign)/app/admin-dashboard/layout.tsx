"use client";

import { type ReactNode, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";

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

/**
 * Operator (admin + manager) dashboard layout. Owns the auth/org guard and
 * mounts OperatorShell ONCE for the whole tree (mirrors the cleaner and
 * homeowner dashboard layouts), so the shell chrome (rail, top bar, bottom
 * nav) persists across tab navigations and only the content area swaps.
 * Per-screen manager-permission guards stay in each page
 * (useRequireManagerFlag). The Suspense boundary exists because the shell's
 * global hosts read search params (?booking=, ?newbooking=), which requires
 * one during static prerender.
 */
export default function OperatorDashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;

  return (
    <Suspense fallback={<Spinner />}>
      <OperatorShell>{children}</OperatorShell>
    </Suspense>
  );
}
