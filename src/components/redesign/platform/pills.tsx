import { Badge } from '@/components/ui/badge';
import {
  subscriptionPillMeta,
  paymentsPillMeta,
  type PaymentsConnectState,
} from '@/lib/platform/presenters';

/** Subscription status pill (icon + label), built on the design-system Badge. */
export function SubscriptionPill({ status, className }: { status: string; className?: string }) {
  const { variant, label, Icon } = subscriptionPillMeta(status);
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {label}
    </Badge>
  );
}

/** Stripe Connect readiness pill (Ready / Onboarding / Not connected). */
export function PaymentsPill({ org, className }: { org: PaymentsConnectState; className?: string }) {
  const { variant, label, Icon } = paymentsPillMeta(org);
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {label}
    </Badge>
  );
}
