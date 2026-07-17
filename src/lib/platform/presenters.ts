import type { ComponentType } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import type { BadgeProps } from '@/components/ui/badge';

export type PillVariant = NonNullable<BadgeProps['variant']>;
type IconType = ComponentType<{ className?: string }>;

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Format integer cents as a USD string, e.g. 286330 -> "$2,863.30". */
export function formatCents(cents: number): string {
  return USD.format((cents ?? 0) / 100);
}

export interface PillMeta {
  variant: PillVariant;
  label: string;
  Icon: IconType;
}

/** Subscription status to pill meta. Unknown statuses render as a neutral "No plan". */
export function subscriptionPillMeta(status: string): PillMeta {
  switch (status) {
    case 'active':
      return { variant: 'positive', label: 'Active', Icon: CheckCircle2 };
    case 'trialing':
      return { variant: 'caution', label: 'Trial', Icon: Clock };
    case 'past_due':
      return { variant: 'critical', label: 'Past due', Icon: AlertTriangle };
    case 'canceled':
    case 'cancelled':
      return { variant: 'secondary', label: 'Canceled', Icon: XCircle };
    default:
      return { variant: 'secondary', label: 'No plan', Icon: MinusCircle };
  }
}

export interface PaymentsConnectState {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
}

/** Stripe Connect readiness to pill meta (mirrors the legacy PaymentsBadge derivation). */
export function paymentsPillMeta(org: PaymentsConnectState): PillMeta {
  if (org.stripe_connect_charges_enabled && org.stripe_connect_payouts_enabled) {
    return { variant: 'positive', label: 'Ready', Icon: CheckCircle2 };
  }
  if (org.stripe_connect_account_id) {
    return { variant: 'caution', label: 'Onboarding', Icon: Clock };
  }
  return { variant: 'secondary', label: 'Not connected', Icon: MinusCircle };
}

export interface AuditActionMeta {
  label: string;
  variant: PillVariant;
}

const AUDIT_ACTIONS: Record<string, AuditActionMeta> = {
  impersonation_start: { label: 'Viewed as company', variant: 'info' },
  impersonation_end: { label: 'Ended view-as', variant: 'secondary' },
  reset_tenant_connect: { label: 'Reset tenant Connect', variant: 'caution' },
  reset_cleaner_connect: { label: 'Reset cleaner Connect', variant: 'caution' },
  delete_tenant: { label: 'Deleted tenant', variant: 'critical' },
  provision_tenant: { label: 'Provisioned tenant', variant: 'positive' },
};

/**
 * Friendly label + Badge variant for an audit action. Unknown actions are
 * humanized (underscores to spaces, first letter capitalized) so a newly added
 * action type still renders sensibly without a code change.
 */
export function auditActionMeta(action: string): AuditActionMeta {
  return (
    AUDIT_ACTIONS[action] ?? {
      label: action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      variant: 'default',
    }
  );
}
