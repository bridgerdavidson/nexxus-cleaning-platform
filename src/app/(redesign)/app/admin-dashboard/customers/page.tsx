"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorCustomers } from "@/components/redesign/customers/OperatorCustomers";

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

function OperatorCustomersInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;

  // The "New booking" quick-action and FAB aren't redesigned yet, so hand off
  // to the legacy flow. (Adding a customer is handled in-screen by the invite
  // dialog, not this shell action.)
  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");

  return (
    <OperatorShell active="people" onNewBooking={goNewBooking}>
      <OperatorCustomers />
    </OperatorShell>
  );
}

export default function OperatorCustomersPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorCustomersInner />
    </Suspense>
  );
}
