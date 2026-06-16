'use client';

import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';

/** Bump the version suffix if the copy ever changes materially, so the note re-shows once. */
const STORAGE_KEY = 'nexxus.payout-timing-notice.dismissed.v1';

/**
 * One-time, dismissible explainer for how Stripe payout timing works. Rendered inside
 * PayoutsSection, so it shows on every payout screen (cleaner Earnings tab, /settings/payouts,
 * /settings/payments) for both cleaners and organizations. Once the user hits X it stays hidden
 * forever on that device (localStorage).
 *
 * Numbers come straight from Stripe's payout docs: a new account's first payout is held ~7-14 days
 * for verification, and standard payouts thereafter settle on a ~2 business-day rolling schedule.
 *
 * SSR-safe: `dismissed` starts null ("not checked yet") so we render nothing until the client has
 * read localStorage, which avoids a flash of the note for someone who already dismissed it.
 */
export default function PayoutTimingNotice() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // localStorage unavailable (private mode / blocked): show the note, just don't persist.
      setDismissed(false);
    }
  }, []);

  if (dismissed !== false) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Ignore persistence failures; hiding for this session is still the right behavior.
    }
    setDismissed(true);
  };

  return (
    <div className="relative mb-4 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 pr-10">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold text-blue-900">How payout timing works</p>
        <p className="mt-1 text-blue-800">
          Your first payout takes about 7 to 14 days while Stripe verifies your account. After that,
          payouts land in your bank in about 2 business days. Only the first one is slow; this is
          normal for card payments.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1 text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
