'use client';

import { useState } from 'react';
import { ArrowLeft, Eye, Loader, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { usePlatformOrganization } from '@/hooks/usePlatformOrganizations';
import { useToast } from '@/contexts/ToastContext';
import { keys } from '@/lib/queryKeys';
import { PaymentsBadge, SubscriptionBadge } from './statusBadges';
import DeleteOrgDialog from './DeleteOrgDialog';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-secondary-500">{label}</dt>
      <dd className="mt-1 text-sm text-secondary-900">{children}</dd>
    </div>
  );
}

function memberName(m: { first_name: string | null; last_name: string | null; email: string | null }) {
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
  return name || m.email || 'Unknown';
}

export function PlatformOrgDetail({ orgId, onBack }: { orgId: string; onBack: () => void }) {
  const { data: org, isLoading, isError, error, refetch } = usePlatformOrganization(orgId);
  const { startImpersonation } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // Surfaces an audit-log failure: startImpersonation is audit-first, so it
  // refuses to enter the impersonated view if /api/platform/impersonation can't
  // record the entry. The admin sees the reason rather than silently failing.
  const [impersonationError, setImpersonationError] = useState<string | null>(null);
  const [startingImpersonation, setStartingImpersonation] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleStartImpersonation = async (targetOrgId: string, targetName: string | null) => {
    setImpersonationError(null);
    setStartingImpersonation(true);
    try {
      const ok = await startImpersonation(targetOrgId, targetName);
      if (!ok) {
        setImpersonationError(
          "Couldn’t start “View as”: the audit log entry failed. Please try again.",
        );
        return;
      }
      router.push('/admin-dashboard');
    } finally {
      setStartingImpersonation(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-secondary-600 transition-colors duration-150 hover:bg-secondary-100 hover:text-secondary-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All tenants
      </button>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-secondary-200 bg-white py-16">
          <Loader className="h-6 w-6 animate-spin text-secondary-400" aria-label="Loading tenant" />
        </div>
      ) : isError || !org ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">
            Couldn’t load this tenant{error instanceof Error ? `: ${error.message}` : ''}.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-secondary-900">{org.name}</h1>
            <SubscriptionBadge status={org.subscription_status} />
            <PaymentsBadge org={org} />
            <button
              type="button"
              onClick={() => {
                void handleStartImpersonation(org.id, org.name);
              }}
              disabled={startingImpersonation}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm font-medium text-secondary-700 transition-colors duration-150 hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              {startingImpersonation ? 'Starting…' : 'View as this company'}
            </button>
          </div>

          {impersonationError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {impersonationError}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Billing */}
            <section className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-secondary-900">Billing</h2>
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Status">{org.subscription_status}</Field>
                <Field label="Renews">{formatDate(org.subscription_current_period_end)}</Field>
                <Field label="Billing email">{org.billing_email || '—'}</Field>
                <Field label="Platform fee">{(org.platform_fee_bps / 100).toFixed(2)}%</Field>
              </dl>
            </section>

            {/* Payments / Connect */}
            <section className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-secondary-900">Payments (Stripe Connect)</h2>
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Charges">{org.stripe_connect_charges_enabled ? 'Enabled' : 'Off'}</Field>
                <Field label="Payouts">{org.stripe_connect_payouts_enabled ? 'Enabled' : 'Off'}</Field>
                <Field label="Details submitted">
                  {org.stripe_connect_details_submitted ? 'Yes' : 'No'}
                </Field>
                <Field label="Payout model">{org.default_payout_model}</Field>
              </dl>
              {org.stripe_connect_requirements_due.length > 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {org.stripe_connect_requirements_due.length} Stripe requirement(s) outstanding.
                </p>
              )}
            </section>
          </div>

          {/* Danger Zone */}
          <section
            className="mt-6 rounded-xl border border-red-200 bg-white shadow-sm"
            aria-labelledby="danger-zone-heading"
          >
            <div className="border-b border-red-100 bg-red-50 px-5 py-3">
              <h2 id="danger-zone-heading" className="text-sm font-semibold text-red-800">
                Danger zone
              </h2>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-secondary-900">Delete this tenant</h3>
                <p className="mt-0.5 text-sm text-secondary-600">
                  Removes the organization, all of its data (appointments, properties, services,
                  payments), and any users that belong only to this tenant. Users that also belong
                  to other tenants are detached, not deleted.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <Trash2 className="h-4 w-4" />
                Delete organization
              </button>
            </div>
          </section>

          <DeleteOrgDialog
            open={deleteOpen}
            orgId={org.id}
            orgName={org.name}
            memberCount={org.member_counts.total}
            appointmentCount={org.counts.appointments}
            stripeConnected={Boolean(org.stripe_connect_account_id)}
            onClose={() => setDeleteOpen(false)}
            onDeleted={() => {
              setDeleteOpen(false);
              showToast(`Deleted ${org.name}`, { variant: 'success' });
              // Wipe the list cache so the org disappears from /owner immediately.
              queryClient.invalidateQueries({ queryKey: keys.platform.organizations.all });
              onBack();
            }}
          />

          {/* Members */}
          <section className="mt-4 rounded-xl border border-secondary-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-sm font-semibold text-secondary-900">Members</h2>
              <span className="text-xs text-secondary-500 tabular-nums">
                {org.member_counts.total} total · {org.counts.appointments} appointments
              </span>
            </div>
            {org.members.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-secondary-500">No members yet.</p>
            ) : (
              <div className="overflow-x-auto border-t border-secondary-100">
                <table className="min-w-full divide-y divide-secondary-100 text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                      <th scope="col" className="px-5 py-2.5">Name</th>
                      <th scope="col" className="px-5 py-2.5">Email</th>
                      <th scope="col" className="px-5 py-2.5">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-secondary-100">
                    {org.members.map((m) => (
                      <tr key={m.user_id}>
                        <td className="px-5 py-2.5 font-medium text-secondary-900">{memberName(m)}</td>
                        <td className="px-5 py-2.5 text-secondary-600">{m.email || '—'}</td>
                        <td className="px-5 py-2.5 capitalize text-secondary-600">{m.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
