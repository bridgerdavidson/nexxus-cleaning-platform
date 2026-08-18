"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { useSupabaseRealtimeSync } from "@/lib/useSupabaseRealtimeSync";
import { useDetailParam } from "@/hooks/useDetailParam";
import { money2, longDate } from "./payments-presenters";
import { dismissCutoffIso } from "./payoutDismissSnooze";
import type { TriageChargeVM, TriagePayoutVM, TriageHeldVM } from "./payments-types";

// Focused data + actions for the Payments "Needs you now" triage band. Queries the
// org's appointments/payouts directly (RLS-scoped) for the few fields the ledger
// hooks don't carry, mirroring the legacy PaymentsNeedingAttentionSection. There is
// NO manual payout approval in this app: a 'pending' payout is HELD because the
// cleaner hasn't finished payout setup (the reconcile sweep settles it once they do),
// so held rows are awareness + a "Message cleaner" nudge, never an approve button.

type NamePair = { first_name?: string; last_name?: string } | null;

function fullName(p: NamePair): string {
  if (!p) return "";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}
/** payouts join: cleaner:cleaner_profiles!cleaner_id ( user_profile:user_profiles(...) ). */
function cleanerNameFromJoin(joined: unknown): string {
  const cleaner = firstOf(joined as { user_profile?: NamePair | NamePair[] } | null);
  const up = firstOf(cleaner?.user_profile);
  return fullName(up);
}

const POST_JSON = (orgId: string) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ organization_id: orgId }),
});

export type PaymentsTriage = {
  loading: boolean;
  charges: TriageChargeVM[];
  failedPayouts: TriagePayoutVM[];
  heldPayouts: TriageHeldVM[];
  busyId: string | null;
  /** Which action busyId refers to, so a row can spin ONLY the pressed button. */
  busyAction: "retry" | "dismiss" | "card-link" | null;
  error: string | null;
  notice: string | null;
  isEmpty: boolean;
  reload: () => Promise<void>;
  retryPayout: (id: string) => Promise<void>;
  dismissPayout: (id: string) => Promise<void>;
  sendCardLink: (apptId: string, homeownerId: string | null, customerName?: string) => Promise<void>;
  fixCard: (apptId: string) => void;
  messageCleaner: (cleanerId: string | null) => Promise<void>;
};

export function usePaymentsTriage(): PaymentsTriage {
  const { currentOrganizationId, currentOrganization } = useAuth();
  const router = useRouter();
  const { setParam: setBookingParam } = useDetailParam("booking");

  const [loading, setLoading] = useState(true);
  const [charges, setCharges] = useState<TriageChargeVM[]>([]);
  const [failedPayouts, setFailedPayouts] = useState<TriagePayoutVM[]>([]);
  const [heldPayouts, setHeldPayouts] = useState<TriageHeldVM[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"retry" | "dismiss" | "card-link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const orgName = currentOrganization?.name || "Your company";
  // Only the first load shows the skeleton; realtime-triggered reloads update the
  // content in place so the band doesn't flash on every appointment/payout change.
  const loadedOnce = useRef(false);

  const reload = useCallback(async () => {
    if (!currentOrganizationId) return;
    if (!loadedOnce.current) setLoading(true);
    const payoutSelect =
      "id, amount, status, cleaner_id, attention_dismissed_at, cleaner:cleaner_profiles!cleaner_id(user_profile:user_profiles(first_name, last_name))";

    const [chargeRes, failedRes, heldRes] = await Promise.all([
      // Failed/requires-action charges are found by the DATA (authorization_status),
      // not a build-time client flag. Gating this on NEXT_PUBLIC_STRIPE_NEW_CHARGE_FLOW_ENABLED
      // meant a drifted mirror (the exact '' bug that hit STRIPE_TENANT_CONNECT_ENABLED)
      // silently hid real uncollected money (T2-13). If the new charge flow isn't running,
      // no appointment carries that status, so this simply returns nothing.
      supabase
        .from("appointments")
        .select(
          "id, scheduled_date, total_price, authorization_status, homeowner_id, is_self_pay, homeowner:user_profiles!homeowner_id(first_name, last_name)",
        )
        .eq("organization_id", currentOrganizationId)
        .in("authorization_status", ["failed", "requires_action"])
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: true }),
      // Dismissal is a SNOOZE, not a hide-forever (T2-9): a stamp older than the snooze
      // window stops filtering the row, so a payout the sweep keeps failing comes back
      // (tagged `resurfaced` below) instead of staying invisible while the cleaner's
      // money stays stranded. The sweep's next failed write fires the realtime reload
      // that actually brings an expired row back on screen.
      supabase
        .from("payouts")
        .select(payoutSelect)
        .eq("organization_id", currentOrganizationId)
        .eq("status", "failed")
        .or(`attention_dismissed_at.is.null,attention_dismissed_at.lt.${dismissCutoffIso(Date.now())}`)
        .order("created_at", { ascending: false }),
      supabase
        .from("payouts")
        .select(payoutSelect)
        .eq("organization_id", currentOrganizationId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    // T2-8: a failed query must NOT read as "all clear". Surface it and keep the
    // last-known rows rather than overwriting them with empty arrays that hide the
    // band (its absence is defined as the cockpit's all-clear).
    if (chargeRes.error || failedRes.error || heldRes.error) {
      setError("Couldn't load payments needing attention. Refresh to try again.");
      loadedOnce.current = true;
      setLoading(false);
      return;
    }
    setError(null);

    const chargeVMs: TriageChargeVM[] = ((chargeRes.data as Record<string, unknown>[]) ?? []).map((a) => {
      const ho = firstOf(a.homeowner as NamePair | NamePair[]);
      const isSelfPay = !!a.is_self_pay;
      const payer = fullName(ho) || (isSelfPay ? orgName : "Homeowner");
      const homeownerId = (a.homeowner_id as string | null) ?? null;
      return {
        apptId: a.id as string,
        payer,
        amountLabel: money2(Number(a.total_price ?? 0)),
        dateLabel: longDate(a.scheduled_date as string),
        reason: a.authorization_status === "failed" ? "failed" : "requires_action",
        homeownerId,
        canSendLink: !!homeownerId && !isSelfPay,
      };
    });

    const failedVMs: TriagePayoutVM[] = ((failedRes.data as Record<string, unknown>[]) ?? []).map((p) => {
      // The query only returns dismissed rows once their snooze lapsed, so any stamp
      // here means "dismissed earlier but STILL failing" — the resurfaced treatment.
      const dismissedAt = (p.attention_dismissed_at as string | null) ?? null;
      return {
        id: p.id as string,
        cleaner: cleanerNameFromJoin(p.cleaner) || "Cleaner",
        amountLabel: money2(Number(p.amount ?? 0)),
        resurfaced: dismissedAt != null,
        dismissedDateLabel: dismissedAt ? longDate(dismissedAt) : null,
      };
    });

    // Group held payouts by cleaner so one row (summed) shows per cleaner.
    const heldMap = new Map<string, { cleaner: string; total: number; cleanerId: string | null }>();
    ((heldRes.data as Record<string, unknown>[]) ?? []).forEach((p) => {
      const cleaner = cleanerNameFromJoin(p.cleaner) || "Cleaner";
      const cleanerId = (p.cleaner_id as string | null) ?? null;
      const key = cleanerId ?? cleaner;
      const cur = heldMap.get(key) ?? { cleaner, total: 0, cleanerId };
      cur.total += Number(p.amount ?? 0);
      heldMap.set(key, cur);
    });
    const heldVMs: TriageHeldVM[] = [...heldMap.values()].map((h) => ({
      cleanerId: h.cleanerId,
      cleaner: h.cleaner,
      amountLabel: money2(h.total),
    }));

    setCharges(chargeVMs);
    setFailedPayouts(failedVMs);
    setHeldPayouts(heldVMs);
    loadedOnce.current = true;
    setLoading(false);
  }, [currentOrganizationId, orgName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Resolved rows drop off live: reload on any org appointment/payout change.
  useSupabaseRealtimeSync({
    channelName: `payments-triage-appts:${currentOrganizationId ?? ""}`,
    table: "appointments",
    filter: currentOrganizationId ? `organization_id=eq.${currentOrganizationId}` : undefined,
    enabled: !!currentOrganizationId,
    onEvent: () => {
      void reload();
    },
  });
  useSupabaseRealtimeSync({
    channelName: `payments-triage-payouts:${currentOrganizationId ?? ""}`,
    table: "payouts",
    filter: currentOrganizationId ? `organization_id=eq.${currentOrganizationId}` : undefined,
    enabled: !!currentOrganizationId,
    onEvent: () => {
      void reload();
    },
  });

  const retryPayout = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusyId(id);
      setBusyAction("retry");
      setError(null);
      setNotice(null);
      try {
        const token = await getAccessToken();
        const init = POST_JSON(currentOrganizationId);
        const res = await fetch(`/api/payouts/${id}/retry`, {
          ...init,
          headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Retry failed");
        if (data.reason === "cleaner_slice_held") {
          setNotice(
            "The cleaner still needs to finish their payout setup, so this payment is queued and will send automatically once they do.",
          );
        }
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Retry failed");
      } finally {
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [currentOrganizationId, reload],
  );

  const dismissPayout = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusyId(id);
      setBusyAction("dismiss");
      setError(null);
      setNotice(null);
      try {
        const token = await getAccessToken();
        const init = POST_JSON(currentOrganizationId);
        const res = await fetch(`/api/payouts/${id}/dismiss`, {
          ...init,
          headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not dismiss");
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not dismiss");
      } finally {
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [currentOrganizationId, reload],
  );

  const sendCardLink = useCallback(
    async (apptId: string, homeownerId: string | null, customerName?: string) => {
      if (!currentOrganizationId || !homeownerId) return;
      setBusyId(apptId);
      setBusyAction("card-link");
      setError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/billing/card-links`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            organization_id: currentOrganizationId,
            homeowner_id: homeownerId,
            // Server-verified; switches the email to the urgent failed-payment wording.
            appointment_id: apptId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not create card link");
        if (data.delivered === "email") {
          const name = customerName?.trim();
          setNotice(name ? `Card link emailed to ${name}.` : "Card link emailed to the customer.");
        } else {
          // SMTP not configured (or the send failed server-side), so the link was
          // NOT delivered: copy it for the operator to send, rather than claiming
          // it was sent.
          const url = typeof data.url === "string" ? data.url : null;
          if (url && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            try {
              await navigator.clipboard.writeText(url);
              setNotice("Card link copied to your clipboard. Share it with the customer.");
            } catch {
              setNotice(`Card link ready: ${url}`);
            }
          } else {
            setNotice(url ? `Card link ready: ${url}` : "Card link created.");
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create card link");
      } finally {
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [currentOrganizationId],
  );

  // Fixing a failed/unauthenticated charge means putting a WORKING card on, which
  // now lives in the redesign booking sheet's Payment section (R6). Open it in
  // place with ?booking=<id>, mirroring how the other operator surfaces deep-link
  // into a booking (see useOpenBookingDetail / OperatorBookings' openDetail).
  const fixCard = useCallback(
    (apptId: string) => {
      setBookingParam(apptId);
    },
    [setBookingParam],
  );

  // The redesign Messages screen creates/opens the thread itself from ?to=,
  // so navigation is all this needs to do.
  const messageCleaner = useCallback(
    async (cleanerId: string | null) => {
      router.push(
        cleanerId
          ? `/admin/messages?to=${cleanerId}`
          : "/admin/messages",
      );
    },
    [router],
  );

  const isEmpty = charges.length === 0 && failedPayouts.length === 0 && heldPayouts.length === 0;

  return {
    loading,
    charges,
    failedPayouts,
    heldPayouts,
    busyId,
    busyAction,
    error,
    notice,
    isEmpty,
    reload,
    retryPayout,
    dismissPayout,
    sendCardLink,
    fixCard,
    messageCleaner,
  };
}
