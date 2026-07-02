import { describe, it, expect } from 'vitest';
import { homeownerDisplayName, homeownerInitials } from './deriveHomeownerProfile';

describe('homeownerDisplayName', () => {
  it('joins first and last', () => {
    expect(homeownerDisplayName({ firstName: 'John', lastName: 'Doe' })).toBe('John Doe');
  });
  it('uses whichever name is present', () => {
    expect(homeownerDisplayName({ firstName: 'John' })).toBe('John');
    expect(homeownerDisplayName({ lastName: 'Doe' })).toBe('Doe');
  });
  it('falls back when nothing is set', () => {
    expect(homeownerDisplayName({})).toBe('Your profile');
    expect(homeownerDisplayName({ firstName: '  ', lastName: null })).toBe('Your profile');
  });
});

describe('homeownerInitials', () => {
  it('returns up-to-two uppercase initials', () => {
    expect(homeownerInitials({ firstName: 'John', lastName: 'Doe' })).toBe('JD');
  });
  it('falls back to U when empty', () => {
    expect(homeownerInitials({})).toBe('U');
  });
});
