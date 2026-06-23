"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorServices } from "@/components/redesign/services/OperatorServices";

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

function OperatorServicesInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;

  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");

  return (
    <OperatorShell active="services" onNewBooking={goNewBooking}>
      <OperatorServices />
    </OperatorShell>
  );
}

export default function OperatorServicesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorServicesInner />
    </Suspense>
  );
}
