'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { keys } from '@/lib/queryKeys';

export interface RetryFeeResult {
  ok: boolean;
  code: string;
  message?: string;
  feeCapturedCents?: number;
}

/**
 * Homeowner-side retry of a failed cancellation/no-show fee (L-7). Declines are EXPECTED
 * outcomes here, so the mutation resolves (never throws) with { ok, code, message } and the
 * caller renders the failure inline. A collected fee invalidates the receipts query so the
 * row and receipt flip to Paid.
 */
export function useRetryFeeCharge() {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (paymentId: string): Promise<RetryFeeResult> => {
      const token = await getAccessToken();
      const res = await fetch(`/api/payments/${paymentId}/retry-fee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          code: typeof data.code === 'string' ? data.code : 'error',
          message: typeof data.error === 'string' ? data.error : 'Payment failed. Please try again.',
        };
      }
      return { ok: true, code: 'charged', feeCapturedCents: Number(data.fee_captured_cents ?? 0) };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: keys.payments.byHomeowner(userId) });
      }
    },
  });

  return {
    retryFee: (paymentId: string) => mutation.mutateAsync(paymentId),
    isPending: mutation.isPending,
  };
}
