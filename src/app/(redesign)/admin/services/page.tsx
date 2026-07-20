"use client";

import { Suspense } from "react";
import { OperatorServices } from "@/components/redesign/services/OperatorServices";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorServicesInner() {
  const flagState = useRequireManagerFlag("can_view_services");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorServices />;
}

export default function OperatorServicesPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorServicesInner />
    </Suspense>
  );
}
