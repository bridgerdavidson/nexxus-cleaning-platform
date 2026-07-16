/**
 * Card-collection link email: pure { subject, html, text } builder, no I/O.
 *
 * Email HTML cannot use the Tailwind design system, so the brand tokens are
 * mirrored here as inline styles (brand-600 #0150FC, warm-50 canvas #F7F6F3,
 * warm-900 text #211E1A, warm-600 muted #6B6459, warm-200 border #E6E2DB;
 * source of truth: src/app/globals.css + tailwind.config.js).
 *
 * Every interpolated dynamic value is escaped: homeowner and org names are
 * operator-settable input, not self-owned. Only the server-built `url` carries
 * the link token, and it is escaped too (defense in depth; it is server-built
 * from APP_URL + a base64url token, so escaping never alters a legit URL).
 */

export interface CardLinkEmailInput {
  /** Recipient display name; falls back to a generic greeting when empty. */
  homeownerName: string | null;
  /** The cleaning company's name (shown as the actor; "Nexxus" is only the platform). */
  orgName: string;
  /** Full https URL to the hosted add-card page, built server-side from APP_URL. */
  url: string;
  expiresInDays?: number;
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
  expiresInDays = 7,
}: CardLinkEmailInput): { subject: string; html: string; text: string } {
  const safeOrg = escapeHtml(orgName);
  const greetingName = (homeownerName ?? '').trim();
  const greeting = greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hi,';
  const safeUrl = escapeHtml(url);

  const subject = sanitizeHeaderValue(`Update your payment method for ${orgName}`);

  const fontStack =
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#F7F6F3;">
    <div style="display:none;max-height:0;overflow:hidden;">Add or update the card on file for your cleanings. It takes about a minute.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F6F3;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E6E2DB;border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 24px 32px;font-family:${fontStack};">
                <p style="margin:0 0 24px 0;font-size:14px;font-weight:700;color:#0150FC;">${safeOrg}</p>
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#211E1A;">Update your card on file</h1>
                <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:#211E1A;">${greeting}</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#211E1A;">${safeOrg} keeps a card on file to pay for your cleanings. Use the secure link below to add or update your card. It takes about a minute.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:10px;background-color:#0150FC;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-family:${fontStack};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">Update payment method</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6B6459;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:#0150FC;text-decoration:underline;">${safeUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6B6459;">This link is just for you and expires in ${expiresInDays} days. Your card details go directly to our payment processor and are never stored by ${safeOrg}. If you were not expecting this email, you can ignore it.</p>
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
    greetingName ? `Hi ${greetingName},` : 'Hi,',
    '',
    `${orgName} keeps a card on file to pay for your cleanings. Use this secure link to add or update your card:`,
    '',
    url,
    '',
    `This link is just for you and expires in ${expiresInDays} days. If you were not expecting this email, you can ignore it.`,
    '',
    `Sent by ${orgName} via Nexxus`,
  ].join('\n');

  return { subject, html, text };
}
