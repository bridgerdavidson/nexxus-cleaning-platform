'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, CheckCircle, Loader2, Save } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { sectionVisibleToRole } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

const DAYS: { key: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

type DayKey = (typeof DAYS)[number]['key'];
type DayRow = { open: string; close: string; closed: boolean };
type Hours = Record<DayKey, DayRow>;

const DEFAULT_HOURS: Hours = {
  mon: { open: '08:00', close: '17:00', closed: false },
  tue: { open: '08:00', close: '17:00', closed: false },
  wed: { open: '08:00', close: '17:00', closed: false },
  thu: { open: '08:00', close: '17:00', closed: false },
  fri: { open: '08:00', close: '17:00', closed: false },
  sat: { open: '09:00', close: '14:00', closed: false },
  sun: { open: '09:00', close: '14:00', closed: true },
};

function listTimezones(): string[] {
  type IntlWithSupported = typeof Intl & { supportedValuesOf?: (k: string) => string[] };
  const supported = (Intl as IntlWithSupported).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      // fall through to a curated shortlist
    }
  }
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'Europe/London',
    'Europe/Paris',
    'UTC',
  ];
}

export default function BusinessHoursSettingsPage() {
  const router = useRouter();
  const { user, currentOrganizationId, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!sectionVisibleToRole('business-hours', user.role, currentOrgRole ?? undefined, permissions)) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, permissions, router]);

  const timezones = useMemo(listTimezones, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [timezone, setTimezone] = useState('America/New_York');
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);

  useEffect(() => {
    if (!currentOrganizationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('timezone, business_hours')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as { timezone: string | null; business_hours: Hours | null };
        setTimezone(row.timezone ?? 'America/New_York');
        setHours({ ...DEFAULT_HOURS, ...(row.business_hours ?? {}) });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  function updateDay(day: DayKey, patch: Partial<DayRow>) {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    setSavedAt(null);
  }

  async function save() {
    if (!currentOrganizationId) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/organizations/${currentOrganizationId}/business-hours`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ timezone, business_hours: hours }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsPageHeader
        section="Business hours"
        title="Business hours"
        description="Your weekly schedule. Bookings outside these hours flag a warning to the homeowner before confirming."
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <label htmlFor="org-timezone" className="mb-1 block text-sm font-medium text-gray-700">
              Timezone
            </label>
            <select
              id="org-timezone"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                setSavedAt(null);
              }}
              className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
            >
              {timezones.includes(timezone) ? null : <option value={timezone}>{timezone}</option>}
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Times below are in this timezone. Daylight saving is handled automatically.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">Weekly schedule</h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {DAYS.map(({ key, label }) => {
                const row = hours[key];
                return (
                  <li key={key} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="w-28 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={!row.closed}
                        onChange={(e) => updateDay(key, { closed: !e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Open
                    </label>
                    <input
                      type="time"
                      value={row.open}
                      disabled={row.closed}
                      onChange={(e) => updateDay(key, { open: e.target.value })}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                    />
                    <span className="text-sm text-gray-400">to</span>
                    <input
                      type="time"
                      value={row.close}
                      disabled={row.closed}
                      onChange={(e) => updateDay(key, { close: e.target.value })}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {savedAt && (
            <p className="flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle className="w-4 h-4" /> Saved
            </p>
          )}

          <div>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
