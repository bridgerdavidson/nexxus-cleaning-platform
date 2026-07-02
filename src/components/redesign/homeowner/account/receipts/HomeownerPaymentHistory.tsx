'use client';

import { useHomeownerPayments } from '@/hooks/useHomeownerData';
import { useOpenPayment } from './useOpenPayment';
import { HomeownerPaymentHistoryView } from './HomeownerPaymentHistoryView';
import { PaymentReceiptHost } from './PaymentReceiptHost';
import type { PaymentLike } from './derive-payments';

/** Read-only payment history + a ?payment= receipt takeover. */
export function HomeownerPaymentHistory() {
  const { payments, loading } = useHomeownerPayments();
  const openPayment = useOpenPayment();

  return (
    <>
      <HomeownerPaymentHistoryView
        payments={payments as PaymentLike[]}
        loading={loading}
        onOpen={openPayment}
      />
      <PaymentReceiptHost />
    </>
  );
}
