import { describe, it, expect } from 'vitest';
import { recoveryEmail, type RecoveryEmailInput } from './recoveryEmail';
import { NEXXUS_BRAND_HEX } from '@/lib/branding/tokens';

const BASE: RecoveryEmailInput = {
  orgName: 'Sparkle Cleaning',
  url: 'https://xyz.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https%3A%2F%2Fapp.example.com%2Freset-password',
};

describe('recoveryEmail', () => {
  it('names the org in the body and footer; the action link is the button and the paste fallback', () => {
    const { subject, html, text } = recoveryEmail(BASE);
    expect(subject).toBe('Reset your password');
    expect(html).toContain('your Sparkle Cleaning account');
    expect(html).toContain('Reset password');
    expect(html).toContain('/auth/v1/verify?token=abc&amp;type=recovery');
    expect(text).toContain(BASE.url);
    expect(text).toContain('Sent by Sparkle Cleaning via Nexxus');
  });

  it('falls back to the neutral Nexxus look for a user with no org', () => {
    const { html, text } = recoveryEmail({ ...BASE, orgName: null });
    expect(html).toContain('your account');
    expect(html).not.toContain('via Nexxus');
    expect(html).toContain('Sent by Nexxus');
    expect(html).toContain(`background-color:${NEXXUS_BRAND_HEX}`);
    expect(text).toContain('Sent by Nexxus');
  });

  it('uses the org brand color when valid, Nexxus blue otherwise', () => {
    const branded = recoveryEmail({ ...BASE, brandColor: '#22AA55' });
    expect(branded.html).toContain('background-color:#22AA55');
    const fallback = recoveryEmail({ ...BASE, brandColor: 'not-a-hex' });
    expect(fallback.html).toContain(`background-color:${NEXXUS_BRAND_HEX}`);
  });

  it('escapes operator-settable values in the HTML', () => {
    const { html } = recoveryEmail({ ...BASE, orgName: '<b>Sparkle & Shine</b>' });
    expect(html).not.toContain('<b>Sparkle');
    expect(html).toContain('&lt;b&gt;Sparkle &amp; Shine&lt;/b&gt;');
  });

  it('contains no em dashes (user-facing copy rule)', () => {
    for (const orgName of ['Sparkle Cleaning', null]) {
      const { subject, html, text } = recoveryEmail({ ...BASE, orgName });
      expect(subject).not.toContain('—');
      expect(html).not.toContain('—');
      expect(text).not.toContain('—');
    }
  });
});
