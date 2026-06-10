import { describe, it, expect } from 'vitest';
import { resolveCustomerLabel } from './resolveDisplayName';

describe('resolveCustomerLabel', () => {
  it('uses the homeowner full name when present', () => {
    expect(
      resolveCustomerLabel({ homeowner: { first_name: 'Sarah', last_name: 'Williams' } }, 'admin'),
    ).toBe('Sarah Williams');
  });

  it('never returns "Unknown" for an org-owned job with no homeowner', () => {
    const label = resolveCustomerLabel(
      { homeowner: null, is_self_pay: true, property: { name: '123 Admin Street' } },
      'admin',
    );
    expect(label).toBe('123 Admin Street');
    expect(label).not.toMatch(/unknown/i);
  });

  it('falls back to property address, then "Company booking", for a self-pay job', () => {
    expect(
      resolveCustomerLabel({ is_self_pay: true, property: { address: '9 Oak Ave' } }, 'manager'),
    ).toBe('9 Oak Ave');
    expect(resolveCustomerLabel({ is_self_pay: true, property: {} }, 'manager')).toBe(
      'Company booking',
    );
  });

  it('shows the property to a homeowner viewer', () => {
    expect(
      resolveCustomerLabel(
        { homeowner: { first_name: 'Sarah', last_name: 'Williams' }, property: { name: 'Beach House' } },
        'homeowner',
      ),
    ).toBe('Beach House');
  });

  it('falls back to "Customer" when nothing is known', () => {
    expect(resolveCustomerLabel({}, 'admin')).toBe('Customer');
  });
});
