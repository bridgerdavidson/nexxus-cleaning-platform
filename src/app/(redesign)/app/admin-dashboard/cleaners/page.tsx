"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorPeople } from "@/components/redesign/cleaners/OperatorPeople";
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

function OperatorCleanersInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  const flagState = useRequireManagerFlag("can_manage_cleaners");

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (flagState === "checking") return <Spinner />;

  // The "New booking" quick-action and FAB aren't redesigned yet, so hand off to
  // the legacy flow. (Inviting a cleaner is handled in-screen by the dialog.)
  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");

  return (
    <OperatorShell active="cleaners" onNewBooking={goNewBooking}>
      <OperatorPeople />
    </OperatorShell>
  );
}

export default function OperatorCleanersPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorCleanersInner />
    </Suspense>
  );
}
