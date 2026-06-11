"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import OrgPaymentMethodPicker from "./OrgPaymentMethodPicker";
import { placeAppointmentPayment, type PlaceHoldResult } from "@/lib/payments/authorizeClient";

interface Props {
  appointmentId: string;
  organizationId: string;
  /** Called with the card-update/charge result after a card change so the parent can clear the
   *  failure banner. */
  onHoldResult?: (result: PlaceHoldResult) => void;
  /** True for a COMPLETED job: changing the card charges it immediately. An upcoming job just saves
   *  the card (it is charged when the job is completed). */
  chargeNow?: boolean;
}

/**
 * Company-card manager for a SELF-PAY appointment's details drawer. Self-pay charges the org's
 * company card (there's no homeowner), so it reuses OrgPaymentMethodPicker (saved company cards +
 * add a new card/bank via the same shared Stripe panel used in booking step 3). Switching or adding
 * a card promotes it to the org default; for a COMPLETED job it then charges the card now, while an
 * upcoming job just saves it (the company card is charged when the job is completed).
 */
export default function AppointmentSelfPayCardManager({
  appointmentId,
  organizationId,
  onHoldResult,
  chargeNow,
}: Props) {
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<PlaceHoldResult | null>(null);

  const handleChanged = async () => {
    setPlacing(true);
    setResult(null);
    if (chargeNow) {
      // Completed job: charge the company card now and surface the result.
      const charged = await placeAppointmentPayment(appointmentId, organizationId);
      setResult(charged);
      onHoldResult?.(charged);
    } else {
      // Upcoming job: the company card is just saved (it is charged when the job is completed).
      const saved: PlaceHoldResult = {
        ok: true,
        message: "Card updated. It will be charged when the job is completed.",
      };
      setResult(saved);
      onHoldResult?.(saved);
    }
    setPlacing(false);
  };

  return (
    <div className="space-y-2">
      <OrgPaymentMethodPicker organizationId={organizationId} onChanged={handleChanged} />
      {placing && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />{" "}
          {chargeNow ? "Processing payment..." : "Updating payment method..."}
        </p>
      )}
      {!placing && result && (
        <p
          className={`flex items-center gap-2 text-sm ${
            result.ok ? "text-success-600" : "text-amber-600"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {result.message}
        </p>
      )}
    </div>
  );
}
