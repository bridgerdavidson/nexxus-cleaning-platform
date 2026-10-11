import { describe, it, expect } from 'vitest';
import { formatCents, formatBillingDate } from './format';

describe('formatCents', () => {
  it('formats whole dollars', () => {
    expect(formatCents(9900)).toBe('$99.00');
  });
  it('formats cents', () => {
    expect(formatCents(10717)).toBe('$107.17');
  });
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
  it('formats a credit as negative', () => {
    expect(formatCents(-2500)).toBe('-$25.00');
  });
  it('groups thousands', () => {
    expect(formatCents(194800)).toBe('$1,948.00');
  });
  it('does not collapse distinct amounts to the same string', () => {
    // Guards against a stubbed-constant implementation: every value below must
    // format to something different from every other value.
    const outputs = [0, 100, 9900, 10717, -2500, 194800].map(formatCents);
    expect(new Set(outputs).size).toBe(outputs.length);
  });
});

describe('formatBillingDate', () => {
  it('formats an ISO date in long form', () => {
    expect(formatBillingDate('2026-10-21T00:00:00.000Z')).toBe('October 21, 2026');
  });
  it('formats a different date to a different string', () => {
    // Guards against a stubbed-constant implementation.
    expect(formatBillingDate('2027-01-05T00:00:00.000Z')).not.toBe(
      formatBillingDate('2026-10-21T00:00:00.000Z'),
    );
  });
  it('returns an empty string for null', () => {
    expect(formatBillingDate(null)).toBe('');
  });
  it('returns an empty string for an unparseable value', () => {
    expect(formatBillingDate('nope')).toBe('');
  });
});
