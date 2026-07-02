'use client';

import { TxnStatusBadge, money2, longDate } from '@/components/redesign/payments/payments-presenters';
import { paymentBadgeKey, paymentServiceLabel, type PaymentLike } from './derive-payments';

export function PaymentRow({ payment, onOpen }: { payment: PaymentLike; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-foreground">
          {paymentServiceLabel(payment)}
        </span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">
          {longDate(payment.paid_at || payment.created_at)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[15px] font-bold tabular-nums text-foreground">{money2(payment.amount)}</span>
        <TxnStatusBadge badge={paymentBadgeKey(payment.status)} />
      </span>
    </button>
  );
}
