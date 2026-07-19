import { describe, it, expect } from 'vitest';
import { getSetupSteps } from './onboardingConfig';

describe('getSetupSteps', () => {
  it('returns 5 operator steps with 4 required for percentage_contractor', () => {
    const steps = getSetupSteps('operator', 'percentage_contractor');
    expect(steps.map((s) => s.key)).toEqual(['payments', 'services', 'payout', 'cleaners', 'hours']);
    expect(steps.filter((s) => s.required).map((s) => s.key)).toEqual(['payments', 'services', 'payout', 'cleaners']);
    expect(steps.find((s) => s.key === 'payout')!.href).toBe('/admin/settings?section=payout');
  });

  it('returns cleaner steps: required payouts + optional profile', () => {
    const steps = getSetupSteps('cleaner', 'percentage_contractor');
    expect(steps.map((s) => s.key)).toEqual(['payouts', 'profile']);
    expect(steps.find((s) => s.key === 'payouts')!.required).toBe(true);
    expect(steps.find((s) => s.key === 'profile')!.required).toBe(false);
  });

  it('returns homeowner steps: both required', () => {
    const steps = getSetupSteps('homeowner', 'percentage_contractor');
    expect(steps.map((s) => s.key)).toEqual(['home', 'card']);
    expect(steps.every((s) => s.required)).toBe(true);
  });

  it('has no em dashes in copy', () => {
    const roles = ['operator', 'cleaner', 'homeowner'] as const;
    for (const role of roles) {
      for (const step of getSetupSteps(role, 'percentage_contractor')) {
        expect(step.title.includes('—')).toBe(false);
        expect(step.description.includes('—')).toBe(false);
      }
    }
  });
});
