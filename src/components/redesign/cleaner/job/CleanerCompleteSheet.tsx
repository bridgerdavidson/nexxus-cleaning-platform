'use client';

/**
 * CleanerCompleteSheet — bottom-sheet confirmation for completing an active job.
 *
 * Shows the authoritative charge breakdown (fetched lazily when open) and lets
 * the cleaner confirm job completion. On confirm it fires the completion mutation
 * (which charges the card) then swaps to a success state.
 *
 * Job is ALWAYS complete even when charge fails; the sheet says "Job complete"
 * in all outcomes. Charge failure is communicated calmly, without blame.
 */

import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useChargeProjection, useCompleteJob } from '@/hooks/useCleanerData';
import { useCleanerPayRequests } from '@/hooks/useCleanerPayRequests';
import { formatCents, completeSuccessCopy, type PayRequestOutcome } from './active-job-presenters';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CleanerCompleteSheetProps {
  open: boolean;
  appointmentId: string;
  onClose: () => void;
  onCompleted: () => void;
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  // Uses the shared Skeleton primitive (matches the rest of the cleaner slice)
  // instead of a bare animate-pulse div.
  return (
    <div className="flex items-center justify-between py-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown row
// ---------------------------------------------------------------------------

function BreakdownRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span
        className={cn(
          'text-sm',
          emphasis ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-sm tabular-nums',
          emphasis ? 'font-bold text-foreground' : 'font-medium text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CleanerCompleteSheet({
  open,
  appointmentId,
  onClose,
  onCompleted,
}: CleanerCompleteSheetProps) {
  const { projection, isLoading } = useChargeProjection(appointmentId, open);
  const completeJob = useCompleteJob();

  // Request mode: the cleaner names their pay as a required completion step.
  const isRequestMode = projection?.payoutModel === 'request';
  // The anchor is their own approved history; the job price is hidden from them,
  // so without it they would be naming a number with no reference at all.
  const { anchor } = useCleanerPayRequests({
    appointmentId,
    enabled: open && isRequestMode,
  });

  // Success state after job is confirmed
  const [successOutcome, setSuccessOutcome] = useState<string | undefined>(undefined);
  const [payRequestOutcome, setPayRequestOutcome] = useState<PayRequestOutcome | undefined>(
    undefined,
  );
  const [didComplete, setDidComplete] = useState(false);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  const isCompleting = completeJob.isPending;

  async function handleComplete() {
    let requestAmountCents: number | undefined;
    if (isRequestMode) {
      const dollars = parseFloat(amount);
      if (!Number.isFinite(dollars) || dollars < 0) {
        setAmountError('Enter the amount you want to be paid for this job.');
        return;
      }
      requestAmountCents = Math.round(dollars * 100);
      setAmountError(null);
    }

    try {
      const result = await completeJob.mutateAsync(
        requestAmountCents === undefined ? appointmentId : { appointmentId, requestAmountCents },
      );
      setSuccessOutcome(result.chargeOutcome);
      setPayRequestOutcome(result.payRequest);
      setDidComplete(true);
    } catch {
      // useCompleteJob already shows a toast on error; sheet stays open so
      // the cleaner can retry or close. In request mode the completion is
      // deliberately blocked when the request POST fails, so retrying here
      // resends it.
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      // Reset local state when the drawer closes
      setDidComplete(false);
      setSuccessOutcome(undefined);
      setPayRequestOutcome(undefined);
      setAmount('');
      setAmountError(null);
      if (didComplete) {
        onCompleted();
      } else {
        onClose();
      }
    }
  }

  function handleDone() {
    setDidComplete(false);
    setSuccessOutcome(undefined);
    setPayRequestOutcome(undefined);
    setAmount('');
    setAmountError(null);
    onCompleted();
  }

  function handleNotYet() {
    onClose();
  }

  // Derive success copy (only relevant when didComplete)
  const successCopy = completeSuccessCopy(successOutcome, projection?.cleanerCutCents ?? 0, {
    payRequest: payRequestOutcome,
  });

  // ---------------------------------------------------------------------------
  // Render: success state
  // ---------------------------------------------------------------------------

  if (didComplete) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <DrawerHeader className="items-center text-center pb-2">
            <CheckCircle2
              aria-hidden="true"
              className="mx-auto mb-3 size-14 text-success-600"
            />
            <DrawerTitle className="text-lg">{successCopy.title}</DrawerTitle>
            <DrawerDescription className="mt-1 text-sm leading-relaxed">
              {successCopy.body}
            </DrawerDescription>
          </DrawerHeader>

          <DrawerFooter>
            <Button
              size="lg"
              onClick={handleDone}
              className="w-full min-h-[44px]"
            >
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: confirmation state
  // ---------------------------------------------------------------------------

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Complete this job?</DrawerTitle>
          <DrawerDescription>
            {isRequestMode
              ? "Tell us what you want to be paid for this job. If it fits your company's range it's approved right away, otherwise they'll review it."
              : 'The job will be marked complete and the customer will be charged.'}
          </DrawerDescription>
        </DrawerHeader>

        {/* Charge breakdown. In request mode there is no cut to show: the
            cleaner's pay is whatever they ask for below. */}
        {isLoading || !projection || !isRequestMode ? (
          <div
            aria-label="Charge breakdown"
            className="mx-5 rounded-card border border-border bg-card px-4 divide-y divide-border"
          >
            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : projection ? (
              <>
                {projection.display === 'full' && projection.chargeCents != null && (
                  <BreakdownRow
                    label="Customer is charged"
                    value={formatCents(projection.chargeCents)}
                  />
                )}
                {projection.cleanerCutCents != null && (
                  <BreakdownRow
                    label="Your cut"
                    value={formatCents(projection.cleanerCutCents)}
                    emphasis
                  />
                )}
              </>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                Could not load payment details.
              </p>
            )}
          </div>
        ) : null}

        {/* Request mode: naming the pay IS the completion step. */}
        {isRequestMode && !isLoading ? (
          <div className="mx-5">
            <FormField
              label="Request your pay"
              htmlFor="cl-request-amount"
              error={amountError ?? undefined}
              helper={
                anchor
                  ? anchor.samePlace
                    ? `Last time here you were paid ${formatCents(anchor.amountCents)}.`
                    : `You were last paid ${formatCents(anchor.amountCents)}.`
                  : 'Enter what you want to be paid for this job.'
              }
            >
              <Input
                id="cl-request-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                placeholder="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError(null);
                }}
                className="min-h-[44px] text-base"
              />
            </FormField>
          </div>
        ) : null}

        <DrawerFooter>
          <Button
            size="lg"
            onClick={handleComplete}
            disabled={isCompleting || isLoading}
            loading={isCompleting}
            className="w-full min-h-[44px]"
          >
            {isCompleting
              ? isRequestMode
                ? 'Sending...'
                : 'Completing...'
              : isRequestMode
                ? 'Send request and complete'
                : 'Complete job'}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={handleNotYet}
            disabled={isCompleting}
            className="w-full min-h-[44px]"
          >
            Not yet
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
