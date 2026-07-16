"use client";

import { Suspense } from "react";
import { OperatorCustomers } from "@/components/redesign/customers/OperatorCustomers";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorCustomersInner() {
  const flagState = useRequireManagerFlag("can_view_customers");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorCustomers />;
}

export default function OperatorCustomersPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorCustomersInner />
    </Suspense>
  );
}
