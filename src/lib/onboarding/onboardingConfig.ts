export type OnboardingRole = 'operator' | 'cleaner' | 'homeowner';
export type OrgModel = 'percentage' | 'flat' | 'request' | 'hourly_external';

export interface SetupStepDef {
  key: string;
  title: string;
  description: string;
  required: boolean;
  ctaLabel: string;
  /** Absolute redesign route the step routes to. */
  href: string;
  /** Key into the signals map the status hook computes. */
  completionKey: string;
}

const OPERATOR_PERCENTAGE: SetupStepDef[] = [
  { key: 'payments', title: 'Connect payments', description: 'So you can charge customers and pay your cleaners', required: true, ctaLabel: 'Connect', href: '/admin/settings?section=payments', completionKey: 'payments_connected' },
  { key: 'services', title: 'Add your services and pricing', description: 'Define what you offer and what it costs', required: true, ctaLabel: 'Add service', href: '/admin/services', completionKey: 'services_added' },
  { key: 'payout', title: 'Set cleaner pay', description: 'The percent each cleaner earns per job', required: true, ctaLabel: 'Set pay', href: '/admin/settings?section=payout', completionKey: 'cleaner_pay_set' },
  { key: 'cleaners', title: 'Invite your cleaners', description: 'Build your team so you can assign jobs', required: true, ctaLabel: 'Invite', href: '/admin/cleaners', completionKey: 'cleaners_invited' },
  { key: 'hours', title: 'Set business hours and cancellation policy', description: 'When you work and your terms', required: false, ctaLabel: 'Set hours', href: '/admin/settings?section=business-hours', completionKey: 'hours_policy_set' },
];

const CLEANER_PERCENTAGE: SetupStepDef[] = [
  { key: 'payouts', title: 'Connect payouts', description: 'So you get paid to your bank', required: true, ctaLabel: 'Connect', href: '/cleaner/earnings', completionKey: 'payouts_connected' },
  { key: 'profile', title: 'Complete your profile', description: 'Add a photo so homeowners know who is coming', required: false, ctaLabel: 'Add photo', href: '/cleaner/profile', completionKey: 'profile_complete' },
];

const HOMEOWNER_PERCENTAGE: SetupStepDef[] = [
  { key: 'home', title: 'Add your home', description: 'Where you would like us to clean', required: true, ctaLabel: 'Add home', href: '/homeowner/account/properties', completionKey: 'home_added' },
  { key: 'card', title: 'Add a payment method', description: 'You are only charged after a cleaning', required: true, ctaLabel: 'Add card', href: '/homeowner/account/payment-methods', completionKey: 'payment_method_added' },
];

/**
 * Model-keyed setup step definitions. Every contractor-umbrella mode
 * (percentage/flat/request) shares the same steps - they all pay cleaners via
 * Connect. hourly_external (employee/availability) adds its own arrays here
 * without touching the checklist machinery.
 */
export function getSetupSteps(role: OnboardingRole, model: OrgModel): SetupStepDef[] {
  if (model === 'hourly_external') return [];
  switch (role) {
    case 'operator': return OPERATOR_PERCENTAGE;
    case 'cleaner': return CLEANER_PERCENTAGE;
    case 'homeowner': return HOMEOWNER_PERCENTAGE;
  }
}
