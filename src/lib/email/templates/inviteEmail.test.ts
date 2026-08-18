import { describe, it, expect } from 'vitest';
import { inviteEmail, type InviteEmailInput } from './inviteEmail';
import { NEXXUS_BRAND_HEX } from '@/lib/branding/tokens';

const BASE: InviteEmailInput = {
  orgName: 'Sparkle Cleaning',
  url: 'https://xyz.supabase.co/auth/v1/verify?token=abc&type=invite&redirect_to=https%3A%2F%2Fapp.example.com%2Faccept-invite%3Finvite_id%3D123',
};

describe('inviteEmail', () => {
  it('subject and body name the inviting org; the action link is the button and the paste fallback', () => {
    const { subject, html, text } = inviteEmail(BASE);
    expect(subject).toBe("You're invited to join Sparkle Cleaning");
    expect(html).toContain('Sparkle Cleaning invited you to create your account');
    expect(html).toContain('Accept invitation');
    // Escaped twice in the HTML: button href + paste-fallback link.
    expect(html.split('auth%2Fv1%2Fverify').length).toBe(1); // never double-encoded
    expect(html).toContain('/auth/v1/verify?token=abc&amp;type=invite');
    expect(text).toContain(BASE.url);
    expect(text).toContain('Sent by Sparkle Cleaning via Nexxus');
  });

  it('uses the org brand color for the button when valid, Nexxus blue otherwise', () => {
    const branded = inviteEmail({ ...BASE, brandColor: '#22AA55' });
    expect(branded.html).toContain('background-color:#22AA55');
    const fallback = inviteEmail({ ...BASE, brandColor: 'not-a-hex' });
    expect(fallback.html).toContain(`background-color:${NEXXUS_BRAND_HEX}`);
    const absent = inviteEmail(BASE);
    expect(absent.html).toContain(`background-color:${NEXXUS_BRAND_HEX}`);
  });

  it('shows the org logo when set, the org name eyebrow otherwise', () => {
    const withLogo = inviteEmail({ ...BASE, logoUrl: 'https://cdn.example.com/icon.png' });
    expect(withLogo.html).toContain('src="https://cdn.example.com/icon.png"');
    expect(withLogo.html).toContain('width="32" height="32"');
    const without = inviteEmail(BASE);
    expect(without.html).not.toContain('<img');
  });

  it('escapes operator-settable values in the HTML', () => {
    const { html } = inviteEmail({ ...BASE, orgName: '<b>Sparkle & Shine</b>' });
    expect(html).not.toContain('<b>Sparkle');
    expect(html).toContain('&lt;b&gt;Sparkle &amp; Shine&lt;/b&gt;');
  });

  it('strips header-injection characters from the subject', () => {
    const { subject } = inviteEmail({ ...BASE, orgName: 'Evil\r\nBcc: victim@example.com' });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('contains no em dashes (user-facing copy rule)', () => {
    const { subject, html, text } = inviteEmail(BASE);
    expect(subject).not.toContain('—');
    expect(html).not.toContain('—');
    expect(text).not.toContain('—');
  });
});
