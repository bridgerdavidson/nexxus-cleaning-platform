import { describe, it, expect } from 'vitest';
import { formatUserName } from './formatName';

describe('formatUserName', () => {
  it('joins first and last', () => {
    expect(formatUserName('Wanda', 'Jones')).toBe('Wanda Jones');
  });

  it('tolerates a missing half', () => {
    expect(formatUserName('Wanda', null)).toBe('Wanda');
    expect(formatUserName(null, 'Jones')).toBe('Jones');
    expect(formatUserName('  ', 'Jones')).toBe('Jones');
  });

  it('returns an empty string when nothing is available (caller decides fallback)', () => {
    expect(formatUserName(null, null)).toBe('');
    expect(formatUserName(undefined, undefined)).toBe('');
    expect(formatUserName('', '   ')).toBe('');
  });
});
