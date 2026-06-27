import { EmptyState } from "@/components/ui/empty-state";
import { User } from "lucide-react";

export default function CleanerProfilePage() {
  return (
    <EmptyState
      icon={<User />}
      title="Profile is coming soon"
      description="Your details, availability, and settings will live here."
    />
  );
}
