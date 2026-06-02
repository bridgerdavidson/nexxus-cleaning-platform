"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { CreditCard, AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { useToast } from "@/contexts/ToastContext";
import { stripeSelfPayUiEnabled } from "@/lib/stripe/flags";

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

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "16px",
      color: "#1f2937",
      fontFamily: "system-ui, -apple-system, sans-serif",
      "::placeholder": { color: "#9ca3af" },
    },
    invalid: { color: "#dc2626", iconColor: "#dc2626" },
  },
  hidePostalCode: false,
};

/** Inner Stripe Elements form — saves the org's company card via the org setup-intent routes. */
function OrgCardForm({
  organizationId,
  onSaved,
  onCancel,
}: {
  organizationId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { showToast } = useToast();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardComplete, setCardComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await authFetch("/api/stripe/org/create-setup-intent", {
          method: "POST",
          body: JSON.stringify({ organization_id: organizationId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || "Failed to initialize the card form");
        }
        if (cancelled) return;
        setClientSecret(data.client_secret);
        setSetupIntentId(data.setup_intent_id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to initialize the card form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || !clientSecret || !setupIntentId) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setProcessing(true);
    setError(null);
    try {
      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });
      if (stripeError) throw new Error(stripeError.message || "Failed to save the card");
      if (setupIntent?.status !== "succeeded") throw new Error("Card setup did not succeed");

      const res = await authFetch("/api/stripe/org/confirm-setup-intent", {
        method: "POST",
        body: JSON.stringify({ organization_id: organizationId, setup_intent_id: setupIntentId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || "Failed to save the card");

      showToast("Company card saved", { variant: "success" });
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save the card";
      setError(msg);
      showToast("Couldn't save card", { variant: "error", description: msg });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
        <span className="text-sm">Preparing the secure card form…</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-gray-50 p-3">
      <div className="rounded-lg border border-gray-300 bg-white p-4 transition-all focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
        <CardElement
          options={CARD_ELEMENT_OPTIONS}
          onChange={(e) => {
            setCardComplete(e.complete);
            setError(e.error ? e.error.message : null);
          }}
        />
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="px-4 py-2 font-medium text-gray-700 transition-colors hover:text-gray-900 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || !cardComplete || processing}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          {processing ? "Saving…" : "Save company card"}
        </button>
      </div>
    </form>
  );
}

/**
 * Settings → Payments section for the org's self-pay company card. Behind stripeSelfPayUiEnabled().
 * Lists the saved card(s), supports add/replace/remove. Visual patterns mirror the rest of the
 * settings page (section card, dashed empty state, brand CTA, toasts).
 */
export default function OrgPaymentMethodSection({ organizationId }: { organizationId: string }) {
  const { showToast } = useToast();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  }, []);

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
        stripePromise ? (
          <Elements stripe={stripePromise}>
            <OrgCardForm
              organizationId={organizationId}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                void refresh();
              }}
            />
          </Elements>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Card processing is unavailable (missing Stripe key).
          </div>
        )
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
