import { describe, it, expect } from 'vitest';
import { formatPropertyLabel } from './formatProperty';

describe('formatPropertyLabel', () => {
  it('prefers the property name', () => {
    expect(formatPropertyLabel('Beach House', '123 Oak St', 'Austin')).toBe('Beach House');
  });

  it('falls back to address with city when there is no name', () => {
    expect(formatPropertyLabel(null, '123 Oak St', 'Austin')).toBe('123 Oak St, Austin');
    expect(formatPropertyLabel('  ', '123 Oak St', null)).toBe('123 Oak St');
  });

  it('returns an empty string when nothing is available', () => {
    expect(formatPropertyLabel(null, null, null)).toBe('');
    expect(formatPropertyLabel(undefined)).toBe('');
  });
});
