/**
 * Owner-provision email: pure { subject, html, text } builder, no I/O.
 *
 * Sent when the PLATFORM provisions a new tenant and hands the founder their
 * owner account. Unlike inviteEmail (white-labeled as the inviting org), this
 * one is deliberately Nexxus-branded: the founder's company does not exist to
 * them yet, and the exciting part is Nexxus granting them ownership. Sender
 * name is "Nexxus" (see src/lib/auth/provisionDelivery.ts).
 *
 * Visual: the login screen's brand panel translated to email. Brand-600 hero
 * with the white lockup and ring outlines, "Welcome, owner.", a 3-step
 * what-happens-next list, and the pill CTA. Composed from the shell so it
 * matches every other transactional email.
 *
 * Brand images are hosted PNGs under /brand/email/ (Gmail cannot render SVG);
 * `assetBaseUrl` is the absolute origin to load them from (APP_URL). When it
 * is missing the hero degrades to a text lockup and a plain blue band.
 */
import { NEXXUS_BRAND_HEX } from '@/lib/branding/tokens';
import { escapeHtml } from './cardLinkEmail';
import {
  EMAIL_COLORS,
  EMAIL_FONT_STACK,
  emailShell,
  linkFallback,
  pillButton,
  sanitizeHeaderValue,
} from './shell';

export interface OwnerProvisionEmailInput {
  /** The newly provisioned company's name (operator-typed; escaped here). */
  orgName: string;
  /** GoTrue action link (…/auth/v1/verify?…), minted server-side via generateLink. */
  url: string;
  /** Absolute origin for hosted brand images, e.g. https://cleaning.trynexxus.com. */
  assetBaseUrl?: string | null;
}

const STEPS: { title: string; sub: string }[] = [
  { title: 'Create your password', sub: 'Your email is already your login.' },
  { title: 'Set up your business', sub: 'Services, team, and branding in a guided setup.' },
  { title: 'Start booking jobs', sub: 'Invite your team and take your first booking.' },
];

export function ownerProvisionEmail({ orgName, url, assetBaseUrl }: OwnerProvisionEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = EMAIL_COLORS;
  const accent = NEXXUS_BRAND_HEX;
  const safeOrg = escapeHtml(orgName);
  const safeUrl = escapeHtml(url);
  const base = (assetBaseUrl ?? '').trim().replace(/\/+$/, '');

  const subject = sanitizeHeaderValue(`Your owner account for ${orgName} is ready`);
  const preheader = 'Accept ownership and set your password.';

  const lockup = base
    ? `<img src="${escapeHtml(base)}/brand/email/logo-white-2x.png" alt="Nexxus" width="154" height="34" style="display:block;width:154px;height:34px;" />`
    : `<p style="margin:0;font-size:19px;line-height:34px;font-weight:800;letter-spacing:-0.02em;color:#FFFFFF;">Nexxus</p>`;
  const rings = base
    ? `background-image:url('${escapeHtml(base)}/brand/email/hero-rings-2x.png');background-repeat:no-repeat;background-position:left top;background-size:cover;`
    : '';

  const stepsRows = STEPS.map(
    (s, i) => `<tr>
                    <td style="padding:10px 0;${i > 0 ? `border-top:1px solid ${c.divider};` : ''}">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td valign="top" style="padding:1px 14px 0 0;">
                            <div style="width:26px;height:26px;border-radius:9999px;background-color:#EFF4FF;color:#0140CC;font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:26px;font-weight:700;text-align:center;">${i + 1}</div>
                          </td>
                          <td style="font-family:${EMAIL_FONT_STACK};">
                            <p style="margin:0;font-size:14px;line-height:1.4;font-weight:700;color:${c.ink};">${s.title}</p>
                            <p style="margin:1px 0 0 0;font-size:13px;line-height:1.5;color:${c.muted};">${s.sub}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`,
  ).join('\n                  ');

  const bodyHtml = `<tr>
              <td bgcolor="${accent}" style="background-color:${accent};${rings}border-radius:22px 22px 0 0;padding:36px 32px 32px 32px;font-family:${EMAIL_FONT_STACK};">
                ${lockup}
                <h1 style="margin:26px 0 0 0;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#FFFFFF;">Welcome, owner.</h1>
                <p style="margin:10px 0 0 0;font-size:16px;line-height:1.55;font-weight:500;color:rgba(255,255,255,0.92);">${safeOrg} is set up and waiting for you.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 28px 32px;font-family:${EMAIL_FONT_STACK};">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:${c.ink};">Your owner account is reserved. Here's what happens when you accept:</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px 0;">
                  ${stepsRows}
                </table>
                ${pillButton({ href: safeUrl, label: 'Accept ownership', bg: accent, fg: '#FFFFFF' })}
                ${linkFallback({ url: safeUrl, ink: accent })}
              </td>
            </tr>`;

  const html = emailShell({
    preheader,
    bodyHtml,
    footerHtml: `<p style="margin:0;font-size:12px;color:${c.muted};">Sent by Nexxus, the platform behind your cleaning business.</p>`,
  });

  const text = [
    `Welcome, owner. ${orgName} is set up and waiting for you on Nexxus.`,
    '',
    'When you accept:',
    ...STEPS.map((s, i) => `${i + 1}. ${s.title}. ${s.sub}`),
    '',
    'Accept ownership:',
    url,
    '',
    "This link is for you only and can be used once. If you weren't expecting it, you can safely ignore this email.",
    '',
    'Sent by Nexxus, the platform behind your cleaning business.',
  ].join('\n');

  return { subject, html, text };
}
