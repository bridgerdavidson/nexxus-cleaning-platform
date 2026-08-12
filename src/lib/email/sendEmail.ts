import { emailConfigured, getTransport } from './transport';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Sender display name, e.g. the tenant org's name (white-label: the inbox row
   * then reads "Sparkles Cleaning", not the platform). The ADDRESS always stays
   * EMAIL_FROM's — it is the Brevo-verified sender that SPF/DKIM sign for.
   * Omitted/blank = EMAIL_FROM verbatim (its own display name included).
   */
  fromName?: string;
}

/** EMAIL_FROM may be a bare address or a 'Display Name <addr>' string; extract the addr. */
function fromAddress(): string {
  const raw = (process.env.EMAIL_FROM ?? '').trim();
  const m = /<([^<>]+)>\s*$/.exec(raw);
  return m ? m[1].trim() : raw;
}

/**
 * Build the nodemailer `from` value. Exported for unit tests. The display name is
 * operator-settable input, so CR/LF and control chars are stripped here (nodemailer
 * then RFC-2047-encodes whatever remains, so quotes/unicode in org names are safe).
 */
export function resolveFrom(fromName?: string): string | { name: string; address: string } {
  const name = (fromName ?? '').replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  if (!name) return process.env.EMAIL_FROM as string;
  return { name, address: fromAddress() };
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
export async function sendEmail({ to, subject, html, text, fromName }: SendEmailInput): Promise<void> {
  const transport = getTransport();
  await transport.sendMail({ from: resolveFrom(fromName), to, subject, html, text });
}

export { emailConfigured };
