"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Trash2, Plus } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";
import HomeownerCardField from "./HomeownerCardField";

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/**
 * Homeowner "Payment methods" tab: list, add, and remove saved cards. Cards are saved against
 * the homeowner's platform Customer (off_session) so a hold can be placed when a cleaner
 * accepts a booking. New charge flow only.
 */
export default function PaymentMethodsPage() {
  const { user, accessToken } = useAuth();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/stripe/my-payment-methods", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load cards");
      setCards((data.cards ?? []) as SavedCard[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stripeNewChargeFlowUiEnabled()) void load();
    else setLoading(false);
  }, [load]);

  const remove = async (pmId: string) => {
    setRemovingId(pmId);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/stripe/my-payment-methods", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ payment_method_id: pmId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove card");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove card");
    } finally {
      setRemovingId(null);
    }
  };

  if (!stripeNewChargeFlowUiEnabled()) {
    return (
      <div className="card flex flex-col items-center justify-center text-center py-20">
        <CreditCard className="w-8 h-8 text-gray-300 mb-3" />
        <h2 className="text-xl font-bold text-gray-900 mb-1">Payment methods</h2>
        <p className="text-gray-500 max-w-sm">Online payments aren’t enabled yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 mb-2">
          Payment methods
        </h1>
        <p className="text-[15px] text-gray-500">
          Cards are charged only after a cleaning is completed.
        </p>
      </div>

      <div className="card py-6 px-5 md:px-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-6">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {cards.length === 0 ? (
              <p className="text-sm text-gray-500 mb-4">You don’t have any saved cards yet.</p>
            ) : (
              <ul className="space-y-2 mb-4">
                {cards.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 capitalize">
                          {c.brand} •••• {c.last4}
                          {c.isDefault && (
                            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                              Default
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          Expires {String(c.expMonth).padStart(2, "0")}/{c.expYear}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => remove(c.id)}
                      disabled={removingId === c.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {removingId === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {adding ? (
              <div className="rounded-xl border border-gray-200 p-4">
                {user?.id && (
                  <HomeownerCardField
                    homeownerId={user.id}
                    accessToken={accessToken}
                    savedPaymentMethodId={null}
                    onSaved={() => {
                      setAdding(false);
                      void load();
                    }}
                  />
                )}
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              >
                <Plus className="w-4 h-4" /> Add a card
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
