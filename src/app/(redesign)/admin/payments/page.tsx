"use client";

import { Suspense } from "react";
import { OperatorPayments } from "@/components/redesign/payments/OperatorPayments";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorPaymentsInner() {
  const flagState = useRequireManagerFlag("can_view_payments");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorPayments />;
}

export default function OperatorPaymentsPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorPaymentsInner />
    </Suspense>
  );
}
