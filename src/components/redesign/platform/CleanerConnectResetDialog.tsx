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
import { toast } from '@/components/ui/toast';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

/**
 * Reset a cleaner's Stripe Connect state. Two-step when the route returns 409
 * `in_flight_payouts`: surface the payout count and require an acknowledgement
 * before re-posting with `force: true`.
 */
export function CleanerConnectResetDialog({
  open,
  onOpenChange,
  cleanerId,
  cleanerName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cleanerId: string;
  cleanerName: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<{ payout_count: number } | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    if (open) {
      setConflict(null);
      setAck(false);
    }
  }, [open]);

  async function postReset(force: boolean) {
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/platform/cleaners/${cleanerId}/connect/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: true, ...(force ? { force: true } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 409 && data.error === 'in_flight_payouts') {
        setConflict({ payout_count: typeof data.payout_count === 'number' ? data.payout_count : 0 });
        return;
      }
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `Reset failed (${res.status})`);
      }
      const orphaned = typeof data.payout_count === 'number' ? data.payout_count : 0;
      toast.success(
        `Connect reset for ${cleanerName}${
          orphaned > 0 ? ` (${orphaned} payout(s) orphaned, reconcile manually)` : ''
        }`,
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Connect for {cleanerName}?</DialogTitle>
          <DialogDescription>
            Deletes the cleaner&apos;s Stripe account and clears their Connect state so they can
            re-onboard. Payment history and appointments are untouched; future payouts fail until they
            re-onboard.
          </DialogDescription>
        </DialogHeader>

        {conflict ? (
          <div className="mt-2 space-y-3">
            <div className="flex items-start gap-2 rounded-control border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {conflict.payout_count} in-flight payout{conflict.payout_count === 1 ? '' : 's'}{' '}
                (pending or approved) will be orphaned. You must reconcile them manually after
                resetting.
              </span>
            </div>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <Checkbox
                checked={ack}
                onCheckedChange={(v) => setAck(v === true)}
                disabled={submitting}
                className="mt-0.5"
              />
              <span>
                I understand and will reconcile the orphaned payout
                {conflict.payout_count === 1 ? '' : 's'} manually.
              </span>
            </label>
          </div>
        ) : null}

        <DialogFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          {conflict ? (
            <Button
              variant="destructive"
              loading={submitting}
              disabled={!ack}
              onClick={() => void postReset(true)}
            >
              Force reset anyway
            </Button>
          ) : (
            <Button variant="destructive" loading={submitting} onClick={() => void postReset(false)}>
              Reset Connect
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
