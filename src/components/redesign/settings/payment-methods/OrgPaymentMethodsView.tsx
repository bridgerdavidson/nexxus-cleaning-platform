'use client';

import { CreditCard, Landmark, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { stripeAchUiEnabled } from '@/lib/stripe/flags';
import { PaymentMethodRow } from '@/components/redesign/shared/payment-methods/PaymentMethodRow';
import type { SavedPaymentMethod } from '@/components/redesign/shared/payment-methods/derive-payment-methods';

export interface OrgPaymentMethodsViewProps {
  cards: SavedPaymentMethod[];
  loading: boolean;
  error: boolean;
  /** id of the card with an action in flight, or null. */
  busyId: string | null;
  onAdd: () => void;
  onSetDefault: (pm: SavedPaymentMethod) => void;
  onRemove: (pm: SavedPaymentMethod) => void;
  onRetry?: () => void;
}

export function OrgPaymentMethodsView({
  cards,
  loading,
  error,
  busyId,
  onAdd,
  onSetDefault,
  onRemove,
  onRetry,
}: OrgPaymentMethodsViewProps) {
  if (error) {
    return (
      <div className="py-8">
        <ErrorState title="Couldn't load company payment methods" onRetry={onRetry} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pt-1">
        <Skeleton className="h-[104px] w-full rounded-card" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={<CreditCard />}
          title="No company card on file"
          description="Add a card so your company can book and pay for its own (self-pay) cleanings."
          action={
            <Button onClick={onAdd}>
              <Plus className="size-4" aria-hidden /> Add a card
            </Button>
          }
        />
      </div>
    );
  }

  const hasBank = cards.some((c) => c.type === 'us_bank_account');

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={onAdd} className="gap-1.5">
          <Plus className="size-4" aria-hidden /> Add a card
        </Button>
      </div>
      <div className="space-y-2.5">
        {cards.map((pm) => (
          <PaymentMethodRow
            key={pm.id}
            pm={pm}
            busy={busyId === pm.id}
            onSetDefault={() => onSetDefault(pm)}
            onRemove={() => onRemove(pm)}
          />
        ))}
      </div>
      {stripeAchUiEnabled() && !hasBank ? (
        <p className="flex items-start gap-1.5 px-0.5 pt-1 text-xs leading-relaxed text-muted-foreground">
          <Landmark className="mt-0.5 size-3.5 shrink-0 text-brand-ink" aria-hidden />
          Paying by bank account costs less than a card. Add one to save on processing fees.
        </p>
      ) : (
        <p className="px-0.5 pt-1 text-xs leading-relaxed text-muted-foreground">
          Your default card is charged when a self-pay cleaning is completed.
        </p>
      )}
    </div>
  );
}
