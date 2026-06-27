import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays } from "lucide-react";

export default function CleanerSchedulePage() {
  return (
    <EmptyState
      icon={<CalendarDays />}
      title="Schedule is coming soon"
      description="Your full upcoming and past jobs will live here."
    />
  );
}
