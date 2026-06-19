"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorOverview } from "@/components/redesign/overview/OperatorOverview";

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function OperatorOverviewInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;

  return (
    <OperatorShell
      active="overview"
      // New booking isn't redesigned yet — hand off to the legacy bookings flow
      // so the primary action works instead of silently doing nothing.
      onNewBooking={() => router.push("/admin-dashboard?tab=bookings")}
    >
      <OperatorOverview />
    </OperatorShell>
  );
}

export default function OperatorOverviewPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorOverviewInner />
    </Suspense>
  );
}
