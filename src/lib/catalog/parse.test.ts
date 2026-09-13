import { describe, it, expect } from 'vitest';
import { asRecord, isUuid, parseMoney, parseOptionalText, parseRequiredText } from './parse';

describe('asRecord', () => {
  it('accepts plain objects only', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toBeNull();
    expect(asRecord([1])).toBeNull();
    expect(asRecord('x')).toBeNull();
  });
});

describe('isUuid', () => {
  it('matches lowercase and uppercase v4-shaped ids', () => {
    expect(isUuid('5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9')).toBe(true);
    expect(isUuid('5F3A2B1C-9D8E-4F7A-B6C5-D4E3F2A1B0C9')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isUuid('svc_1')).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('parseMoney', () => {
  it('accepts numbers and numeric strings, rounds to cents', () => {
    expect(parseMoney(199.999, 'Base price')).toEqual({ ok: true, value: 200 });
    expect(parseMoney('42.5', 'Base price')).toEqual({ ok: true, value: 42.5 });
    expect(parseMoney(0, 'Base price')).toEqual({ ok: true, value: 0 });
  });
  it('rejects negatives, NaN, and non-numbers with the label', () => {
    const err = { ok: false, error: 'Base price must be a number of 0 or more' };
    expect(parseMoney(-1, 'Base price')).toEqual(err);
    expect(parseMoney('abc', 'Base price')).toEqual(err);
    expect(parseMoney(null, 'Base price')).toEqual(err);
  });
});

describe('parseRequiredText', () => {
  it('trims and enforces the max length', () => {
    expect(parseRequiredText('  Deep Clean ', 'Service name', 120)).toEqual({ ok: true, value: 'Deep Clean' });
    expect(parseRequiredText('   ', 'Service name', 120)).toEqual({ ok: false, error: 'Service name is required' });
    expect(parseRequiredText('x'.repeat(121), 'Service name', 120)).toEqual({
      ok: false,
      error: 'Service name must be 120 characters or fewer',
    });
    expect(parseRequiredText(7, 'Service name', 120)).toEqual({ ok: false, error: 'Service name is required' });
  });
});

describe('parseOptionalText', () => {
  it('maps absent, null, and blank to null and trims text', () => {
    expect(parseOptionalText(undefined, 'Description')).toEqual({ ok: true, value: null });
    expect(parseOptionalText(null, 'Description')).toEqual({ ok: true, value: null });
    expect(parseOptionalText('   ', 'Description')).toEqual({ ok: true, value: null });
    expect(parseOptionalText(' hi ', 'Description')).toEqual({ ok: true, value: 'hi' });
    expect(parseOptionalText(5, 'Description')).toEqual({ ok: false, error: 'Description must be text' });
  });
});
