import { describe, it, expect } from 'vitest';
import { isAuthEmailSendFailure } from './authEmailHealth';

describe('isAuthEmailSendFailure', () => {
  it('returns false for null/undefined (a successful send returns no error)', () => {
    expect(isAuthEmailSendFailure(null)).toBe(false);
    expect(isAuthEmailSendFailure(undefined)).toBe(false);
  });

  it('flags a 500 / unexpected_failure (a provider SMTP 535 surfaces this way)', () => {
    expect(
      isAuthEmailSendFailure({
        status: 500,
        code: 'unexpected_failure',
        message: 'Error sending recovery email',
      }),
    ).toBe(true);
  });

  it('flags by code alone when the status is absent', () => {
    expect(isAuthEmailSendFailure({ code: 'unexpected_failure' })).toBe(true);
  });

  it('flags by message alone, for both recovery and magic-link sends', () => {
    expect(isAuthEmailSendFailure({ message: 'Error sending recovery email' })).toBe(true);
    expect(isAuthEmailSendFailure({ message: 'Error sending magic link email' })).toBe(true);
  });

  it('does NOT flag a rate-limit error (429)', () => {
    expect(
      isAuthEmailSendFailure({
        status: 429,
        code: 'over_email_send_rate_limit',
        message: 'Email rate limit exceeded',
      }),
    ).toBe(false);
  });

  it('does NOT flag validation errors (400/422)', () => {
    expect(
      isAuthEmailSendFailure({
        status: 400,
        message: 'Unable to validate email address: invalid format',
      }),
    ).toBe(false);
    expect(isAuthEmailSendFailure({ status: 422 })).toBe(false);
  });
});
