"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import OrgPaymentMethodPicker from "./OrgPaymentMethodPicker";
import { placeAppointmentPayment, type PlaceHoldResult } from "@/lib/payments/authorizeClient";

interface Props {
  appointmentId: string;
  organizationId: string;
  /** Called with the hold result after a card change so the parent can clear the failure banner. */
  onHoldResult?: (result: PlaceHoldResult) => void;
  /** True for a COMPLETED job: changing the card charges it immediately instead of placing a hold. */
  chargeNow?: boolean;
}

/**
 * Company-card manager for a SELF-PAY appointment's details drawer. Self-pay charges the org's
 * company card (there's no homeowner), so it reuses OrgPaymentMethodPicker (saved company cards +
 * add a new card/bank via the same shared Stripe panel used in booking step 3). Switching or adding
 * a card promotes it to the org default and immediately re-places the hold (or, for a completed job,
 * charges it now), surfacing the result inline instead of waiting on the cron.
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
    const hold = await placeAppointmentPayment(appointmentId, organizationId, { chargeNow });
    setResult(hold);
    setPlacing(false);
    onHoldResult?.(hold);
  };

  return (
    <div className="space-y-2">
      <OrgPaymentMethodPicker organizationId={organizationId} onChanged={handleChanged} />
      {placing && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />{" "}
          {chargeNow ? "Charging the card..." : "Placing the card hold..."}
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
