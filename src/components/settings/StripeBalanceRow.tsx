'use client';

interface BalanceCell {
  label: string;
  /** Whole-dollar number. Pass null while loading. */
  amount: number | null;
  /** Small caption under the amount (e.g. "Ready to pay out", "Expected Jun 2"). */
  meta?: string;
}

interface StripeBalanceRowProps {
  available: number | null;
  inTransit: number | null;
  nextPayout: number | null;
  /** Short text after the next-payout amount — e.g. "Expected Jun 2 → •••6789". */
  nextPayoutMeta?: string;
  /** When true, all three cells render skeletons. */
  loading?: boolean;
}

/**
 * Single 3-cell balance row. Replaces the duplicated Stripe `<ConnectBalances />`
 * markup that used to render twice on every tenant/cleaner Payments page.
 */
export default function StripeBalanceRow({
  available,
  inTransit,
  nextPayout,
  nextPayoutMeta,
  loading,
}: StripeBalanceRowProps) {
  const cells: BalanceCell[] = [
    {
      label: 'Available',
      amount: loading ? null : available,
      meta: 'Ready to pay out',
    },
    {
      label: 'In transit',
      amount: loading ? null : inTransit,
      meta: 'Settling from cards',
    },
    {
      label: 'Next payout',
      amount: loading ? null : nextPayout,
      meta: nextPayoutMeta ?? '—',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-xl bg-gray-50 px-4 py-3.5"
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            {c.label}
          </div>
          <div className="mt-1.5 text-2xl font-extrabold tracking-tight text-gray-900 tabular-nums">
            {c.amount === null ? (
              <span className="inline-block h-7 w-24 animate-pulse rounded bg-gray-200" />
            ) : (
              formatUSD(c.amount)
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">{c.meta}</div>
        </div>
      ))}
    </div>
  );
}

function formatUSD(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}
