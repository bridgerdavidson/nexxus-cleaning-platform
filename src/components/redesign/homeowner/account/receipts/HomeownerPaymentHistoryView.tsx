'use client';

import { Receipt } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PaymentRow } from './PaymentRow';
import type { PaymentLike } from './derive-payments';

export interface HomeownerPaymentHistoryViewProps {
  payments: PaymentLike[];
  loading: boolean;
  onOpen: (id: string) => void;
}

export function HomeownerPaymentHistoryView({
  payments,
  loading,
  onOpen,
}: HomeownerPaymentHistoryViewProps) {
  if (loading) {
    return (
      <div className="space-y-2.5 pt-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={<Receipt />}
          title="No payments yet"
          description="Receipts for your cleanings will appear here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5 pt-1">
      {payments.map((p) => (
        <PaymentRow key={p.id} payment={p} onOpen={() => onOpen(p.id)} />
      ))}
    </div>
  );
}
