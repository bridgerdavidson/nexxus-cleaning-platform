import { describe, it, expect } from 'vitest';
import { parsePropertyCreate } from './parsePropertyInput';

const ORG = '5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const OWNER = '11111111-1111-4111-8111-111111111111';
const valid = {
  organization_id: ORG,
  name: ' Lake House ',
  address: '1 Shore Rd',
  city: 'Austin',
  state: 'TX',
  zip_code: '78701',
  bedrooms: '3',
  bathrooms: 2.5,
  square_feet: null,
  special_instructions: '  ',
  access_instructions: ' Key under mat ',
};

describe('parsePropertyCreate', () => {
  it('normalizes a valid body; owner_id defaults to null', () => {
    expect(parsePropertyCreate(valid)).toEqual({
      ok: true,
      value: {
        organization_id: ORG,
        owner_id: null,
        name: 'Lake House',
        address: '1 Shore Rd',
        city: 'Austin',
        state: 'TX',
        zip_code: '78701',
        bedrooms: 3,
        bathrooms: 2.5,
        square_feet: null,
        special_instructions: null,
        access_instructions: 'Key under mat',
      },
    });
  });

  it('keeps an explicit owner_id', () => {
    expect(parsePropertyCreate({ ...valid, owner_id: OWNER })).toMatchObject({ ok: true, value: { owner_id: OWNER } });
  });

  it.each([
    [{ organization_id: 'x' }, 'organization_id is required'],
    [{ owner_id: 'x' }, 'owner_id must be an id'],
    [{ name: '' }, 'Property name is required'],
    [{ address: '  ' }, 'Address is required'],
    [{ city: undefined }, 'City is required'],
    [{ state: '' }, 'State is required'],
    [{ zip_code: '' }, 'ZIP code is required'],
    [{ bedrooms: 1.5 }, 'Bedrooms must be a whole number of 0 or more'],
    [{ bedrooms: -1 }, 'Bedrooms must be a whole number of 0 or more'],
    [{ bathrooms: 'two' }, 'Bathrooms must be a number of 0 or more'],
    [{ square_feet: 12.5 }, 'Square feet must be a whole number of 0 or more'],
    [{ special_instructions: 4 }, 'Special instructions must be text'],
  ] as const)('rejects %j', (override, error) => {
    expect(parsePropertyCreate({ ...valid, ...override })).toEqual({ ok: false, error });
  });

  it('treats empty strings for the numbers as null', () => {
    expect(parsePropertyCreate({ ...valid, bedrooms: '', bathrooms: '', square_feet: '' })).toMatchObject({
      ok: true,
      value: { bedrooms: null, bathrooms: null, square_feet: null },
    });
  });
});
