'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  paymentMethodTitle,
  paymentMethodSubtitle,
  type SavedPaymentMethod,
} from './derive-payment-methods';

export interface PaymentMethodRowProps {
  pm: SavedPaymentMethod;
  /** True while this row has an action in flight (set-default or remove). */
  busy: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}

export function PaymentMethodRow({ pm, busy, onSetDefault, onRemove }: PaymentMethodRowProps) {
  const Icon = pm.type === 'us_bank_account' ? Landmark : CreditCard;

  // The parent only knows WHICH ROW is busy; remember which button was pressed
  // so the spinner lands on that button instead of a detached header spinner.
  const [pressed, setPressed] = useState<'default' | 'remove' | null>(null);
  useEffect(() => {
    if (!busy) setPressed(null);
  }, [busy]);

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-foreground">{paymentMethodTitle(pm)}</span>
            {pm.isDefault && (
              <span className="shrink-0 rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                Default
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{paymentMethodSubtitle(pm)}</div>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 border-t border-border">
        {!pm.isDefault && (
          <Button
            variant="link"
            size="sm"
            className="h-auto min-h-[44px] rounded-control px-1 text-xs font-bold text-brand-700"
            loading={busy && pressed === 'default'}
            disabled={busy}
            onClick={() => {
              setPressed('default');
              onSetDefault();
            }}
          >
            Set as default
          </Button>
        )}
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-auto min-h-[44px] rounded-control px-1 text-xs font-bold text-critical"
          loading={busy && pressed === 'remove'}
          disabled={busy}
          onClick={() => {
            setPressed('remove');
            onRemove();
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
