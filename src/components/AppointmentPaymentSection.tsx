'use client';

import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Link2, Copy, Check, RefreshCw } from 'lucide-react';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/** Sentinel value for the "no card yet (defer)" radio option. */
export const DEFER_CARD = '__defer__';

interface Props {
  homeownerId: string | null;
  organizationId: string | null;
  /** Selected Stripe PaymentMethod id, or DEFER_CARD, or null (nothing chosen yet). */
  value: string | null;
  onChange: (value: string | null) => void;
}

/**
 * Card section for the admin appointment-creation flow (new charge flow only). Lets staff:
 *  - pick one of the homeowner's saved cards (authorized on save, charged on completion),
 *  - generate a hosted card-collection link to send the homeowner, then refresh to pick the
 *    newly-saved card, or
 *  - defer (create the appointment with no card; collect before completion).
 *
 * Renders nothing when the new-charge-flow UI flag is off, so the legacy flow is untouched.
 */
export default function AppointmentPaymentSection({ homeownerId, organizationId, value, onChange }: Props) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadCards = useCallback(async () => {
    if (!homeownerId || !organizationId) {
      setCards([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `/api/stripe/saved-payment-methods?homeowner_id=${homeownerId}&organization_id=${organizationId}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load saved cards');
      setCards((data.cards ?? []) as SavedCard[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved cards');
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [homeownerId, organizationId]);

  // Reload whenever the selected homeowner changes; reset any prior selection/link.
  useEffect(() => {
    setLinkUrl(null);
    onChange(null);
    loadCards();
    // onChange intentionally omitted — it's a stable setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCards]);

  if (!stripeNewChargeFlowUiEnabled()) return null;

  async function generateLink() {
    if (!homeownerId || !organizationId) return;
    setGeneratingLink(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/billing/card-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ organization_id: organizationId, homeowner_id: homeownerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create card link');
      setLinkUrl(data.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create card link');
    } finally {
      setGeneratingLink(false);
    }
  }

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the URL is still visible to copy manually */
    }
  }

  const radio = (optionValue: string, checked: boolean, label: React.ReactNode, sublabel?: string) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
        checked ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'
      }`}
    >
      <input
        type="radio"
        name="appointment-payment"
        className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
        checked={checked}
        onChange={() => onChange(optionValue)}
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {sublabel && <span className="block text-xs text-gray-500">{sublabel}</span>}
      </span>
    </label>
  );

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <CreditCard className="h-4 w-4 text-gray-500" />
        Payment
      </label>

      {!homeownerId ? (
        <p className="text-sm text-gray-500">Select a customer first to choose a card.</p>
      ) : (
        <div className="space-y-2">
          {loading && <p className="text-sm text-gray-500">Loading saved cards…</p>}

          {!loading &&
            cards.map((c) =>
              radio(
                c.id,
                value === c.id,
                <span className="capitalize">
                  {c.brand} •••• {c.last4}
                  {c.isDefault && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                      Default
                    </span>
                  )}
                </span>,
                `Expires ${String(c.expMonth).padStart(2, '0')}/${c.expYear}`,
              ),
            )}

          {!loading &&
            radio(
              'send-link',
              value === 'send-link',
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-gray-500" /> Send a card-collection link
              </span>,
              cards.length === 0 ? 'This customer has no saved card yet.' : undefined,
            )}

          {value === 'send-link' && (
            <div className="ml-7 space-y-2 rounded-lg bg-gray-50 p-3">
              {!linkUrl ? (
                <button
                  type="button"
                  onClick={generateLink}
                  disabled={generatingLink}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {generatingLink ? 'Generating…' : 'Generate link'}
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={linkUrl}
                      className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                    />
                    <button
                      type="button"
                      onClick={copyLink}
                      className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Send this to the customer. After they save a card, refresh and select it below.
                  </p>
                  <button
                    type="button"
                    onClick={loadCards}
                    className="flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh saved cards
                  </button>
                </>
              )}
            </div>
          )}

          {!loading && radio(DEFER_CARD, value === DEFER_CARD, 'No card yet (defer)', 'Collect before the job is completed.')}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {value && value !== 'send-link' && value !== DEFER_CARD && (
            <p className="text-xs text-gray-500">
              This card is authorized (a hold) when you save, and charged when the appointment is marked complete.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
