import { CreditCard } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';

export default function AccountPaymentMethodsPage() {
  return (
    <div>
      <AccountSubHeader title="Payment methods" />
      <div className="py-10">
        <EmptyState icon={<CreditCard />} title="Coming soon" description="Your saved cards will appear here." />
      </div>
    </div>
  );
}
