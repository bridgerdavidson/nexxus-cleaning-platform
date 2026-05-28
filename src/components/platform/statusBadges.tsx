import { CheckCircle2, Clock, AlertTriangle, MinusCircle, CreditCard } from 'lucide-react';
import type { PlatformOrgSummary } from '@/types/platform';

const PILL = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium';

const SUBSCRIPTION: Record<
  string,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  active: { label: 'Active', cls: 'bg-green-100 text-green-700', Icon: CheckCircle2 },
  trialing: { label: 'Trial', cls: 'bg-amber-100 text-amber-700', Icon: Clock },
  past_due: { label: 'Past due', cls: 'bg-red-100 text-red-700', Icon: AlertTriangle },
  canceled: { label: 'Canceled', cls: 'bg-secondary-100 text-secondary-600', Icon: MinusCircle },
  none: { label: 'No plan', cls: 'bg-secondary-100 text-secondary-600', Icon: MinusCircle },
};

/** Tenant SaaS-subscription status. Pairs a color with an icon so meaning isn't color-only. */
export function SubscriptionBadge({ status }: { status: string }) {
  const s = SUBSCRIPTION[status] ?? SUBSCRIPTION.none;
  const { Icon } = s;
  return (
    <span className={`${PILL} ${s.cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {s.label}
    </span>
  );
}

type ConnectFields = Pick<
  PlatformOrgSummary,
  'stripe_connect_account_id' | 'stripe_connect_charges_enabled' | 'stripe_connect_payouts_enabled'
>;

/** Where the tenant is in Stripe Connect onboarding (their ability to take payments). */
export function PaymentsBadge({ org }: { org: ConnectFields }) {
  let label: string;
  let cls: string;
  if (org.stripe_connect_charges_enabled && org.stripe_connect_payouts_enabled) {
    label = 'Ready';
    cls = 'bg-green-100 text-green-700';
  } else if (org.stripe_connect_account_id) {
    label = 'Onboarding';
    cls = 'bg-amber-100 text-amber-700';
  } else {
    label = 'Not connected';
    cls = 'bg-secondary-100 text-secondary-600';
  }
  return (
    <span className={`${PILL} ${cls}`}>
      <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
