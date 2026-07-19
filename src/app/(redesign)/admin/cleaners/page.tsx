"use client";

import { Suspense } from "react";
import { OperatorPeople } from "@/components/redesign/cleaners/OperatorPeople";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorCleanersInner() {
  const flagState = useRequireManagerFlag("can_manage_cleaners");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorPeople />;
}

export default function OperatorCleanersPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorCleanersInner />
    </Suspense>
  );
}
