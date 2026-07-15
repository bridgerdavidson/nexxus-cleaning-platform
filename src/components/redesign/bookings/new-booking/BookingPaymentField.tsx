'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, CreditCard, Landmark, Clock, Plus } from 'lucide-react';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountAddCardPanel } from '@/components/redesign/shared/payment-methods/AccountAddCardPanel';
import {
  paymentMethodTitle,
  paymentMethodSubtitle,
  type SavedPaymentMethod,
} from '@/components/redesign/shared/payment-methods/derive-payment-methods';
import type { PaymentMethodKind } from '@/lib/payments/processingFee';

export const DEFER_PAYMENT = 'defer';

async function fetchCards(url: string): Promise<SavedPaymentMethod[]> {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const data = await res.json().catch(() => ({}));
  return res.ok ? ((data.cards ?? []) as SavedPaymentMethod[]) : [];
}

function CardRow({
  pm,
  selected,
  onSelect,
}: {
  pm: SavedPaymentMethod;
  selected: boolean;
  /** When omitted the row is display-only (no button semantics, no hover affordance). */
  onSelect?: () => void;
}) {
  const Icon = pm.type === 'us_bank_account' ? Landmark : CreditCard;
  const baseClass =
    'flex w-full items-center gap-3 rounded-control border p-3 text-left transition-colors ' +
    (selected ? 'border-brand-600 bg-brand-50' : 'border-border bg-card');
  const inner = (
    <>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{paymentMethodTitle(pm)}</div>
        <div className="truncate text-xs text-muted-foreground">{paymentMethodSubtitle(pm)}</div>
      </div>
      {selected && <Check className="size-4 shrink-0 text-brand-600" aria-hidden />}
    </>
  );
  if (!onSelect) return <div className={baseClass}>{inner}</div>;
  return (
    <button type="button" onClick={onSelect} className={`${baseClass}${selected ? '' : ' hover:bg-muted'}`}>
      {inner}
    </button>
  );
}

/**
 * Operator payment selection, rebuilt from the design system (no legacy AppointmentPaymentSection /
 * OrgPaymentMethodPicker styling). Customer-billed: the customer's saved cards, "add a card" (via the
 * brand SetupIntent panel, org-staff acting on the customer), or "collect later". Self-pay: the org's
 * saved cards (report method + whether one exists). "Send a payment link" is a fast follow-up.
 */
export function BookingPaymentField({
  billTo,
  customerId,
  organizationId,
  value,
  onChange,
  onSelfPayChange,
}: {
  billTo: 'customer' | 'self_pay';
  customerId: string | null;
  organizationId: string | null;
  /** Customer-billed selection: a card id, or DEFER_PAYMENT. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Self-pay: reports whether an org method exists + which method (for the fee-aware total). */
  onSelfPayChange: (info: { hasMethod: boolean; method: PaymentMethodKind }) => void;
}) {
  const selfPay = billTo === 'self_pay';
  const [adding, setAdding] = useState(false);

  const customerCards = useQuery({
    queryKey: ['operator-booking', 'customer-cards', organizationId, customerId],
    enabled: !selfPay && !!customerId && !!organizationId,
    queryFn: () =>
      fetchCards(
        `/api/stripe/saved-payment-methods?homeowner_id=${customerId}&organization_id=${organizationId}`,
      ),
  });

  const orgCards = useQuery({
    queryKey: ['operator-booking', 'org-cards', organizationId],
    enabled: selfPay && !!organizationId,
    queryFn: () => fetchCards(`/api/stripe/org/saved-payment-methods?organization_id=${organizationId}`),
  });

  // Report the org's charged method up once the card list resolves (kept out of the queryFn so the
  // fetch stays a pure data source). Gated on the derived primitives so it does not loop.
  const orgDefault = orgCards.data?.find((c) => c.isDefault) ?? orgCards.data?.[0] ?? null;
  const orgHasMethod = !!orgDefault;
  const orgMethod: PaymentMethodKind = orgDefault?.type === 'us_bank_account' ? 'us_bank_account' : 'card';
  useEffect(() => {
    if (selfPay) onSelfPayChange({ hasMethod: orgHasMethod, method: orgMethod });
    // onSelfPayChange is a fresh closure each render; depend on the derived values instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfPay, orgHasMethod, orgMethod]);

  const createSetupIntent = useCallback(async (): Promise<string> => {
    const token = await getAccessToken();
    const res = await fetch('/api/stripe/create-setup-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ homeowner_id: customerId, organization_id: organizationId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) throw new Error(data.error || 'Could not start card setup');
    return data.client_secret as string;
  }, [customerId, organizationId]);

  if (selfPay) {
    const cards = orgCards.data ?? [];
    return (
      <div className="space-y-2">
        <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Company payment method
        </p>
        {orgCards.isLoading ? (
          <Skeleton className="h-14 w-full rounded-control" />
        ) : cards.length === 0 ? (
          <p className="rounded-control border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            No company card on file. Add one in Settings, Payments to book a self-pay cleaning.
          </p>
        ) : (
          // Self-pay always charges the org default (or first) card server-side, so show ONLY that
          // card (product decision 2026-07-15: honest display, not a per-booking picker). Listing
          // the other saved cards here read as a broken selection.
          orgDefault && <CardRow pm={orgDefault} selected />
        )}
        <p className="px-0.5 text-xs text-muted-foreground">
          Self-pay cleanings are charged to the company default card when the job is completed.{' '}
          <Link
            href="/app/admin-dashboard/settings?section=payments"
            className="font-medium text-foreground hover:underline"
          >
            Manage in Settings
          </Link>
        </p>
      </div>
    );
  }

  const cards = customerCards.data ?? [];
  return (
    <div className="space-y-2">
      <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Payment</p>
      {customerCards.isLoading ? (
        <Skeleton className="h-14 w-full rounded-control" />
      ) : (
        cards.map((pm) => (
          <CardRow key={pm.id} pm={pm} selected={value === pm.id} onSelect={() => onChange(pm.id)} />
        ))
      )}

      <button
        type="button"
        onClick={() => onChange(DEFER_PAYMENT)}
        className={
          'flex w-full items-center gap-3 rounded-control border p-3 text-left transition-colors ' +
          (value === DEFER_PAYMENT ? 'border-brand-600 bg-brand-50' : 'border-border bg-card hover:bg-muted')
        }
      >
        <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Collect later</div>
          <div className="text-xs text-muted-foreground">Add a card before the job is charged.</div>
        </div>
        {value === DEFER_PAYMENT && <Check className="size-4 shrink-0 text-brand-600" aria-hidden />}
      </button>

      {adding ? (
        <div className="rounded-control border border-border p-3">
          <AccountAddCardPanel
            createSetupIntent={createSetupIntent}
            onSaved={async (pmId) => {
              await customerCards.refetch();
              onChange(pmId);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        !!customerId && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Add a card
          </Button>
        )
      )}
    </div>
  );
}
