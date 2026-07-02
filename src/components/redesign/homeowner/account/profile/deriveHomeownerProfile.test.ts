import { describe, it, expect } from 'vitest';
import { homeownerInitials } from './deriveHomeownerProfile';

describe('homeownerInitials', () => {
  it('returns up-to-two uppercase initials', () => {
    expect(homeownerInitials({ firstName: 'John', lastName: 'Doe' })).toBe('JD');
  });
  it('falls back to U when empty', () => {
    expect(homeownerInitials({})).toBe('U');
  });
});
