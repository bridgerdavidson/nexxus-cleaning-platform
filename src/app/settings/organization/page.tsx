'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle, Loader2, Save } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { sectionVisibleToRole } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

interface OrgRow {
  name: string;
  logo_url: string | null;
  billing_email: string | null;
}

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const { user, currentOrganizationId, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!sectionVisibleToRole('organization', user.role, currentOrgRole ?? undefined, permissions)) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, permissions, router]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [billingEmail, setBillingEmail] = useState('');

  useEffect(() => {
    if (!currentOrganizationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('organizations')
        .select('name, logo_url, billing_email')
        .eq('id', currentOrganizationId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as OrgRow;
        setName(row.name ?? '');
        setLogoUrl(row.logo_url ?? '');
        setBillingEmail(row.billing_email ?? '');
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
        body: JSON.stringify({
          name: name.trim(),
          logo_url: logoUrl.trim() || null,
          billing_email: billingEmail.trim() || null,
        }),
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
        section="Organization"
        title="Organization"
        description="Your company name, logo, and the email Stripe uses for billing receipts."
      />

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-5">
            <Field label="Company name" htmlFor="org-name">
              <input
                id="org-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
              />
            </Field>

            <Field
              label="Logo URL"
              htmlFor="org-logo"
              hint="Paste a public image URL (PNG or JPG). File upload is coming."
            >
              <div className="flex items-start gap-3">
                <input
                  id="org-logo"
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                    className="h-12 w-12 rounded border border-gray-200 object-contain bg-white"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded border border-gray-200 bg-gray-50">
                    <Building2 className="h-5 w-5 text-gray-400" />
                  </div>
                )}
              </div>
            </Field>

            <Field
              label="Billing email"
              htmlFor="org-billing-email"
              hint="Stripe sends subscription invoices and receipts to this address."
            >
              <input
                id="org-billing-email"
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
              />
            </Field>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {savedAt && (
              <p className="flex items-center gap-1.5 text-sm text-green-700">
                <CheckCircle className="w-4 h-4" /> Saved
              </p>
            )}

            <div className="pt-2">
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
