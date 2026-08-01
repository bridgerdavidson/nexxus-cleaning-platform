'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getRedesignConnectAppearance } from '@/lib/stripe/appearance';
import { deriveBrandRamp, rampToCssVars } from '@/lib/branding/palette';
import { orgInitials } from '@/lib/branding/monogram';
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
  orgName: string | null;
  brandColor: string | null;
  logoIconUrl: string | null;
}

/**
 * The link's org brand as local CSS variables. The ONE pre-auth surface that
 * is allowed tenant branding: the token identifies the org (spec decision 10).
 * Semantic tokens are re-derived locally because :root resolves them against
 * its own --brand-* values and children inherit them pre-resolved.
 */
function brandVars(brandColor: string | null): React.CSSProperties | undefined {
  if (!brandColor || !/^#[0-9a-f]{6}$/i.test(brandColor)) return undefined;
  const ramp = rampToCssVars(deriveBrandRamp(brandColor));
  return {
    ...ramp,
    '--primary': ramp['--brand-600'],
    '--primary-foreground': ramp['--brand-fg-600'],
    '--accent': ramp['--brand-50'],
    '--accent-foreground': ramp['--brand-700'],
    '--ring': ramp['--brand-600'],
    '--brand-ink': ramp['--brand-ink-on-light'],
  } as React.CSSProperties;
}

/** Link-scoped org identity; OrgLogo would show the VIEWER'S org, not the link's. */
function LinkOrgIdentity({ orgName, logoIconUrl }: { orgName: string | null; logoIconUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!orgName) return null;
  return (
    <div className="mb-5 flex items-center gap-2">
      {logoIconUrl && !failed ? (
        /* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded storage asset */
        <img
          src={logoIconUrl}
          alt=""
          className="h-7 w-7 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 select-none place-items-center rounded-md bg-brand-600 text-xs font-extrabold leading-none text-[hsl(var(--brand-fg-600))]"
        >
          {orgInitials(orgName)}
        </span>
      )}
      <span className="truncate text-sm font-bold text-foreground">{orgName}</span>
    </div>
  );
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
          setLink({
            clientSecret: data.client_secret,
            firstName: data.homeowner_first_name ?? 'there',
            orgName: data.org_name ?? null,
            brandColor: data.brand_color ?? null,
            logoIconUrl: data.logo_icon_url ?? null,
          });
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
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground mb-3" />
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
    // The wrapper carries the LINK org's derived brand vars, so the primary
    // button, focus rings, and the monogram all take the company's color.
    <div style={brandVars(link.brandColor)}>
      <LinkOrgIdentity orgName={link.orgName} logoIconUrl={link.logoIconUrl} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Hi {link.firstName} 👋</h1>
        <p className="text-muted-foreground mt-1">Add a card to confirm your cleaning booking.</p>
      </div>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: link.clientSecret,
          // Public page has no theme provider; light appearance with the link
          // org's accent so Stripe's focus borders and tabs match the page.
          appearance: getRedesignConnectAppearance(false, link.brandColor ?? undefined),
        }}
      >
        <CardForm />
      </Elements>
    </div>
  );
}

export default function AddCardPage() {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 md:p-8 shadow-soft-sm border border-border">
        <Suspense
          fallback={
            <div className="flex justify-center py-12">
              <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <AddCardInner />
        </Suspense>
      </div>
    </div>
  );
}
