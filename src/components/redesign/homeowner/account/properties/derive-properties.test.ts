import { describe, it, expect } from 'vitest';
import { propertyLocationLine, propertyStatsLabel } from './derive-properties';

describe('propertyLocationLine', () => {
  it('joins city and state', () => {
    expect(propertyLocationLine({ city: 'Tempe', state: 'AZ' })).toBe('Tempe, AZ');
  });
  it('omits a missing part', () => {
    expect(propertyLocationLine({ city: 'Tempe', state: '' })).toBe('Tempe');
  });
});

describe('propertyStatsLabel', () => {
  it('joins present stats with a middot', () => {
    expect(propertyStatsLabel({ bedrooms: 3, bathrooms: 2, square_feet: 1200 })).toBe(
      '3 bd · 2 ba · 1,200 sq ft',
    );
  });
  it('omits missing/zero stats', () => {
    expect(propertyStatsLabel({ bedrooms: 2, bathrooms: undefined, square_feet: 0 })).toBe('2 bd');
  });
  it('returns empty when nothing is set', () => {
    expect(propertyStatsLabel({})).toBe('');
  });
});
