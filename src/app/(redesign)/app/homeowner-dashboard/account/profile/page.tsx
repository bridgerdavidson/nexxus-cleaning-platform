import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';
import { HomeownerProfile } from '@/components/redesign/homeowner/account/profile/HomeownerProfile';

export default function AccountProfilePage() {
  return (
    <div>
      <AccountSubHeader title="Profile" />
      <HomeownerProfile />
    </div>
  );
}
