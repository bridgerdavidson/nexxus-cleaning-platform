'use client';

import { CreditCard, Landmark, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Property } from '@/hooks/useHomeownerData';
import type { ServiceType } from '@/hooks/useServices';
import type { SavedPaymentMethod } from '../account/payment-methods/derive-payment-methods';
import { paymentMethodTitle } from '../account/payment-methods/derive-payment-methods';
import type { BookingState } from './booking-types';
import { canSend, formatSlotLabel, slotOrdinal, bookingTotal } from './deriveBooking';

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export interface BookingReviewViewProps {
  state: BookingState;
  property: Property | null;
  service: ServiceType | null;
  paymentRequired: boolean;
  card: SavedPaymentMethod | null;
  onOpenCard: () => void;
  onSend: () => void;
  submitting: boolean;
}

function SummaryLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-semibold text-foreground">{children}</span>
    </div>
  );
}

export function BookingReviewView({
  state,
  property,
  service,
  paymentRequired,
  card,
  onOpenCard,
  onSend,
  submitting,
}: BookingReviewViewProps) {
  const total = service ? bookingTotal(service.base_price, state.method) : null;

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-4 pb-6">
          <p className="text-sm text-muted-foreground">One last look. You can still go back and change anything.</p>

          <div className="divide-y divide-border rounded-card border border-border bg-card px-4 shadow-soft-sm">
            <SummaryLine label="Home">{property?.name ?? '-'}</SummaryLine>
            <SummaryLine label="Service">{service?.name ?? '-'}</SummaryLine>
            <SummaryLine label="Preferred">
              <span className="flex flex-col items-end gap-0.5">
                {state.slots.map((s, i) => (
                  <span key={i}>
                    <span className="text-muted-foreground">{slotOrdinal(i)} </span>
                    {formatSlotLabel(s)}
                  </span>
                ))}
              </span>
            </SummaryLine>
            {state.notes.trim() && <SummaryLine label="Notes">{state.notes.trim()}</SummaryLine>}
          </div>

          {paymentRequired && (
            <div className="space-y-2">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Payment method
              </p>
              <button
                type="button"
                onClick={onOpenCard}
                className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
                  {card?.type === 'us_bank_account' ? (
                    <Landmark className="size-5" aria-hidden />
                  ) : (
                    <CreditCard className="size-5" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {card ? (
                    <>
                      <div className="truncate text-sm font-bold text-foreground">{paymentMethodTitle(card)}</div>
                      <div className="text-xs text-muted-foreground">Charged when the job is done</div>
                    </>
                  ) : (
                    <div className="text-sm font-semibold text-muted-foreground">Add a payment method</div>
                  )}
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </div>
          )}

          {total && (
            <div className="rounded-card bg-brand-50 p-4">
              <div className="flex justify-between py-0.5 text-sm">
                <span className="text-muted-foreground">Service</span>
                <span className="tabular-nums">{money(total.baseUsd)}</span>
              </div>
              {paymentRequired && total.feeUsd > 0 && (
                <div className="flex justify-between py-0.5 text-sm">
                  <span className="text-muted-foreground">Processing fee</span>
                  <span className="tabular-nums">{money(total.feeUsd)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between text-[15px] font-extrabold">
                <span>Total when completed</span>
                <span className="tabular-nums">{money(paymentRequired ? total.totalUsd : total.baseUsd)}</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>You are not charged now.</span>
                <Badge variant="positive">No upfront hold</Badge>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-card px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <Button
          className="w-full"
          loading={submitting}
          disabled={!canSend(state, paymentRequired)}
          onClick={onSend}
        >
          Send request
        </Button>
      </div>
    </>
  );
}
