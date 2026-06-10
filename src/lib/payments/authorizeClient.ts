import { getAccessToken } from "@/lib/auth/clientAccessToken";

export interface PlaceHoldResult {
  ok: boolean;
  code?: string;
  /** A single friendly line to show inline in the drawer. */
  message: string;
}

/**
 * Places the payment for an appointment after its card was changed, and maps the coded result to one
 * friendly line. Two modes:
 *   - hold (default): an upcoming job gets a manual-capture authorization (`/authorize`).
 *   - chargeNow: a COMPLETED job whose hold never landed is charged immediately (`/charge`).
 * The booking already exists, so this is best-effort immediate feedback for the admin; the JIT cron
 * (holds) and the reconciliation sweep (charges) are the backstops. Shared by the homeowner and
 * self-pay drawer card managers.
 */
export async function placeAppointmentPayment(
  appointmentId: string,
  organizationId: string,
  opts?: { chargeNow?: boolean },
): Promise<PlaceHoldResult> {
  const endpoint = opts?.chargeNow ? "charge" : "authorize";
  try {
    const token = await getAccessToken();
    const res = await fetch(`/api/appointments/${appointmentId}/${endpoint}`, {
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
    if (code === "authorized") {
      return { ok: true, code, message: "Card hold placed." };
    }
    if (code === "charged") {
      return { ok: true, code, message: "Payment charged." };
    }
    if (code === "processing") {
      return { ok: true, code, message: "Payment is processing." };
    }
    if (code === "deferred_ach") {
      return {
        ok: true,
        code,
        message: opts?.chargeNow
          ? "The bank account is being charged; it clears in a few business days."
          : "The bank account will be charged when the job is completed.",
      };
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

/** Back-compat alias: place a hold (the upcoming-job path). */
export function placeAppointmentHold(
  appointmentId: string,
  organizationId: string,
): Promise<PlaceHoldResult> {
  return placeAppointmentPayment(appointmentId, organizationId);
}
