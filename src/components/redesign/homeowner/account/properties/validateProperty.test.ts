import { describe, it, expect } from 'vitest';
import { validateProperty, toNumberOrNull, EMPTY_PROPERTY_FORM } from './validateProperty';

const full = {
  ...EMPTY_PROPERTY_FORM,
  name: 'Main house',
  address: '123 Elm St',
  city: 'Tempe',
  state: 'AZ',
  zip_code: '85281',
};

describe('validateProperty', () => {
  it('passes when all required fields are present', () => {
    expect(validateProperty(full)).toBeNull();
  });
  it('flags each missing required field in order', () => {
    expect(validateProperty({ ...full, name: '  ' })).toMatch(/name/i);
    expect(validateProperty({ ...full, address: '' })).toMatch(/address/i);
    expect(validateProperty({ ...full, city: '' })).toMatch(/city/i);
    expect(validateProperty({ ...full, state: '' })).toMatch(/state/i);
    expect(validateProperty({ ...full, zip_code: '' })).toMatch(/zip/i);
  });
});

describe('toNumberOrNull', () => {
  it('parses a number', () => {
    expect(toNumberOrNull('3')).toBe(3);
  });
  it('returns null for blank or invalid', () => {
    expect(toNumberOrNull('')).toBeNull();
    expect(toNumberOrNull('  ')).toBeNull();
    expect(toNumberOrNull('abc')).toBeNull();
  });
});
