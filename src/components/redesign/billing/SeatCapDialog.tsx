'use client'

// The seat cap, resolved INLINE in the invite flow (ruling R16). Jobber and
// Calendly both do this; sending an operator to a billing page loses the
// invite they were part-way through writing, which is the whole reason the
// ruling exists. On success the caller retries that exact invite.
//
// THE RULE THIS COMPONENT EXISTS TO KEEP: the only number on screen is one
// Stripe gave us. Every figure in the total block comes from the preview
// endpoint. While a quote is in flight the total is a skeleton and the confirm
// button is disabled; if the quote fails, the confirm button stays disabled.
// Nothing here adds, subtracts or guesses a price. A locally computed total is
// how a customer is shown $99.00 and charged $109.00.
//
// Every decision (which case, which words, whether a number may be drawn yet)
// lives in seatCapDialogModel.ts, under unit test. This file is the renderer.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { useBilling } from '@/hooks/useBilling'
import { formatCents } from '@/lib/billing/format'
import { keys } from '@/lib/queryKeys'
import { changePlan, previewPlan } from './billing-api'
import { asBillingPeriod, asPlanTier } from './paywallModel'
import {
  priceErrorMessage,
  seatCapCaseFor,
  seatCapNotes,
  seatCapTotalRow,
  seatQuoteState,
} from './seatCapDialogModel'

const SUBMIT_ERROR = 'Could not add the seat. Please try again.'

/**
 * Where "Choose a plan" goes on a trial (Case 0).
 *
 * ⚠ NOT openPaywall(). The plan says the paywall, but paywallGate refuses to
 * render unless `access.frozen` is true AND paywallCopyFor has words for the
 * state, and a trialing org is neither frozen nor covered by that copy. Case 0
 * is reachable ONLY while trialing (a frozen org is refused by
 * assertOrgWritable with a 402 before the seat check ever runs), so
 * openPaywall() here would be a button that does nothing at all, every single
 * time. Settings > Plan and billing mounts the same PlanPicker and its "Choose
 * a plan" works today for a trialing owner. See the task report for the
 * one-line alternative in paywallModel.ts, which is another task's file.
 */
const CHOOSE_PLAN_PATH = '/admin/settings?section=billing'

export interface SeatCapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The person they were trying to invite, for the copy. */
  inviteeName: string | null
  /** Retried automatically after a seat is added. */
  onSeatAdded: () => void
}

export function SeatCapDialog({ open, onOpenChange, inviteeName, onSeatAdded }: SeatCapDialogProps) {
  const { access, billing, seatsInUse, isOwner, uiEnabled } = useBilling()
  const { currentOrganizationId } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const orgId = currentOrganizationId ?? ''

  const seatCase = seatCapCaseFor({
    uiEnabled,
    access,
    isOwner,
    tier: asPlanTier(billing?.plan_tier),
    seatCount: billing?.seat_count ?? null,
    seatsInUse,
    period: asBillingPeriod(billing?.billing_period),
    inviteeName,
  })

  // Non-null only for the two cases that cost money. It is both what gets
  // priced and what gets applied, so the quote cannot describe a different
  // purchase than the confirm button makes.
  const selection =
    seatCase.kind === 'add_seat' || seatCase.kind === 'upgrade' ? seatCase.selection : null

  const previewQuery = useQuery({
    queryKey: keys.billing.preview(
      orgId,
      selection?.tier ?? '',
      selection?.period ?? '',
      selection?.seat_count ?? 0,
    ),
    queryFn: () => previewPlan(orgId, selection!),
    enabled: open && !!orgId && !!selection,
    staleTime: 30_000,
  })

  const quote = seatQuoteState({
    needsQuote: !!selection,
    isFetching: previewQuery.isFetching,
    error: previewQuery.error,
    data: previewQuery.data,
    submitting,
  })

  function handleClose(): void {
    setSubmitError(null)
    onOpenChange(false)
  }

  async function handleConfirm(): Promise<void> {
    // Case 0: nothing to price and nothing to charge, so there is nothing to
    // confirm either. Send them to the plan picker.
    if (seatCase.kind === 'trial') {
      handleClose()
      router.push(CHOOSE_PLAN_PATH)
      return
    }
    // Never buy at an unknown price: no selection, or no settled quote for it,
    // means this does nothing. The button is already disabled in that state;
    // this is the second lock on the same door.
    if (!selection || !quote.preview) return

    setSubmitError(null)
    setSubmitting(true)
    try {
      // Same instant the quote was priced at, so the seat charge matches the
      // total this dialog showed. See PlanSelectionBody.proration_date.
      const result = await changePlan(orgId, {
        ...selection,
        proration_date: quote.preview.proration_date,
      })
      await queryClient.invalidateQueries({ queryKey: keys.billing.all })
      if (result?.checkout_url) {
        // No live subscription to amend, so the apply route hands back hosted
        // Stripe Checkout (ruling R10). The invite is not retried: the browser
        // is leaving this screen.
        window.location.href = result.checkout_url
        return
      }
      handleClose()
      // Ruling R16: the seat is only half the job. Losing the invite they were
      // writing is the thing this dialog exists to prevent.
      onSeatAdded()
    } catch {
      setSubmitError(SUBMIT_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  // Flag-dark, plus the unreadable-billing case. Placed after every hook so the
  // hook order never changes with the flag. The invite flow shows a toast
  // instead (seatCapFallbackToast), so this never leaves an operator with no
  // answer at all.
  if (seatCase.kind === 'unavailable') return null

  // The two cases that cost money, narrowed once. Everything priced hangs off
  // this, so the non-owner and trial cases cannot reach a figure at all.
  const priced = seatCase.kind === 'add_seat' || seatCase.kind === 'upgrade' ? seatCase : null
  const total = priced && quote.preview ? seatCapTotalRow(quote.preview, priced.totalLabel) : null
  const notes = quote.preview ? seatCapNotes({ preview: quote.preview, inviteeName }) : []

  const priceBlock =
    priced ? (
      <div className="mt-4 min-w-0 space-y-3 rounded-card border border-border bg-muted/40 p-4">
        <dl className="space-y-2">
          {priced.lines.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 text-sm text-muted-foreground">{line.label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">
                {formatCents(line.cents)}
              </dd>
            </div>
          ))}
        </dl>
        <Separator />
        {quote.status === 'error' ? (
          // "Please try again" needs a way to try again, or it is a dead
          // control: nothing else on this dialog re-runs the quote.
          <div className="space-y-2">
            <p className="text-sm font-semibold text-critical-700 dark:text-destructive">
              {priceErrorMessage(previewQuery.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void previewQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : total ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              {/* Ruling R17: the NEW total, prominent. Label and figure come
                  from the same object so the pair cannot disagree. */}
              <span className="text-sm font-bold text-foreground">{total.label}</span>
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {formatCents(total.cents)}
              </span>
            </div>
            {priced.comparison ? (
              <p className="text-xs text-muted-foreground">{priced.comparison}</p>
            ) : null}
            {notes.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        ) : (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {quote.status === 'error'
            ? priceErrorMessage(previewQuery.error)
            : total
              ? `${total.label} ${formatCents(total.cents)}`
              : 'Pricing this change'}
        </p>
      </div>
    ) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{seatCase.title}</DialogTitle>
          <DialogDescription>{seatCase.body}</DialogDescription>
        </DialogHeader>

        {priceBlock}

        {submitError ? (
          <p className="mt-3 text-sm font-semibold text-critical-700 dark:text-destructive">
            {submitError}
          </p>
        ) : null}

        <DialogFooter className="mt-4">
          {seatCase.kind === 'non_owner' ? (
            <Button variant="outline" onClick={handleClose}>
              {seatCase.closeLabel}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>
                {seatCase.cancelLabel}
              </Button>
              <Button
                onClick={() => void handleConfirm()}
                loading={submitting}
                disabled={!quote.canConfirm}
              >
                {seatCase.confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
