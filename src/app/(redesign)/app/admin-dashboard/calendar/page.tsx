"use client";

import { Suspense } from "react";
import { OperatorCalendar } from "@/components/redesign/calendar/OperatorCalendar";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorCalendarInner() {
  const flagState = useRequireManagerFlag("can_view_bookings");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorCalendar />;
}

export default function OperatorCalendarPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorCalendarInner />
    </Suspense>
  );
}
