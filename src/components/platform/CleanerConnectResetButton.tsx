'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

interface CleanerConnectResetButtonProps {
  cleanerId: string;
  cleanerName: string;
  /** Current stored stripe_connect_account_id for the cleaner, or null. */
  currentAccountId: string | null;
  /** Called after a successful reset so the parent can refetch. */
  onReset: () => void;
}

type ResetSuccess = {
  stripe_delete_status: 'skipped' | 'deleted' | 'error';
  stripe_delete_error: string | null;
  before_account_id: string | null;
  payout_count: number;
};

type InFlightConflict = {
  payout_count: number;
  before_account_id: string | null;
};

/**
 * Platform-admin button + confirm dialog for
 * `/api/platform/cleaners/[id]/connect/reset`.
 *
 * Recovery path for a cleaner whose embedded Stripe Connect onboarding got
 * stuck (the prod incident on 2026-05-28: looped on "Select an account for
 * payouts" because a partial bank-attach left the Stripe account in a state
 * it would never progress out of). Best-effort deletes the connected
 * account on Stripe, then nulls the local pointers + bumps the attempt
 * counter so the next /start call creates a fresh account.
 *
 * If the cleaner has in-flight payouts (status pending|approved), the route
 * returns 409; the button surfaces the count and requires a second
 * confirmation before re-posting with force:true.
 */
export default function CleanerConnectResetButton({
  cleanerId,
  cleanerName,
  currentAccountId,
  onReset,
}: CleanerConnectResetButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<InFlightConflict | null>(null);
  const [forceAcknowledged, setForceAcknowledged] = useState(false);
  const [result, setResult] = useState<ResetSuccess | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
      setConflict(null);
      setForceAcknowledged(false);
    }
  }, [open]);

  async function postReset(force: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/platform/cleaners/${cleanerId}/connect/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: true, ...(force ? { force: true } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.status === 409 && data.error === 'in_flight_payouts') {
        setConflict({
          payout_count: typeof data.payout_count === 'number' ? data.payout_count : 0,
          before_account_id:
            typeof data.before_account_id === 'string' ? data.before_account_id : null,
        });
        return;
      }
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : `Reset failed with status ${res.status}`,
        );
      }

      setResult({
        stripe_delete_status: data.stripe_delete_status as ResetSuccess['stripe_delete_status'],
        stripe_delete_error:
          typeof data.stripe_delete_error === 'string' ? data.stripe_delete_error : null,
        before_account_id:
          typeof data.before_account_id === 'string' ? data.before_account_id : null,
        payout_count: typeof data.payout_count === 'number' ? data.payout_count : 0,
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
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <RotateCcw className="h-3.5 w-3.5" />
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
              aria-labelledby="reset-cleaner-connect-title"
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
                <h2 id="reset-cleaner-connect-title" className="text-lg font-bold text-amber-900">
                  Reset Stripe Connect for {cleanerName}
                </h2>
              </div>

              {result ? (
                <div className="space-y-3 px-6 py-5 text-sm text-gray-700">
                  <p className="font-medium text-secondary-900">Connect state cleared.</p>
                  <ul className="space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-xs">
                    <li>
                      Stored account before:{' '}
                      <span className="font-mono">{result.before_account_id || '—'}</span>
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
                    {result.payout_count > 0 && (
                      <li>
                        In-flight payouts at reset:{' '}
                        <span className="font-semibold text-red-700">{result.payout_count}</span>{' '}
                        (orphaned — reconcile manually)
                      </li>
                    )}
                  </ul>
                  <p>
                    The cleaner can now reload <code>/settings/payouts</code> and start
                    Stripe onboarding from a clean slate. If the Stripe delete reported
                    an error, finish it manually in the Stripe dashboard (typical cause:
                    non-zero balance).
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
              ) : conflict ? (
                <div className="px-6 py-5">
                  <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {conflict.payout_count} in-flight payout{conflict.payout_count === 1 ? '' : 's'} will be orphaned.
                      </p>
                      <p className="mt-1">
                        This cleaner has payouts in <code>pending</code> or{' '}
                        <code>approved</code> status. Deleting their Stripe account will
                        leave those transfers unable to land. You must reconcile them
                        manually after resetting.
                      </p>
                    </div>
                  </div>
                  <label className="mb-4 flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      checked={forceAcknowledged}
                      onChange={(e) => setForceAcknowledged(e.target.checked)}
                      disabled={submitting}
                    />
                    <span>
                      I understand {conflict.payout_count} payout
                      {conflict.payout_count === 1 ? '' : 's'} may be orphaned and
                      I&apos;ll reconcile them manually.
                    </span>
                  </label>
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
                      onClick={() => void postReset(true)}
                      disabled={submitting || !forceAcknowledged}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      {submitting ? 'Resetting…' : 'Force reset anyway'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-6 py-5">
                  <p className="mb-3 text-sm text-gray-700">This will:</p>
                  <ul className="mb-4 space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    <li>
                      Attempt to delete the connected Stripe account{' '}
                      <span className="font-mono text-xs">
                        {currentAccountId || '(none stored)'}
                      </span>
                    </li>
                    <li>Clear the cleaner&apos;s local Connect state so they can start over</li>
                    <li>Resolve any open Connect drift events for the cleaner</li>
                  </ul>
                  <p className="mb-4 text-sm text-gray-600">
                    Existing payment history and appointments are untouched. Future
                    payouts to this cleaner will fail until they re-onboard.
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
                      onClick={() => void postReset(false)}
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
