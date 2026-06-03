"use client";

import { useState } from "react";
import { CreditCard, Plus, Trash2, Loader2, Check } from "lucide-react";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { useToast } from "@/contexts/ToastContext";
import { OrgCardFormPanel } from "./OrgCardForm";

export interface OrgPickerCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault?: boolean;
}

interface OrgCardPickerProps {
  organizationId: string;
  cards: OrgPickerCard[];
  loading?: boolean;
  /** Refetch the org cards after any change (set-default / add / remove). */
  onChanged: () => Promise<void> | void;
  /** Collapse the picker back to the card summary. */
  onClose: () => void;
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
 * Manage an org's self-pay company card(s) inline: pick which saved card is charged (set-default),
 * add/replace a card via the shared OrgCardFormPanel, and remove a card. Self-pay charges read the
 * Customer's default PaymentMethod, so selecting a card promotes it to default. Used in the booking
 * modal's self-pay payment step.
 */
export default function OrgCardPicker({
  organizationId,
  cards,
  loading,
  onChanged,
  onClose,
}: OrgCardPickerProps) {
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const base = `/api/stripe/org/saved-payment-methods?organization_id=${encodeURIComponent(
    organizationId,
  )}`;

  const setDefault = async (id: string) => {
    setBusyId(id);
    try {
      const res = await authFetch(`${base}&payment_method_id=${encodeURIComponent(id)}`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Couldn't switch card");
      }
      await onChanged();
    } catch (err) {
      showToast("Couldn't switch card", {
        variant: "error",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await authFetch(`${base}&payment_method_id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Couldn't remove card");
      }
      showToast("Card removed", { variant: "success" });
      await onChanged();
    } catch (err) {
      showToast("Couldn't remove card", {
        variant: "error",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  if (adding) {
    return (
      <OrgCardFormPanel
        organizationId={organizationId}
        onCancel={() => setAdding(false)}
        onSaved={async () => {
          setAdding(false);
          await onChanged();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
          <span className="text-sm">Loading cards...</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => {
            const isBusy = busyId === c.id;
            return (
              <li
                key={c.id}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                  c.isDefault
                    ? "border-primary-500 bg-primary-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <button
                  type="button"
                  onClick={() => !c.isDefault && !isBusy && setDefault(c.id)}
                  disabled={c.isDefault || isBusy}
                  className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
                  aria-label={c.isDefault ? "Current card" : `Use ${c.brand} ending ${c.last4}`}
                >
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                      c.isDefault ? "border-primary-600 bg-primary-600" : "border-gray-300"
                    }`}
                  >
                    {c.isDefault && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <CreditCard className="h-5 w-5 flex-shrink-0 text-gray-500" />
                  <span className="text-sm">
                    <span className="font-medium capitalize text-gray-900">{c.brand}</span>{" "}
                    <span className="text-gray-600">•••• {c.last4}</span>
                    {c.isDefault && (
                      <span className="ml-2 rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary-700">
                        Selected
                      </span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">
                      Expires {String(c.expMonth).padStart(2, "0")}/{c.expYear}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={isBusy}
                  className="ml-3 flex-shrink-0 text-gray-400 transition-colors hover:text-red-600 disabled:opacity-50"
                  aria-label={`Remove ${c.brand} ending ${c.last4}`}
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Plus className="h-4 w-4" />
          Add a new card
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-primary-700 transition-colors hover:text-primary-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}
