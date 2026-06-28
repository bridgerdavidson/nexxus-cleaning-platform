import { Suspense } from "react";
import { CleanerMessages } from "@/components/redesign/cleaner/messages/CleanerMessages";

export default function CleanerMessagesPage() {
  return (
    <Suspense fallback={null}>
      <CleanerMessages />
    </Suspense>
  );
}
