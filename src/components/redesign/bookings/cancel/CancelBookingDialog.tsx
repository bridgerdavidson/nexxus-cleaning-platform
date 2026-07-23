'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { toast } from '@/components/ui/toast';
import { supabase } from '@/lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { useAuth } from '@/hooks/useAuth';
import type { AdminAppointment } from '@/hooks/useAdminData';
import { fmtTime, monthDay } from '../booking-vm';
import {
  previewCancelFee,
  feeLine,
  cancelToast,
  formatUsd,
  type CancelParty,
  type CancelPolicy,
  type CancelRouteResult,
  type FeeType,
} from './deriveCancelBooking';

/**
 * Fee-aware operator cancel (audit gap R8), the redesign counterpart of the
 * legacy CancelWithFeeModal: who cancelled decides the fee (customer inside
 * the window or no-show pays the org's policy fee; cleaner/company-caused is
 * always free), previewed live with the same computeCancellationFee the
 * server applies. Submits POST /api/appointments/[id]/cancel, which cancels
 * even when the fee can't be collected. Only rendered when the new charge
 * flow is on AND the caller may capture money (owner/admin, or manager with
 * can_manage_payments); other operators keep the plain soft-cancel confirm.
 */
export function CancelBookingDialog({
  open,
  onOpenChange,
  appointment: a,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AdminAppointment;
  onCancelled: () => void;
}) {
  const { currentOrganizationId } = useAuth();
  const [party, setParty] = useState<CancelParty>('homeowner');
  const [noShow, setNoShow] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState(false);
  const [policy, setPolicy] = useState<CancelPolicy>({ windowHours: 24, feeType: 'none', feeValue: 0 });

  // Self-pay has no customer to charge; a completed booking's money is owned
  // by the completion-refund flow. Either way the fee UI is meaningless.
  const feeless = !!a.is_self_pay || a.status === 'completed';

  useEffect(() => {
    if (!open || !currentOrganizationId) return;
    setParty('homeowner');
    setNoShow(false);
    setReason('');
    setPolicyError(false);
    let stale = false;
    (async () => {
      setPolicyLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (stale) return;
      if (error) {
        // Fail closed: a $0 fallback would under-disclose the fee.
        setPolicyError(true);
        setPolicyLoading(false);
        return;
      }
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
      stale = true;
    };
  }, [open, currentOrganizationId]);

  const preview = previewCancelFee(a, policy, party, noShow);
  const fee = feeless ? 0 : preview.feeCents;

  const submit = async () => {
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${a.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          organization_id: currentOrganizationId,
          party: feeless ? 'org' : party,
          no_show: feeless ? false : party === 'homeowner' && noShow,
          reason: reason.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CancelRouteResult & { error?: string; details?: string };
      if (!res.ok) throw new Error(data.error || data.details || 'Cancellation failed');
      const t = cancelToast(data);
      toast[t.tone](t.message, t.description ? { description: t.description } : undefined);
      onCancelled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            {`${a.property?.name || a.property?.address || 'Property'} · ${monthDay(a.scheduled_date)} at ${fmtTime(a.scheduled_time)}. This can't be undone.`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {!feeless ? (
            <div className="space-y-1.5">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Who is cancelling?
              </p>
              <SegmentedControl
                options={[
                  { value: 'homeowner', label: 'Customer' },
                  { value: 'cleaner', label: 'Cleaner' },
                  { value: 'org', label: 'Company' },
                ]}
                value={party}
                onChange={(p) => {
                  setParty(p);
                  if (p !== 'homeowner') setNoShow(false);
                }}
              />
            </div>
          ) : null}

          {!feeless && party === 'homeowner' ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <Checkbox checked={noShow} onCheckedChange={(v) => setNoShow(v === true)} />
              No-show (the customer was not there)
            </label>
          ) : null}

          <div className="space-y-1.5">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Reason (optional)
            </p>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer requested a different week"
            />
          </div>

          {policyError ? (
            <div className="flex items-start gap-2 rounded-control border border-critical-700/30 bg-critical-50 px-3 py-2 text-xs text-critical-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>We could not load the cancellation policy. Close and try again.</span>
            </div>
          ) : (
            <div
              className={
                fee > 0
                  ? 'flex items-start gap-2 rounded-control border border-caution-700/30 bg-caution-50 px-3 py-2 text-xs text-caution-700'
                  : 'rounded-control bg-muted/30 px-3 py-2 text-xs text-muted-foreground'
              }
            >
              {fee > 0 ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null}
              <span>
                {policyLoading ? 'Checking the cancellation policy.' : feeLine(fee, policy.windowHours, noShow)}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6 gap-2">
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            loading={saving}
            disabled={policyLoading || policyError || saving}
            onClick={submit}
          >
            {fee > 0 ? `Cancel and charge ${formatUsd(fee)}` : 'Cancel booking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
