import { describe, it, expect } from 'vitest';
import { getWelcomeCopy } from './welcomeCopy';

describe('getWelcomeCopy', () => {
  it('operator setup greets by name and offers a skip', () => {
    const c = getWelcomeCopy('operator', 'setup', 'Sarah');
    expect(c.title).toBe('Welcome to Nexxus, Sarah');
    expect(c.skipLabel).toBe("I'll do this later");
  });

  it('reorientation is the same for every role and has no skip', () => {
    const c = getWelcomeCopy('cleaner', 'reorientation', 'Marco');
    expect(c.title).toBe('Welcome to the new Nexxus');
    expect(c.skipLabel).toBeNull();
  });

  it('handles a missing name gracefully', () => {
    const c = getWelcomeCopy('homeowner', 'setup', null);
    expect(c.title).toBe('Welcome');
  });

  it('has no em dashes', () => {
    const variants = ['setup', 'reorientation'] as const;
    const roles = ['operator', 'cleaner', 'homeowner'] as const;
    for (const role of roles) for (const v of variants) {
      const c = getWelcomeCopy(role, v, 'X');
      expect((c.title + c.lede + c.ctaLabel + (c.skipLabel ?? '')).includes('—')).toBe(false);
    }
  });
});
