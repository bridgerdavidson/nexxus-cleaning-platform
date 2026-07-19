"use client";

import { Suspense } from "react";
import { OperatorBookings } from "@/components/redesign/bookings/OperatorBookings";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorBookingsInner() {
  const flagState = useRequireManagerFlag("can_view_bookings");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorBookings />;
}

export default function OperatorBookingsPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorBookingsInner />
    </Suspense>
  );
}
