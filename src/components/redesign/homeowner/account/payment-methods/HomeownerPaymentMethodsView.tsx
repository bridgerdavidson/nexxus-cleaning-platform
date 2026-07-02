'use client';

import { CreditCard, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PaymentMethodRow } from './PaymentMethodRow';
import type { SavedPaymentMethod } from './derive-payment-methods';

export interface HomeownerPaymentMethodsViewProps {
  cards: SavedPaymentMethod[];
  loading: boolean;
  error: boolean;
  /** id of the card with an action in flight, or null. */
  busyId: string | null;
  onAdd: () => void;
  onSetDefault: (pm: SavedPaymentMethod) => void;
  onRemove: (pm: SavedPaymentMethod) => void;
}

export function HomeownerPaymentMethodsView({
  cards,
  loading,
  error,
  busyId,
  onAdd,
  onSetDefault,
  onRemove,
}: HomeownerPaymentMethodsViewProps) {
  if (loading) {
    return (
      <div className="space-y-2.5 pt-1">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8">
        <EmptyState
          icon={<CreditCard />}
          title="Could not load your cards"
          description="Please check your connection and try again."
        />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={<CreditCard />}
          title="No saved cards yet"
          description="Add a card so your cleanings can be paid automatically when they are done."
          action={
            <Button onClick={onAdd}>
              <Plus className="size-4" aria-hidden /> Add a card
            </Button>
          }
        />
      </div>
    );
  }

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
      <p className="px-0.5 pt-1 text-xs leading-relaxed text-muted-foreground">
        Your default card is charged after each cleaning is completed. You will not be charged just
        for saving a card.
      </p>
    </div>
  );
}
