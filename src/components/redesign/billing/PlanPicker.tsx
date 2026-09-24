'use client'

// The purchase surface. Built once, mounted twice (ruling R3): inside the
// full-screen paywall a frozen org hits, and behind "Change plan" in Settings.
//
// THE RULE THIS COMPONENT EXISTS TO KEEP: never show a number we are not
// certain of. Every figure in the total block comes from the preview endpoint,
// which asks Stripe. Nothing here guesses, and nothing here keeps a total from
// a previous selection on screen next to a new one. While a quote is in flight
// the total is a skeleton; if the quote fails, submit is disabled. Letting
// someone buy at an unknown price is the failure the preview endpoint was built
// to prevent.
//
// All the decisions live in planPickerModel.ts, under unit test. This file is
// the renderer.

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Stepper } from '@/components/ui/stepper'
import { formatCents } from '@/lib/billing/format'
import { billingEnforcementUiEnabled } from '@/lib/billing/flags'
import { PLANS, type BillingPeriod, type PlanTier } from '@/lib/billing/plans'
import { keys } from '@/lib/queryKeys'
import { cn } from '@/lib/utils'
import { previewPlan, type PlanSelectionBody } from './billing-api'
import {
  buildTierOptions,
  cancelNoteFor,
  clampSeats,
  defaultTierFor,
  initialPeriodFor,
  initialSeatsFor,
  planLines,
  priceErrorInfo,
  prorationNoteFor,
  renewalNoteFor,
  quoteStateFor,
  seatHelperText,
  seatMinReasonFor,
  seatRangeFor,
  taxNoteFor,
  totalRowFor,
} from './planPickerModel'

const SUBMIT_ERROR = 'Could not save this change. Please try again.'
/** Holding the plus button must not fire one request per click. */
const SEAT_DEBOUNCE_MS = 400

export interface PlanPickerProps {
  seatsInUse: number
  currentTier: PlanTier | null
  currentPeriod: BillingPeriod | null
  currentSeats: number | null
  orgId: string
  /** "Continue to payment" on the paywall, "Update plan" in Settings. */
  submitLabel: string
  onSubmit: (sel: PlanSelectionBody) => Promise<void>
  /** Escape hatch and trial-extension link, supplied by the host. */
  footer?: React.ReactNode
  /**
   * Invoked by the "See options" link on a tier the org is too big for (ruling
   * R6). The host decides what that means. OMIT IT and the link is not rendered
   * at all, rather than rendering dead.
   */
  onResolveTooSmall?: (tier: PlanTier) => void
}

export function PlanPicker({
  seatsInUse,
  currentTier,
  currentPeriod,
  currentSeats,
  orgId,
  submitLabel,
  onSubmit,
  footer,
  onResolveTooSmall,
}: PlanPickerProps) {
  const [period, setPeriod] = React.useState<BillingPeriod>(() => initialPeriodFor(currentPeriod))
  const [tier, setTier] = React.useState<PlanTier>(() => defaultTierFor(seatsInUse, currentTier))
  const [seats, setSeats] = React.useState<number>(() =>
    initialSeatsFor({ tier: defaultTierFor(seatsInUse, currentTier), seatsInUse, currentSeats }),
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  // The seat count the preview was asked about. It trails `seats` by the
  // debounce, which is exactly why the total must be a skeleton until the two
  // agree: in that window the on-screen stepper and the last quote disagree.
  const [pricedSeats, setPricedSeats] = React.useState(seats)
  React.useEffect(() => {
    if (pricedSeats === seats) return
    const id = setTimeout(() => setPricedSeats(seats), SEAT_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [seats, pricedSeats])

  const previewQuery = useQuery({
    queryKey: keys.billing.preview(orgId, tier, period, pricedSeats),
    queryFn: () => previewPlan(orgId, { tier, period, seat_count: pricedSeats }),
    enabled: !!orgId,
    staleTime: 30_000,
  })

  // Every "may we draw a number yet" decision, in one unit-tested place.
  const quote = quoteStateFor({
    seats,
    pricedSeats,
    isFetching: previewQuery.isFetching,
    error: previewQuery.error,
    data: previewQuery.data,
    submitting,
  })
  const preview = quote.preview
  const showPriceError = quote.status === 'error'
  // I1: past_due and unpaid refuse the preview with billing_payment_required
  // every time, so "Try again" next to that message would be a dead control.
  // Computed here, once, so every place the error renders (desktop, mobile,
  // the sr-only status line) agrees on both the wording and whether a retry
  // is offered.
  const priceError = showPriceError ? priceErrorInfo(previewQuery.error) : null

  const options = buildTierOptions({ period, seatsInUse, currentTier })
  const plan = PLANS[tier]
  const seatRange = seatRangeFor(tier, seatsInUse)
  const lines = planLines({ tier, period, seatCount: seats })
  const total = preview ? totalRowFor(preview) : null

  function selectTier(next: PlanTier) {
    setTier(next)
    setSeats((current) => clampSeats({ tier: next, seatsInUse, desired: current }))
  }

  async function handleSubmit() {
    // Submits the exact triple that was priced, never the live state. They are
    // equal whenever `preview` exists; pricing the submit off the same value
    // makes that structural rather than an invariant to keep re-proving.
    if (!preview) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      // proration_date rides along with the triple: the apply route prorates at
      // the instant THIS quote was priced at, so the figure above the button is
      // the figure Stripe charges rather than one recomputed a few seconds later.
      await onSubmit({
        tier,
        period,
        seat_count: pricedSeats,
        proration_date: preview.proration_date,
      })
    } catch {
      setSubmitError(SUBMIT_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  // Flag-dark: no billing surface renders until ops flips the UI flag. Placed
  // after every hook so the hook order never changes with the flag.
  if (!billingEnforcementUiEnabled()) return null

  const totalBlock = priceError ? (
    // "Please try again" has to come with a way to try again, or it is a dead
    // control (I1): past_due and unpaid refuse this preview every time, so
    // that case renders no retry button at all, only the real next step.
    <div className="space-y-2">
      <p className="text-sm font-semibold text-critical-700 dark:text-destructive">{priceError.message}</p>
      {priceError.retryable ? (
        <Button variant="outline" onClick={() => void previewQuery.refetch()}>
          Try again
        </Button>
      ) : null}
    </div>
  ) : total && preview ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-foreground">{total.label}</span>
        {/* Label and figure come from the same number (ruling R21 v2), so this
            pair cannot say "nothing" over a real charge. */}
        <span className="text-3xl font-bold tabular-nums text-foreground">
          {formatCents(total.cents)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{renewalNoteFor({ preview, period })}</p>
      {prorationNoteFor(preview) ? (
        <p className="text-xs text-muted-foreground">{prorationNoteFor(preview)}</p>
      ) : null}
      {taxNoteFor(preview) ? (
        <p className="text-xs text-muted-foreground">{taxNoteFor(preview)}</p>
      ) : null}
      {cancelNoteFor(period) ? (
        <p className="text-xs text-muted-foreground">{cancelNoteFor(period)}</p>
      ) : null}
    </div>
  ) : (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-36" />
      <Skeleton className="h-3 w-48" />
    </div>
  )

  const pricingStatus = (
    <p className="sr-only" role="status" aria-live="polite">
      {priceError
        ? priceError.message
        : total && preview
          ? `${total.label} ${formatCents(total.cents)}`
          : 'Pricing your selection'}
    </p>
  )

  return (
    <div className="space-y-4">
      {/* min-w-0 on BOTH children: without it a long line inside either column
          sets a floor wider than the viewport and the page scrolls sideways. */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="sr-only">Billing period</h3>
            <SegmentedControl<BillingPeriod>
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: 'Yearly' },
              ]}
              value={period}
              onChange={setPeriod}
            />
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            {options.map((option) => {
              const selected = option.tier === tier
              const reasonId = `plan-${option.tier}-reason`
              return (
                <div
                  key={option.tier}
                  className={cn(
                    'flex min-w-0 flex-col rounded-card border bg-card p-4 transition-colors duration-base',
                    selected ? 'border-primary ring-2 ring-primary/15' : 'border-border',
                    !option.available && 'opacity-60',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!option.available) return
                      selectTier(option.tier)
                    }}
                    aria-pressed={selected}
                    aria-disabled={option.available ? undefined : true}
                    aria-describedby={option.available ? undefined : reasonId}
                    className="min-w-0 flex-1 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-sm font-bold text-foreground">{option.name}</span>
                    <span className="mt-1 block text-2xl font-bold tabular-nums text-foreground">
                      {formatCents(option.priceCents)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {period === 'annual' ? 'per month, billed yearly' : 'per month'}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {option.includedSeats} seats included
                    </span>
                    {option.fitReason ? (
                      <span className="mt-2 block text-xs font-semibold text-primary dark:text-brand-400">
                        {option.fitReason}
                      </span>
                    ) : null}
                  </button>
                  {option.unavailableReason ? (
                    <p
                      id={reasonId}
                      className="mt-2 text-xs font-semibold text-caution-700 dark:text-caution"
                    >
                      {option.unavailableReason}
                    </p>
                  ) : null}
                  {!option.available && onResolveTooSmall ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1 self-start px-0"
                      onClick={() => onResolveTooSmall(option.tier)}
                    >
                      See options
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <Card className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Cleaner seats</p>
              <p className="text-xs text-muted-foreground">
                {seatHelperText(seatsInUse, plan.includedSeats)}
              </p>
            </div>
            <Stepper
              value={seats}
              min={seatRange.min}
              max={seatRange.max}
              onChange={setSeats}
              label="Cleaner seats"
              minReason={seatMinReasonFor(tier, seatsInUse)}
            />
          </Card>
        </div>

        <div className="min-w-0">
          <Card className="min-w-0 p-5 lg:sticky lg:top-20">
            <h3 className="text-sm font-bold text-foreground">Your plan</h3>
            <dl className="mt-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-sm text-muted-foreground">{lines.base.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCents(lines.base.cents)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-sm text-muted-foreground">{lines.seats.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCents(lines.seats.cents)}
                </dd>
              </div>
              {preview && !preview.tax_excluded ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 text-sm text-muted-foreground">Sales tax</dt>
                  <dd className="text-sm font-semibold tabular-nums text-foreground">
                    {formatCents(preview.tax_cents)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <Separator className="my-4" />
            {totalBlock}
            {pricingStatus}
            {submitError ? (
              <p className="mt-3 text-sm font-semibold text-critical-700 dark:text-destructive">
                {submitError}
              </p>
            ) : null}
            <Button
              className="mt-4 hidden w-full lg:inline-flex"
              onClick={handleSubmit}
              loading={submitting}
              disabled={!quote.canSubmit}
            >
              {submitLabel}
            </Button>
            {footer ? <div className="mt-3 flex flex-col items-center gap-2">{footer}</div> : null}
          </Card>
        </div>
      </div>

      {/* Mobile CTA bar. Offset by the operator shell's fixed bottom nav
          (60px plus the device safe area) so the two never overlap. */}
      <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-30 lg:hidden">
        <Card className="flex min-w-0 items-center gap-3 p-3 shadow-soft-lg">
          <div className="min-w-0 flex-1">
            {priceError ? (
              <p className="text-xs font-semibold text-critical-700 dark:text-destructive">
                {priceError.message}
              </p>
            ) : total && preview ? (
              <>
                <p className="truncate text-xs text-muted-foreground">{total.label}</p>
                <p className="text-xl font-bold tabular-nums text-foreground">
                  {formatCents(total.cents)}
                </p>
              </>
            ) : (
              <div className="space-y-1" aria-hidden>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            )}
          </div>
          <Button onClick={handleSubmit} loading={submitting} disabled={!quote.canSubmit}>
            {submitLabel}
          </Button>
        </Card>
      </div>
    </div>
  )
}
