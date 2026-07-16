"use client";

import { Suspense } from "react";
import { OperatorProperties } from "@/components/redesign/properties/OperatorProperties";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorPropertiesInner() {
  const flagState = useRequireManagerFlag("can_view_properties");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorProperties />;
}

export default function OperatorPropertiesPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorPropertiesInner />
    </Suspense>
  );
}
