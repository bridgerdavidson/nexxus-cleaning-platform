import { getAccessToken } from "@/lib/auth/clientAccessToken";

export interface PlaceHoldResult {
  ok: boolean;
  code?: string;
  /** A single friendly line to show inline in the drawer. */
  message: string;
}

/**
 * Charges a COMPLETED appointment's saved card after its card was changed, mapping the coded result
 * to one friendly line. The booking already exists, so this is best-effort immediate feedback for
 * the admin; the reconciliation sweep is the backstop. Shared by the homeowner and self-pay drawer
 * card managers (an upcoming job just saves the card and is charged when it is completed).
 */
export async function placeAppointmentPayment(
  appointmentId: string,
  organizationId: string,
): Promise<PlaceHoldResult> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`/api/appointments/${appointmentId}/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: organizationId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      error?: string;
    };
    const code = data.code;
    if (code === "charged") {
      return { ok: true, code, message: "Payment charged." };
    }
    if (code === "processing") {
      return { ok: true, code, message: "Payment is processing." };
    }
    if (code === "requires_action") {
      return {
        ok: false,
        code,
        message:
          "This card needs the customer to verify their identity, so it couldn't be charged. Try a different card.",
      };
    }
    // declined / no_card / no_org_card / cleaner_not_payable / tenant_not_ready / not_chargeable / error.
    return {
      ok: false,
      code,
      message: data.message || data.error || "The payment didn't go through.",
    };
  } catch {
    return {
      ok: false,
      message: "We couldn't reach the card processor. We'll keep trying automatically.",
    };
  }
}

export interface CompletionChargeResult {
  paymentStatus: "paid" | "processing" | "failed";
  paymentError?: string;
  paymentIntentId?: string;
}

/**
 * New-flow completion charge. A card is SAVED (not held) at booking, so once the job is marked
 * completed we create + auto-capture the charge on the saved card via `/charge`. Maps the coded
 * result to the shape the dashboard status-update helpers return. Non-fatal by contract: a payment
 * problem comes back as paymentStatus 'failed' so the job still completes and the row lands in
 * "Payments needing attention" for follow-up. Settlement to the cleaner runs on the
 * payment_intent.succeeded webhook, with the reconciliation sweep as the backstop.
 */
export async function chargeCompletedAppointmentClient(
  appointmentId: string,
  organizationId: string | undefined,
): Promise<CompletionChargeResult> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`/api/appointments/${appointmentId}/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: organizationId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      error?: string;
      payment_intent_id?: string;
    };
    if (!res.ok) {
      return { paymentStatus: "failed", paymentError: data.error || data.message || "Charge failed" };
    }
    // A 200 is either an instant card charge ('charged') or an ACH debit now clearing ('processing').
    return {
      paymentStatus: data.code === "processing" ? "processing" : "paid",
      paymentIntentId: data.payment_intent_id,
    };
  } catch (err) {
    return {
      paymentStatus: "failed",
      paymentError: err instanceof Error ? err.message : "Payment processing failed",
    };
  }
}
