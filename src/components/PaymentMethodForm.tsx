"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { CreditCard, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

// Helper function to check if Stripe UI is enabled
function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";
}

interface PaymentMethodFormProps {
  homeownerId: string;
  onSuccess: (customerId: string, paymentMethodId: string) => void;
  onError: (error: string) => void;
  onCancel?: () => void;
}

// Inner form component that uses Stripe hooks
function PaymentForm({
  homeownerId,
  onSuccess,
  onError,
  onCancel,
}: PaymentMethodFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);

  // Create SetupIntent when component mounts
  useEffect(() => {
    async function createSetupIntent() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/stripe/create-setup-intent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ homeowner_id: homeownerId }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to initialize payment form");
        }

        setClientSecret(data.client_secret);
        setSetupIntentId(data.setup_intent_id);
        setCustomerId(data.customer_id);
      } catch (err) {
        console.error("Error creating SetupIntent:", err);
        setError(err instanceof Error ? err.message : "Failed to initialize payment form");
        onError(err instanceof Error ? err.message : "Failed to initialize payment form");
      } finally {
        setLoading(false);
      }
    }

    if (homeownerId) {
      createSetupIntent();
    }
  }, [homeownerId, onError]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements || !clientSecret || !customerId) {
      setError("Payment system not ready. Please try again.");
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError("Card element not found");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Confirm the SetupIntent with the card details
      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message || "Failed to save payment method");
      }

      if (setupIntent?.status !== "succeeded") {
        throw new Error("Payment method setup did not succeed");
      }

      // Confirm with our backend
      const confirmResponse = await fetch("/api/stripe/confirm-setup-intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setup_intent_id: setupIntentId,
          homeowner_id: homeownerId,
        }),
      });

      const confirmData = await confirmResponse.json();

      if (!confirmResponse.ok || !confirmData.success) {
        throw new Error(confirmData.error || "Failed to confirm payment method");
      }

      setSuccess(true);
      onSuccess(confirmData.customer_id, confirmData.payment_method_id);
    } catch (err) {
      console.error("Error processing payment method:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to save payment method";
      setError(errorMessage);
      onError(errorMessage);
    } finally {
      setProcessing(false);
    }
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: "16px",
        color: "#1f2937",
        fontFamily: "system-ui, -apple-system, sans-serif",
        "::placeholder": {
          color: "#9ca3af",
        },
        iconColor: "#6366f1",
      },
      invalid: {
        color: "#dc2626",
        iconColor: "#dc2626",
      },
    },
    hidePostalCode: false,
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600 mb-3" />
        <p className="text-gray-600">Initializing payment form...</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Payment Method Saved
        </h3>
        <p className="text-gray-600 text-center">
          The payment method has been saved successfully.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-primary-600" />
          <h4 className="font-medium text-gray-900">Payment Information</h4>
        </div>

        <div className="p-4 border border-gray-300 rounded-lg bg-white focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500 transition-all">
          <CardElement
            options={cardElementOptions}
            onChange={(e) => {
              setCardComplete(e.complete);
              if (e.error) {
                setError(e.error.message);
              } else {
                setError(null);
              }
            }}
          />
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500">
          This card will be charged automatically when the cleaning job is completed.
        </p>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!stripe || !cardComplete || processing}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" />
              Save Payment Method
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// Main component with Elements provider
export default function PaymentMethodForm(props: PaymentMethodFormProps) {
  // Only load Stripe if UI is enabled
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!stripeUiEnabled()) {
      return null;
    }

    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      console.warn('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set');
      return null;
    }

    return loadStripe(publishableKey);
  }, []);

  // If Stripe UI is disabled, return null
  if (!stripeUiEnabled() || !stripePromise) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 text-center">
            Payment processing is currently unavailable.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <PaymentForm {...props} />
    </Elements>
  );
}

// Simple card display component for showing saved payment method
export function SavedPaymentMethodDisplay({
  last4,
  brand,
  onRemove,
}: {
  last4: string;
  brand: string;
  onRemove?: () => void;
}) {
  const getBrandIcon = (brand: string) => {
    // You can replace these with actual card brand icons
    return <CreditCard className="w-6 h-6 text-gray-600" />;
  };

  return (
    <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-gray-50">
      <div className="flex items-center gap-3">
        {getBrandIcon(brand)}
        <div>
          <p className="font-medium text-gray-900 capitalize">{brand}</p>
          <p className="text-sm text-gray-600">•••• •••• •••• {last4}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Default
        </span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-red-600 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

