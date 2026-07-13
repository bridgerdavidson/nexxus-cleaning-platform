import { describe, expect, it } from 'vitest';
import { buildPropertySeed } from './seedFromProperty';
import type { AdminProperty } from '@/hooks/useAdminData';

function makeProperty(overrides: Partial<AdminProperty> = {}): AdminProperty {
  return {
    id: 'prop-1',
    name: 'Main house',
    address: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip_code: '62704',
    bedrooms: null,
    bathrooms: null,
    square_feet: null,
    photo_url: null,
    archived_at: null,
    special_instructions: null,
    access_instructions: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    owner_id: '',
    homeowner: null,
    ...overrides,
  } as AdminProperty;
}

describe('buildPropertySeed', () => {
  it('seeds customer + property + bill-to customer for a homeowner-owned property', () => {
    const property = makeProperty({ id: 'prop-1', owner_id: 'owner-1' });
    expect(buildPropertySeed(property)).toEqual({
      customerId: 'owner-1',
      propertyId: 'prop-1',
      billTo: 'customer',
    });
  });

  it('seeds only the property + self-pay bill-to for an org-owned property (no customerId)', () => {
    // owner_id is nullable at runtime for org-owned rows even though the
    // AdminProperty type declares it as `string` (see useAdminData.ts).
    const property = makeProperty({ id: 'prop-2', owner_id: null as unknown as string });
    const seed = buildPropertySeed(property);
    expect(seed).toEqual({ propertyId: 'prop-2', billTo: 'self_pay' });
    expect('customerId' in seed).toBe(false);
  });
});
