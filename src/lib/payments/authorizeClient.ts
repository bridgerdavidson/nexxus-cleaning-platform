import { getAccessToken } from "@/lib/auth/clientAccessToken";

export interface PlaceHoldResult {
  ok: boolean;
  code?: string;
  /** A single friendly line to show inline in the drawer. */
  message: string;
}

/**
 * Places (or re-places) the manual-capture card hold for an appointment after its card was changed,
 * and maps the `/authorize` route's coded result to one friendly line. The booking already exists,
 * so this is best-effort immediate feedback for the admin; the JIT authorize-due cron is still the
 * backstop if the request times out. Shared by the homeowner and self-pay drawer card managers.
 */
export async function placeAppointmentHold(
  appointmentId: string,
  organizationId: string,
): Promise<PlaceHoldResult> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`/api/appointments/${appointmentId}/authorize`, {
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
    if (code === "deferred_ach") {
      return {
        ok: true,
        code,
        message: "The bank account will be charged when the job is completed.",
      };
    }
    if (code === "requires_action") {
      return {
        ok: false,
        code,
        message:
          "This card needs the customer to verify their identity, so the hold isn't placed.",
      };
    }
    // declined / no_org_card / cleaner_not_payable / not_authorizable / error.
    return {
      ok: false,
      code,
      message: data.message || data.error || "The card hold didn't go through.",
    };
  } catch {
    return {
      ok: false,
      message: "We couldn't reach the card processor. We'll keep trying automatically.",
    };
  }
}
