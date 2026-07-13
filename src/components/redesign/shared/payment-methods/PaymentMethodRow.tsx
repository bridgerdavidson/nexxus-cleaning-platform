'use client';

import { CreditCard, Landmark, Loader2 } from 'lucide-react';
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
        {busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      <div className="mt-1 flex items-center gap-2 border-t border-border">
        {!pm.isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center rounded-control px-1 text-xs font-bold text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Set as default
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="ml-auto inline-flex min-h-[44px] items-center rounded-control px-1 text-xs font-bold text-critical outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
