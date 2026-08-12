import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveFrom } from './sendEmail';

describe('resolveFrom', () => {
  let originalFrom: string | undefined;

  beforeEach(() => {
    originalFrom = process.env.EMAIL_FROM;
  });

  afterEach(() => {
    process.env.EMAIL_FROM = originalFrom;
  });

  it('no fromName: returns EMAIL_FROM verbatim, display name and all', () => {
    process.env.EMAIL_FROM = 'Nexxus Cleaning <no-reply@nexxus.test>';
    expect(resolveFrom()).toBe('Nexxus Cleaning <no-reply@nexxus.test>');
    expect(resolveFrom('   ')).toBe('Nexxus Cleaning <no-reply@nexxus.test>');
  });

  it('fromName replaces the display name but keeps the address from a Name <addr> EMAIL_FROM', () => {
    process.env.EMAIL_FROM = 'Nexxus Cleaning <no-reply@nexxus.test>';
    expect(resolveFrom('Sparkles Cleaning')).toEqual({
      name: 'Sparkles Cleaning',
      address: 'no-reply@nexxus.test',
    });
  });

  it('works with a bare-address EMAIL_FROM', () => {
    process.env.EMAIL_FROM = 'no-reply@nexxus.test';
    expect(resolveFrom('Sparkles Cleaning')).toEqual({
      name: 'Sparkles Cleaning',
      address: 'no-reply@nexxus.test',
    });
  });

  it('strips header-injection characters from the operator-settable name', () => {
    process.env.EMAIL_FROM = 'no-reply@nexxus.test';
    const from = resolveFrom('Evil\r\nBcc: victim@example.com\x00Org');
    expect(from).toEqual({ name: 'Evil Bcc: victim@example.com Org', address: 'no-reply@nexxus.test' });
  });
});
