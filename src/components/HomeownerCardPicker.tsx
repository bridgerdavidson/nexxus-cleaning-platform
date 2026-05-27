"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, AlertCircle, Plus, CreditCard } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

/** Whether the picker can render at all (publishable key + flag). Mirrored by the parent so it
 *  only requires payment when the picker is actually usable. */
export function homeownerCardPickerAvailable(): boolean {
  return stripeNewChargeFlowUiEnabled() && !!PUBLISHABLE_KEY;
}

const NEW_CARD = "__new__";

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

type ResolveResult = { paymentMethodId: string } | { error: string };

export interface CardPickerHandle {
  /** Resolve the chosen payment method. A saved card returns immediately; a new card is
   *  confirmed (and saved off_session) at this point so there's no separate "save" step. */
  resolve: () => Promise<ResolveResult>;
}

interface NewCardHandle {
  confirm: () => Promise<ResolveResult>;
}

interface Props {
  homeownerId: string;
  accessToken: string | null | undefined;
  /** Reports whether a payment method is selected (and, for a new card, the fields are complete). */
  onReadyChange?: (ready: boolean) => void;
}

/**
 * Homeowner card picker for the self-request flow. Saved cards are rendered as our own radio
 * list (selectable with zero Stripe round-trip), and the Stripe Payment Element is mounted only
 * for entering a NEW card. Both the "saved" and "new card" sections are always shown (the saved
 * section shows an empty state when there are none). Selecting a saved card needs no "save" —
 * the parent calls `resolve()` on submit, which returns the saved id directly or confirms the
 * new card inline. Renders nothing when the new-charge-flow UI flag or publishable key is absent.
 */
const HomeownerCardPicker = forwardRef<CardPickerHandle, Props>(function HomeownerCardPicker(
  { homeownerId, accessToken, onReadyChange },
  ref,
) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [newComplete, setNewComplete] = useState(false);

  // SetupIntent for the new-card path — lazily created the first time "Use a new card" is chosen.
  const [siSecret, setSiSecret] = useState<string | null>(null);
  const [siLoading, setSiLoading] = useState(false);
  const [siError, setSiError] = useState<string | null>(null);

  const newCardRef = useRef<NewCardHandle>(null);

  const loadCards = useCallback(async () => {
    setLoadingCards(true);
    try {
      const token = accessToken ?? (await getAccessToken());
      const res = await fetch("/api/stripe/my-payment-methods", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      const list = res.ok ? ((data.cards ?? []) as SavedCard[]) : [];
      setCards(list);
      setSelected((prev) => {
        if (prev) return prev;
        const def = list.find((c) => c.isDefault) ?? list[0];
        return def ? def.id : NEW_CARD;
      });
    } catch {
      setCards([]);
      setSelected((prev) => prev ?? NEW_CARD);
    } finally {
      setLoadingCards(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const fetchSetupIntent = useCallback(async () => {
    setSiLoading(true);
    setSiError(null);
    try {
      const res = await fetch("/api/stripe/create-setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeowner_id: homeownerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.client_secret) throw new Error(data.error || "Could not start card setup");
      setSiSecret(data.client_secret as string);
    } catch (e) {
      setSiError(e instanceof Error ? e.message : "Could not start card setup");
    } finally {
      setSiLoading(false);
    }
  }, [homeownerId]);

  // Lazily create a SetupIntent the first time the new-card option is selected. Idempotent
  // guards (not a cancel flag) prevent re-fetching: once we have a secret, are mid-flight, or
  // hit an error, we don't fire again. "Try again" clears siError to re-trigger this.
  useEffect(() => {
    if (selected === NEW_CARD && !siSecret && !siLoading && !siError) {
      void fetchSetupIntent();
    }
  }, [selected, siSecret, siLoading, siError, fetchSetupIntent]);

  // Report readiness up to the parent (drives the Submit button's disabled state).
  useEffect(() => {
    const ready =
      (!!selected && selected !== NEW_CARD) || (selected === NEW_CARD && newComplete);
    onReadyChange?.(ready);
  }, [selected, newComplete, onReadyChange]);

  useImperativeHandle(
    ref,
    () => ({
      async resolve() {
        if (selected && selected !== NEW_CARD) return { paymentMethodId: selected };
        if (selected === NEW_CARD) {
          if (!newCardRef.current) return { error: "The card form isn’t ready yet." };
          return newCardRef.current.confirm();
        }
        return { error: "Please choose a payment method." };
      },
    }),
    [selected],
  );

  if (!homeownerCardPickerAvailable() || !stripePromise || !homeownerId) return null;

  const radio = (value: string, label: React.ReactNode, sublabel?: string) => {
    const checked = selected === value;
    return (
      <label
        key={value}
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
          checked ? "border-primary-500 bg-primary-50" : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <input
          type="radio"
          name="homeowner-payment-method"
          className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
          checked={checked}
          onChange={() => setSelected(value)}
        />
        <span className="flex-1">
          <span className="block text-sm font-medium text-gray-900">{label}</span>
          {sublabel && <span className="block text-xs text-gray-500">{sublabel}</span>}
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Saved cards</p>
        {loadingCards ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your cards…
          </div>
        ) : cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500">
            No saved cards yet.
          </p>
        ) : (
          cards.map((c) =>
            radio(
              c.id,
              <span className="flex items-center gap-2 capitalize">
                <CreditCard className="h-4 w-4 text-gray-500" />
                {c.brand} •••• {c.last4}
                {c.isDefault && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                    Default
                  </span>
                )}
              </span>,
              `Expires ${String(c.expMonth).padStart(2, "0")}/${c.expYear}`,
            ),
          )
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Pay with a new card</p>
        {radio(
          NEW_CARD,
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-gray-500" /> Use a new card
          </span>,
        )}
        {selected === NEW_CARD && (
          <div className="mt-2">
            {siLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading secure card form…
              </div>
            ) : siError ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {siError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSiError(null);
                    setSiSecret(null);
                  }}
                  className="text-xs font-semibold text-primary-700 hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : siSecret ? (
              <NewCardSection
                ref={newCardRef}
                clientSecret={siSecret}
                onCompleteChange={setNewComplete}
              />
            ) : null}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        You won’t be charged until your cleaning is completed. A new card is saved securely for next
        time.
      </p>
    </div>
  );
});

const NewCardSection = forwardRef<NewCardHandle, { clientSecret: string; onCompleteChange: (c: boolean) => void }>(
  function NewCardSection({ clientSecret, onCompleteChange }, ref) {
    if (!stripePromise) return null;
    return (
      <Elements
        stripe={stripePromise}
        options={{ clientSecret, appearance: { variables: { colorPrimary: "#F7C41E" } } }}
      >
        <NewCardInner ref={ref} onCompleteChange={onCompleteChange} />
      </Elements>
    );
  },
);

const NewCardInner = forwardRef<NewCardHandle, { onCompleteChange: (c: boolean) => void }>(
  function NewCardInner({ onCompleteChange }, ref) {
    const stripe = useStripe();
    const elements = useElements();

    useImperativeHandle(
      ref,
      () => ({
        async confirm() {
          if (!stripe || !elements) return { error: "Payment form isn’t ready yet." };
          const { error: submitErr } = await elements.submit();
          if (submitErr) return { error: submitErr.message ?? "Please check your card details." };
          const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
            elements,
            redirect: "if_required",
          });
          if (confirmErr) return { error: confirmErr.message ?? "We couldn’t save your card." };
          const pm =
            typeof setupIntent?.payment_method === "string"
              ? setupIntent.payment_method
              : setupIntent?.payment_method?.id;
          return pm ? { paymentMethodId: pm } : { error: "Could not read the saved card." };
        },
      }),
      [stripe, elements],
    );

    return <PaymentElement onChange={(e) => onCompleteChange(e.complete)} />;
  },
);

export default HomeownerCardPicker;
