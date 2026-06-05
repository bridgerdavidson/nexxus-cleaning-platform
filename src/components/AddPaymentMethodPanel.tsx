"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, AlertCircle, CreditCard } from "lucide-react";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

interface Props {
  /**
   * Fetch a SetupIntent client secret for the target customer (homeowner vs org). Resolves the
   * secret string; throws an Error (its message is shown) on failure. MEMOIZE this in the parent
   * (useCallback) so the panel doesn't re-fetch on every render.
   */
  createSetupIntent: () => Promise<string>;
  /** Called with the saved PaymentMethod id after confirmSetup succeeds (parent refetches + selects). */
  onSaved: (paymentMethodId: string) => void | Promise<void>;
  /** Label for the save button (defaults to "Save payment method"). */
  saveLabel?: string;
}

/**
 * Shared "add a new card or bank account" panel. Lazily creates a SetupIntent, mounts the Stripe
 * PaymentElement (card + us_bank_account via Financial Connections when the SetupIntent allows it),
 * and on Save confirms the SetupIntent off-session and hands the saved PaymentMethod id up. The
 * caller supplies how to create the SetupIntent (which customer) and what to do after the save
 * (refetch + select / set default). Used by both the homeowner picker and the org picker so the
 * add-method flow can never drift between them. Renders nothing without a publishable key.
 */
export default function AddPaymentMethodPanel({ createSetupIntent, onSaved, saveLabel }: Props) {
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSecret = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSecret(await createSetupIntent());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the secure form");
    } finally {
      setLoading(false);
    }
  }, [createSetupIntent]);

  // Fetch once on mount (the panel only mounts when the "new method" option is active). Guarded so
  // it never re-fetches; "Try again" clears the error to re-trigger.
  useEffect(() => {
    if (!secret && !loading && !error) void fetchSecret();
  }, [secret, loading, error, fetchSecret]);

  if (!stripePromise) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading secure form…
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSecret(null);
          }}
          className="text-xs font-semibold text-primary-700 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!secret) return null;

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret: secret, appearance: { variables: { colorPrimary: "#F7C41E" } } }}
    >
      <AddPaymentMethodInner onSaved={onSaved} saveLabel={saveLabel} />
    </Elements>
  );
}

function AddPaymentMethodInner({
  onSaved,
  saveLabel,
}: {
  onSaved: (paymentMethodId: string) => void | Promise<void>;
  saveLabel?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);

    const { error: submitErr } = await elements.submit();
    if (submitErr) {
      setError(submitErr.message ?? "Please check your details.");
      setSaving(false);
      return;
    }

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (confirmErr) {
      setError(confirmErr.message ?? "We couldn’t save this payment method. Please try again.");
      setSaving(false);
      return;
    }

    const pm =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (!pm) {
      setError("Could not read the saved payment method.");
      setSaving(false);
      return;
    }
    // Hand the saved method up; the parent refetches + selects it. Keep `saving` true through the
    // collapse (this component unmounts on success) so the button stays disabled.
    await onSaved(pm);
  };

  return (
    <div className="space-y-3">
      <PaymentElement options={{ wallets: { link: "never" } }} />
      {error && (
        <p className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!stripe || saving}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {saving ? "Saving…" : saveLabel ?? "Save payment method"}
      </button>
    </div>
  );
}
