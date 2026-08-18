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
 * Brand-token mirroring and escaping follow cardLinkEmail.ts: the same derived
 * ramp supplies a max-contrast button label and a link ink guaranteed legible
 * on white, the logo carries hard width/height attributes for Outlook, and
 * every interpolated dynamic value is escaped (org names are operator-settable
 * input; the url is server-built but escaped anyway as defense in depth).
 */
import { parse, formatHex } from 'culori';
import { deriveBrandRamp } from '@/lib/branding/palette';
import { NEXXUS_BRAND_HEX } from '@/lib/branding/tokens';
import { escapeHtml } from './cardLinkEmail';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function channelsToHex(channels: string): string {
  return (formatHex(parse(`hsl(${channels})`)) ?? '#211E1A').toUpperCase();
}

/** Header values must never contain CR/LF (SMTP header injection). */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
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
  const accent = brandColor && HEX_RE.test(brandColor) ? brandColor.toUpperCase() : NEXXUS_BRAND_HEX;
  const ramp = deriveBrandRamp(accent);
  const buttonFg = channelsToHex(ramp.foreground600);
  const ink = ramp.inkOnLight === ramp.steps[600] ? accent : channelsToHex(ramp.inkOnLight);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;

  const safeOrg = escapeHtml(orgName);
  const safeUrl = escapeHtml(url);

  const subject = sanitizeHeaderValue(`You're invited to join ${orgName}`);
  const preheader = 'Accept your invitation and set your password.';

  const fontStack =
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#F7F6F3;">
    <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F6F3;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E6E2DB;border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 24px 32px;font-family:${fontStack};">
                ${
                  safeLogoUrl
                    ? `<img src="${safeLogoUrl}" alt="${safeOrg}" width="32" height="32" style="display:block;width:32px;height:32px;object-fit:contain;margin:0 0 24px 0;" />`
                    : `<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;color:${ink};">${safeOrg}</p>`
                }
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#211E1A;">You're invited</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#211E1A;">${safeOrg} invited you to create your account. Click the button below to accept your invitation and set your password.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:10px;background-color:${accent};">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-family:${fontStack};font-size:15px;font-weight:600;color:${buttonFg};text-decoration:none;border-radius:10px;">Accept invitation</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6B6459;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:${ink};text-decoration:underline;">${safeUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6B6459;">This link is for you only and can be used once. If you weren't expecting this invitation, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #E6E2DB;font-family:${fontStack};">
                <p style="margin:0;font-size:12px;color:#6B6459;">Sent by ${safeOrg} via Nexxus</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

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
