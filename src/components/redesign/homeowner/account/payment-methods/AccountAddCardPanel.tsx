'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useTheme } from 'next-themes';
import { Loader2, AlertCircle } from 'lucide-react';
import { getRedesignConnectAppearance } from '@/lib/stripe/appearance';
import { Button } from '@/components/ui/button';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

interface Props {
  /**
   * Fetch a SetupIntent client secret for the homeowner's Customer. Resolves the secret;
   * throws an Error (its message is shown) on failure. Memoize in the parent.
   */
  createSetupIntent: () => Promise<string>;
  /** Called with the saved PaymentMethod id after confirmSetup succeeds. */
  onSaved: (paymentMethodId: string) => void | Promise<void>;
  /** Reports the in-flight save state up so the parent sheet can lock dismissal during 3DS. */
  onSavingChange?: (saving: boolean) => void;
}

/**
 * Homeowner add-a-card panel, built fresh from the design system (brand #0150FC Stripe
 * Elements appearance + design-system Button) so no legacy styling leaks in. Reuses the
 * shared SetupIntent -> confirmSetup(off-session) logic. The theme-aware appearance is applied
 * once at Elements init, so we hold behind a mounted gate until next-themes resolves (mirrors
 * PaymentsYourMoney) to avoid initializing in the wrong theme.
 */
export function AccountAddCardPanel({ createSetupIntent, onSaved, onSavingChange }: Props) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const fetchSecret = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSecret(await createSetupIntent());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the secure form');
    } finally {
      setLoading(false);
    }
  }, [createSetupIntent]);

  useEffect(() => {
    if (mounted && !secret && !loading && !error) void fetchSecret();
  }, [mounted, secret, loading, error, fetchSecret]);

  if (!stripePromise) {
    return <p className="text-sm text-muted-foreground">Card setup is unavailable right now.</p>;
  }

  if (!mounted || loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading secure form...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 py-1">
        <p className="flex items-center gap-2 text-sm text-critical">
          <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSecret(null);
          }}
          className="text-xs font-bold text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
      options={{ clientSecret: secret, appearance: getRedesignConnectAppearance(resolvedTheme === 'dark') }}
    >
      <AddCardInner onSaved={onSaved} onSavingChange={onSavingChange} />
    </Elements>
  );
}

function AddCardInner({
  onSaved,
  onSavingChange,
}: {
  onSaved: (paymentMethodId: string) => void | Promise<void>;
  onSavingChange?: (saving: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface the in-flight save state so the parent sheet can block dismissal mid-confirm.
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  const save = async () => {
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);

    const { error: submitErr } = await elements.submit();
    if (submitErr) {
      setError(submitErr.message ?? 'Please check your details.');
      setSaving(false);
      return;
    }

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });
    if (confirmErr) {
      setError(confirmErr.message ?? 'We could not save this card. Please try again.');
      setSaving(false);
      return;
    }

    const pm =
      typeof setupIntent?.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (!pm) {
      setError('Could not read the saved card.');
      setSaving(false);
      return;
    }
    // Hand the saved method up; the parent refetches + closes. Keep `saving` true through the
    // unmount so the button stays disabled.
    await onSaved(pm);
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ wallets: { link: 'never' } }} />
      {error && (
        <p className="flex items-center gap-2 text-sm text-critical">
          <AlertCircle className="size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
      <Button onClick={save} loading={saving} disabled={!stripe} className="w-full">
        Save card
      </Button>
    </div>
  );
}
