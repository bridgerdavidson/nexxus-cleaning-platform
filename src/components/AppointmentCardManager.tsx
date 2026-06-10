"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import HomeownerCardPicker, { type CardPickerHandle } from "./HomeownerCardPicker";
import { placeAppointmentPayment, type PlaceHoldResult } from "@/lib/payments/authorizeClient";

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface Props {
  appointmentId: string;
  homeownerId: string;
  organizationId: string;
  /** Panel role. A homeowner manages their OWN cards (self-scoped); staff act on the homeowner's
   *  behalf (admin-scoped). Cleaners never see this (the section is hidden for them). */
  role: "admin" | "manager" | "cleaner" | "homeowner";
  /** Called with the hold result after a card change so the parent can clear the failure banner. */
  onHoldResult?: (result: PlaceHoldResult) => void;
  /** True for a COMPLETED job: changing the card charges it immediately instead of placing a hold. */
  chargeNow?: boolean;
}

/**
 * Card section for the appointment details drawer (new charge flow). Shows the card currently
 * selected for the appointment, and on "Change/Add card" reveals the shared HomeownerCardPicker
 * (saved cards + add-a-new-card) with the current card pre-selected. Confirming sets the
 * appointment's payment_method_id via /api/appointments/:id/payment-method. Renders the picker in
 * staff mode (admin/manager) or self mode (homeowner).
 */
export default function AppointmentCardManager({ appointmentId, homeownerId, organizationId, role, onHoldResult, chargeNow }: Props) {
  const staffMode = role !== "homeowner";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [holdResult, setHoldResult] = useState<PlaceHoldResult | null>(null);
  const pickerRef = useRef<CardPickerHandle>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const { data: appt } = await supabase
        .from("appointments")
        .select("payment_method_id")
        .eq("id", appointmentId)
        .maybeSingle();
      setSelectedId((appt as { payment_method_id: string | null } | null)?.payment_method_id ?? null);

      const url = staffMode
        ? `/api/stripe/saved-payment-methods?homeowner_id=${homeownerId}&organization_id=${organizationId}`
        : "/api/stripe/my-payment-methods";
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json().catch(() => ({}));
      setCards(res.ok ? ((data.cards ?? []) as SavedCard[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payment info");
    } finally {
      setLoading(false);
    }
  }, [appointmentId, homeownerId, organizationId, staffMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = cards.find((c) => c.id === selectedId) ?? null;

  const save = async () => {
    const result = await pickerRef.current?.resolve();
    if (!result || "error" in result) {
      setError(result && "error" in result ? result.error : "Please choose a card.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/payment-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ organization_id: organizationId, payment_method_id: result.paymentMethodId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update card");
      setSelectedId(result.paymentMethodId);
      setEditing(false);
      await load();
      // Immediately (re)place the hold on the new card and surface the result, instead of only
      // queuing the JIT cron. Staff-only: a homeowner managing their own card can't authorize.
      if (staffMode) {
        const hold = await placeAppointmentPayment(appointmentId, organizationId, { chargeNow });
        setHoldResult(hold);
        onHoldResult?.(hold);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update card");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <HomeownerCardPicker
          ref={pickerRef}
          homeownerId={homeownerId}
          accessToken={null}
          organizationId={staffMode ? organizationId : undefined}
          initialSelectedId={selectedId}
          onReadyChange={setReady}
        />
        {error && (
          <p className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!ready || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Use this card"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading payment info…</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        {current ? (
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gray-100 rounded-lg">
              <CreditCard className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900 capitalize">{current.brand}</p>
              <p className="text-sm text-gray-600">•••• {current.last4}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 italic">No card on file</p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          {current ? "Change card" : "Add card"}
        </button>
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-2 text-sm text-amber-600">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {!error && holdResult && (
        <p
          className={`mt-2 flex items-center gap-2 text-sm ${
            holdResult.ok ? "text-success-600" : "text-amber-600"
          }`}
        >
          {holdResult.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {holdResult.message}
        </p>
      )}
    </div>
  );
}
