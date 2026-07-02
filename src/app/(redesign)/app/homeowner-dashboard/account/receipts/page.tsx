import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';
import { HomeownerPaymentHistory } from '@/components/redesign/homeowner/account/receipts/HomeownerPaymentHistory';

export default function AccountReceiptsPage() {
  return (
    <div>
      <AccountSubHeader title="Payment history" />
      <HomeownerPaymentHistory />
    </div>
  );
}
