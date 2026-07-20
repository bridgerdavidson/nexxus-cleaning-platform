import { describe, it, expect } from 'vitest';
import { HOMEOWNER_NAV, deriveHomeownerActive } from './homeowner-nav-items';

describe('HOMEOWNER_NAV', () => {
  it('has the four primary destinations with icon + label', () => {
    expect(HOMEOWNER_NAV.map((n) => n.id)).toEqual(['home', 'cleanings', 'messages', 'account']);
    for (const n of HOMEOWNER_NAV) {
      expect(n.label.length).toBeGreaterThan(0);
      expect(n.icon).toBeTruthy();
    }
  });
});

describe('deriveHomeownerActive', () => {
  it('maps pathnames to the active nav id', () => {
    expect(deriveHomeownerActive('/homeowner')).toBe('home');
    expect(deriveHomeownerActive('/homeowner/cleanings')).toBe('cleanings');
    expect(deriveHomeownerActive('/homeowner/messages')).toBe('messages');
    expect(deriveHomeownerActive('/homeowner/account')).toBe('account');
  });
  it('defaults to home for unknown paths', () => {
    expect(deriveHomeownerActive('/homeowner/whatever')).toBe('home');
  });
});
