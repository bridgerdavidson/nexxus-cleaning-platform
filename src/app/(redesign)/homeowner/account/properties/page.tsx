import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';
import { HomeownerProperties } from '@/components/redesign/homeowner/account/properties/HomeownerProperties';

export default function AccountPropertiesPage() {
  return (
    <div>
      <AccountSubHeader title="Properties" />
      <HomeownerProperties />
    </div>
  );
}
