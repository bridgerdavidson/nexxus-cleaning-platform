'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getRedesignConnectAppearance } from '@/lib/stripe/appearance';
import { Button } from '@/components/ui/button';

/**
 * Public, token-scoped hosted card-collection page. A homeowner opens the link an admin
 * sent (?t=<token>), the token resolves to a SetupIntent client secret, and the homeowner
 * saves a card via Stripe's Payment Element. PCI scope stays SAQ-A — the card never
 * touches our servers. Gated implicitly by the publishable key + the token route's flag.
 */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

interface LinkData {
  clientSecret: string;
  firstName: string;
}

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: submitErr } = await elements.submit();
    if (submitErr) {
      setError(submitErr.message ?? 'Please check your card details.');
      setSubmitting(false);
      return;
    }

    const { error: confirmErr } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (confirmErr) {
      setError(confirmErr.message ?? 'We couldn’t save your card. Please try again.');
      setSubmitting(false);
      return;
    }

    setDone(true);
    setSubmitting(false);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center text-center py-8">
        <CheckCircle2 className="w-12 h-12 text-positive mb-3" />
        <h2 className="text-xl font-bold text-foreground">Card saved</h2>
        <p className="text-muted-foreground mt-1">You’re all set. You can close this tab.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement />
      {error && (
        <p className="flex items-center gap-2 text-sm text-critical-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </p>
      )}
      <Button type="submit" disabled={!stripe} loading={submitting} className="w-full">
        Save card
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your card won’t be charged until your cleaning is completed.
      </p>
    </form>
  );
}

function AddCardInner() {
  const params = useSearchParams();
  const token = params.get('t');
  const [link, setLink] = useState<LinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError('This link is missing its token.');
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/billing/card-links/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.client_secret) {
          setError(
            res.status === 410
              ? 'This link has expired or was already used. Please ask for a new one.'
              : data.error || 'We couldn’t load this link.',
          );
        } else {
          setLink({ clientSecret: data.client_secret, firstName: data.homeowner_first_name ?? 'there' });
        }
      } catch {
        if (!cancelled) setError('Something went wrong loading this link.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center py-12">
        <Loader2 className="w-7 h-7 animate-spin text-brand-600 mb-3" />
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !link || !stripePromise) {
    return (
      <div className="flex flex-col items-center text-center py-12">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="text-muted-foreground max-w-sm">{error ?? 'Payment setup is unavailable right now.'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Hi {link.firstName} 👋</h1>
        <p className="text-muted-foreground mt-1">Add a card to confirm your cleaning booking.</p>
      </div>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: link.clientSecret,
          // Public page has no theme provider; always the light brand appearance.
          appearance: getRedesignConnectAppearance(false),
        }}
      >
        <CardForm />
      </Elements>
    </>
  );
}

export default function AddCardPage() {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 md:p-8 shadow-soft-sm border border-border">
        <Suspense
          fallback={
            <div className="flex justify-center py-12">
              <Loader2 className="w-7 h-7 animate-spin text-brand-600" />
            </div>
          }
        >
          <AddCardInner />
        </Suspense>
      </div>
    </div>
  );
}
