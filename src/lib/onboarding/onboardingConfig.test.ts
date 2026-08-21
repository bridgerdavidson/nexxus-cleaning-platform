import { describe, it, expect } from 'vitest';
import { getSetupSteps } from './onboardingConfig';

describe('getSetupSteps', () => {
  it('returns 6 operator steps with 5 required for percentage', () => {
    const steps = getSetupSteps('operator', 'percentage');
    expect(steps.map((s) => s.key)).toEqual(['payments', 'services', 'payout', 'branding', 'cleaners', 'hours']);
    expect(steps.filter((s) => s.required).map((s) => s.key)).toEqual(['payments', 'services', 'payout', 'branding', 'cleaners']);
    expect(steps.find((s) => s.key === 'payout')!.href).toBe('/admin/settings?section=payout');
    expect(steps.find((s) => s.key === 'branding')!.href).toBe('/admin/settings?section=branding');
  });

  it('branding is required and listed before inviting cleaners, so invites go out branded', () => {
    const steps = getSetupSteps('operator', 'percentage');
    expect(steps.find((s) => s.key === 'branding')!.required).toBe(true);
    const keys = steps.map((s) => s.key);
    expect(keys.indexOf('branding')).toBeLessThan(keys.indexOf('cleaners'));
  });

  it('returns cleaner steps: required payouts + optional profile', () => {
    const steps = getSetupSteps('cleaner', 'percentage');
    expect(steps.map((s) => s.key)).toEqual(['payouts', 'profile']);
    expect(steps.find((s) => s.key === 'payouts')!.required).toBe(true);
    expect(steps.find((s) => s.key === 'profile')!.required).toBe(false);
  });

  it('returns homeowner steps: both required', () => {
    const steps = getSetupSteps('homeowner', 'percentage');
    expect(steps.map((s) => s.key)).toEqual(['home', 'card']);
    expect(steps.every((s) => s.required)).toBe(true);
  });

  it('has no em dashes in copy', () => {
    const roles = ['operator', 'cleaner', 'homeowner'] as const;
    for (const role of roles) {
      for (const step of getSetupSteps(role, 'percentage')) {
        expect(step.title.includes('—')).toBe(false);
        expect(step.description.includes('—')).toBe(false);
      }
    }
  });
});
