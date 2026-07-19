"use client";

import { Suspense } from "react";
import { OperatorOverview } from "@/components/redesign/overview/OperatorOverview";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";

// Auth/org guarding and the shell live in ./layout.tsx; pages render only the
// screen content (plus a per-screen manager-permission guard where needed).
export default function OperatorOverviewPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorOverview />
    </Suspense>
  );
}
