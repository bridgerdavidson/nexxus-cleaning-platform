'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { supabase } from '../lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { computeCancellationFee } from '@/lib/payments/cancellationFee';

type Party = 'homeowner' | 'cleaner' | 'org';
type FeeType = 'none' | 'flat' | 'percent';

interface Props {
  isOpen: boolean;
  appointmentId: string;
  organizationId: string;
  /** Job total in dollars (drives the percent-fee preview). */
  totalPrice: number;
  scheduledDate: string | null;
  scheduledTime: string | null;
  homeownerName?: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Cancel-with-fee action (decision #10). Calls POST /api/appointments/:id/cancel, which releases
 * the card hold (cleaner/on-time cancel) or partial-captures the policy fee (homeowner late-cancel
 * / no-show) and marks the appointment cancelled. Shows a live fee preview computed from the org
 * policy via the same pure `computeCancellationFee` the backend uses.
 */
export default function CancelWithFeeModal({
  isOpen,
  appointmentId,
  organizationId,
  totalPrice,
  scheduledDate,
  scheduledTime,
  homeownerName,
  onClose,
  onDone,
}: Props) {
  useBodyScrollLock(isOpen);

  const [party, setParty] = useState<Party>('homeowner');
  const [noShow, setNoShow] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [policyLoading, setPolicyLoading] = useState(true);
  const [policy, setPolicy] = useState<{ windowHours: number; feeType: FeeType; feeValue: number }>({
    windowHours: 24,
    feeType: 'none',
    feeValue: 0,
  });

  useEffect(() => {
    if (!isOpen) return;
    // Reset per-open.
    setParty('homeowner');
    setNoShow(false);
    setReason('');
    setError(null);
    let cancelled = false;
    (async () => {
      setPolicyLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value')
        .eq('id', organizationId)
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
  }, [isOpen, organizationId]);

  const preview = useMemo(
    () =>
      computeCancellationFee({
        party,
        noShow,
        grossCents: Math.round(totalPrice * 100),
        windowHours: policy.windowHours,
        feeType: policy.feeType,
        feeValue: policy.feeValue,
        scheduledDate,
        scheduledTime,
      }),
    [party, noShow, totalPrice, policy, scheduledDate, scheduledTime],
  );

  if (!isOpen) return null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ organization_id: organizationId, party, no_show: noShow, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.details || 'Cancellation failed');
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setSubmitting(false);
    }
  }

  const feeDollars = (preview.feeCents / 100).toFixed(2);

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <h3 className="text-lg font-bold text-gray-900">Cancel appointment</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {homeownerName && <p className="mb-4 text-sm text-gray-600">{homeownerName}</p>}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Who is cancelling?</label>
            <div className="grid grid-cols-3 gap-2">
              {(['homeowner', 'cleaner', 'org'] as Party[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setParty(p)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize ${
                    party === p ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-700'
                  }`}
                >
                  {p === 'org' ? 'Company' : p}
                </button>
              ))}
            </div>
          </div>

          {party === 'homeowner' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={noShow}
                onChange={(e) => setNoShow(e.target.checked)}
                className="h-4 w-4 rounded text-primary-600 focus:ring-primary-500"
              />
              No-show (homeowner wasn&apos;t there)
            </label>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. homeowner rescheduled"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Fee preview */}
          <div className={`rounded-lg p-3 text-sm ${preview.feeCents > 0 ? 'bg-orange-50 text-orange-800' : 'bg-gray-50 text-gray-700'}`}>
            {policyLoading ? (
              <span className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking policy…
              </span>
            ) : preview.feeCents > 0 ? (
              <>A <span className="font-semibold">${feeDollars}</span> fee will be charged to the homeowner; the rest of the card hold is released.</>
            ) : (
              <>No fee — the card hold (if any) will be released and nothing is charged.</>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Keep
          </button>
          <button
            onClick={submit}
            disabled={submitting || policyLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {preview.feeCents > 0 ? `Cancel & charge $${feeDollars}` : 'Cancel appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}
