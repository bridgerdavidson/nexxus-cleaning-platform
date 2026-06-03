"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { CreditCard, AlertCircle, Loader2 } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { useToast } from "@/contexts/ToastContext";

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

export interface OrgCardFormProps {
  organizationId: string;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Inner Stripe Elements form that saves the org's company card via the org setup-intent
 * routes. Must be rendered inside an <Elements> boundary (see OrgCardFormPanel for the
 * self-contained version). Shared by the Settings payments section and the inline
 * add-card flow in the booking modal.
 */
export function OrgCardForm({ organizationId, onSaved, onCancel }: OrgCardFormProps) {
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
 * Self-contained company-card form: owns the Stripe.js load + <Elements> boundary so any
 * caller can drop it in without wiring Stripe themselves. Renders a friendly error when
 * the publishable key is missing.
 */
export function OrgCardFormPanel(props: OrgCardFormProps) {
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    return key ? loadStripe(key) : null;
  }, []);

  if (!stripePromise) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Card processing is unavailable (missing Stripe key).
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <OrgCardForm {...props} />
    </Elements>
  );
}

export default OrgCardForm;
