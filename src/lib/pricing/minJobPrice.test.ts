import { describe, it, expect } from 'vitest';
import {
  MIN_JOB_PRICE_CENTS,
  MIN_JOB_PRICE_MESSAGE,
  MIN_JOB_PRICE_USD,
  jobPriceError,
  meetsMinJobPrice,
} from './minJobPrice';

describe('minJobPrice constants', () => {
  it('is one dollar, in dollars and cents', () => {
    expect(MIN_JOB_PRICE_USD).toBe(1);
    expect(MIN_JOB_PRICE_CENTS).toBe(100);
  });

  it('copy has no em dash (CLAUDE.md copy rule)', () => {
    expect(MIN_JOB_PRICE_MESSAGE).not.toContain('—');
  });
});

describe('jobPriceError', () => {
  it('accepts exactly $1', () => {
    expect(jobPriceError(1)).toBeNull();
  });

  it('accepts typical prices', () => {
    expect(jobPriceError(1.01)).toBeNull();
    expect(jobPriceError(150)).toBeNull();
    expect(jobPriceError(9999.99)).toBeNull();
  });

  it('rejects $0 (the pilot bug)', () => {
    expect(jobPriceError(0)).toBe(MIN_JOB_PRICE_MESSAGE);
  });

  it('rejects anything under $1', () => {
    expect(jobPriceError(0.5)).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError(0.99)).toBe(MIN_JOB_PRICE_MESSAGE);
  });

  it('rejects negative prices', () => {
    expect(jobPriceError(-1)).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError(-150)).toBe(MIN_JOB_PRICE_MESSAGE);
  });

  it('rejects null, undefined, NaN, Infinity, and empty input', () => {
    expect(jobPriceError(null)).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError(undefined)).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError(Number.NaN)).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError(Number.POSITIVE_INFINITY)).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError('')).toBe(MIN_JOB_PRICE_MESSAGE);
    expect(jobPriceError('abc')).toBe(MIN_JOB_PRICE_MESSAGE);
  });

  it('accepts numeric strings (PostgREST numeric serialization)', () => {
    expect(jobPriceError('1.00')).toBeNull();
    expect(jobPriceError('0.00')).toBe(MIN_JOB_PRICE_MESSAGE);
  });

  it('compares in cents, so base + adder float noise at the boundary still passes', () => {
    expect(jobPriceError(0.7 + 0.3)).toBeNull();
    expect(jobPriceError(0.99 + 0.01)).toBeNull();
    expect(jobPriceError(0.994)).toBe(MIN_JOB_PRICE_MESSAGE);
  });
});

describe('meetsMinJobPrice', () => {
  it('mirrors jobPriceError', () => {
    expect(meetsMinJobPrice(1)).toBe(true);
    expect(meetsMinJobPrice(0)).toBe(false);
    expect(meetsMinJobPrice(null)).toBe(false);
  });
});
