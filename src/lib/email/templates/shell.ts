/**
 * Shared shell for transactional emails: the design system translated to
 * email-safe HTML (inline styles, tables, no scripts, no external CSS).
 *
 * Email clients render roughly 2005-era HTML, so the app's primitives exist
 * here as string builders instead of components:
 * - emailShell: the card-on-canvas frame (warm canvas, white card, 22px card
 *   radius, soft-lg shadow, bordered footer bar)
 * - pillButton: the Button primitive at `lg` (pill, 48px tall, semibold 16px)
 * - linkFallback: the paste-this-link block + single-use note
 *
 * Templates compose these so the whole outbox reads as one product. Color and
 * radius values mirror the LIGHT theme in src/app/globals.css / tailwind
 * config as literals, deliberately: emails cannot read CSS variables, and the
 * light palette is the email palette (inbox dark modes recolor on their own).
 *
 * Rendering caveats (accepted): border-radius and box-shadow are ignored by
 * desktop Outlook, which falls back to a clean bordered rectangle; everything
 * else is solid-color table layout and holds everywhere.
 *
 * All values interpolated into these builders must ALREADY be escaped by the
 * caller (escapeHtml for HTML context, sanitizeHeaderValue for headers).
 */

export const EMAIL_FONT_STACK =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Light-theme neutrals, mirrored from globals.css. */
export const EMAIL_COLORS = {
  canvas: '#F7F6F3',
  card: '#FFFFFF',
  border: '#E6E2DB',
  divider: '#F0EDE7',
  ink: '#211E1A',
  muted: '#6B6459',
} as const;

/** Header values must never contain CR/LF (SMTP header injection). */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
}

/**
 * The document frame. `bodyHtml` is one or more complete `<tr>` rows of the
 * 560px card table (a hero row may claim the top corners with its own
 * `border-radius:22px 22px 0 0`); the footer bar row is appended here so every
 * email ends the same way.
 */
export function emailShell({
  preheader,
  bodyHtml,
  footerHtml,
}: {
  preheader: string;
  bodyHtml: string;
  footerHtml: string;
}): string {
  const c = EMAIL_COLORS;
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:${c.canvas};">
    <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${c.canvas};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${c.card};border:1px solid ${c.border};border-radius:22px;box-shadow:0 14px 34px rgba(20,18,15,0.12), 0 4px 10px rgba(20,18,15,0.06);">
            ${bodyHtml}
            <tr>
              <td style="padding:16px 32px;border-top:1px solid ${c.border};font-family:${EMAIL_FONT_STACK};">
                ${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The Button primitive at `lg`: pill radius, 48px tall (14+20+14), 32px side
 * padding, semibold 16px. Solid td background so it renders in every client;
 * the radius quietly squares off in desktop Outlook.
 */
export function pillButton({
  href,
  label,
  bg,
  fg,
}: {
  href: string;
  label: string;
  bg: string;
  fg: string;
}): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px 0;">
                  <tr>
                    <td style="border-radius:9999px;background-color:${bg};">
                      <a href="${href}" style="display:inline-block;padding:14px 32px;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:20px;font-weight:600;color:${fg};text-decoration:none;border-radius:9999px;">${label}</a>
                    </td>
                  </tr>
                </table>`;
}

/**
 * The paste-fallback block: plain link for clients that mangle the button,
 * then the single-use reassurance note. `ink` is the template's link color
 * (Nexxus blue, or the org's ramp-derived ink for white-label emails).
 */
export function linkFallback({ url, ink }: { url: string; ink: string }): string {
  const c = EMAIL_COLORS;
  return `<p style="margin:0 0 6px 0;font-size:13px;line-height:1.6;color:${c.muted};">Or paste this link into your browser:</p>
                <p style="margin:0 0 18px 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${url}" style="color:${ink};text-decoration:underline;">${url}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:${c.muted};">This link is for you only and can be used once. If you weren't expecting it, you can safely ignore this email.</p>`;
}
