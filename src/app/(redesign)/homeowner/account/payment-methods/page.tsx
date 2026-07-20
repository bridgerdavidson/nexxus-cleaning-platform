import { AccountSubHeader } from '@/components/redesign/homeowner/account/AccountSubHeader';
import { HomeownerPaymentMethods } from '@/components/redesign/homeowner/account/payment-methods/HomeownerPaymentMethods';

export default function AccountPaymentMethodsPage() {
  return (
    <div>
      <AccountSubHeader title="Payment methods" />
      <HomeownerPaymentMethods />
    </div>
  );
}
