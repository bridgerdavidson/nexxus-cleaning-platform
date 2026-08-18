/**
 * Org-branded password-recovery email: pure { subject, html, text } builder, no I/O.
 *
 * Counterpart to inviteEmail.ts for the forgot-password flow (see
 * src/lib/auth/recoveryDelivery.ts): when SMTP is configured the recovery link
 * is minted with admin.generateLink and sent through the Brevo transport with
 * the user's org as the sender. A user with no org membership (e.g. a platform
 * admin) gets the neutral Nexxus look: pass orgName null.
 *
 * supabase/templates/auth/recovery.html stays as the GoTrue-sent fallback look.
 * Brand-token mirroring and escaping follow cardLinkEmail.ts.
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

export interface RecoveryEmailInput {
  /** The user's org (sender/branding); null = no membership, neutral Nexxus look. */
  orgName: string | null;
  /** GoTrue action link (…/auth/v1/verify?…type=recovery…), minted via generateLink. */
  url: string;
  /** The org's brand hex (organizations.brand_color); null/invalid = Nexxus blue. */
  brandColor?: string | null;
  /** The org's icon URL (organizations.logo_icon_url); shown above the heading when set. */
  logoUrl?: string | null;
}

export function recoveryEmail({ orgName, url, brandColor, logoUrl }: RecoveryEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const accent = brandColor && HEX_RE.test(brandColor) ? brandColor.toUpperCase() : NEXXUS_BRAND_HEX;
  const ramp = deriveBrandRamp(accent);
  const buttonFg = channelsToHex(ramp.foreground600);
  const ink = ramp.inkOnLight === ramp.steps[600] ? accent : channelsToHex(ramp.inkOnLight);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;

  const name = (orgName ?? '').trim();
  const safeOrg = name ? escapeHtml(name) : null;
  const safeUrl = escapeHtml(url);

  const subject = sanitizeHeaderValue('Reset your password');
  const preheader = 'Choose a new password for your account.';
  const accountRefHtml = safeOrg ? `your ${safeOrg} account` : 'your account';
  const accountRefText = name ? `your ${name} account` : 'your account';
  const footerHtml = safeOrg ? `Sent by ${safeOrg} via Nexxus` : 'Sent by Nexxus';
  const footerText = name ? `Sent by ${name} via Nexxus` : 'Sent by Nexxus';

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
                    ? `<img src="${safeLogoUrl}" alt="${safeOrg ?? 'Nexxus'}" width="32" height="32" style="display:block;width:32px;height:32px;object-fit:contain;margin:0 0 24px 0;" />`
                    : `<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;color:${ink};">${safeOrg ?? 'Nexxus'}</p>`
                }
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#211E1A;">Reset your password</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#211E1A;">We received a request to reset the password for ${accountRefHtml}. Click the button below to choose a new one. The link expires after a short time and can only be used once.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:10px;background-color:${accent};">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-family:${fontStack};font-size:15px;font-weight:600;color:${buttonFg};text-decoration:none;border-radius:10px;">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6B6459;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:${ink};text-decoration:underline;">${safeUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6B6459;">If you didn't request this, you can safely ignore this email. Your password won't change until you create a new one.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #E6E2DB;font-family:${fontStack};">
                <p style="margin:0;font-size:12px;color:#6B6459;">${footerHtml}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `We received a request to reset the password for ${accountRefText}. Use this link to choose a new one (it expires after a short time and can only be used once):`,
    '',
    url,
    '',
    "If you didn't request this, you can safely ignore this email. Your password won't change until you create a new one.",
    '',
    footerText,
  ].join('\n');

  return { subject, html, text };
}
