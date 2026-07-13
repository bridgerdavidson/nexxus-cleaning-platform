"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorProperties } from "@/components/redesign/properties/OperatorProperties";
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

function OperatorPropertiesInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  const flagState = useRequireManagerFlag("can_view_properties");

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  if (flagState === "checking") return <Spinner />;

  return (
    <OperatorShell active="properties">
      <OperatorProperties />
    </OperatorShell>
  );
}

export default function OperatorPropertiesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorPropertiesInner />
    </Suspense>
  );
}
