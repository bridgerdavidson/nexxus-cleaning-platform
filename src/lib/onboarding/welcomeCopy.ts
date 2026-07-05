import type { OnboardingRole } from './onboardingConfig';

export type WelcomeVariant = 'setup' | 'reorientation';

export interface WelcomeCopy {
  title: string;
  lede: string;
  ctaLabel: string;
  skipLabel: string | null;
}

function greet(base: string, firstName?: string | null): string {
  return firstName ? `${base}, ${firstName}` : base;
}

export function getWelcomeCopy(role: OnboardingRole, variant: WelcomeVariant, firstName?: string | null): WelcomeCopy {
  if (variant === 'reorientation') {
    return {
      title: 'Welcome to the new Nexxus',
      lede: 'Same tools, a fresh and faster look. Nothing you set up has changed.',
      ctaLabel: 'Take a look',
      skipLabel: null,
    };
  }
  switch (role) {
    case 'operator':
      return {
        title: greet('Welcome to Nexxus', firstName),
        lede: "Let's get your cleaning business ready to take bookings. A few quick steps and you are live.",
        ctaLabel: "Let's get started",
        skipLabel: "I'll do this later",
      };
    case 'cleaner':
      return {
        title: greet('Welcome', firstName),
        lede: 'You are on the team. Connect your payouts and you are ready for jobs.',
        ctaLabel: 'Get started',
        skipLabel: 'Later',
      };
    case 'homeowner':
      return {
        title: greet('Welcome', firstName),
        lede: "Let's get your home set up so you can book your first cleaning.",
        ctaLabel: 'Get started',
        skipLabel: 'Later',
      };
  }
}
