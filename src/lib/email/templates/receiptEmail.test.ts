import { describe, it, expect } from 'vitest';
import { receiptEmail, type ReceiptEmailInput } from './receiptEmail';

const BASE: ReceiptEmailInput = {
  kind: 'charge_succeeded',
  homeownerName: 'Sarah Test',
  orgName: 'Sparkle Cleaning',
  amountLabel: '$123.45',
  dateLabel: 'June 24',
  propertyLabel: 'Maple Ave',
  receiptsUrl: 'https://app.example.com/homeowner/account/receipts',
};

describe('receiptEmail', () => {
  it('charge receipt: subject carries the amount and org; body carries the cleaning reference', () => {
    const { subject, html, text } = receiptEmail(BASE);
    expect(subject).toBe('Receipt: $123.45 paid to Sparkle Cleaning');
    expect(html).toContain('Payment received');
    expect(html).toContain('Maple Ave');
    expect(html).toContain('June 24');
    expect(text).toContain('$123.45');
    expect(text).toContain('no action is needed');
  });

  it('refund: sets expectations for the 5 to 10 day bank delay', () => {
    const { subject, html } = receiptEmail({ ...BASE, kind: 'refund_issued' });
    expect(subject).toBe('Your $123.45 refund from Sparkle Cleaning is on the way');
    expect(html).toContain('5 to 10 business days');
  });

  it('fee: no_show and cancellation reasons pick the right wording', () => {
    const noShow = receiptEmail({ ...BASE, kind: 'cancellation_fee_charged', feeReason: 'no_show' });
    expect(noShow.subject).toBe('Receipt: $123.45 no-show fee from Sparkle Cleaning');
    const cancel = receiptEmail({ ...BASE, kind: 'cancellation_fee_charged', feeReason: 'cancellation' });
    expect(cancel.subject).toBe('Receipt: $123.45 cancellation fee from Sparkle Cleaning');
    expect(cancel.html).toContain('cancellation fee');
  });

  it('degrades gracefully with no amount, date, property, or receipts URL', () => {
    const { subject, html, text } = receiptEmail({
      ...BASE,
      amountLabel: null,
      dateLabel: null,
      propertyLabel: null,
      receiptsUrl: null,
    });
    expect(subject).toBe('Receipt for your payment to Sparkle Cleaning');
    expect(html).not.toContain('View your receipts');
    expect(text).not.toContain('View your receipts');
    expect(html).toContain('your cleaning.');
  });

  it('escapes operator-settable values in the HTML', () => {
    const { html } = receiptEmail({
      ...BASE,
      orgName: '<b>Sparkle & Shine</b>',
      propertyLabel: '<img src=x>',
    });
    expect(html).not.toContain('<b>Sparkle');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;b&gt;Sparkle &amp; Shine&lt;/b&gt;');
  });

  it('strips header-injection characters from the subject', () => {
    const { subject } = receiptEmail({ ...BASE, orgName: 'Evil\r\nBcc: victim@example.com' });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('contains no em dashes in any variant (user-facing copy rule)', () => {
    for (const kind of ['charge_succeeded', 'refund_issued', 'cancellation_fee_charged'] as const) {
      const { subject, html, text } = receiptEmail({ ...BASE, kind, feeReason: 'no_show' });
      expect(subject).not.toContain('—');
      expect(html).not.toContain('—');
      expect(text).not.toContain('—');
    }
  });

  it('falls back to Nexxus branding without crashing on a missing/invalid brand color', () => {
    const ok = receiptEmail({ ...BASE, brandColor: null, logoUrl: null });
    expect(ok.html).toContain('Sparkle Cleaning');
    const invalid = receiptEmail({ ...BASE, brandColor: 'not-a-hex' });
    expect(invalid.html).toContain('Sparkle Cleaning');
  });
});
