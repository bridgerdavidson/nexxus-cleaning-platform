import { describe, it, expect } from 'vitest';
import { cardLinkEmail, escapeHtml } from './cardLinkEmail';

const URL = 'https://app.example.com/billing/add-card?t=abc123-_tok';

describe('escapeHtml', () => {
  it('escapes all five HTML metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves a base64url token untouched', () => {
    expect(escapeHtml('abc123-_tok')).toBe('abc123-_tok');
  });
});

describe('cardLinkEmail', () => {
  it('includes the link URL in html and text, and the org in the subject', () => {
    const { subject, html, text } = cardLinkEmail({
      homeownerName: 'John',
      orgName: 'Sparkle Co',
      url: URL,
    });
    expect(subject).toBe('Update your payment method for Sparkle Co');
    expect(html).toContain(`href="${URL}"`);
    expect(text).toContain(URL);
    expect(html).toContain('Hi John,');
    expect(text).toContain('Hi John,');
  });

  it('HTML-escapes operator-settable names (homeowner + org)', () => {
    const { html } = cardLinkEmail({
      homeownerName: '<img src=x onerror=alert(1)>',
      orgName: 'A&B "Cleaners" <script>',
      url: URL,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A&amp;B &quot;Cleaners&quot; &lt;script&gt;');
  });

  it('strips CR/LF from the subject (SMTP header injection)', () => {
    const { subject } = cardLinkEmail({
      homeownerName: null,
      orgName: 'Evil\r\nBcc: attacker@example.com',
      url: URL,
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('Evil Bcc: attacker@example.com');
  });

  it('falls back to a generic greeting when the name is empty', () => {
    const { html, text } = cardLinkEmail({ homeownerName: '  ', orgName: 'Sparkle Co', url: URL });
    expect(html).toContain('>Hi,<');
    expect(text.startsWith('Hi,')).toBe(true);
  });

  it('includes the signed-in alternative only when accountUrl is provided', () => {
    const accountUrl = 'https://app.example.com/app/homeowner-dashboard/account/payment-methods';
    const withAccount = cardLinkEmail({
      homeownerName: 'John',
      orgName: 'Sparkle Co',
      url: URL,
      accountUrl,
    });
    expect(withAccount.html).toContain(`href="${accountUrl}"`);
    expect(withAccount.html).toContain('Sign in to your account');
    expect(withAccount.text).toContain(accountUrl);

    const without = cardLinkEmail({ homeownerName: 'John', orgName: 'Sparkle Co', url: URL });
    expect(without.html).not.toContain('Sign in to your account');
    expect(without.text).not.toContain('Sign in to your account');
  });

  it('states the expiry window', () => {
    const { html, text } = cardLinkEmail({
      homeownerName: 'John',
      orgName: 'Sparkle Co',
      url: URL,
      expiresInDays: 7,
    });
    expect(html).toContain('expires in 7 days');
    expect(text).toContain('expires in 7 days');
  });
});
