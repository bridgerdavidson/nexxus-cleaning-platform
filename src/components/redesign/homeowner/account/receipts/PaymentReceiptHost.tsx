'use client';

import { useDetailParam } from '@/hooks/useDetailParam';
import { useHomeownerPayments } from '@/hooks/useHomeownerData';
import { PaymentReceipt } from './PaymentReceipt';
import type { PaymentLike } from './derive-payments';

export function PaymentReceiptHost() {
  const { paramId, setParam } = useDetailParam('payment');
  const { payments, loading, error, refetch } = useHomeownerPayments();

  if (!paramId) return null;
  const payment = (payments as PaymentLike[]).find((p) => p.id === paramId) ?? null;

  return (
    <PaymentReceipt
      key={paramId}
      payment={payment}
      loading={loading}
      error={Boolean(error)}
      onRetry={() => refetch()}
      onClose={() => setParam(null)}
    />
  );
}
