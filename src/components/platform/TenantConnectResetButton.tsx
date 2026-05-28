'use client';

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

interface TenantConnectResetButtonProps {
  orgId: string;
  orgName: string;
  /** Current stored stripe_connect_account_id for the org, or null. */
  currentAccountId: string | null;
  /** Called after a successful reset so the parent can refetch. */
  onReset: () => void;
}

/**
 * Platform-admin button + confirm dialog for `/api/platform/organizations/[id]/connect/reset`.
 *
 * Recovery path for stuck Connect state — the "Stripe account mismatch detected"
 * banner that surfaces from drift detection (incident 2026-05-28) is cleared
 * by running this reset. Best-effort deletes the stub Connect account on
 * Stripe, then nulls the local pointers so the next /start call creates fresh.
 */
export default function TenantConnectResetButton({
  orgId,
  orgName,
  currentAccountId,
  onReset,
}: TenantConnectResetButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    stripe_delete_status: 'skipped' | 'deleted' | 'error';
    stripe_delete_error: string | null;
    before_account_id: string | null;
  } | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
    }
  }, [open]);

  async function handleReset() {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/platform/organizations/${orgId}/connect/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `Reset failed with status ${res.status}`);
      }
      setResult({
        stripe_delete_status: (data as { stripe_delete_status: 'skipped' | 'deleted' | 'error' })
          .stripe_delete_status,
        stripe_delete_error: (data as { stripe_delete_error: string | null }).stripe_delete_error,
        before_account_id: (data as { before_account_id: string | null }).before_account_id,
      });
      onReset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <RotateCcw className="h-4 w-4" />
        Reset Connect
      </button>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={submitting ? undefined : () => setOpen(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              role="dialog"
              aria-labelledby="reset-connect-title"
              aria-modal="true"
              className="relative max-w-lg w-full overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up"
            >
              {!submitting && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="absolute top-3 right-3 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              )}

              <div className="border-b border-amber-200 bg-amber-50 px-6 py-4">
                <h2 id="reset-connect-title" className="text-lg font-bold text-amber-900">
                  Reset Stripe Connect for {orgName}
                </h2>
              </div>

              {result ? (
                <div className="space-y-3 px-6 py-5 text-sm text-gray-700">
                  <p className="font-medium text-secondary-900">
                    Connect state cleared.
                  </p>
                  <ul className="space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-xs">
                    <li>
                      Stored account before: <span className="font-mono">{result.before_account_id || '—'}</span>
                    </li>
                    <li>
                      Stripe delete:{' '}
                      <span
                        className={
                          result.stripe_delete_status === 'deleted'
                            ? 'font-semibold text-green-700'
                            : result.stripe_delete_status === 'error'
                            ? 'font-semibold text-red-700'
                            : 'font-semibold text-gray-700'
                        }
                      >
                        {result.stripe_delete_status}
                      </span>
                      {result.stripe_delete_error ? ` — ${result.stripe_delete_error}` : ''}
                    </li>
                  </ul>
                  <p>
                    The tenant can now re-run Connect onboarding from a clean slate. If the
                    Stripe delete reported an error, you may need to finish it manually in
                    the Stripe dashboard (typical cause: non-zero balance or open charges).
                  </p>
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-lg bg-secondary-900 px-4 py-2 text-sm font-semibold text-white hover:bg-secondary-800"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-6 py-5">
                  <p className="mb-3 text-sm text-gray-700">
                    This will:
                  </p>
                  <ul className="mb-4 space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    <li>
                      Attempt to delete the connected Stripe account{' '}
                      <span className="font-mono text-xs">
                        {currentAccountId || '(none stored)'}
                      </span>
                    </li>
                    <li>Clear the tenant’s local Connect state so they can start over</li>
                    <li>Resolve any open Connect drift events for the tenant</li>
                  </ul>
                  <p className="mb-4 text-sm text-gray-600">
                    Existing payment history is untouched. Future charges + payouts will
                    fail until the tenant re-onboards.
                  </p>
                  {error && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      disabled={submitting}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={submitting}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      {submitting ? 'Resetting…' : 'Reset Connect'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
