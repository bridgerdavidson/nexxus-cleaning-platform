'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2, Percent, Save, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useAdminCleaners } from '@/hooks/useAdminData';
import { sectionVisibleToRole } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

export default function CleanerPayoutsSettingsPage() {
  const router = useRouter();
  const { user, currentOrganizationId, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();
  const { cleaners, loading: cleanersLoading, updateCleanerInState } = useAdminCleaners();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!sectionVisibleToRole('cleaner-payouts', user.role, currentOrgRole ?? undefined, permissions)) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, permissions, router]);

  // ── Org default % ────────────────────────────────────────────────────────
  const [defaultPct, setDefaultPct] = useState('50');
  const [defaultDirty, setDefaultDirty] = useState(false);
  const [defaultLoading, setDefaultLoading] = useState(true);
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [defaultSavedAt, setDefaultSavedAt] = useState<number | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrganizationId) return;
    let cancelled = false;
    (async () => {
      setDefaultLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('default_cleaner_payout_percent')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const v = (data as { default_cleaner_payout_percent: number | null }).default_cleaner_payout_percent;
        setDefaultPct(String(v ?? 50));
        setDefaultDirty(false);
      }
      setDefaultLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  async function saveDefault() {
    if (!currentOrganizationId) return;
    const v = parseFloat(defaultPct);
    if (Number.isNaN(v) || v < 0 || v > 100) {
      setDefaultError('Enter a number between 0 and 100');
      return;
    }
    setDefaultSaving(true);
    setDefaultError(null);
    setDefaultSavedAt(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/organizations/${currentOrganizationId}/cleaner-payouts`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ default_cleaner_payout_percent: v }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setDefaultDirty(false);
      setDefaultSavedAt(Date.now());
    } catch (e) {
      setDefaultError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setDefaultSaving(false);
    }
  }

  // ── Per-cleaner draft state ─────────────────────────────────────────────
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSavedAt, setBulkSavedAt] = useState<number | null>(null);

  // Initialize draft when cleaners load.
  useEffect(() => {
    setDraft((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const c of cleaners) {
        if (next[c.id] === undefined) {
          next[c.id] = String(c.payout_percent ?? 0);
        }
      }
      return next;
    });
  }, [cleaners]);

  const dirtyIds = useMemo(() => {
    return cleaners
      .filter((c) => draft[c.id] !== undefined && parseFloat(draft[c.id]!) !== Number(c.payout_percent ?? 0))
      .map((c) => c.id);
  }, [cleaners, draft]);

  async function saveBulk() {
    if (dirtyIds.length === 0) return;
    setBulkError(null);
    setBulkSavedAt(null);

    const updates: { cleaner_id: string; payout_percent: number }[] = [];
    for (const id of dirtyIds) {
      const v = parseFloat(draft[id] ?? '');
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        setBulkError('All payout %s must be between 0 and 100');
        return;
      }
      updates.push({ cleaner_id: id, payout_percent: v });
    }

    setBulkSaving(true);
    try {
      const { error } = await supabase.rpc('bulk_update_cleaner_payouts', { updates });
      if (error) throw error;
      // Optimistic patch — realtime invalidation will refetch shortly anyway.
      for (const u of updates) {
        updateCleanerInState(u.cleaner_id, { payout_percent: u.payout_percent });
      }
      setBulkSavedAt(Date.now());
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <>
      <SettingsPageHeader
        section="Cleaner payouts"
        title="Cleaner payouts"
        description="Default payout share for new cleaners, and a per-cleaner override for everyone on your team."
      />

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50">
            <Percent className="h-5 w-5 text-primary-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-900">Organization default</h2>
            <p className="text-sm text-gray-500">
              The starting payout % when you add a new cleaner. Existing cleaners aren’t changed.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {defaultLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          ) : (
            <>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={defaultPct}
                  onChange={(e) => {
                    setDefaultPct(e.target.value);
                    setDefaultDirty(true);
                    setDefaultSavedAt(null);
                  }}
                  className="w-28 rounded-lg border border-gray-300 px-3 py-2 pr-8 text-right focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
              <button
                onClick={saveDefault}
                disabled={defaultSaving || !defaultDirty}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {defaultSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save default
              </button>
              {defaultSavedAt && !defaultDirty && (
                <span className="inline-flex items-center gap-1 text-sm text-green-700">
                  <CheckCircle className="w-4 h-4" /> Saved
                </span>
              )}
            </>
          )}
        </div>
        {defaultError && <p className="mt-2 text-sm text-red-600">{defaultError}</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">Per-cleaner overrides</h2>
          </div>
          <div className="flex items-center gap-3">
            {bulkSavedAt && dirtyIds.length === 0 && (
              <span className="inline-flex items-center gap-1 text-sm text-green-700">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
            <button
              onClick={saveBulk}
              disabled={bulkSaving || dirtyIds.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save {dirtyIds.length || ''} {dirtyIds.length === 1 ? 'change' : 'changes'}
            </button>
          </div>
        </div>

        {cleanersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : cleaners.length === 0 ? (
          <div className="px-6 pb-8 pt-2 text-sm text-gray-500">No cleaners yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100 border-t border-gray-200">
            {cleaners.map((c) => {
              const initials = `${c.user_profile?.first_name?.[0] ?? ''}${c.user_profile?.last_name?.[0] ?? ''}`.toUpperCase() || '?';
              const isDirty = dirtyIds.includes(c.id);
              return (
                <li key={c.id} className="flex items-center gap-4 px-6 py-3">
                  {c.user_profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.user_profile.avatar_url}
                      alt=""
                      className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-100">
                      <span className="text-xs font-semibold text-primary-700">{initials}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {c.user_profile?.first_name} {c.user_profile?.last_name}
                    </div>
                    <div className="truncate text-xs text-gray-500">{c.user_profile?.email}</div>
                  </div>
                  <div className="relative flex-shrink-0">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={draft[c.id] ?? String(c.payout_percent ?? 0)}
                      onChange={(e) => {
                        setDraft((prev) => ({ ...prev, [c.id]: e.target.value }));
                        setBulkSavedAt(null);
                      }}
                      className={`w-24 rounded-lg border px-2 py-1.5 pr-7 text-right text-sm focus:ring-2 focus:ring-primary-500 ${
                        isDirty ? 'border-primary-400 bg-primary-50' : 'border-gray-300'
                      }`}
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {bulkError && <p className="px-6 pb-4 text-sm text-red-600">{bulkError}</p>}
      </section>
    </>
  );
}
