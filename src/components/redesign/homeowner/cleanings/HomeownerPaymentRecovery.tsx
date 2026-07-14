'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CreditCard, Landmark } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { keys } from '@/lib/queryKeys';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import type { Appointment } from '@/hooks/useHomeownerData';
import {
  derivePaymentSectionState,
  mapChargeResponse,
  type PaymentSectionState,
} from '@/lib/payments/paymentSectionState';
import {
  paymentMethodSubtitle,
  paymentMethodTitle,
} from '@/components/redesign/shared/payment-methods/derive-payment-methods';
import { CardPickerSheet } from '@/components/redesign/homeowner/booking/CardPickerSheet';

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function paymentCopy(args: {
  state: PaymentSectionState;
  priceLabel: string;
  cardLabel: string | null;
  justPaidNow: boolean;
  jobCompleted: boolean;
}): { heading: string; description: string | null } {
  const { state, priceLabel, cardLabel, justPaidNow, jobCompleted } = args;
  switch (state) {
    case 'failed':
      return { heading: 'Payment failed', description: "We couldn't charge your card for this cleaning." };
    case 'requires_action':
      return {
        heading: 'Confirm your payment',
        description: 'Your bank needs to verify this card before we can charge it. Update your card to continue.',
      };
    case 'processing':
      return { heading: 'Payment processing', description: "We'll let you know once it's confirmed." };
    case 'before_charge':
      // Once the job is done the charge is due now (e.g. after "Update card" cleared a failed auth
      // back to null), so the pre-completion "you'll be charged after" line would be wrong.
      return jobCompleted
        ? {
            heading: 'Card on file',
            description: 'Your cleaning is done. Pay now to complete your payment.',
          }
        : {
            heading: 'Card on file',
            description: `You'll be charged ${priceLabel} after your cleaning is completed.`,
          };
    case 'paid':
      return {
        heading: `Paid ${priceLabel}`,
        description: cardLabel
          ? `Charged to ${cardLabel}${justPaidNow ? ' just now' : ''}.`
          : justPaidNow
            ? 'Charged just now.'
            : null,
      };
    case 'no_card':
      return {
        heading: 'No card on file',
        description: "Add a card so we can charge you after your cleaning is completed.",
      };
    case 'self_pay':
      return { heading: 'Self-pay', description: 'Managed by your cleaning company.' };
    default:
      return { heading: 'Payment', description: null };
  }
}

/**
 * R7 homeowner Payment section, mounted inside `HomeownerCleaningDetail` behind
 * `stripeNewChargeFlowUiEnabled()`. Consumer-toned: calm/informational for every state except a
 * genuine failure (`failed`) or a bank-verification bounce (`requires_action`), which get an
 * alert treatment. `requires_action` deliberately offers Update card only, never Pay now: an
 * off-session retry cannot clear 3DS and would just loop back to `requires_action`.
 */
export function HomeownerPaymentRecovery({ appointment }: { appointment: Appointment }) {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const [charging, setCharging] = useState(false);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [chargeMessage, setChargeMessage] = useState<string | null>(null);
  // Set true only after a Pay now response with code "charged" (never optimistically before the
  // response). Drives the "just now" confirmation copy; the underlying badge/state still comes
  // from the refetched appointment, not this flag.
  const [justPaidNow, setJustPaidNow] = useState(false);

  const organizationId = appointment.organization_id ?? currentOrganizationId ?? null;
  const card = appointment.payment_method_card ?? null;
  const priceLabel = formatUsd(appointment.total_price);
  const jobCompleted = appointment.status === 'completed';

  const state = derivePaymentSectionState({
    authorizationStatus: appointment.authorization_status ?? null,
    paymentStatus: appointment.payment_status ?? null,
    // The homeowner appointment shape (useHomeownerData) doesn't carry is_self_pay today; self-pay
    // cleanings are company-funded and never surface a homeowner Pay now, so false is safe here.
    // Pass the real flag through if that column is ever added to the query/type.
    isSelfPay: false,
    jobCompleted,
    hasCard: !!appointment.payment_method_id,
  });

  // Once the refetched appointment confirms recovery (state moved off failed/requires_action),
  // drop the stale inline error/guidance banner.
  useEffect(() => {
    if (state !== 'failed' && state !== 'requires_action') setChargeMessage(null);
  }, [state]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: keys.appointments.byHomeowner(userId) });
    void queryClient.invalidateQueries({ queryKey: keys.stats.homeowner(userId) });
  };

  const authHeaders = async () => {
    const token = await getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const handlePayNow = async () => {
    if (!organizationId || charging) return;
    setCharging(true);
    setChargeMessage(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/charge`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ organization_id: organizationId }),
      });
      const data = await res.json().catch(() => ({}));
      const code = typeof data.code === 'string' ? data.code : null;
      const message =
        typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : null;
      const { outcome } = mapChargeResponse(code, res.status);
      switch (outcome) {
        case 'charged':
          // Response-driven, not optimistic: the route already captured the payment.
          setJustPaidNow(true);
          toast.success(`Paid ${priceLabel}`);
          break;
        case 'processing':
          toast.info('Your payment is processing');
          break;
        case 'requires_action':
          setChargeMessage(message || 'Your bank needs to verify this card. Update your card to continue.');
          break;
        case 'declined':
          setChargeMessage(message || 'Your card was declined again.');
          break;
        case 'precondition':
          setChargeMessage(message || 'We could not charge this cleaning. Please try again.');
          break;
      }
    } catch (e) {
      setChargeMessage(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setCharging(false);
      // Never optimistically show Paid: the section's own badge/copy is driven by the refetched
      // appointment (or, for a genuine "charged" response, the justPaidNow flag set above from the
      // response itself), not an assumption made before either arrived.
      invalidate();
    }
  };

  const handleCardSelected = async (paymentMethodId: string) => {
    if (!organizationId || updatingCard) return;
    setUpdatingCard(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/payment-method`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ organization_id: organizationId, payment_method_id: paymentMethodId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update your card');
      setChargeMessage(null);
      toast.success('Card updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update your card');
    } finally {
      setUpdatingCard(false);
      invalidate();
    }
  };

  // justPaidNow is set only from an actual "charged" response (never optimistic). It can be true
  // for a render or two before the invalidated appointment query refetches and `state` itself
  // catches up to 'paid' — override `state` here so the copy/actions never show a stale "Failed"
  // in that gap.
  const effectiveState: PaymentSectionState = justPaidNow ? 'paid' : state;
  const alarm = effectiveState === 'failed' || effectiveState === 'requires_action';
  const copy = paymentCopy({
    state: effectiveState,
    priceLabel,
    cardLabel: card ? paymentMethodTitle(card) : null,
    justPaidNow,
    jobCompleted,
  });
  const showCardPreview = effectiveState !== 'paid';
  // Pay now stays available after "Update card" clears a failed auth back to null: a completed job
  // in before_charge is due now. requires_action deliberately never offers it (3DS can't clear
  // off-session). Also suppress it while authorization_status is the transient 'charging' claim
  // (chargeCompletedAppointment.ts): derivePaymentSectionState maps that to before_charge for the
  // sub-second window a completion charge is in flight, and a Pay now click then would 403 against
  // the charge-in-progress guard.
  const canPayNow =
    appointment.authorization_status !== 'charging' &&
    (effectiveState === 'failed' || (effectiveState === 'before_charge' && jobCompleted));
  const showActions =
    effectiveState === 'failed' ||
    effectiveState === 'requires_action' ||
    effectiveState === 'before_charge' ||
    effectiveState === 'no_card';

  return (
    <div
      className={
        alarm
          ? effectiveState === 'failed'
            ? 'space-y-3 rounded-card border border-critical/30 bg-critical-50 p-4'
            : 'space-y-3 rounded-card border border-caution/30 bg-caution-50 p-4'
          : 'space-y-3 rounded-card border border-border bg-card p-4 shadow-soft-sm'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={
              'text-sm font-bold ' + (alarm ? (effectiveState === 'failed' ? 'text-critical-700' : 'text-caution-700') : 'text-foreground')
            }
          >
            {copy.heading}
          </div>
          {copy.description ? (
            <p
              className={
                'mt-0.5 text-sm ' +
                (alarm ? (effectiveState === 'failed' ? 'text-critical-700' : 'text-caution-700') : 'text-muted-foreground')
              }
            >
              {copy.description}
            </p>
          ) : null}
        </div>
        {alarm ? (
          <AlertCircle
            className={'mt-0.5 size-5 shrink-0 ' + (effectiveState === 'failed' ? 'text-critical-700' : 'text-caution-700')}
            aria-hidden
          />
        ) : null}
      </div>

      {chargeMessage ? (
        <div className="flex items-start gap-2 rounded-control border border-critical/30 bg-card px-3 py-2 text-sm text-critical-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{chargeMessage}</span>
        </div>
      ) : null}

      {card && showCardPreview ? (
        <div className="flex items-center gap-3 rounded-card border border-border bg-card p-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
            {card.type === 'us_bank_account' ? (
              <Landmark className="size-4" aria-hidden />
            ) : (
              <CreditCard className="size-4" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{paymentMethodTitle(card)}</div>
            <div className="truncate text-xs text-muted-foreground">{paymentMethodSubtitle(card)}</div>
          </div>
        </div>
      ) : null}

      {showActions ? (
        <div className="flex flex-wrap gap-2">
          {canPayNow ? (
            <Button size="sm" loading={charging} onClick={() => void handlePayNow()}>
              Pay now · {priceLabel}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={canPayNow ? 'outline' : 'default'}
            loading={updatingCard}
            onClick={() => setCardPickerOpen(true)}
          >
            Update card
          </Button>
        </div>
      ) : null}

      <CardPickerSheet
        open={cardPickerOpen}
        onOpenChange={setCardPickerOpen}
        selectedId={appointment.payment_method_id ?? null}
        onSelect={(paymentMethodId) => void handleCardSelected(paymentMethodId)}
      />
    </div>
  );
}
