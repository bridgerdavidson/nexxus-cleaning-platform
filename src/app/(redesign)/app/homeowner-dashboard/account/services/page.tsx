import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';
import { HomeownerServices } from '@/components/redesign/homeowner/account/services/HomeownerServices';

export default function AccountServicesPage() {
  return (
    <div>
      <AccountSubHeader title="Browse services" />
      <HomeownerServices />
    </div>
  );
}
