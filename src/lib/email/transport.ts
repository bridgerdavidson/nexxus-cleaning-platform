import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Lazy SMTP transport over the org's Brevo account (the same account that already
 * delivers Supabase auth email, so the sending domain is verified).
 *
 * Server-only env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM.
 * All five must be set for email delivery to be considered configured; callers
 * fall back to copy-link behavior otherwise. Never throws at import time.
 */

let transporter: Transporter | null = null;

export function emailConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.EMAIL_FROM
  );
}

export function getTransport(): Transporter {
  if (!emailConfigured()) {
    throw new Error('SMTP is not configured (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM)');
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587 (Brevo's default) upgrades via STARTTLS. requireTLS
      // makes the upgrade mandatory: without it a STARTTLS-stripping MITM could force
      // the credentials + tokened card link onto a plaintext connection. A failed
      // upgrade then errors the send, which callers already degrade to copy-link.
      secure: port === 465,
      requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

/** Test-only: drop the cached transport so env changes take effect. */
export function resetTransportForTests(): void {
  transporter = null;
}
