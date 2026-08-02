'use client';

import { OrgLogo } from '@/components/branding/OrgLogo';
import { Button } from '@/components/ui/button';
import type { WelcomeCopy } from '@/lib/onboarding/welcomeCopy';

export function WelcomeContent({
  copy,
  previewSteps,
  onPrimary,
  onSkip,
}: {
  copy: WelcomeCopy;
  previewSteps?: { title: string }[];
  onPrimary: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-2 py-2 text-center">
      {/* The COMPANY'S mark, not Nexxus: the first-run welcome is a tenant
          surface, and spec decision 11 keeps Nexxus out of all of them. */}
      {/* A touch larger than the top bars (40x240 box): this takeover is the
          welcome moment and the mark is its centerpiece. */}
      <OrgLogo variant="full" size={32} imageMaxHeight={40} imageMaxWidth={240} />
      {/* h2, not h1: this takeover renders above pages that carry their own h1
          (the white-label greeting headings), and a document gets one h1. */}
      <h2 className="mt-10 text-3xl font-extrabold tracking-tight text-foreground">{copy.title}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{copy.lede}</p>

      {previewSteps && previewSteps.length > 0 && (
        <ul className="mt-7 w-full space-y-1.5 text-left">
          {previewSteps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-control bg-muted/60 px-4 py-2.5 text-sm font-semibold text-foreground">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-brand-50 text-xs font-extrabold text-primary">
                {i + 1}
              </span>
              {s.title}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex w-full flex-col items-center gap-3">
        <Button size="lg" className="w-full" onClick={onPrimary}>
          {copy.ctaLabel}
        </Button>
        {copy.skipLabel && (
          <Button variant="ghost" onClick={onSkip}>
            {copy.skipLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
