'use client'

// The wall a frozen organization's OWNER hits (ruling R2). It wraps the shell's
// content and renders `children`, the real dashboard, whenever it should not be
// on screen. That is why "View your data" is nothing more than close(): there is
// no overlay to tear down and no portal to unmount, so dismissing it cannot
// half-fail and leave a sheet of glass over the customer's own schedule.
//
// Mounted INSIDE <main>, not over the page, so the rail, the top bar and its
// banner stay visible and the user keeps their bearings.
//
// Every decision lives in paywallModel.ts and usePaywall.ts, both under unit
// test. This file is the renderer.

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useBilling } from '@/hooks/useBilling'
import { keys } from '@/lib/queryKeys'
import { PlanPicker } from './PlanPicker'
import { changePlan, extendTrial, type PlanSelectionBody } from './billing-api'
import {
  asBillingPeriod,
  asPlanTier,
  cachedCount,
  paywallGate,
  reassuranceLine,
} from './paywallModel'
import { syncPaywallFrozen, usePaywall } from './usePaywall'

const EXTEND_ERROR = 'Could not extend your trial. Please try again.'

export function BillingPaywall({ children }: { children: React.ReactNode }) {
  const { access, billing, seatsInUse, isOwner, uiEnabled } = useBilling()
  const { currentOrganizationId } = useAuth()
  const { isOpen, close } = usePaywall()
  const queryClient = useQueryClient()
  const headingId = React.useId()
  const [extending, setExtending] = React.useState(false)
  const [extendError, setExtendError] = React.useState<string | null>(null)

  const orgId = currentOrganizationId ?? ''
  // null while billing state is loading, so the effect below stays out of the
  // way rather than reporting "not frozen" during the gap.
  const frozen = access ? access.frozen : null

  React.useEffect(() => {
    if (!uiEnabled || !isOwner || frozen === null) return
    // EDGE triggered inside the store. Never call openPaywall() from here: a
    // level-triggered open would undo the user's dismissal on the next render.
    syncPaywallFrozen(frozen)
  }, [uiEnabled, isOwner, frozen])

  const gate = paywallGate({
    uiEnabled,
    access,
    isOwner,
    isOpen,
    pauseResumesAt: billing?.billing_pause_resumes_at ?? null,
  })

  async function handleSubmit(sel: PlanSelectionBody): Promise<void> {
    const result = await changePlan(orgId, sel)
    if (result?.checkout_url) {
      // Hosted Stripe Checkout (ruling R10).
      window.location.href = result.checkout_url
      return
    }
    await queryClient.invalidateQueries({ queryKey: keys.billing.all })
    close()
  }

  async function handleExtend(): Promise<void> {
    setExtendError(null)
    setExtending(true)
    try {
      await extendTrial(orgId)
      await queryClient.invalidateQueries({ queryKey: keys.billing.all })
    } catch {
      setExtendError(EXTEND_ERROR)
    } finally {
      setExtending(false)
    }
  }

  if (!gate.show) return <>{children}</>

  // Counts come from the query cache only. Nothing here adds a query, and a
  // cache miss falls back to the generic sentence rather than guessing.
  const reassurance = reassuranceLine({
    jobs: cachedCount(queryClient.getQueryData(keys.appointments.byOrg(orgId))),
    customers: cachedCount(queryClient.getQueryData(keys.customers.byOrg(orgId))),
  })

  // THE ESCAPE HATCH. Declared once, rendered in every branch below, behind no
  // condition of any kind. A real Button, never a text link. Read the header of
  // usePaywall.ts before touching this.
  const escapeHatch = (
    <Button variant="outline" onClick={close}>
      View your data
    </Button>
  )

  const extendLink = access?.canExtendTrial ? (
    // A standalone tappable link row (rendered alone in the footer, not
    // inline with other text): kept as link styling, not a boxed button, but
    // given a comfortable hit area rather than the 36px size="sm" gives it.
    // Same convention as PaymentMethodRow's link actions.
    <Button
      variant="link"
      size="sm"
      className="h-auto min-h-[44px] px-1"
      onClick={handleExtend}
      loading={extending}
    >
      Extend your trial by seven days
    </Button>
  ) : null

  return (
    <section aria-labelledby={headingId} className="min-h-[70vh] min-w-0 space-y-6">
      <header className="min-w-0 space-y-2">
        <h1
          id={headingId}
          className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
        >
          {gate.copy.headline}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{gate.copy.subhead}</p>
      </header>

      <p className="flex max-w-2xl items-start gap-2 rounded-card bg-positive-50 px-4 py-3 text-sm font-semibold text-positive-700 dark:bg-positive/15 dark:text-positive">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{reassurance}</span>
      </p>

      {extendError ? (
        <p className="text-sm font-semibold text-critical-700 dark:text-destructive">
          {extendError}
        </p>
      ) : null}

      {gate.showPicker ? (
        <PlanPicker
          seatsInUse={seatsInUse}
          currentTier={asPlanTier(billing?.plan_tier)}
          currentPeriod={asBillingPeriod(billing?.billing_period)}
          currentSeats={billing?.seat_count ?? null}
          orgId={orgId}
          submitLabel="Continue to payment"
          onSubmit={handleSubmit}
          footer={
            <>
              {escapeHatch}
              {extendLink}
            </>
          }
        />
      ) : (
        <div className="flex flex-col items-start gap-2">{escapeHatch}</div>
      )}
    </section>
  )
}
