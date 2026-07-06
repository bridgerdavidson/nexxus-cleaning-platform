import { describe, it, expect } from 'vitest';
import { deriveChecklist } from './deriveChecklist';
import type { SetupStepDef } from './onboardingConfig';

const steps: SetupStepDef[] = [
  { key: 'a', title: 'A', description: '', required: true, ctaLabel: 'A', href: '/a', completionKey: 'a' },
  { key: 'b', title: 'B', description: '', required: true, ctaLabel: 'B', href: '/b', completionKey: 'b' },
  { key: 'c', title: 'C', description: '', required: false, ctaLabel: 'C', href: '/c', completionKey: 'c' },
];

describe('deriveChecklist', () => {
  it('counts required only and picks the first incomplete required as next', () => {
    const vm = deriveChecklist(steps, { a: true, b: false, c: false });
    expect(vm.requiredTotal).toBe(2);
    expect(vm.requiredDone).toBe(1);
    expect(vm.requiredRemaining).toBe(1);
    expect(vm.allRequiredComplete).toBe(false);
    expect(vm.progressPercent).toBe(50);
    expect(vm.nextKey).toBe('b');
    expect(vm.items.find((i) => i.key === 'b')!.isNext).toBe(true);
  });

  it('falls back to first incomplete optional for next when required are done', () => {
    const vm = deriveChecklist(steps, { a: true, b: true, c: false });
    expect(vm.allRequiredComplete).toBe(true);
    expect(vm.progressPercent).toBe(100);
    expect(vm.nextKey).toBe('c');
  });

  it('nextKey is null when everything is done', () => {
    const vm = deriveChecklist(steps, { a: true, b: true, c: true });
    expect(vm.nextKey).toBeNull();
    expect(vm.items.every((i) => i.done)).toBe(true);
  });

  it('treats a missing signal as not done', () => {
    const vm = deriveChecklist(steps, {});
    expect(vm.requiredDone).toBe(0);
    expect(vm.progressPercent).toBe(0);
    expect(vm.nextKey).toBe('a');
  });
});
