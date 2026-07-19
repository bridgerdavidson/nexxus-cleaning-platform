"use client";

import { Suspense } from "react";
import { OperatorAnalytics } from "@/components/redesign/analytics/OperatorAnalytics";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorAnalyticsInner() {
  const flagState = useRequireManagerFlag("can_view_analytics");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorAnalytics />;
}

export default function OperatorAnalyticsPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorAnalyticsInner />
    </Suspense>
  );
}
