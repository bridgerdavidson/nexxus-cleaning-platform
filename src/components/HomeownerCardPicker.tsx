"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Loader2, Plus, CreditCard, Landmark } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { stripeNewChargeFlowUiEnabled, stripeAchUiEnabled } from "../lib/stripe/flags";
import type { PaymentMethodKind } from "@/lib/payments/processingFee";
import AddPaymentMethodPanel from "./AddPaymentMethodPanel";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

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
 * list (selectable with zero Stripe round-trip). "Use a new card or bank account" reveals the
 * shared AddPaymentMethodPanel (Stripe Payment Element + Save): saving confirms the SetupIntent
 * (off_session), refetches the saved list, and auto-selects the newly-saved method so it moves
 * into the saved section. Submit is only enabled once a saved method is selected. Renders nothing
 * when the new-charge-flow UI flag or publishable key is absent.
 */
const HomeownerCardPicker = forwardRef<CardPickerHandle, Props>(function HomeownerCardPicker(
  { homeownerId, accessToken, organizationId, initialSelectedId, onReadyChange, onSelectedMethodChange },
  ref,
) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

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

  // Create a SetupIntent for the homeowner's customer. The Payment Element renders card (+ bank
  // when ACH is enabled) from the SetupIntent's allowed payment-method types.
  const createSetupIntent = useCallback(async (): Promise<string> => {
    const token = accessToken ?? (await getAccessToken());
    const res = await fetch("/api/stripe/create-setup-intent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        homeowner_id: homeownerId,
        ...(organizationId ? { organization_id: organizationId } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) throw new Error(data.error || "Could not start card setup");
    return data.client_secret as string;
  }, [homeownerId, accessToken, organizationId]);

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

  // After a new method is saved: refetch the saved list and select it, so it moves into the saved
  // section (the AddPaymentMethodPanel unmounts on success, resetting itself for next time).
  const handleNewCardSaved = useCallback(
    async (pmId: string) => {
      await loadCards();
      setSelected(pmId);
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

  if (!homeownerCardPickerAvailable() || !homeownerId) return null;

  const hasSavedBank = cards.some((c) => c.type === "us_bank_account");

  const radio = (value: string, label: React.ReactNode, sublabel?: string) => {
    const checked = selected === value;
    return (
      <label
        key={value}
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
          checked ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground/40"
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
          <span className="block text-sm font-medium text-foreground">{label}</span>
          {sublabel && <span className="block text-xs text-muted-foreground">{sublabel}</span>}
        </span>
      </label>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved payment methods</p>
        {loadingCards ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your cards…
          </div>
        ) : cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            No saved payment methods yet.
          </p>
        ) : (
          cards.map((c) =>
            c.type === "us_bank_account"
              ? radio(
                  c.id,
                  <span className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-muted-foreground" />
                    {c.bankName ?? "Bank account"} •••• {c.last4}
                    {c.isDefault && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        Default
                      </span>
                    )}
                  </span>,
                  "Bank account · lower fee",
                )
              : radio(
                  c.id,
                  <span className="flex items-center gap-2 capitalize">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    {c.brand} •••• {c.last4}
                    {c.isDefault && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
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
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pay with a new card or bank</p>
        {/* Nudge toward bank (lower fee) before any bank is attached — that incentive otherwise
            only shows as a sublabel on an already-saved bank. */}
        {stripeAchUiEnabled() && !hasSavedBank && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" />
            Paying by bank account costs less than a card. Add one below to save on fees.
          </p>
        )}
        {radio(
          NEW_CARD,
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" /> Use a new card or bank account
          </span>,
        )}
        {selected === NEW_CARD && (
          <div className="mt-2">
            <AddPaymentMethodPanel createSetupIntent={createSetupIntent} onSaved={handleNewCardSaved} />
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        You won’t be charged until your cleaning is completed. Your card or bank account is saved
        securely for next time.
      </p>
    </div>
  );
});

export default HomeownerCardPicker;
