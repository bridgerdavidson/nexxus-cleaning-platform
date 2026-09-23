'use client'

// Step 1 of the severity ladder (ruling R13): a quiet, dismissible pill for
// most of the trial, escalating to a firm, non-dismissible one in the last
// three days. At 0 days it renders nothing; the frozen bar in BillingBanners
// owns the message from there.
//
// The decision of WHAT to show lives in trialPillState (billingBannersModel.ts);
// this file only reads sessionStorage and renders the answer.

import * as React from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useBilling } from '@/hooks/useBilling'
import { trialPillState } from './billingBannersModel'

const DISMISS_KEY = 'nexxus.trialPillDismissed'

/**
 * sessionStorage can throw: private browsing, blocked site data, some
 * enterprise policies. A blocked read must still render the pill, so it
 * reads as "not dismissed" on failure rather than propagating the error.
 */
function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * A blocked write just means the dismissal does not persist across a reload;
 * it must never crash the click. Local component state (below) is what makes
 * the click still work for the rest of this session even when this throws.
 */
function writeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, 'true')
  } catch {
    // Storage blocked. The pill still disappears for this render via the
    // component's own state; it will just reappear on the next full reload.
  }
}

export function TrialPill(): React.JSX.Element | null {
  const { uiEnabled, canSeeBillingChrome, access } = useBilling()
  const [dismissed, setDismissed] = React.useState(false)

  // Read once on mount. SSR has no session, so the pill's first paint always
  // assumes "not dismissed" and this effect corrects it on the client.
  React.useEffect(() => {
    setDismissed(readDismissed())
  }, [])

  const state = trialPillState({ uiEnabled, canSeeBillingChrome, access, dismissed })
  if (!state.show) return null

  function handleDismiss() {
    writeDismissed()
    setDismissed(true)
  }

  return (
    <Badge
      variant={state.variant}
      // Matches the New booking button's own responsive discipline right next
      // to it: hidden on the cramped mobile top bar, visible from sm+. On
      // mobile the <=3 day banner carries the message instead.
      className="hidden sm:inline-flex"
    >
      {state.label}
      {state.dismissible ? (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="-mr-1 inline-flex size-4 items-center justify-center rounded-pill opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </Badge>
  )
}
