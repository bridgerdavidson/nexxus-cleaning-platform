import { describe, it, expect } from 'vitest';
import { canMessageHomeowner } from './canMessageHomeowner';

describe('canMessageHomeowner', () => {
  it('true when the appointment has a homeowner', () => {
    expect(canMessageHomeowner({ homeowner: { first_name: 'John', last_name: 'Doe' } })).toBe(true);
  });
  it('false for a self-pay / org-owned job with no homeowner', () => {
    expect(canMessageHomeowner({ homeowner: null })).toBe(false);
  });
  it('false when homeowner is undefined', () => {
    expect(canMessageHomeowner({})).toBe(false);
  });
});
