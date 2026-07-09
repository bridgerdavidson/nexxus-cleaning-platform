"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorPayments } from "@/components/redesign/payments/OperatorPayments";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

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

function OperatorPaymentsInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  const flagState = useRequireManagerFlag("can_view_payments");

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (flagState === "checking") return <Spinner />;

  // The "New booking" quick-action isn't redesigned yet, so hand off to legacy.
  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");

  return (
    <OperatorShell active="payments" onNewBooking={goNewBooking}>
      <OperatorPayments />
    </OperatorShell>
  );
}

export default function OperatorPaymentsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorPaymentsInner />
    </Suspense>
  );
}
