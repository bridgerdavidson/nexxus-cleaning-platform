'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, CreditCard, Landmark, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useSavedPaymentMethods } from '../account/payment-methods/useSavedPaymentMethods';
import { AccountAddCardPanel } from '../account/payment-methods/AccountAddCardPanel';
import {
  paymentMethodTitle,
  paymentMethodSubtitle,
} from '../account/payment-methods/derive-payment-methods';
import type { PaymentMethodKind } from '@/lib/payments/processingFee';

export interface CardPickerSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedId: string | null;
  onSelect: (pmId: string, method: PaymentMethodKind) => void;
}

export function CardPickerSheet({ open, onOpenChange, selectedId, onSelect }: CardPickerSheetProps) {
  const { user } = useAuth();
  const { cards, loading, refetch } = useSavedPaymentMethods();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) setAdding(false);
  }, [open]);

  const createSetupIntent = useCallback(async (): Promise<string> => {
    const token = await getAccessToken();
    const res = await fetch('/api/stripe/create-setup-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ homeowner_id: user?.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) throw new Error(data.error || 'Could not start card setup');
    return data.client_secret as string;
  }, [user?.id]);

  const showAdd = adding || (!loading && cards.length === 0);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Payment method</DrawerTitle>
          <DrawerDescription>Saved securely. You are charged when the job is completed.</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[72vh] space-y-2 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-card" />)
          ) : (
            cards.map((pm) => {
              const on = selectedId === pm.id;
              const Icon = pm.type === 'us_bank_account' ? Landmark : CreditCard;
              return (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => {
                    onSelect(pm.id, pm.type);
                    onOpenChange(false);
                  }}
                  className={
                    'flex w-full items-center gap-3 rounded-card border p-4 text-left transition-colors ' +
                    (on ? 'border-brand-600 bg-brand-50' : 'border-border bg-card hover:bg-muted')
                  }
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-foreground">{paymentMethodTitle(pm)}</div>
                    <div className="truncate text-xs text-muted-foreground">{paymentMethodSubtitle(pm)}</div>
                  </div>
                  {on && <Check className="size-5 shrink-0 text-brand-600" aria-hidden />}
                </button>
              );
            })
          )}

          {showAdd ? (
            <div className="rounded-card border border-border p-4">
              <AccountAddCardPanel
                createSetupIntent={createSetupIntent}
                onSaved={async (pmId) => {
                  await refetch();
                  onSelect(pmId, 'card');
                  onOpenChange(false);
                }}
              />
            </div>
          ) : (
            !loading && (
              <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> Add a card
              </Button>
            )
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
