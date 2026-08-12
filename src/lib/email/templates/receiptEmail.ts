/**
 * Homeowner money receipt email (audit T2-1b): pure { subject, html, text }
 * builder, no I/O. One template, three variants keyed by the notification
 * event type it delivers:
 *
 *   - charge_succeeded        → "Payment received" (the receipt)
 *   - refund_issued           → "Refund on the way"
 *   - cancellation_fee_charged → "A fee was charged" (cancel / no-show)
 *
 * Branding, escaping, and header hardening mirror cardLinkEmail.ts exactly
 * (same warm neutrals, same tenant brand ramp for the button + link ink, same
 * escapeHtml / sanitizeHeaderValue rules). Copy matches the in-app bell
 * wording (labels.ts describeHomeownerMoneyEvent) so the two surfaces tell
 * one story.
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

export type ReceiptEmailKind =
  | 'charge_succeeded'
  | 'refund_issued'
  | 'cancellation_fee_charged';

export interface ReceiptEmailInput {
  kind: ReceiptEmailKind;
  /** Recipient display name; falls back to a generic greeting when empty. */
  homeownerName: string | null;
  /** The cleaning company's name (the merchant the homeowner knows). */
  orgName: string;
  /** Preformatted, e.g. "$123.45". Null when the emit had no amount. */
  amountLabel: string | null;
  /** Preformatted, e.g. "June 24". Server-derived from the appointment. */
  dateLabel: string | null;
  propertyLabel: string | null;
  /** cancellation_fee_charged only: drives "no-show fee" vs "cancellation fee". */
  feeReason?: 'no_show' | 'cancellation' | null;
  /** Full https URL to the homeowner's receipts page, built from APP_URL. Null = omit the button. */
  receiptsUrl?: string | null;
  /** The org's brand hex (organizations.brand_color); null/invalid = Nexxus blue. */
  brandColor?: string | null;
  /** The org's icon URL (organizations.logo_icon_url); shown above the heading when set. */
  logoUrl?: string | null;
}

export function receiptEmail({
  kind,
  homeownerName,
  orgName,
  amountLabel,
  dateLabel,
  propertyLabel,
  feeReason,
  receiptsUrl,
  brandColor,
  logoUrl,
}: ReceiptEmailInput): { subject: string; html: string; text: string } {
  const accent = brandColor && HEX_RE.test(brandColor) ? brandColor.toUpperCase() : NEXXUS_BRAND_HEX;
  const ramp = deriveBrandRamp(accent);
  const buttonFg = channelsToHex(ramp.foreground600);
  const ink = ramp.inkOnLight === ramp.steps[600] ? accent : channelsToHex(ramp.inkOnLight);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;

  const safeOrg = escapeHtml(orgName);
  const greetingName = (homeownerName ?? '').trim();
  const greeting = greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hi,';
  const safeReceiptsUrl = receiptsUrl ? escapeHtml(receiptsUrl) : null;

  // "your cleaning at Maple Ave on June 24", omitting whatever is missing.
  const cleaningRef = `your cleaning${propertyLabel ? ` at ${propertyLabel}` : ''}${
    dateLabel ? ` on ${dateLabel}` : ''
  }`;
  const safeCleaningRef = escapeHtml(cleaningRef);

  const feeKind = feeReason === 'no_show' ? 'no-show fee' : 'cancellation fee';

  let subject: string;
  let preheader: string;
  let heading: string;
  let leadHtml: string;
  let leadText: string;

  switch (kind) {
    case 'charge_succeeded':
      subject = amountLabel
        ? `Receipt: ${amountLabel} paid to ${orgName}`
        : `Receipt for your payment to ${orgName}`;
      preheader = 'Your cleaning payment went through. This is your receipt.';
      heading = 'Payment received';
      leadHtml = `Your card on file was charged${amountLabel ? ` ${escapeHtml(amountLabel)}` : ''} for ${safeCleaningRef}. This is your receipt, and no action is needed. If anything looks wrong, reply to this email or contact ${safeOrg} directly.`;
      leadText = `Your card on file was charged${amountLabel ? ` ${amountLabel}` : ''} for ${cleaningRef}. This is your receipt, and no action is needed. If anything looks wrong, contact ${orgName} directly.`;
      break;
    case 'refund_issued':
      subject = amountLabel
        ? `Your ${amountLabel} refund from ${orgName} is on the way`
        : `Your refund from ${orgName} is on the way`;
      preheader = 'Your refund was issued. It reaches your card in 5 to 10 days.';
      heading = 'Refund on the way';
      leadHtml = `${safeOrg} issued you a refund${amountLabel ? ` of ${escapeHtml(amountLabel)}` : ''} for ${safeCleaningRef}. It typically reaches your card in 5 to 10 business days, depending on your bank.`;
      leadText = `${orgName} issued you a refund${amountLabel ? ` of ${amountLabel}` : ''} for ${cleaningRef}. It typically reaches your card in 5 to 10 business days, depending on your bank.`;
      break;
    case 'cancellation_fee_charged':
      subject = amountLabel
        ? `Receipt: ${amountLabel} ${feeKind} from ${orgName}`
        : `Receipt: ${feeKind} from ${orgName}`;
      preheader = `A ${feeKind} was charged to your card on file. This is your receipt.`;
      heading = `A ${feeKind} was charged`;
      leadHtml = `Your card on file was charged${amountLabel ? ` a ${escapeHtml(amountLabel)} ${feeKind}` : ` a ${feeKind}`} for ${safeCleaningRef}. This is your receipt. If you have questions about this fee, contact ${safeOrg} directly.`;
      leadText = `Your card on file was charged${amountLabel ? ` a ${amountLabel} ${feeKind}` : ` a ${feeKind}`} for ${cleaningRef}. This is your receipt. If you have questions about this fee, contact ${orgName} directly.`;
      break;
  }

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
                    ? // Width AND height attrs, hard-bounded, for Outlook's Word engine
                      // (same reasoning as cardLinkEmail).
                      `<img src="${safeLogoUrl}" alt="${safeOrg}" width="32" height="32" style="display:block;width:32px;height:32px;object-fit:contain;margin:0 0 24px 0;" />`
                    : `<p style="margin:0 0 24px 0;font-size:14px;font-weight:700;color:${ink};">${safeOrg}</p>`
                }
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#211E1A;">${heading}</h1>
                <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:#211E1A;">${greeting}</p>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#211E1A;">${leadHtml}</p>${
                  safeReceiptsUrl
                    ? `
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:10px;background-color:${accent};">
                      <a href="${safeReceiptsUrl}" style="display:inline-block;padding:12px 24px;font-family:${fontStack};font-size:15px;font-weight:600;color:${buttonFg};text-decoration:none;border-radius:10px;">View your receipts</a>
                    </td>
                  </tr>
                </table>`
                    : ''
                }
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6B6459;">Your card details are handled by our payment processor and are never stored by ${safeOrg}.</p>
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
    leadText,
    '',
    ...(receiptsUrl ? [`View your receipts: ${receiptsUrl}`, ''] : []),
    `Sent by ${orgName} via Nexxus`,
  ].join('\n');

  return { subject: sanitizeHeaderValue(subject), html, text };
}
