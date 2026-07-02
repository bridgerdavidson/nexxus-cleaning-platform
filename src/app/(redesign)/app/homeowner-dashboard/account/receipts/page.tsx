import { Receipt } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';

export default function AccountReceiptsPage() {
  return (
    <div>
      <AccountSubHeader title="Payment history" />
      <div className="py-10">
        <EmptyState icon={<Receipt />} title="Coming soon" description="Your receipts will appear here." />
      </div>
    </div>
  );
}
