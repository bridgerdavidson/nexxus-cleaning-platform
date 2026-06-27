import { EmptyState } from "@/components/ui/empty-state";
import { MessageSquare } from "lucide-react";

export default function CleanerMessagesPage() {
  return (
    <EmptyState
      icon={<MessageSquare />}
      title="Messages is coming soon"
      description="Chat with your operator will live here."
    />
  );
}
