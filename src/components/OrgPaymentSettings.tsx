'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle, Info, Loader2, Save } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';

type FeeType = 'none' | 'flat' | 'percent';

interface PolicyState {
  cancellation_window_hours: string;
  cancellation_fee_type: FeeType;
  cancellation_fee_value: string;
  no_show_fee_type: FeeType;
  no_show_fee_value: string;
  reschedule_window_hours: string;
  reschedule_fee_type: FeeType;
  reschedule_fee_value: string;
}

const DEFAULT_POLICY: PolicyState = {
  cancellation_window_hours: '24',
  cancellation_fee_type: 'none',
  cancellation_fee_value: '0',
  no_show_fee_type: 'none',
  no_show_fee_value: '0',
  reschedule_window_hours: '24',
  reschedule_fee_type: 'none',
  reschedule_fee_value: '0',
};

/**
 * Three-group policy editor (cancellation / no-show / reschedule) used by
 * /settings/cancellation-policy. Owner/admin can edit; managers see read-only.
 * Renders null when the new charge flow UI flag is off (no card-on-file = no fee).
 */
export default function OrgPaymentSettings() {
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [policy, setPolicy] = useState<PolicyState>(DEFAULT_POLICY);
  const [platformFeeBps, setPlatformFeeBps] = useState(0);

  useEffect(() => {
    if (!currentOrganizationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select(
          'cancellation_window_hours, cancellation_fee_type, cancellation_fee_value, no_show_fee_type, no_show_fee_value, reschedule_window_hours, reschedule_fee_type, reschedule_fee_value, platform_fee_bps',
        )
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as {
          cancellation_window_hours: number | null;
          cancellation_fee_type: FeeType | null;
          cancellation_fee_value: number | null;
          no_show_fee_type: FeeType | null;
          no_show_fee_value: number | null;
          reschedule_window_hours: number | null;
          reschedule_fee_type: FeeType | null;
          reschedule_fee_value: number | null;
          platform_fee_bps: number | null;
        };
        setPolicy({
          cancellation_window_hours: String(row.cancellation_window_hours ?? 24),
          cancellation_fee_type: (row.cancellation_fee_type as FeeType) ?? 'none',
          cancellation_fee_value: String(row.cancellation_fee_value ?? 0),
          no_show_fee_type: (row.no_show_fee_type as FeeType) ?? 'none',
          no_show_fee_value: String(row.no_show_fee_value ?? 0),
          reschedule_window_hours: String(row.reschedule_window_hours ?? 24),
          reschedule_fee_type: (row.reschedule_fee_type as FeeType) ?? 'none',
          reschedule_fee_value: String(row.reschedule_fee_value ?? 0),
        });
        setPlatformFeeBps(Number(row.platform_fee_bps ?? 0));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  // Policy values are always editable — they live in the DB regardless of the
  // charge-flow rollout. The flag only changes whether fees actually capture
  // (which requires card-on-file), so we surface a notice instead of hiding
  // the form.
  const chargeFlowOn = stripeNewChargeFlowUiEnabled();

  function set<K extends keyof PolicyState>(key: K, value: PolicyState[K]) {
    setPolicy((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function save() {
    if (!currentOrganizationId) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/organizations/${currentOrganizationId}/payment-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          cancellation_window_hours: parseInt(policy.cancellation_window_hours, 10) || 0,
          cancellation_fee_type: policy.cancellation_fee_type,
          cancellation_fee_value: parseFloat(policy.cancellation_fee_value) || 0,
          no_show_fee_type: policy.no_show_fee_type,
          no_show_fee_value: parseFloat(policy.no_show_fee_value) || 0,
          reschedule_window_hours: parseInt(policy.reschedule_window_hours, 10) || 0,
          reschedule_fee_type: policy.reschedule_fee_type,
          reschedule_fee_value: parseFloat(policy.reschedule_fee_value) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-6">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!chargeFlowOn && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            Card-on-file isn&apos;t enabled yet for your account, so these fees won&apos;t actually
            capture until that ships. You can still configure the policy now — it&apos;ll apply
            automatically once card-on-file goes live.
          </div>
        </div>
      )}
      <PolicyGroup
        title="Late cancellation"
        description="When a homeowner cancels less than the window below before the start, we capture this fee from their card hold."
        showWindow
        windowLabel="Cancellation window (hours)"
        windowValue={policy.cancellation_window_hours}
        feeType={policy.cancellation_fee_type}
        feeValue={policy.cancellation_fee_value}
        canEdit={canEdit}
        onWindowChange={(v) => set('cancellation_window_hours', v)}
        onTypeChange={(v) => set('cancellation_fee_type', v)}
        onValueChange={(v) => set('cancellation_fee_value', v)}
      />

      <PolicyGroup
        title="No-show"
        description="When the homeowner isn't on-site at the scheduled start time and the cleaner can't get in."
        showWindow={false}
        feeType={policy.no_show_fee_type}
        feeValue={policy.no_show_fee_value}
        canEdit={canEdit}
        onTypeChange={(v) => set('no_show_fee_type', v)}
        onValueChange={(v) => set('no_show_fee_value', v)}
      />

      <PolicyGroup
        title="Late reschedule"
        description="When a homeowner reschedules less than the window below before the start. Charged on top of any new appointment."
        showWindow
        windowLabel="Reschedule window (hours)"
        windowValue={policy.reschedule_window_hours}
        feeType={policy.reschedule_fee_type}
        feeValue={policy.reschedule_fee_value}
        canEdit={canEdit}
        onWindowChange={(v) => set('reschedule_window_hours', v)}
        onTypeChange={(v) => set('reschedule_fee_type', v)}
        onValueChange={(v) => set('reschedule_fee_value', v)}
      />

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-500">
          Platform fee:{' '}
          <span className="font-medium text-gray-700">{(platformFeeBps / 100).toFixed(2)}%</span>{' '}
          <span className="text-xs">(set by Nexxus)</span>
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {savedAt && (
        <p className="flex items-center gap-1.5 text-sm text-green-700">
          <CheckCircle className="w-4 h-4" /> Saved
        </p>
      )}

      {canEdit && (
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      )}
    </div>
  );
}

interface PolicyGroupProps {
  title: string;
  description: string;
  showWindow: boolean;
  /** Defaults to `${title} window (hours)` — kept matchable by the existing E2E test. */
  windowLabel?: string;
  windowValue?: string;
  feeType: FeeType;
  feeValue: string;
  canEdit: boolean;
  onWindowChange?: (v: string) => void;
  onTypeChange: (v: FeeType) => void;
  onValueChange: (v: string) => void;
}

function PolicyGroup({
  title,
  description,
  showWindow,
  windowLabel,
  windowValue,
  feeType,
  feeValue,
  canEdit,
  onWindowChange,
  onTypeChange,
  onValueChange,
}: PolicyGroupProps) {
  const effectiveWindowLabel = windowLabel ?? `${title} window (hours)`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const windowId = `${slug}-window`;
  const typeId = `${slug}-fee-type`;
  const valueId = `${slug}-fee-value`;
  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mb-3 mt-0.5 text-sm text-gray-500">{description}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {showWindow && (
          <div>
            <label htmlFor={windowId} className="block text-xs font-medium text-gray-700">
              {effectiveWindowLabel}
            </label>
            <input
              id={windowId}
              type="number"
              min="0"
              max="720"
              value={windowValue ?? '0'}
              onChange={(e) => onWindowChange?.(e.target.value)}
              disabled={!canEdit}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
            />
          </div>
        )}
        <div>
          <label htmlFor={typeId} className="block text-xs font-medium text-gray-700">
            Fee type
          </label>
          <select
            id={typeId}
            value={feeType}
            onChange={(e) => onTypeChange(e.target.value as FeeType)}
            disabled={!canEdit}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
          >
            <option value="none">No fee</option>
            <option value="flat">Flat ($)</option>
            <option value="percent">% of job</option>
          </select>
        </div>
        {feeType !== 'none' && (
          <div>
            <label htmlFor={valueId} className="block text-xs font-medium text-gray-700">
              {feeType === 'flat' ? 'Amount ($)' : 'Percent (%)'}
            </label>
            <input
              id={valueId}
              type="number"
              min="0"
              step={feeType === 'flat' ? '0.01' : '1'}
              max={feeType === 'percent' ? '100' : undefined}
              value={feeValue}
              onChange={(e) => onValueChange(e.target.value)}
              disabled={!canEdit}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
            />
          </div>
        )}
      </div>
    </section>
  );
}
