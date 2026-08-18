import { describe, it, expect } from 'vitest';
import { ownerProvisionEmail, type OwnerProvisionEmailInput } from './ownerProvisionEmail';
import { NEXXUS_BRAND_HEX } from '@/lib/branding/tokens';

const BASE: OwnerProvisionEmailInput = {
  orgName: 'Nexxus Corporate Housing',
  url: 'https://xyz.supabase.co/auth/v1/verify?token=abc&type=invite&redirect_to=https%3A%2F%2Fapp.example.com%2Faccept-invite%3Finvite_id%3D123',
  assetBaseUrl: 'https://cleaning.trynexxus.com',
};

describe('ownerProvisionEmail', () => {
  it('is Nexxus-branded platform voice: subject names the org, body grants ownership', () => {
    const { subject, html, text } = ownerProvisionEmail(BASE);
    expect(subject).toBe('Your owner account for Nexxus Corporate Housing is ready');
    expect(html).toContain('Welcome, owner.');
    expect(html).toContain('Nexxus Corporate Housing is set up and waiting for you.');
    expect(html).toContain('Accept ownership');
    expect(html).toContain(`background-color:${NEXXUS_BRAND_HEX}`);
    expect(text).toContain(BASE.url);
    expect(text).toContain('Sent by Nexxus, the platform behind your cleaning business.');
  });

  it('carries the action link as both the button href and the paste fallback, never double-encoded', () => {
    const { html } = ownerProvisionEmail(BASE);
    expect(html).toContain('/auth/v1/verify?token=abc&amp;type=invite');
    expect(html.split('auth%2Fv1%2Fverify').length).toBe(1);
  });

  it('loads hosted brand images from assetBaseUrl, trimming trailing slashes', () => {
    const { html } = ownerProvisionEmail({ ...BASE, assetBaseUrl: 'https://cleaning.trynexxus.com/' });
    expect(html).toContain('src="https://cleaning.trynexxus.com/brand/email/logo-white-2x.png"');
    expect(html).toContain('width="154" height="34"');
    expect(html).toContain("https://cleaning.trynexxus.com/brand/email/hero-rings-2x.png");
  });

  it('degrades to a text lockup and plain hero when assetBaseUrl is missing', () => {
    const { html } = ownerProvisionEmail({ ...BASE, assetBaseUrl: null });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('background-image');
    expect(html).toContain('>Nexxus</p>');
  });

  it('lists the three onboarding steps in order', () => {
    const { html, text } = ownerProvisionEmail(BASE);
    const pw = html.indexOf('Create your password');
    const biz = html.indexOf('Set up your business');
    const jobs = html.indexOf('Start booking jobs');
    expect(pw).toBeGreaterThan(-1);
    expect(biz).toBeGreaterThan(pw);
    expect(jobs).toBeGreaterThan(biz);
    expect(text).toContain('1. Create your password.');
  });

  it('escapes the operator-typed org name in the HTML', () => {
    const { html } = ownerProvisionEmail({ ...BASE, orgName: '<b>Corp & Co</b>' });
    expect(html).not.toContain('<b>Corp');
    expect(html).toContain('&lt;b&gt;Corp &amp; Co&lt;/b&gt;');
  });

  it('strips header-injection characters from the subject', () => {
    const { subject } = ownerProvisionEmail({ ...BASE, orgName: 'Evil\r\nBcc: victim@example.com' });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('contains no em dashes (user-facing copy rule)', () => {
    const { subject, html, text } = ownerProvisionEmail(BASE);
    expect(subject).not.toContain('—');
    expect(html).not.toContain('—');
    expect(text).not.toContain('—');
  });
});
