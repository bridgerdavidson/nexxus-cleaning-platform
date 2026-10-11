'use client'

// Task 11: what a customer sees in the seconds after they pay.
//
// Hosted Stripe Checkout returns here (Settings > Billing, never the
// paywall: a trialing buyer who purchases before their trial expires is
// never frozen, so no paywall is mounted to host this). The subscription
// itself lands in our database by webhook, so our own row can lag the
// redirect by a few seconds. This component's only job is to bridge that
// gap without ever reading as a failure: the payment already succeeded, only
// our copy of it is late, and the nightly reconcileBillingMirror sweep is
// the backstop if this component gives up first.
//
// Wraps BillingSection's content the same way BillingPaywall wraps the
// shell's: renders `children` whenever there is nothing to resolve, and
// takes the screen over only for the two short-lived states where the data
// underneath is not yet trustworthy to show. Every decision lives in
// checkoutReturnModel.ts, under unit test; this file is the renderer plus
// the side effects (the poll timer, the confirmation timer, and clearing the
// query string).

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { ShieldCheck, Info } from 'lucide-react'
import { NexxusLoader } from '@/components/ui/nexxus-loader'
import { useAuth } from '@/hooks/useAuth'
import { deriveBillingAccess } from '@/lib/billing/access'
import { keys } from '@/lib/queryKeys'
import { replaceSearchShallow } from '@/lib/shallowSearch'
import { fetchBillingState } from './billing-api'
import {
  afterConfirmedPause,
  afterPollTick,
  CONFIRMED_DISPLAY_MS,
  copyForPhase,
  initialPhase,
  parseCheckoutParam,
  POLL_INTERVAL_MS,
  replacesChildren,
  type PollState,
} from './checkoutReturnModel'

export function CheckoutReturn({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const { currentOrganizationId } = useAuth()
  const queryClient = useQueryClient()
  const orgId = currentOrganizationId ?? ''

  const raw = searchParams.get('checkout')

  // Seeded ONCE from the URL, via the lazy initializer. Every later render
  // reads this state, never the live search param again: that is what makes
  // clearing the param below safe, and what stops the whole flow from
  // replaying if anything else forces a re-render while it is in flight.
  const [state, setState] = React.useState<PollState>(() => ({
    phase: initialPhase(parseCheckoutParam(raw)),
    attempts: 0,
  }))

  // Clear `checkout` (and the now-meaningless `session_id`) exactly once, on
  // the render that first observes either value, keeping every other query
  // param (`section=billing` above all) intact. Native history API only:
  // router.replace is a documented no-op here on a same-path update after a
  // reload-with-params (memory: shallow-search-nav-rule).
  const clearedRef = React.useRef(false)
  React.useEffect(() => {
    if (clearedRef.current) return
    if (raw !== 'success' && raw !== 'canceled') return
    clearedRef.current = true
    const params = new URLSearchParams(window.location.search)
    params.delete('checkout')
    params.delete('session_id')
    const qs = params.toString()
    replaceSearchShallow(`${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }, [raw])

  // Poll while activating. Each tick re-reads billing state directly (not
  // through useBilling's own staleTime) and writes the result into the
  // shared query cache, so the section's own useBilling() call is already
  // showing the fresh plan by the time this component steps aside.
  React.useEffect(() => {
    if (state.phase !== 'activating' || !orgId) return
    let cancelled = false
    const id = setInterval(() => {
      void fetchBillingState(orgId)
        .then((payload) => {
          queryClient.setQueryData(keys.billing.org(orgId), payload)
          return deriveBillingAccess(payload.billing, new Date()).frozen
        })
        .catch(() => null as boolean | null)
        .then((frozen) => {
          if (cancelled) return
          setState((prev) => afterPollTick(prev, frozen))
        })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [state.phase, orgId, queryClient])

  // The brief "You are all set" pause, then reveal the real content.
  React.useEffect(() => {
    if (state.phase !== 'confirmed') return
    const id = setTimeout(() => {
      setState((prev) => afterConfirmedPause(prev))
    }, CONFIRMED_DISPLAY_MS)
    return () => clearTimeout(id)
  }, [state.phase])

  if (replacesChildren(state.phase)) {
    const copy = copyForPhase(state.phase)!
    return (
      <div className="grid min-h-[40vh] min-w-0 place-items-center px-4 text-center">
        <div className="flex flex-col items-center gap-4">
          {copy.showSpinner ? (
            <NexxusLoader className="h-12" />
          ) : (
            <ShieldCheck className="size-10 text-positive-700 dark:text-positive" aria-hidden />
          )}
          <p className="text-lg font-semibold text-foreground">{copy.message}</p>
        </div>
      </div>
    )
  }

  if (state.phase === 'timeout') {
    const copy = copyForPhase('timeout')!
    return (
      <div className="min-w-0 space-y-4">
        <p className="flex items-start gap-2 rounded-card bg-muted px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{copy.message}</span>
        </p>
        {children}
      </div>
    )
  }

  return <>{children}</>
}
