import { emailConfigured, getTransport } from './transport';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send one transactional email over the configured SMTP transport.
 *
 * Isolated in its own module (mirroring src/lib/auth/passwordReset.ts) so route
 * integration tests can `vi.mock('@/lib/email/sendEmail')` without touching
 * nodemailer. Routes should import BOTH sendEmail and emailConfigured from here
 * so a single mock covers the whole delivery decision.
 *
 * Throws when SMTP is unconfigured or the provider rejects the send; callers
 * decide whether that is fatal (for card links it is not: fall back to copy).
 */
export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<void> {
  const transport = getTransport();
  await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, html, text });
}

export { emailConfigured };
