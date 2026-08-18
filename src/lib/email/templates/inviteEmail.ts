/**
 * Org-branded invite email: pure { subject, html, text } builder, no I/O.
 *
 * Replaces GoTrue's mailer for invites when SMTP is configured (see
 * src/lib/auth/inviteDelivery.ts): the action link is minted with
 * admin.generateLink and delivered through the Brevo transport, so the inbox
 * sender name, accent color, and logo are the inviting org's rather than the
 * platform's. supabase/templates/auth/invite.html remains the GoTrue-sent
 * fallback look for environments without app SMTP.
 *
 * White-label rules: the ORG is the actor throughout (sender, header, footer);
 * "Nexxus" appears only in the footer attribution. The layout comes from the
 * shared shell (shell.ts) so it matches the platform's own emails; only the
 * accent color and logo are the org's. Brand-token mirroring and escaping
 * follow cardLinkEmail.ts: the derived ramp supplies a max-contrast button
 * label and a link ink guaranteed legible on white, the logo carries hard
 * width/height attributes for Outlook, and every interpolated dynamic value is
 * escaped (org names are operator-settable input; the url is server-built but
 * escaped anyway as defense in depth).
 */
import { parse, formatHex } from 'culori';
import { deriveBrandRamp } from '@/lib/branding/palette';
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

const HEX_RE = /^#[0-9a-f]{6}$/i;

function channelsToHex(channels: string): string {
  return (formatHex(parse(`hsl(${channels})`)) ?? '#211E1A').toUpperCase();
}

export interface InviteEmailInput {
  /** The inviting org's name (the actor throughout; "Nexxus" is only the platform). */
  orgName: string;
  /** GoTrue action link (…/auth/v1/verify?…), minted server-side via generateLink. */
  url: string;
  /** The org's brand hex (organizations.brand_color); null/invalid = Nexxus blue. */
  brandColor?: string | null;
  /** The org's icon URL (organizations.logo_icon_url); shown above the heading when set. */
  logoUrl?: string | null;
}

export function inviteEmail({ orgName, url, brandColor, logoUrl }: InviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const c = EMAIL_COLORS;
  const accent = brandColor && HEX_RE.test(brandColor) ? brandColor.toUpperCase() : NEXXUS_BRAND_HEX;
  const ramp = deriveBrandRamp(accent);
  const buttonFg = channelsToHex(ramp.foreground600);
  const ink = ramp.inkOnLight === ramp.steps[600] ? accent : channelsToHex(ramp.inkOnLight);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;

  const safeOrg = escapeHtml(orgName);
  const safeUrl = escapeHtml(url);

  const subject = sanitizeHeaderValue(`You're invited to join ${orgName}`);
  const preheader = 'Accept your invitation and set your password.';

  const bodyHtml = `<tr>
              <td style="padding:32px 32px 28px 32px;font-family:${EMAIL_FONT_STACK};">
                ${
                  safeLogoUrl
                    ? `<img src="${safeLogoUrl}" alt="${safeOrg}" width="32" height="32" style="display:block;width:32px;height:32px;object-fit:contain;margin:0 0 24px 0;" />`
                    : `<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;color:${ink};">${safeOrg}</p>`
                }
                <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${c.ink};">You're invited</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:${c.ink};">${safeOrg} invited you to create your account. Accept your invitation to set your password and get started.</p>
                ${pillButton({ href: safeUrl, label: 'Accept invitation', bg: accent, fg: buttonFg })}
                ${linkFallback({ url: safeUrl, ink })}
              </td>
            </tr>`;

  const html = emailShell({
    preheader,
    bodyHtml,
    footerHtml: `<p style="margin:0;font-size:12px;color:${c.muted};">Sent by ${safeOrg} via Nexxus</p>`,
  });

  const text = [
    `${orgName} invited you to create your account. Use this link to accept your invitation and set your password:`,
    '',
    url,
    '',
    "This link is for you only and can be used once. If you weren't expecting this invitation, you can safely ignore this email.",
    '',
    `Sent by ${orgName} via Nexxus`,
  ].join('\n');

  return { subject, html, text };
}
