'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { computeCancellationFee } from '@/lib/payments/cancellationFee';
import type { Appointment } from '@/hooks/useHomeownerData';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useCancelMyCleaning } from '@/hooks/useCancelMyCleaning';

type FeeType = 'none' | 'flat' | 'percent';

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function CancelCleaningSheet({
  open,
  onOpenChange,
  appointment,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  onCancelled: () => void;
}) {
  const { currentOrganizationId } = useAuth();
  const { cancel, isPending } = useCancelMyCleaning();
  const [error, setError] = useState<string | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policy, setPolicy] = useState<{ windowHours: number; feeType: FeeType; feeValue: number }>({
    windowHours: 24,
    feeType: 'none',
    feeValue: 0,
  });

  // Load the org cancellation policy to preview the fee. Homeowners can read their own org row
  // under RLS (the organizations SELECT policy allows any member), so this works client-side.
  useEffect(() => {
    if (!open || !currentOrganizationId) return;
    setError(null);
    let cancelled = false;
    (async () => {
      setPolicyLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as {
        cancellation_window_hours?: number;
        cancellation_fee_type?: FeeType;
        cancellation_fee_value?: number;
      };
      setPolicy({
        windowHours: Number(row.cancellation_window_hours ?? 24),
        feeType: (row.cancellation_fee_type as FeeType) ?? 'none',
        feeValue: Number(row.cancellation_fee_value ?? 0),
      });
      setPolicyLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentOrganizationId]);

  const preview = useMemo(
    () =>
      computeCancellationFee({
        party: 'homeowner',
        noShow: false,
        grossCents: Math.round(appointment.total_price * 100),
        windowHours: policy.windowHours,
        feeType: policy.feeType,
        feeValue: policy.feeValue,
        scheduledDate: appointment.scheduled_date,
        scheduledTime: appointment.scheduled_time,
      }),
    [appointment.total_price, appointment.scheduled_date, appointment.scheduled_time, policy],
  );

  const fee = preview.feeCents;

  async function submit() {
    setError(null);
    try {
      await cancel(appointment.id);
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancellation failed');
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Cancel this cleaning?</DrawerTitle>
          <DrawerDescription>
            {policyLoading
              ? 'Checking your cancellation policy.'
              : fee > 0
                ? `Cancelling now is within ${policy.windowHours} hours of your appointment, so a ${formatUsd(fee)} cancellation fee applies. Your card on file will be charged ${formatUsd(fee)}.`
                : 'You can cancel this cleaning at no charge.'}
          </DrawerDescription>
        </DrawerHeader>

        {fee > 0 && !policyLoading && (
          <div className="mx-5 mb-1 flex items-center justify-between rounded-control bg-caution-50 px-4 py-3 text-sm">
            <span className="font-medium text-caution-700">Cancellation fee</span>
            <span className="font-bold tabular-nums text-caution-700">{formatUsd(fee)}</span>
          </div>
        )}

        {error && <p className="px-5 text-sm text-critical-700">{error}</p>}

        <DrawerFooter>
          <Button variant="destructive" loading={isPending} disabled={policyLoading} onClick={submit}>
            {fee > 0 ? `Cancel and pay ${formatUsd(fee)}` : 'Cancel cleaning'}
          </Button>
          <Button variant="ghost" disabled={isPending} onClick={() => onOpenChange(false)}>
            Keep my cleaning
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
