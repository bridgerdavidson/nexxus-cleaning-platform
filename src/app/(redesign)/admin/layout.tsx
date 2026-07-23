"use client";

import { type ReactNode, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
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
  const { user, loading, orgStatus, reloadOrganization, impersonatingOrgId } = useAuth();

  // Soft role guard. The operator shell legitimately serves admin AND manager,
  // and a platform admin "viewing as" a tenant is pushed here too
  // (TenantDetailSheet → /admin), so this is a denylist of the two
  // roles that belong elsewhere rather than the sibling layouts' single-role
  // allowlist: a cleaner or homeowner with a stale bookmark (every legacy role's
  // chrome carried a /settings link that now 307s into this shell) gets sent
  // back to their own dashboard instead of stranding on empty org queries.
  const wrongRole =
    !impersonatingOrgId && (user?.role === "cleaner" || user?.role === "homeowner");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (wrongRole) {
      router.push(getDashboardPath(user.role));
    }
  }, [user, loading, router, wrongRole]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (wrongRole) return <Spinner />;

  return (
    <Suspense fallback={<Spinner />}>
      <OperatorShell>{children}</OperatorShell>
    </Suspense>
  );
}
