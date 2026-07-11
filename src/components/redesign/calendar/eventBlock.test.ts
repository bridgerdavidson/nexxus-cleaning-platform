import { describe, expect, it } from 'vitest';
import { isCompactHeight } from './EventBlock';

describe('isCompactHeight', () => {
  it('is compact below 64px, full at or above', () => {
    expect(isCompactHeight(44)).toBe(true);
    expect(isCompactHeight(64)).toBe(false);
  });
});
