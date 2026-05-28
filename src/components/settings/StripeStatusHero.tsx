'use client';

import { ReactNode } from 'react';
import { CheckCircle, AlertTriangle, CreditCard, ExternalLink, Loader2 } from 'lucide-react';

export type StripeStatusKind = 'active' | 'pending' | 'inactive' | 'loading';

interface StripeStatusHeroProps {
  status: StripeStatusKind;
  /** Bold one-line headline (e.g. "Payments are active"). */
  title: string;
  /** Supporting copy with account id hint, schedule, etc. */
  description: ReactNode;
  /** Optional right-side CTA. Pass `null` to omit. */
  action?: ReactNode;
}

/**
 * Gradient hero card that replaces the inline "Payments connected" H2 across all
 * Stripe-bearing settings pages. Same look for tenant and cleaner; the `status`
 * prop drives the icon color and the small label above the title.
 */
export default function StripeStatusHero({
  status,
  title,
  description,
  action,
}: StripeStatusHeroProps) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div
      className={`mb-6 grid grid-cols-1 items-center gap-4 rounded-2xl border ${cfg.border} ${cfg.bg} p-5 sm:grid-cols-[1fr_auto] sm:p-6`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-white ${cfg.iconBg}`}
          aria-hidden="true"
        >
          <cfg.Icon className="h-5 w-5" />
        </div>
        <div>
          <div
            className={`text-[11px] font-bold uppercase tracking-wider ${cfg.labelColor}`}
          >
            {cfg.label}
          </div>
          <h2 className="mt-0.5 text-lg font-bold text-gray-900">{title}</h2>
          <div className="mt-1 text-sm text-gray-600">{description}</div>
        </div>
      </div>
      {action !== null && action !== undefined ? (
        <div className="flex flex-shrink-0 justify-start sm:justify-end">{action}</div>
      ) : null}
    </div>
  );
}

const STATUS_CONFIG = {
  active: {
    label: 'Connected',
    Icon: CheckCircle,
    iconBg: 'bg-success-600',
    bg: 'bg-gradient-to-br from-primary-50 to-yellow-50',
    border: 'border-amber-300',
    labelColor: 'text-success-700',
  },
  pending: {
    label: 'Verifying',
    Icon: AlertTriangle,
    iconBg: 'bg-amber-500',
    bg: 'bg-gradient-to-br from-amber-50 to-yellow-50',
    border: 'border-amber-300',
    labelColor: 'text-amber-700',
  },
  inactive: {
    label: 'Not connected',
    Icon: CreditCard,
    iconBg: 'bg-gray-400',
    bg: 'bg-gradient-to-br from-gray-50 to-slate-50',
    border: 'border-gray-200',
    labelColor: 'text-gray-500',
  },
  loading: {
    label: 'Loading',
    Icon: Loader2,
    iconBg: 'bg-gray-300',
    bg: 'bg-gradient-to-br from-gray-50 to-slate-50',
    border: 'border-gray-200',
    labelColor: 'text-gray-500',
  },
} as const satisfies Record<
  StripeStatusKind,
  {
    label: string;
    Icon: typeof CheckCircle;
    iconBg: string;
    bg: string;
    border: string;
    labelColor: string;
  }
>;

/**
 * Re-export of the standard hero CTA — keeps callers consistent.
 */
export function OpenStripeDashboardButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ExternalLink className="h-4 w-4" />
      )}
      Open Stripe dashboard
    </button>
  );
}
