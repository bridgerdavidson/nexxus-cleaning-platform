"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, CreditCard, Landmark, Trash2, Check } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { useToast } from "@/contexts/ToastContext";
import { stripeAchUiEnabled } from "@/lib/stripe/flags";
import type { PaymentMethodKind } from "@/lib/payments/processingFee";
import AddPaymentMethodPanel from "./AddPaymentMethodPanel";

interface OrgMethod {
  id: string;
  type: "card" | "us_bank_account";
  last4: string;
  isDefault: boolean;
  // card
  brand?: string;
  expMonth?: number;
  expYear?: number;
  // us_bank_account
  bankName?: string;
}

interface Props {
  organizationId: string;
  /** Reports the charged state: whether any method is on file (for a submit gate) and the charged
   *  (default) method's type (so a booking total can show the right fee). */
  onChargedMethodChange?: (info: { hasMethod: boolean; method: PaymentMethodKind }) => void;
  /** Called after any change (add / set-default / remove) so a parent can refresh dependent data. */
  onChanged?: () => void | Promise<void>;
}

async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/**
 * Unified company payment-method picker for ORG self-pay. Mirrors the homeowner picker's visual
 * language (bordered rows, primary-50 highlight, card/bank icons, "lower fee" sublabel) but with
 * org semantics: one method is the DEFAULT (what self-pay charges), selecting another promotes it
 * to default, and you can add a new card or bank (shared AddPaymentMethodPanel) or remove one.
 * Used both inline in the booking modal's self-pay step and in Settings → Payments.
 */
export default function OrgPaymentMethodPicker({ organizationId, onChargedMethodChange, onChanged }: Props) {
  const { showToast } = useToast();
  const [methods, setMethods] = useState<OrgMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const base = `/api/stripe/org/saved-payment-methods?organization_id=${encodeURIComponent(organizationId)}`;

  const refresh = useCallback(async (): Promise<OrgMethod[]> => {
    setLoading(true);
    try {
      const res = await authFetch(base);
      const data = await res.json().catch(() => null);
      const list = res.ok && Array.isArray(data?.cards) ? (data.cards as OrgMethod[]) : [];
      setMethods(list);
      return list;
    } catch {
      setMethods([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Report the charged state (presence + method) so a parent can gate submit and show the right
  // fee. The charged method is the default, else the first on file. Bank is cheaper; an empty list
  // defaults to 'card' (never under-quote). Held in a ref so an inline parent callback doesn't
  // re-run this on every render (parents set multiple states here, so can't pass a stable setter).
  const reportRef = useRef(onChargedMethodChange);
  reportRef.current = onChargedMethodChange;
  useEffect(() => {
    const charged = methods.find((m) => m.isDefault) ?? methods[0];
    reportRef.current?.({
      hasMethod: methods.length > 0,
      method: charged?.type === "us_bank_account" ? "us_bank_account" : "card",
    });
  }, [methods]);

  const setDefault = async (id: string) => {
    setBusyId(id);
    try {
      const res = await authFetch(`${base}&payment_method_id=${encodeURIComponent(id)}`, { method: "PATCH" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Couldn't switch payment method");
      }
      await refresh();
      await onChanged?.();
    } catch (err) {
      showToast("Couldn't switch payment method", {
        variant: "error",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await authFetch(`${base}&payment_method_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Couldn't remove payment method");
      }
      showToast("Payment method removed", { variant: "success" });
      await refresh();
      await onChanged?.();
    } catch (err) {
      showToast("Couldn't remove payment method", {
        variant: "error",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  // Create a SetupIntent for the org's self-pay customer (card + bank when ACH is enabled).
  const createSetupIntent = useCallback(async (): Promise<string> => {
    const res = await authFetch("/api/stripe/org/create-setup-intent", {
      method: "POST",
      body: JSON.stringify({ organization_id: organizationId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.client_secret) throw new Error(data?.error || "Could not start the secure form");
    return data.client_secret as string;
  }, [organizationId]);

  // A newly added method becomes the charged default (you added it to use it), then we refetch.
  const handleSaved = useCallback(
    async (pmId: string) => {
      setAdding(false);
      try {
        await authFetch(`${base}&payment_method_id=${encodeURIComponent(pmId)}`, { method: "PATCH" });
      } catch {
        /* set-default is best-effort; the method is still saved and listed */
      }
      await refresh();
      await onChanged?.();
    },
    [base, refresh, onChanged],
  );

  const hasBank = methods.some((m) => m.type === "us_bank_account");

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" /> Loading payment methods…
        </div>
      ) : methods.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500">
          No company payment method on file yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {methods.map((m) => {
            const isBusy = busyId === m.id;
            return (
              <li
                key={m.id}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                  m.isDefault ? "border-primary-500 bg-primary-50" : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <button
                  type="button"
                  onClick={() => !m.isDefault && !isBusy && setDefault(m.id)}
                  disabled={m.isDefault || isBusy}
                  className="flex flex-1 items-start gap-3 text-left disabled:cursor-default"
                  aria-label={
                    m.isDefault
                      ? "Current payment method"
                      : `Use ${m.type === "us_bank_account" ? m.bankName ?? "bank account" : m.brand} ending ${m.last4}`
                  }
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                      m.isDefault ? "border-primary-600 bg-primary-600" : "border-gray-300"
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                    ) : (
                      m.isDefault && <Check className="h-3 w-3 text-white" />
                    )}
                  </span>
                  <span className="flex-1">
                    {m.type === "us_bank_account" ? (
                      <>
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          <Landmark className="h-4 w-4 text-gray-500" />
                          {m.bankName ?? "Bank account"} •••• {m.last4}
                          {m.isDefault && (
                            <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary-700">
                              Charged
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-gray-500">Bank account · lower fee</span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-2 text-sm font-medium capitalize text-gray-900">
                          <CreditCard className="h-4 w-4 text-gray-500" />
                          {m.brand} •••• {m.last4}
                          {m.isDefault && (
                            <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary-700">
                              Charged
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-gray-500">
                          Expires {String(m.expMonth).padStart(2, "0")}/{m.expYear}
                        </span>
                      </>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={isBusy}
                  className="ml-3 flex-shrink-0 text-gray-400 transition-colors hover:text-red-600 disabled:opacity-50"
                  aria-label={`Remove ${m.type === "us_bank_account" ? m.bankName ?? "bank account" : m.brand} ending ${m.last4}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Nudge toward bank (lower fee) before any bank is attached — otherwise that incentive only
          shows as a sublabel on an already-saved bank account. */}
      {stripeAchUiEnabled() && !hasBank && !adding && (
        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" />
          Paying by bank account costs less than a card. Add one to save on processing fees.
        </p>
      )}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <AddPaymentMethodPanel
            createSetupIntent={createSetupIntent}
            onSaved={handleSaved}
            saveLabel="Save company payment method"
          />
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        !loading && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" />
            Add a new card or bank account
          </button>
        )
      )}
    </div>
  );
}
