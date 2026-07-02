import { Home } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';

export default function AccountPropertiesPage() {
  return (
    <div>
      <AccountSubHeader title="Properties" />
      <div className="py-10">
        <EmptyState icon={<Home />} title="Coming soon" description="Your homes will appear here." />
      </div>
    </div>
  );
}
