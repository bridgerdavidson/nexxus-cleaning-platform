"use client";

import { Suspense } from "react";
import OperatorMessages from "@/components/redesign/messages/OperatorMessages";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";
import { useRequireManagerFlag } from "@/lib/redesign/useRequireManagerFlag";

// Auth/org guarding and the shell live in ../layout.tsx; this page only keeps
// its per-screen manager-permission guard and the screen content.
function OperatorMessagesInner() {
  const flagState = useRequireManagerFlag("can_view_messages");
  if (flagState === "checking") return <ContentLoading />;
  return <OperatorMessages />;
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorMessagesInner />
    </Suspense>
  );
}
