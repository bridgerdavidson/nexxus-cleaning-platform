'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';

type FeeType = 'none' | 'flat' | 'percent';

/**
 * Org cancellation/no-show policy editor (decision #10) + read-only platform fee.
 * Owner/admin can edit; the policy drives the fee captured by the cancel-with-fee action.
 * Renders null when the new charge flow UI is off.
 */
export default function OrgPaymentSettings() {
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [windowHours, setWindowHours] = useState('24');
  const [feeType, setFeeType] = useState<FeeType>('none');
  const [feeValue, setFeeValue] = useState('0');
  const [platformFeeBps, setPlatformFeeBps] = useState(0);

  useEffect(() => {
    if (!currentOrganizationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value, platform_fee_bps')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as {
          cancellation_window_hours: number | null;
          cancellation_fee_type: FeeType | null;
          cancellation_fee_value: number | null;
          platform_fee_bps: number | null;
        };
        setWindowHours(String(row.cancellation_window_hours ?? 24));
        setFeeType((row.cancellation_fee_type as FeeType) ?? 'none');
        setFeeValue(String(row.cancellation_fee_value ?? 0));
        setPlatformFeeBps(Number(row.platform_fee_bps ?? 0));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  if (!stripeNewChargeFlowUiEnabled()) return null;

  async function save() {
    if (!currentOrganizationId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/organizations/${currentOrganizationId}/payment-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          cancellation_window_hours: parseInt(windowHours, 10) || 0,
          cancellation_fee_type: feeType,
          cancellation_fee_value: parseFloat(feeValue) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card py-6 px-5 md:px-8 mx-1 md:mx-0 mt-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Cancellation policy</h2>
        <p className="text-gray-500 mt-1 max-w-xl text-sm">
          When a homeowner cancels late (inside the window) or no-shows, this fee is captured from
          their card hold; the rest of the hold is released. Cleaner-caused or on-time cancellations
          are always free.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-6">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cancellation window (hours)</label>
            <input
              type="number"
              min="0"
              max="720"
              value={windowHours}
              onChange={(e) => setWindowHours(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500">A homeowner cancel inside this many hours before the start may incur the fee.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fee type</label>
            <select
              value={feeType}
              onChange={(e) => setFeeType(e.target.value as FeeType)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
            >
              <option value="none">No fee</option>
              <option value="flat">Flat amount ($)</option>
              <option value="percent">Percent of job (%)</option>
            </select>
          </div>

          {feeType !== 'none' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {feeType === 'flat' ? 'Fee amount ($)' : 'Fee percent (%)'}
              </label>
              <input
                type="number"
                min="0"
                step={feeType === 'flat' ? '0.01' : '1'}
                max={feeType === 'percent' ? '100' : undefined}
                value={feeValue}
                onChange={(e) => setFeeValue(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
              />
            </div>
          )}

          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Platform fee: <span className="font-medium text-gray-700">{(platformFeeBps / 100).toFixed(2)}%</span>{' '}
              <span className="text-xs">(set by Nexxus)</span>
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && (
            <p className="flex items-center gap-1.5 text-sm text-success-600">
              <CheckCircle className="w-4 h-4" /> Saved
            </p>
          )}

          {canEdit && (
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save policy'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
