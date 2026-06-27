import { EmptyState } from "@/components/ui/empty-state";
import { DollarSign } from "lucide-react";

export default function CleanerEarningsPage() {
  return (
    <EmptyState
      icon={<DollarSign />}
      title="Earnings is coming soon"
      description="Your payouts and what you've earned will show up here."
    />
  );
}
