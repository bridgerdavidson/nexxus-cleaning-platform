'use client';

import { ChevronLeft, Receipt as ReceiptIcon } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { TxnStatusBadge, money2, longDate } from '@/components/redesign/payments/payments-presenters';
import { paymentBadgeKey, paymentServiceLabel, type PaymentLike } from './derive-payments';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function PaymentReceipt({
  payment,
  onClose,
}: {
  payment: PaymentLike | null;
  onClose: () => void;
}) {
  return (
    <MobileTakeover ariaLabel="Receipt" keyboardAware={false} onClosed={onClose}>
      {(close) => (
        <>
          <div className="flex items-center gap-2 border-b border-border px-2">
            <button
              onClick={close}
              aria-label="Back"
              className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-6" />
            </button>
            <div className="min-w-0 flex-1 py-2">
              <div className="truncate text-sm font-bold">Receipt</div>
            </div>
            <div className="w-1" />
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              {!payment ? (
                <div className="pt-10">
                  <EmptyState
                    icon={<ReceiptIcon />}
                    title="Receipt not available"
                    description="This receipt is no longer on your account."
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-2 pt-2 text-center">
                    <span className="text-3xl font-bold tabular-nums text-foreground">
                      {money2(payment.amount)}
                    </span>
                    <TxnStatusBadge badge={paymentBadgeKey(payment.status)} />
                  </div>

                  <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                    <div className="space-y-4">
                      <Field label="Service">{paymentServiceLabel(payment)}</Field>
                      <Separator />
                      <Field label="Date">{longDate(payment.paid_at || payment.created_at)}</Field>
                      {payment.appointment?.scheduled_date && (
                        <>
                          <Separator />
                          <Field label="Cleaning date">
                            {longDate(payment.appointment.scheduled_date)}
                          </Field>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </MobileTakeover>
  );
}
