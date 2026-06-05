"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, AlertCircle, Plus, CreditCard, Landmark } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";
import type { PaymentMethodKind } from "@/lib/payments/processingFee";

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

type ResolveResult = { paymentMethodId: string } | { error: string };

export interface CardPickerHandle {
  /** The chosen (saved) payment method. By submit time a new card has already been saved and
   *  auto-selected, so this only ever resolves a saved-card id. */
  resolve: () => Promise<ResolveResult>;
}

interface Props {
  homeownerId: string;
  accessToken: string | null | undefined;
  /** When set, fetch the homeowner's saved cards as ORG STAFF acting on this homeowner
   *  (admin-scoped endpoint). When omitted, the authenticated caller manages their OWN cards. */
  organizationId?: string;
  /** Saved card id to pre-select (e.g. the card already chosen for an appointment). */
  initialSelectedId?: string | null;
  /** Reports whether a saved method is selected (drives the Submit button's disabled state). */
  onReadyChange?: (ready: boolean) => void;
  /** Reports the selected method's type (card vs bank) so the total can show the right fee. */
  onSelectedMethodChange?: (method: PaymentMethodKind) => void;
}

/**
 * Homeowner card picker for the self-request flow. Saved cards are rendered as our own radio
 * list (selectable with zero Stripe round-trip). "Use a new card" reveals the Stripe Payment
 * Element plus an explicit "Save card" button: saving confirms the SetupIntent (off_session),
 * refetches the saved list, and auto-selects the newly-saved card so it moves into the saved
 * section. Submit is only enabled once a saved card is selected. Renders nothing when the
 * new-charge-flow UI flag or publishable key is absent.
 */
const HomeownerCardPicker = forwardRef<CardPickerHandle, Props>(function HomeownerCardPicker(
  { homeownerId, accessToken, organizationId, initialSelectedId, onReadyChange, onSelectedMethodChange },
  ref,
) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  // SetupIntent for the new-card path — lazily created the first time "Use a new card" is chosen.
  const [siSecret, setSiSecret] = useState<string | null>(null);
  const [siLoading, setSiLoading] = useState(false);
  const [siError, setSiError] = useState<string | null>(null);

  const loadCards = useCallback(async (): Promise<SavedCard[]> => {
    setLoadingCards(true);
    try {
      const token = accessToken ?? (await getAccessToken());
      // Staff acting on a homeowner use the admin-scoped endpoint (homeowner_id + org);
      // a homeowner managing their own cards uses the self-scoped endpoint.
      const url = organizationId
        ? `/api/stripe/saved-payment-methods?homeowner_id=${homeownerId}&organization_id=${organizationId}`
        : "/api/stripe/my-payment-methods";
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json().catch(() => ({}));
      const list = res.ok ? ((data.cards ?? []) as SavedCard[]) : [];
      setCards(list);
      setSelected((prev) => {
        if (prev) return prev;
        if (initialSelectedId && list.some((c) => c.id === initialSelectedId)) return initialSelectedId;
        const def = list.find((c) => c.isDefault) ?? list[0];
        return def ? def.id : NEW_CARD;
      });
      return list;
    } catch {
      setCards([]);
      setSelected((prev) => prev ?? NEW_CARD);
      return [];
    } finally {
      setLoadingCards(false);
    }
  }, [accessToken, organizationId, homeownerId, initialSelectedId]);

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

  // Report readiness up to the parent: a method is chosen only when a SAVED method is selected.
  useEffect(() => {
    onReadyChange?.(!!selected && selected !== NEW_CARD);
  }, [selected, onReadyChange]);

  // Report the selected method's type so the parent's total shows the right fee. A not-yet-saved
  // new method defaults to 'card' (the costlier fee — never under-quote the total).
  useEffect(() => {
    if (!onSelectedMethodChange) return;
    const sel = cards.find((c) => c.id === selected);
    onSelectedMethodChange(sel?.type === "us_bank_account" ? "us_bank_account" : "card");
  }, [selected, cards, onSelectedMethodChange]);

  // After a new card is saved: refetch the saved list and select the newly-saved card, so it
  // moves into the saved section. Reset the SetupIntent so a future "use a new card" is fresh.
  const handleNewCardSaved = useCallback(
    async (pmId: string) => {
      await loadCards();
      setSelected(pmId);
      setSiSecret(null);
    },
    [loadCards],
  );

  useImperativeHandle(
    ref,
    () => ({
      async resolve() {
        if (selected && selected !== NEW_CARD) return { paymentMethodId: selected };
        return { error: "Please save and select a card first." };
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
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Saved payment methods</p>
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
            c.type === "us_bank_account"
              ? radio(
                  c.id,
                  <span className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-gray-500" />
                    {c.bankName ?? "Bank account"} •••• {c.last4}
                    {c.isDefault && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                        Default
                      </span>
                    )}
                  </span>,
                  "Bank account · lower fee",
                )
              : radio(
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
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Pay with a new card or bank</p>
        {radio(
          NEW_CARD,
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-gray-500" /> Use a new card or bank account
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
              <NewCardSection clientSecret={siSecret} onSaved={handleNewCardSaved} />
            ) : null}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        You won’t be charged until your cleaning is completed. Your card or bank account is saved
        securely for next time.
      </p>
    </div>
  );
});

const NewCardSection = ({
  clientSecret,
  onSaved,
}: {
  clientSecret: string;
  onSaved: (paymentMethodId: string) => void | Promise<void>;
}) => {
  if (!stripePromise) return null;
  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance: { variables: { colorPrimary: "#F7C41E" } } }}
    >
      <NewCardInner onSaved={onSaved} />
    </Elements>
  );
};

function NewCardInner({ onSaved }: { onSaved: (paymentMethodId: string) => void | Promise<void> }) {
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
      setError(submitErr.message ?? "Please check your card details.");
      setSaving(false);
      return;
    }

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (confirmErr) {
      setError(confirmErr.message ?? "We couldn’t save your card. Please try again.");
      setSaving(false);
      return;
    }

    const pm =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (!pm) {
      setError("Could not read the saved card.");
      setSaving(false);
      return;
    }
    // Hand the saved card up; the parent refetches + selects it. Keep `saving` true so the
    // button stays disabled through the collapse (this component unmounts on success).
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
        {saving ? "Saving…" : "Save payment method"}
      </button>
    </div>
  );
}

export default HomeownerCardPicker;
