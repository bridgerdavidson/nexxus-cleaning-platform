"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Landmark } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { keys } from "@/lib/queryKeys";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminAppointment } from "@/hooks/useAdminData";
import {
  derivePaymentSectionState,
  mapChargeResponse,
  type PaymentSectionState,
} from "@/lib/payments/paymentSectionState";
import {
  paymentMethodSubtitle,
  paymentMethodTitle,
} from "@/components/redesign/shared/payment-methods/derive-payment-methods";
import { PaymentBadge } from "../bookings-presenters";
import { Field } from "../detail-atoms";
import type { BookingPayment } from "../bookings-types";
import { useAppointmentCard } from "./useAppointmentCard";
import { ChangeCardSheet } from "./ChangeCardSheet";

// Presenter over PaymentSectionState. Reuses the existing PaymentBadge tone
// vocabulary (no new variant needed, per the design spec): "requires_action"
// borrows the caution/amber "pending" tone with a state-specific label.
const SECTION_BADGE: Record<PaymentSectionState, BookingPayment> = {
  failed: { tone: "failed", label: "Failed" },
  requires_action: { tone: "pending", label: "Action needed" },
  processing: { tone: "pending", label: "Processing" },
  before_charge: { tone: "none", label: "Card on file" },
  paid: { tone: "paid", label: "Paid" },
  no_card: { tone: "none", label: "No card on file" },
  self_pay: { tone: "selfpay", label: "Self-pay" },
};

const STATE_HINT: Record<PaymentSectionState, string | null> = {
  failed: "The card on file could not be charged.",
  requires_action: "The customer needs to confirm this payment with their bank.",
  processing: "This payment is processing.",
  before_charge: "Charged automatically when the job is completed.",
  paid: null,
  no_card: "No card is on file for this booking yet.",
  self_pay: "Managed in Settings, Payments.",
};

// The static before_charge hint above reads "Charged automatically when the job is completed,"
// which is stale once the job already IS completed (e.g. a completed-but-uncharged/null row).
// Swap in a completed-accurate variant there; every other state's hint is unaffected by job status.
function stateHint(state: PaymentSectionState, jobCompleted: boolean): string | null {
  if (state === "before_charge" && jobCompleted) {
    return "This cleaning is complete. It will be charged on the next billing run.";
  }
  return STATE_HINT[state];
}

/**
 * R6 operator Payment section: view the card on file + status, and (when
 * canManagePayments) the per-state recovery actions. Mounted inside
 * BookingDetailSheet in place of the old display-only block, gated by
 * canViewPayments + stripeNewChargeFlowUiEnabled() at the call site.
 */
export function OperatorPaymentSection({
  appointment,
  canManagePayments,
  priceLabel,
}: {
  appointment: AdminAppointment;
  canManagePayments: boolean;
  priceLabel: string | null;
}) {
  const { currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  const organizationId = appointment.organization_id ?? currentOrganizationId ?? null;
  const homeownerId = appointment.homeowner_id ?? null;
  const paymentMethodId = appointment.payment_method_id ?? null;
  const isSelfPay = !!appointment.is_self_pay;
  const jobCompleted = appointment.status === "completed";

  const state = derivePaymentSectionState({
    authorizationStatus: appointment.authorization_status ?? null,
    paymentStatus: appointment.payment_status ?? null,
    isSelfPay,
    jobCompleted,
    hasCard: !!paymentMethodId,
  });

  const {
    card,
    loading: cardLoading,
    error: cardError,
  } = useAppointmentCard({
    appointmentId: appointment.id,
    homeownerId,
    organizationId,
    paymentMethodId,
    enabled: !isSelfPay,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: keys.appointments.all });
  };

  const authHeaders = async () => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const handleRetry = async () => {
    if (!organizationId) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/charge`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ organization_id: organizationId }),
      });
      const data = await res.json().catch(() => ({}));
      const code = typeof data.code === "string" ? data.code : null;
      const message =
        typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : null;
      const { outcome } = mapChargeResponse(code, res.status);
      switch (outcome) {
        case "charged":
          toast.success("Payment successful");
          break;
        case "processing":
          toast.info("Payment is processing");
          break;
        case "requires_action":
          toast.warning(message || "The customer needs to verify their card with their bank");
          break;
        case "declined":
          toast.error(message || "Declined again");
          break;
        case "precondition":
          toast.error(message || "Could not charge this booking");
          break;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
      // Never optimistically show Paid: the badge is driven by the appointment
      // row refetch, not the response we just read.
      invalidate();
    }
  };

  const handleEmailCardLink = async () => {
    if (!organizationId || !homeownerId) return;
    setEmailing(true);
    try {
      const res = await fetch("/api/billing/card-links", {
        method: "POST",
        headers: await authHeaders(),
        // appointment_id lets the server send the urgent "payment did not go
        // through" email variant when this appointment's charge actually failed.
        body: JSON.stringify({
          organization_id: organizationId,
          homeowner_id: homeownerId,
          appointment_id: appointment.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create a card link");
      if (data.delivered === "email") {
        const customer = `${appointment.homeowner?.first_name ?? ""} ${appointment.homeowner?.last_name ?? ""}`.trim();
        toast.success(customer ? `Payment link emailed to ${customer}` : "Payment link emailed to the customer");
        return;
      }
      // SMTP not configured (or the send failed server-side): fall back to copy.
      const url = typeof data.url === "string" ? data.url : null;
      if (url && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard permission can be denied; the link was still created.
        }
      }
      toast.success("Payment link copied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create a card link");
    } finally {
      setEmailing(false);
    }
  };

  const hint = stateHint(state, jobCompleted);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Field label="Payment">
            <PaymentBadge payment={SECTION_BADGE[state]} />
          </Field>
          {priceLabel ? (
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Total</div>
              <div className="text-lg font-bold text-foreground">{priceLabel}</div>
            </div>
          ) : null}
        </div>

        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}

        {!isSelfPay ? (
          cardLoading ? (
            <Skeleton className="h-16 w-full rounded-card" />
          ) : cardError ? (
            <p className="text-sm text-critical-700">Could not load the card on file.</p>
          ) : card ? (
            <div className="flex items-center gap-3 rounded-card border border-border bg-card p-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
                {card.type === "us_bank_account" ? (
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
          ) : null
        ) : null}

        {canManagePayments ? (
          <div className="flex flex-wrap gap-2">
            {state === "failed" ? (
              <>
                <Button size="sm" loading={retrying} onClick={handleRetry}>
                  Retry charge
                </Button>
                <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)}>
                  Change card
                </Button>
                <Button size="sm" variant="ghost" loading={emailing} onClick={handleEmailCardLink}>
                  Email card link
                </Button>
              </>
            ) : null}

            {state === "requires_action" ? (
              <>
                <Button size="sm" loading={emailing} onClick={handleEmailCardLink}>
                  Email card link
                </Button>
                <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)}>
                  Change card
                </Button>
              </>
            ) : null}

            {state === "before_charge" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setChangeOpen(true)}>
                  Change card
                </Button>
                <Button size="sm" variant="ghost" loading={emailing} onClick={handleEmailCardLink}>
                  Email card link
                </Button>
              </>
            ) : null}

            {state === "no_card" ? (
              <Button size="sm" loading={emailing} onClick={handleEmailCardLink}>
                Email card link
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ChangeCardSheet
        open={changeOpen}
        onOpenChange={setChangeOpen}
        appointmentId={appointment.id}
        homeownerId={homeownerId}
        organizationId={organizationId}
        currentPaymentMethodId={paymentMethodId}
        onChanged={() => {
          invalidate();
          setChangeOpen(false);
        }}
        onEmailCardLink={handleEmailCardLink}
      />
    </>
  );
}
