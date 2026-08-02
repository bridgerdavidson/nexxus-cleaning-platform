'use client';

import { useEffect, useState } from 'react';
import { useDetailParam } from '@/hooks/useDetailParam';
import { useHomeownerPayments } from '@/hooks/useHomeownerData';
import { useRetryFeeCharge } from '@/hooks/useRetryFeeCharge';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { toast } from '@/components/ui/toast';
import { money2 } from '@/components/redesign/payments/payments-presenters';
import { CardPickerSheet } from '@/components/redesign/homeowner/booking/CardPickerSheet';
import { PaymentReceipt } from './PaymentReceipt';
import { isCancellationFee, type PaymentLike } from './derive-payments';

export function PaymentReceiptHost() {
  const { paramId, setParam } = useDetailParam('payment');
  const { payments, loading, error, refetch } = useHomeownerPayments();
  const { currentOrganizationId } = useAuth();
  const { retryFee, isPending } = useRetryFeeCharge();
  const [payError, setPayError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);

  // The host stays mounted across receipt switches (search-param changes never unmount it; only
  // the child PaymentReceipt is keyed by paramId), so a decline message or open card picker from
  // the previously-viewed receipt would otherwise leak into the next one. Reset on every switch.
  useEffect(() => {
    setPayError(null);
    setPickerOpen(false);
  }, [paramId]);

  if (!paramId) return null;
  const payment = (payments as PaymentLike[]).find((p) => p.id === paramId) ?? null;

  const failedFee = !!payment && isCancellationFee(payment) && payment.status === 'failed';
  const appointmentId = payment?.appointment?.id ?? null;

  const handlePayNow = async () => {
    if (!payment) return;
    setPayError(null);
    const result = await retryFee(payment.id);
    if (result.ok) {
      toast.success(`Paid ${money2((result.feeCapturedCents ?? 0) / 100)}`);
    } else if (result.code === 'failed') {
      setPayError('Your card was declined again. Update your card and try again.');
    } else {
      setPayError(result.message ?? 'Payment failed. Please try again.');
    }
  };

  // Swap the card saved on the fee's appointment, then the retry charges the new card.
  // CardPickerSheet closes itself right after calling onSelect (see its onClick / onSaved
  // handlers), so this does not close the sheet itself; mirrors HomeownerPaymentRecovery's
  // handleCardSelected.
  const handleCardSelected = async (paymentMethodId: string) => {
    if (!appointmentId || !currentOrganizationId) return;
    setSwapping(true);
    setPayError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/payment-method`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId, payment_method_id: paymentMethodId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPayError(typeof data.error === 'string' ? data.error : 'Could not update the card.');
        return;
      }
      toast.success('Card updated. You can pay the fee now.');
      void refetch();
    } finally {
      setSwapping(false);
    }
  };

  return (
    <>
      <PaymentReceipt
        key={paramId}
        payment={payment}
        loading={loading}
        error={Boolean(error)}
        onRetry={() => refetch()}
        onClose={() => setParam(null)}
        onPayNow={failedFee ? handlePayNow : undefined}
        onUpdateCard={failedFee && appointmentId ? () => setPickerOpen(true) : undefined}
        paying={isPending || swapping}
        payError={payError}
      />
      {failedFee && appointmentId ? (
        <CardPickerSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selectedId={payment?.appointment?.payment_method_id ?? null}
          onSelect={(paymentMethodId) => void handleCardSelected(paymentMethodId)}
        />
      ) : null}
    </>
  );
}
