import { afterEach, describe, expect, it } from 'vitest';
import { requireAppUrl } from './appUrl';

const clear = () => { delete process.env.APP_URL; delete process.env.NEXT_PUBLIC_APP_URL; };

describe('requireAppUrl', () => {
  afterEach(clear);

  it('prefers APP_URL', () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://other.example.com';
    expect(requireAppUrl()).toBe('https://app.example.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL', () => {
    clear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com';
    expect(requireAppUrl()).toBe('https://public.example.com');
  });

  it('strips a trailing slash so callers can concatenate a path', () => {
    process.env.APP_URL = 'https://app.example.com/';
    expect(requireAppUrl()).toBe('https://app.example.com');
  });

  it('throws a named error when neither is set', () => {
    clear();
    expect(() => requireAppUrl()).toThrow(/APP_URL/);
  });

  it('throws when the value is not an absolute http(s) URL', () => {
    process.env.APP_URL = '/dashboard';
    expect(() => requireAppUrl()).toThrow(/absolute/i);
  });
});
