'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

/**
 * Reset a tenant's Stripe Connect state (recovery for stuck onboarding / drift).
 * POSTs the existing `/connect/reset` route; the elaborate legacy result panel is
 * replaced by a toast that reports the Stripe delete outcome.
 */
export function TenantConnectResetDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleReset() {
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/platform/organizations/${orgId}/connect/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        stripe_delete_status?: string;
      };
      if (!res.ok) throw new Error(data.error || `Reset failed (${res.status})`);
      toast.success(`Connect reset for ${orgName} (Stripe: ${data.stripe_delete_status ?? 'cleared'})`);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Reset Connect for ${orgName}?`}
      description="Deletes the tenant's Stripe account and clears their Connect state so they can re-onboard from scratch. Payment history is untouched; charges and payouts fail until they re-onboard."
      confirmLabel="Reset Connect"
      destructive
      loading={submitting}
      onConfirm={handleReset}
    />
  );
}
