import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';

export default function AccountServicesPage() {
  return (
    <div>
      <AccountSubHeader title="Browse services" />
      <div className="py-10">
        <EmptyState icon={<Sparkles />} title="Coming soon" description="Our cleaning services will appear here." />
      </div>
    </div>
  );
}
