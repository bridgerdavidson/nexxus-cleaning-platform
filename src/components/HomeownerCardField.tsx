"use client";

import React, { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { CreditCard, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

interface Props {
  homeownerId: string;
  accessToken: string | null | undefined;
  /** Already-saved payment method (drives the "saved" UI). */
  savedPaymentMethodId: string | null;
  onSaved: (paymentMethodId: string) => void;
}

/**
 * Optional inline card-save for the homeowner self-request flow (decision #9: save at
 * request, NO hold — the hold is placed when a cleaner accepts). Uses a CustomerSession +
 * SetupIntent so the homeowner can pick a previously-saved card or add a new one via Stripe's
 * Payment Element; on save the card is attached to their platform Customer (off_session) and
 * the resulting payment method id is threaded into the request. Renders nothing when the new
 * charge flow UI flag is off, or when no publishable key is configured.
 */
export default function HomeownerCardField({
  homeownerId,
  accessToken,
  savedPaymentMethodId,
  onSaved,
}: Props) {
  const [siSecret, setSiSecret] = useState<string | null>(null);
  const [csSecret, setCsSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!stripeNewChargeFlowUiEnabled() || !stripePromise || !homeownerId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // CustomerSession (shows the homeowner's saved cards) — best-effort.
        const csRes = await fetch("/api/stripe/customer-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({}),
        });
        const csData = await csRes.json().catch(() => ({}));
        if (!cancelled && csRes.ok && csData.customer_session_client_secret) {
          setCsSecret(csData.customer_session_client_secret as string);
        }

        // SetupIntent (what gets confirmed to save the card, off_session).
        const siRes = await fetch("/api/stripe/create-setup-intent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ homeowner_id: homeownerId }),
        });
        const siData = await siRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!siRes.ok || !siData.client_secret) {
          throw new Error(siData.error || "Could not start card setup");
        }
        setSiSecret(siData.client_secret as string);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not start card setup");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [homeownerId, accessToken]);

  if (!stripeNewChargeFlowUiEnabled() || !stripePromise) return null;

  if (savedPaymentMethodId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        Card saved — it won&apos;t be charged until your cleaning is completed.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading secure card form…
      </div>
    );
  }

  if (loadError || !siSecret) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        {loadError ?? "Card setup is unavailable right now — you can add a card later."}
      </p>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: siSecret,
        ...(csSecret ? { customerSessionClientSecret: csSecret } : {}),
        appearance: { variables: { colorPrimary: "#F7C41E" } },
      }}
    >
      <CardInner onSaved={onSaved} />
    </Elements>
  );
}

function CardInner({ onSaved }: { onSaved: (pm: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: submitErr } = await elements.submit();
    if (submitErr) {
      setError(submitErr.message ?? "Please check your card details.");
      setSubmitting(false);
      return;
    }

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmErr) {
      setError(confirmErr.message ?? "We couldn’t save your card. Please try again.");
      setSubmitting(false);
      return;
    }

    const pm =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (pm) onSaved(pm);
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <PaymentElement />
      {error && (
        <p className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!stripe || submitting}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {submitting ? "Saving…" : "Save card"}
      </button>
    </div>
  );
}
