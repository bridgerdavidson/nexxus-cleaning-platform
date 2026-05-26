'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

interface Props {
  paymentId: string;
  organizationId: string;
  /** Amount captured on the payment, in dollars (caps a partial refund). */
  amountPaid: number;
  onClose: () => void;
  onDone: () => void;
}

const REASONS = [
  { value: 'requested_by_customer', label: 'Requested by customer' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'fraudulent', label: 'Fraudulent' },
] as const;

/**
 * Admin refund dialog (new charge flow). Issues a full or partial refund via
 * POST /api/payments/:id/refund, which unwinds the cleaner transfer + homeowner charge.
 */
export default function RefundModal({ paymentId, organizationId, amountPaid, onClose, onDone }: Props) {
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string>('requested_by_customer');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const partial = mode === 'partial';
    const amt = partial ? parseFloat(amount) : undefined;
    if (partial && (!amt || amt <= 0 || amt > amountPaid)) {
      setError(`Enter an amount between $0.01 and $${amountPaid.toFixed(2)}.`);
      return;
    }
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ organization_id: organizationId, ...(partial ? { amount: amt } : {}), reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.details || 'Refund failed');
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Refund payment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${mode === 'full' ? 'border-primary-500 bg-primary-50' : 'border-gray-300'}`}>
            <input type="radio" name="refund-mode" checked={mode === 'full'} onChange={() => setMode('full')} className="h-4 w-4 text-primary-600 focus:ring-primary-500" />
            <span className="text-sm font-medium text-gray-900">Full refund (${amountPaid.toFixed(2)})</span>
          </label>

          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${mode === 'partial' ? 'border-primary-500 bg-primary-50' : 'border-gray-300'}`}>
            <input type="radio" name="refund-mode" checked={mode === 'partial'} onChange={() => setMode('partial')} className="h-4 w-4 text-primary-600 focus:ring-primary-500" />
            <span className="text-sm font-medium text-gray-900">Partial refund</span>
          </label>

          {mode === 'partial' && (
            <div className="ml-7">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={amountPaid}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {submitting ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
