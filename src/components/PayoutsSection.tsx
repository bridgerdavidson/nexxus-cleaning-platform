'use client';

import CleanerStripeConnect from './CleanerStripeConnect';
import TenantStripeConnect from './TenantStripeConnect';

type PayoutsVariant = 'cleaner' | 'tenant';

interface PayoutsSectionProps {
  /** Which connected account the embed shows: the cleaner's own, or the org/tenant's. */
  variant: PayoutsVariant;
  /** True once Stripe onboarding is complete (cleaner) / charges are enabled (tenant). */
  connected: boolean;
}

/**
 * The single source of truth for "show me my payouts" everywhere in the app.
 *
 * Wraps the embedded Stripe Connect payouts table (`<ConnectPayouts/>`, rendered by
 * `CleanerStripeConnect` / `TenantStripeConnect`) in a titled section card. We lean on
 * Stripe's embed instead of hand-built balance cards so the numbers can never drift from
 * what Stripe actually holds and pays out.
 *
 * Used on /settings/payments (tenant), /settings/payouts (cleaner), and the cleaner
 * dashboard Earnings tab. The embed components handle onboarding-vs-payouts and the
 * `StripeFramedCard` framing internally — this component only owns the header copy.
 */
export default function PayoutsSection({ variant, connected }: PayoutsSectionProps) {
  const copy = SECTION_COPY[variant][connected ? 'connected' : 'disconnected'];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">{copy.title}</h2>
        <p className="text-sm text-gray-500">{copy.subtitle}</p>
      </div>
      {variant === 'cleaner' ? <CleanerStripeConnect /> : <TenantStripeConnect />}
    </section>
  );
}

const CONNECTED_COPY = {
  title: 'Payouts to your bank',
  subtitle:
    "Your Stripe balance, the next payout on its way, and what's already landed in your bank.",
};

const SECTION_COPY: Record<
  PayoutsVariant,
  { connected: { title: string; subtitle: string }; disconnected: { title: string; subtitle: string } }
> = {
  cleaner: {
    connected: CONNECTED_COPY,
    disconnected: {
      title: 'Connect your bank account',
      subtitle: 'Finish Stripe setup to receive automatic payouts when jobs complete.',
    },
  },
  tenant: {
    connected: CONNECTED_COPY,
    disconnected: {
      title: 'Connect your business',
      subtitle: 'Tell Stripe a bit about your company so homeowner payments can land in your bank.',
    },
  },
};
