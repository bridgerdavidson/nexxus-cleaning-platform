'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, CheckCircle, Clock, Loader2, Save, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { sectionVisibleToRole } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

type PayoutModel = 'percentage_contractor' | 'hourly_external';

// Only the contractor flow is shippable today. The hourly flow's payment
// pipeline isn't built yet — the radio is rendered but disabled so owners can
// see what's coming without being able to save a model the system won't honor.
const ENABLED: PayoutModel[] = ['percentage_contractor'];

export default function PayoutModelSettingsPage() {
  const router = useRouter();
  const { user, currentOrganizationId, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!sectionVisibleToRole('payout-model', user.role, currentOrgRole ?? undefined, permissions)) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, permissions, router]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<PayoutModel>('percentage_contractor');
  const [originalModel, setOriginalModel] = useState<PayoutModel>('percentage_contractor');

  useEffect(() => {
    if (!currentOrganizationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('default_payout_model')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const v = ((data as { default_payout_model: string }).default_payout_model || 'percentage_contractor') as PayoutModel;
        setModel(v);
        setOriginalModel(v);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  async function save() {
    if (!currentOrganizationId) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/organizations/${currentOrganizationId}/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ default_payout_model: model }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setOriginalModel(model);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const dirty = model !== originalModel;

  return (
    <>
      <SettingsPageHeader
        section="Payout model"
        title="Payout model"
        description="How your cleaners are paid. You can change this any time, but switching mid-job affects how that job's payout is computed."
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-4">
          <ModelOption
            id="percentage_contractor"
            icon={<Briefcase className="h-5 w-5" />}
            title="Percentage contractor"
            description="Your cleaner is an independent contractor and receives a share of each job's price. Stripe Connect handles the payout."
            selected={model === 'percentage_contractor'}
            disabled={false}
            onSelect={() => setModel('percentage_contractor')}
          />
          <ModelOption
            id="hourly_external"
            icon={<Clock className="h-5 w-5" />}
            title="Hourly (paid outside Nexxus)"
            description="Your cleaner is an employee on payroll. Nexxus tracks hours; you pay them through your payroll provider."
            selected={model === 'hourly_external'}
            disabled={!ENABLED.includes('hourly_external')}
            comingSoon
            onSelect={() => setModel('hourly_external')}
          />

          {error && <p className="text-sm text-red-600">{error}</p>}
          {savedAt && !dirty && (
            <p className="flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle className="w-4 h-4" /> Saved
            </p>
          )}

          <div className="pt-2">
            <button
              onClick={save}
              disabled={saving || !dirty || !ENABLED.includes(model)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save model'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface ModelOptionProps {
  id: PayoutModel;
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  comingSoon?: boolean;
  onSelect: () => void;
}

function ModelOption({
  id,
  icon,
  title,
  description,
  selected,
  disabled,
  comingSoon,
  onSelect,
}: ModelOptionProps) {
  return (
    <label
      className={`relative flex cursor-pointer items-start gap-4 rounded-2xl border bg-white p-5 shadow-sm transition ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : selected
            ? 'border-primary-500 ring-2 ring-primary-200'
            : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <input
        type="radio"
        name="payout-model"
        value={id}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
          selected ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {comingSoon && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Coming soon
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      </div>
      <div className="flex-shrink-0">
        <div
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
            selected ? 'border-primary-600 bg-primary-600' : 'border-gray-300 bg-white'
          }`}
        >
          {selected && <Wallet className="h-3 w-3 text-white" />}
        </div>
      </div>
    </label>
  );
}
