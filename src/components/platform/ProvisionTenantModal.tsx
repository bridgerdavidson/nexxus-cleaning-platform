'use client';

import { useState } from 'react';
import { Loader, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useProvisionTenant } from '@/hooks/usePlatformOrganizations';

interface Props {
  onClose: () => void;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Platform-owner action: create a new tenant + email its founder an owner invite.
 * Org name + owner email are required; billing email defaults to the owner email
 * server-side when left blank.
 */
export default function ProvisionTenantModal({ onClose }: Props) {
  const { showToast } = useToast();
  const provision = useProvisionTenant();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const trimmedOwner = ownerEmail.trim();
    if (!trimmedName) {
      setError('Enter a company name.');
      return;
    }
    if (!EMAIL_RE.test(trimmedOwner)) {
      setError('Enter a valid owner email.');
      return;
    }
    try {
      await provision.mutateAsync({
        name: trimmedName,
        owner_email: trimmedOwner,
        billing_email: billingEmail.trim() || undefined,
      });
      showToast('Tenant provisioned — invite sent to the owner', { variant: 'success' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to provision tenant');
    }
  }

  const submitting = provision.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-title"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 id="provision-title" className="text-lg font-bold text-secondary-900">
            Provision a tenant
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-400 transition-colors duration-150 hover:bg-secondary-100 hover:text-secondary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-5 text-sm text-secondary-500">
          Creates the company on a free trial and emails the owner a link to set up their account.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="org-name" className="block text-sm font-medium text-secondary-700">
              Company name <span className="text-red-500">*</span>
            </label>
            <input
              id="org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              placeholder="Sparkle Cleaning Co."
              className="mt-1 w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm text-secondary-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div>
            <label htmlFor="owner-email" className="block text-sm font-medium text-secondary-700">
              Owner email <span className="text-red-500">*</span>
            </label>
            <input
              id="owner-email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="founder@sparkle.com"
              className="mt-1 w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm text-secondary-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <p className="mt-1 text-xs text-secondary-500">
              They’ll get an invite to set a password and configure the business.
            </p>
          </div>

          <div>
            <label htmlFor="billing-email" className="block text-sm font-medium text-secondary-700">
              Billing email <span className="text-secondary-400">(optional)</span>
            </label>
            <input
              id="billing-email"
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              autoComplete="email"
              placeholder="Defaults to the owner email"
              className="mt-1 w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm text-secondary-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-secondary-300 px-4 py-2 text-sm font-medium text-secondary-700 transition-colors duration-150 hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
            >
              {submitting && <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {submitting ? 'Provisioning…' : 'Provision tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
