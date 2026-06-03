"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Plus, Trash2 } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { useToast } from "@/contexts/ToastContext";
import { stripeSelfPayUiEnabled } from "@/lib/stripe/flags";
import { OrgCardFormPanel } from "./OrgCardForm";

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
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
 * Settings → Payments section for the org's self-pay company card. Behind stripeSelfPayUiEnabled().
 * Lists the saved card(s), supports add/replace/remove. Visual patterns mirror the rest of the
 * settings page (section card, dashed empty state, brand CTA, toasts). The card-entry form itself
 * lives in OrgCardForm (shared with the inline add-card flow in the booking modal).
 */
export default function OrgPaymentMethodSection({ organizationId }: { organizationId: string }) {
  const { showToast } = useToast();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(
        `/api/stripe/org/saved-payment-methods?organization_id=${encodeURIComponent(organizationId)}`,
      );
      const data = await res.json().catch(() => null);
      setCards(res.ok && Array.isArray(data?.cards) ? (data.cards as SavedCard[]) : []);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeCard = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await authFetch(
        `/api/stripe/org/saved-payment-methods?organization_id=${encodeURIComponent(
          organizationId,
        )}&payment_method_id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to remove the card");
      }
      showToast("Card removed", { variant: "success" });
      await refresh();
    } catch (err) {
      showToast("Couldn't remove card", {
        variant: "error",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRemovingId(null);
    }
  };

  if (!stripeSelfPayUiEnabled()) return null;

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Company payment method</h2>
          <p className="text-sm text-gray-500">
            The card we charge when your organization books and pays for a cleaning itself (self-pay).
          </p>
        </div>
        {!adding && !loading && cards.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" />
            Replace
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : adding ? (
        <OrgCardFormPanel
          organizationId={organizationId}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void refresh();
          }}
        />
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 py-12 text-center">
          <CreditCard className="mb-3 h-8 w-8 text-gray-300" />
          <p className="mb-4 max-w-sm text-sm text-gray-500">
            No company card on file. Add one to pay for cleanings on your own properties.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Add company card
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="h-6 w-6 text-gray-500" />
                <div className="text-sm">
                  <span className="font-medium capitalize text-gray-900">{c.brand}</span>{" "}
                  <span className="text-gray-600">•••• {c.last4}</span>
                  {c.isDefault && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                      Default
                    </span>
                  )}
                  <span className="ml-2 text-xs text-gray-400">
                    Expires {String(c.expMonth).padStart(2, "0")}/{c.expYear}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeCard(c.id)}
                disabled={removingId === c.id}
                className="flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-red-600 disabled:opacity-50"
                aria-label="Remove card"
              >
                {removingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
