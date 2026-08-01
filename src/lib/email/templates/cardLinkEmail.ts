/**
 * Card-collection link email: pure { subject, html, text } builder, no I/O.
 *
 * Email HTML cannot use the Tailwind design system, so the brand tokens are
 * mirrored here as inline styles (neutrals: warm-50 canvas #F7F6F3, warm-900
 * text #211E1A, warm-600 muted #6B6459, warm-200 border #E6E2DB; source of
 * truth: src/app/globals.css + tailwind.config.js). The BRAND color is the
 * org's own when provided (white-label PR 5), derived through the same
 * AA-guarded ramp the app uses: the button fill honors the tenant color
 * exactly, its label flips white/near-black, and link/eyebrow ink steps darker
 * when the tenant color is not legible on white. Nexxus blue when absent.
 *
 * Every interpolated dynamic value is escaped: homeowner and org names are
 * operator-settable input, not self-owned. Only the server-built `url` carries
 * the link token, and it is escaped too (defense in depth; it is server-built
 * from APP_URL + a base64url token, so escaping never alters a legit URL).
 */
import { parse, formatHex } from 'culori';
import { deriveBrandRamp } from '@/lib/branding/palette';
import { NEXXUS_BRAND_HEX } from '@/lib/branding/tokens';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function channelsToHex(channels: string): string {
  return (formatHex(parse(`hsl(${channels})`)) ?? '#211E1A').toUpperCase();
}

export interface FailedPaymentContext {
  /**
   * 'declined' = the charge failed; 'verification' = the bank wants 3DS/extra confirmation;
   * 'no_card' = a completed job has no usable card on file (T1-7 bail), so nothing was declined.
   */
  reason: 'declined' | 'verification' | 'no_card';
  /** Preformatted, e.g. "$100.00". Server-derived from the appointment, never client input. */
  amountLabel: string | null;
  /** Preformatted, e.g. "June 24". Server-derived from the appointment. */
  dateLabel: string | null;
}

export interface CardLinkEmailInput {
  /** Recipient display name; falls back to a generic greeting when empty. */
  homeownerName: string | null;
  /** The cleaning company's name (shown as the actor; "Nexxus" is only the platform). */
  orgName: string;
  /** Full https URL to the hosted add-card page, built server-side from APP_URL. */
  url: string;
  /**
   * Optional signed-in alternative for recipients wary of email payment links:
   * the homeowner dashboard's Payment methods page, also built from APP_URL.
   */
  accountUrl?: string | null;
  /**
   * When present, the email switches to the urgent "your payment did not go
   * through" variant instead of routine "keep a card on file" wording. Derived
   * server-side from the appointment's authorization_status.
   */
  failedPayment?: FailedPaymentContext | null;
  expiresInDays?: number;
  /** The org's brand hex (organizations.brand_color); null/invalid = Nexxus blue. */
  brandColor?: string | null;
  /** The org's icon URL (organizations.logo_icon_url); shown above the heading when set. */
  logoUrl?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header values must never contain CR/LF (SMTP header injection). */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
}

export function cardLinkEmail({
  homeownerName,
  orgName,
  url,
  accountUrl,
  failedPayment,
  expiresInDays = 7,
  brandColor,
  logoUrl,
}: CardLinkEmailInput): { subject: string; html: string; text: string } {
  // The tenant's exact color fills the button (spec decision 3); the derived
  // ramp supplies an AA-passing label and a link ink that stays readable on
  // white. Using the raw accent hex when it IS the legible ink keeps the
  // default output byte-identical to the pre-branding template.
  const accent = brandColor && HEX_RE.test(brandColor) ? brandColor.toUpperCase() : NEXXUS_BRAND_HEX;
  const ramp = deriveBrandRamp(accent);
  const buttonFg = channelsToHex(ramp.foreground600);
  const ink = ramp.inkOnLight === ramp.steps[600] ? accent : channelsToHex(ramp.inkOnLight);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;

  const safeOrg = escapeHtml(orgName);
  const greetingName = (homeownerName ?? '').trim();
  const greeting = greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hi,';
  const safeUrl = escapeHtml(url);
  const safeAccountUrl = accountUrl ? escapeHtml(accountUrl) : null;

  // "your cleaning on June 24 ($100.00)" with graceful omission of missing parts.
  const cleaningRef = failedPayment
    ? `your cleaning${failedPayment.dateLabel ? ` on ${failedPayment.dateLabel}` : ''}${
        failedPayment.amountLabel ? ` (${failedPayment.amountLabel})` : ''
      }`
    : '';

  const subject = sanitizeHeaderValue(
    failedPayment
      ? `Action needed: your payment to ${orgName} did not go through`
      : `Update your payment method for ${orgName}`,
  );
  const preheader = failedPayment
    ? failedPayment.reason === 'no_card'
      ? 'A card is needed to pay for your recent cleaning. Add one to get this resolved.'
      : 'Your card could not be charged for your recent cleaning. Update it to get this resolved.'
    : 'Add or update the card on file for your cleanings. It takes about a minute.';
  const heading = failedPayment ? 'Your payment did not go through' : 'Update your card on file';
  const leadHtml = failedPayment
    ? failedPayment.reason === 'verification'
      ? `Your bank needs extra verification before the payment for ${escapeHtml(cleaningRef)} can go through, so ${safeOrg} has not been paid yet. Please update or re-confirm your card using the secure link below. If you have questions, contact ${safeOrg} directly.`
      : failedPayment.reason === 'no_card'
        ? `There is no card on file for ${escapeHtml(cleaningRef)}, so ${safeOrg} has not been paid yet. Please add a card using the secure link below. If you have questions, contact ${safeOrg} directly.`
        : `The card on file was declined for ${escapeHtml(cleaningRef)}, so ${safeOrg} has not been paid yet. Please update your card using the secure link below. If you have questions, contact ${safeOrg} directly.`
    : `${safeOrg} keeps a card on file to pay for your cleanings. Use the secure link below to add or update your card. It takes about a minute.`;

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
                    ? `<img src="${safeLogoUrl}" alt="${safeOrg}" height="32" style="display:block;height:32px;max-width:200px;margin:0 0 24px 0;" />`
                    : `<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;color:${ink};">${safeOrg}</p>`
                }
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#211E1A;">${heading}</h1>
                <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:#211E1A;">${greeting}</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#211E1A;">${leadHtml}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:10px;background-color:${accent};">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-family:${fontStack};font-size:15px;font-weight:600;color:${buttonFg};text-decoration:none;border-radius:10px;">Update payment method</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6B6459;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:${ink};text-decoration:underline;">${safeUrl}</a></p>${
                  safeAccountUrl
                    ? `
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:#6B6459;">Prefer not to use payment links from email? <a href="${safeAccountUrl}" style="color:${ink};text-decoration:underline;">Sign in to your account</a> and update your card from the Payment methods page.</p>`
                    : ''
                }
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6B6459;">This link is just for you and expires in ${expiresInDays} days. Your card details go directly to our payment processor and are never stored by ${safeOrg}.${
                  failedPayment ? '' : ' If you were not expecting this email, you can ignore it.'
                }</p>
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

  const leadText = failedPayment
    ? failedPayment.reason === 'verification'
      ? `Your bank needs extra verification before the payment for ${cleaningRef} can go through, so ${orgName} has not been paid yet. Update or re-confirm your card with this secure link, or contact ${orgName} if you have questions:`
      : failedPayment.reason === 'no_card'
        ? `There is no card on file for ${cleaningRef}, so ${orgName} has not been paid yet. Add a card with this secure link, or contact ${orgName} if you have questions:`
        : `The card on file was declined for ${cleaningRef}, so ${orgName} has not been paid yet. Update your card with this secure link, or contact ${orgName} if you have questions:`
    : `${orgName} keeps a card on file to pay for your cleanings. Use this secure link to add or update your card:`;

  const text = [
    greetingName ? `Hi ${greetingName},` : 'Hi,',
    '',
    leadText,
    '',
    url,
    '',
    ...(accountUrl
      ? [`Prefer not to use payment links from email? Sign in to your account and update your card from the Payment methods page: ${accountUrl}`, '']
      : []),
    `This link is just for you and expires in ${expiresInDays} days.${failedPayment ? '' : ' If you were not expecting this email, you can ignore it.'}`,
    '',
    `Sent by ${orgName} via Nexxus`,
  ].join('\n');

  return { subject, html, text };
}
