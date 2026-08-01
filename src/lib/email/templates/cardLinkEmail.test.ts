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
    const accountUrl = 'https://app.example.com/homeowner/account/payment-methods';
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

  it('switches to the urgent variant for a declined failed payment', () => {
    const { subject, html, text } = cardLinkEmail({
      homeownerName: 'John',
      orgName: 'Sparkle Co',
      url: URL,
      failedPayment: { reason: 'declined', amountLabel: '$100.00', dateLabel: 'June 24' },
    });
    expect(subject).toBe('Action needed: your payment to Sparkle Co did not go through');
    expect(html).toContain('Your payment did not go through');
    expect(html).toContain('was declined');
    expect(html).toContain('June 24');
    expect(html).toContain('$100.00');
    expect(html).toContain('has not been paid yet');
    expect(text).toContain('was declined');
    expect(text).toContain('June 24');
    expect(text).toContain('$100.00');
  });

  it('T1-7: uses no-card wording (never a false "declined") for the no_card reason', () => {
    const { subject, html, text } = cardLinkEmail({
      homeownerName: 'John',
      orgName: 'Sparkle Co',
      url: URL,
      failedPayment: { reason: 'no_card', amountLabel: '$100.00', dateLabel: 'June 24' },
    });
    expect(subject).toBe('Action needed: your payment to Sparkle Co did not go through');
    expect(html).toContain('no card on file');
    expect(html).toContain('has not been paid yet');
    expect(html).not.toContain('was declined');
    expect(text).toContain('no card on file');
    expect(text).not.toContain('was declined');
  });

  it('uses bank-verification wording for requires_action, and omits missing amount/date', () => {
    const { subject, html, text } = cardLinkEmail({
      homeownerName: 'John',
      orgName: 'Sparkle Co',
      url: URL,
      failedPayment: { reason: 'verification', amountLabel: null, dateLabel: null },
    });
    expect(subject).toContain('Action needed');
    expect(html).toContain('extra verification');
    expect(html).toContain('your cleaning');
    expect(html).not.toContain('your cleaning on');
    expect(html).not.toContain('()');
    expect(text).toContain('extra verification');
  });

  it('keeps the routine wording when failedPayment is absent', () => {
    const { subject, html } = cardLinkEmail({ homeownerName: 'John', orgName: 'Sparkle Co', url: URL });
    expect(subject).toBe('Update your payment method for Sparkle Co');
    expect(html).toContain('Update your card on file');
    expect(html).not.toContain('did not go through');
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

describe('cardLinkEmail branding', () => {
  const base = { homeownerName: 'John', orgName: 'Sparkle Co', url: URL };

  it("uses the org's brand color for the button and links when passed", () => {
    const { html } = cardLinkEmail({ ...base, brandColor: '#B5179E' });
    expect(html).toContain('background-color:#B5179E');
    expect(html).not.toContain('#0150FC');
  });

  it('keeps the Nexxus brand exactly when no color is passed', () => {
    const { html } = cardLinkEmail({ ...base });
    expect(html).toContain('background-color:#0150FC');
    expect(html).toContain('color:#0150FC');
  });

  it('keeps the Nexxus brand for an invalid color', () => {
    const { html } = cardLinkEmail({ ...base, brandColor: 'blue' });
    expect(html).toContain('background-color:#0150FC');
  });

  it('flips the button text dark and darkens link ink for a pale brand (AA)', () => {
    const { html } = cardLinkEmail({ ...base, brandColor: '#FFE24D' });
    // The button keeps the tenant's exact color as its fill...
    expect(html).toContain('background-color:#FFE24D');
    // ...but its label is no longer white, and links do not use the pale hex.
    const button = html.match(/<a href="[^"]*" style="[^"]*display:inline-block[^"]*"/)?.[0] ?? '';
    expect(button).not.toContain('color:#FFFFFF');
    expect(html).not.toContain('color:#FFE24D;text-decoration:underline');
  });

  it('renders the logo img only when a URL is given, with the org name as alt', () => {
    const withLogo = cardLinkEmail({ ...base, logoUrl: 'https://x.supabase.co/storage/v1/object/public/org-branding/o/icon-a.png' });
    expect(withLogo.html).toContain('<img src="https://x.supabase.co/storage/v1/object/public/org-branding/o/icon-a.png"');
    expect(withLogo.html).toContain('alt="Sparkle Co"');
    const without = cardLinkEmail({ ...base });
    expect(without.html).not.toContain('<img');
  });

  it('keeps the attribution footer in both variants (decision 11)', () => {
    for (const input of [{ ...base }, { ...base, brandColor: '#B5179E', logoUrl: 'https://x.supabase.co/logo.png' }]) {
      const { html, text } = cardLinkEmail(input);
      expect(html).toContain('Sent by Sparkle Co via Nexxus');
      expect(text).toContain('Sent by Sparkle Co via Nexxus');
    }
  });
});
