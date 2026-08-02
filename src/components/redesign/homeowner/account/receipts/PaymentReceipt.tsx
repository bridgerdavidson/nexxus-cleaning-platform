'use client';

import { ChevronLeft, Receipt as ReceiptIcon } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { TxnStatusBadge, money2, longDate } from '@/components/redesign/payments/payments-presenters';
import {
  isCancellationFee,
  paymentBadgeKey,
  paymentFeeBreakdown,
  paymentServiceLabel,
  type PaymentLike,
} from './derive-payments';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function MoneyRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'text-sm font-semibold text-foreground' : 'text-sm text-muted-foreground'}>
        {label}
      </span>
      <span
        className={
          strong
            ? 'text-sm font-semibold tabular-nums text-foreground'
            : 'text-sm tabular-nums text-foreground'
        }
      >
        {money2(value)}
      </span>
    </div>
  );
}

export function PaymentReceipt({
  payment,
  onClose,
  loading = false,
  error = false,
  onRetry,
  onPayNow,
  onUpdateCard,
  paying,
  payError,
}: {
  payment: PaymentLike | null;
  onClose: () => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onPayNow?: () => void;
  onUpdateCard?: () => void;
  paying?: boolean;
  payError?: string | null;
}) {
  const fees = payment ? paymentFeeBreakdown(payment) : null;

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
              {error ? (
                <div className="pt-10">
                  <ErrorState title="Couldn't load receipt" onRetry={onRetry} />
                </div>
              ) : !payment && loading ? (
                // The receipt can be opened straight from a deep link before the payments query
                // resolves. Show a skeleton, never the "no longer on your account" empty state,
                // until we actually know the payment isn't there.
                <div className="space-y-5" aria-busy="true" aria-label="Loading receipt">
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-40 w-full rounded-card" />
                </div>
              ) : !payment ? (
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
                    {isCancellationFee(payment) && (
                      <span className="text-sm font-medium text-muted-foreground">Cancellation fee</span>
                    )}
                  </div>

                  <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                    <div className="space-y-4">
                      <Field label={isCancellationFee(payment) ? 'Charge for' : 'Service'}>
                        {paymentServiceLabel(payment)}
                      </Field>

                      {fees && (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <MoneyRow
                              label={isCancellationFee(payment) ? 'Fee' : 'Subtotal'}
                              value={fees.subtotal}
                            />
                            <MoneyRow label="Processing fee" value={fees.fee} />
                            <MoneyRow label="Total charged" value={fees.total} strong />
                          </div>
                        </>
                      )}

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

                  {isCancellationFee(payment) && payment.status === 'failed' ? (
                    <div className="space-y-2">
                      {payment.payment_intent_status === 'requires_action' ? (
                        <p className="text-sm text-muted-foreground">
                          Your bank needs to verify this card. Update your card to continue.
                        </p>
                      ) : null}
                      {payError ? <p className="text-sm text-critical-700">{payError}</p> : null}
                      <div className="flex flex-col gap-2">
                        {payment.payment_intent_status !== 'requires_action' && onPayNow ? (
                          <Button loading={paying} onClick={onPayNow}>
                            Pay now
                          </Button>
                        ) : null}
                        {onUpdateCard ? (
                          <Button variant="secondary" disabled={paying} onClick={onUpdateCard}>
                            Update card
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </MobileTakeover>
  );
}
